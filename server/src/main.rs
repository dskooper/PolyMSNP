// polymsnp main backend code
// abandon all hope ye who enter here

mod client_message;
mod message_handlers;
mod server_message;

use crate::client_message::ClientMessage;
use crate::message_handlers::handle_client_message;
use crate::server_message::ServerMessage;
use axum::{
    extract::State,
    extract::Query,
    http::{header, HeaderMap, HeaderValue},
    response::{IntoResponse, Json},
    Router,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    routing::{get, post},
};
use futures::{SinkExt, StreamExt};
use msnp11_sdk::{client::Client, switchboard_server::switchboard::Switchboard};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock, mpsc};
use tower_http::{services::ServeDir, trace::TraceLayer};
use tracing::{error, info};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;
use local_ip_address::local_ip;

type Session = Arc<Mutex<Option<Client>>>;
type Switchboards = Arc<RwLock<HashMap<String, Arc<Switchboard>>>>;
type PendingSwitchboards = Arc<RwLock<Vec<Arc<Switchboard>>>>;
type UserEmail = Arc<RwLock<Option<String>>>;
type EventSender = Arc<Mutex<Option<mpsc::UnboundedSender<ServerMessage>>>>;
type SessionStore = Arc<RwLock<HashMap<String, Arc<AppState>>>>;
type EventLog = Arc<RwLock<Vec<(u64, ServerMessage)>>>;

#[derive(Clone)]
pub struct AppState {
    session_id: String,
    session: Session,
    switchboards: Switchboards,
    event_tx: EventSender,
    pending_switchboards: PendingSwitchboards,
    user_email: UserEmail,
    display_name: Arc<RwLock<Option<String>>>,
    personal_message: Arc<RwLock<Option<String>>>,
    event_log: EventLog,
    next_event_id: Arc<Mutex<u64>>,
    history: Arc<RwLock<Vec<ServerMessage>>>,
    persistent: Arc<Mutex<bool>>,
}

#[derive(Clone)]
struct ServerContext {
    sessions: SessionStore,
}

fn new_app_state(session_id: String, persistent: bool) -> AppState {
    AppState {
        session_id,
        session: Arc::new(Mutex::new(None)),
        switchboards: Arc::new(RwLock::new(HashMap::new())),
        event_tx: Arc::new(Mutex::new(None)),
        pending_switchboards: Arc::new(RwLock::new(Vec::new())),
        user_email: Arc::new(RwLock::new(None)),
        display_name: Arc::new(RwLock::new(None)),
        personal_message: Arc::new(RwLock::new(None)),
        event_log: Arc::new(RwLock::new(Vec::new())),
        next_event_id: Arc::new(Mutex::new(1)),
        history: Arc::new(RwLock::new(Vec::new())),
        persistent: Arc::new(Mutex::new(persistent)),
    }
}

impl AppState {
    async fn set_own_display_name(&self, display_name: Option<String>) {
        *self.display_name.write().await = display_name;
    }

    async fn set_own_personal_message(&self, personal_message: Option<String>) {
        *self.personal_message.write().await = personal_message;
    }

    async fn own_profile_snapshot(&self) -> (Option<String>, Option<String>) {
        let display_name = self.display_name.read().await.clone();
        let personal_message = self.personal_message.read().await.clone();
        (display_name, personal_message)
    }

    async fn append_event_message(&self, message: ServerMessage) {
        let mut next_event_id = self.next_event_id.lock().await;
        let event_id = *next_event_id;
        *next_event_id += 1;
        self.event_log.write().await.push((event_id, message));
    }

    async fn event_messages_since(&self, cursor: u64) -> (Vec<ServerMessage>, u64) {
        let events = self.event_log.read().await;
        let mut messages = Vec::new();
        let mut latest_cursor = cursor;

        for (event_id, message) in events.iter() {
            if *event_id > cursor {
                messages.push(message.clone());
                latest_cursor = *event_id;
            }
        }

        (messages, latest_cursor)
    }
}

fn parse_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let cookie_header = headers.get(header::COOKIE)?.to_str().ok()?;
    let needle = format!("{}=", name);

    for part in cookie_header.split(';') {
        let trimmed = part.trim();
        if trimmed.starts_with(&needle) {
            return Some(trimmed[needle.len()..].to_string());
        }
    }

    None
}

fn session_cookie_value(session_id: &str) -> String {
    format!(
        "polymsnp_session={}; Path=/; HttpOnly; SameSite=Lax",
        session_id
    )
}

fn cleared_session_cookie() -> String {
    "polymsnp_session=deleted; Path=/; Max-Age=0; HttpOnly; SameSite=Lax".to_string()
}

pub async fn publish_server_message(state: &AppState, message: ServerMessage) {
    if !matches!(
        message,
        ServerMessage::Authenticated
            | ServerMessage::Redirected { .. }
            | ServerMessage::Error { .. }
            | ServerMessage::Disconnected
    ) {
        state.history.write().await.push(message.clone());
        state.append_event_message(message.clone()).await;
    }

    if let Some(sender) = state.event_tx.lock().await.as_ref().cloned() {
        let _ = sender.send(message);
    }
}

pub async fn attach_websocket(state: &AppState, sender: mpsc::UnboundedSender<ServerMessage>) {
    *state.event_tx.lock().await = Some(sender.clone());

    if *state.persistent.lock().await {
        let _ = sender.send(ServerMessage::Authenticated);

        let history = state.history.read().await.clone();
        for message in history {
            let _ = sender.send(message);
        }
    }
}

pub async fn detach_websocket(state: &AppState) {
    *state.event_tx.lock().await = None;
}

pub async fn cleanup_session_state(state: &AppState) {
    // If we still have a connected client, set presence to offline so contacts see us as signed out
    if let Some(guard) = state.session.lock().await.take() {
        // move client out of the option and set presence offline
        let _ = guard.set_presence(msnp11_sdk::MsnpStatus::AppearOffline).await;
        // drop client to close underlying connections
    }

    for (_email, switchboard) in state.switchboards.write().await.drain() {
        let _ = switchboard.disconnect().await;
    }

    state.pending_switchboards.write().await.clear();
    state.history.write().await.clear();
    *state.user_email.write().await = None;
    *state.session.lock().await = None;
    *state.event_tx.lock().await = None;
}

async fn persist_session(ctx: &ServerContext, state: Arc<AppState>) {
    ctx.sessions
        .write()
        .await
        .insert(state.session_id.clone(), state);
}

async fn remove_session(ctx: &ServerContext, session_id: &str) -> Option<Arc<AppState>> {
    ctx.sessions.write().await.remove(session_id)
}

async fn handle_login_request(
    State(ctx): State<ServerContext>,
    Json(payload): Json<ClientMessage>,
) -> impl IntoResponse {
    if let ClientMessage::Login {
        email,
        password,
        server,
        port,
        nexus_url,
        config_server: _,
    } = payload
    {
        let session_id = Uuid::new_v4().to_string();
        let state = Arc::new(new_app_state(session_id.clone(), true));

        let result = crate::message_handlers::handle_login(
            email,
            password,
            server,
            port,
            nexus_url,
            &session_id,
            &state,
        )
        .await;

        match result {
            Some(ServerMessage::Authenticated) => {
                persist_session(&ctx, state.clone()).await;
                let (display_name, personal_message) = state.own_profile_snapshot().await;
                let email = state.user_email.read().await.clone().unwrap_or_default();
                (
                    [(header::SET_COOKIE, HeaderValue::from_str(&session_cookie_value(&session_id)).unwrap())],
                    Json(serde_json::json!({
                        "type": "authenticated",
                        "email": email,
                        "display_name": display_name.unwrap_or_default(),
                        "personal_message": personal_message.unwrap_or_default()
                    })),
                )
                    .into_response()
            }
            Some(ServerMessage::Redirected { server, port }) => {
                cleanup_session_state(&state).await;
                Json(ServerMessage::Redirected { server, port }).into_response()
            }
            Some(ServerMessage::Error { message }) => {
                cleanup_session_state(&state).await;
                Json(ServerMessage::Error { message }).into_response()
            }
            _ => Json(ServerMessage::Error {
                message: "Login failed".to_string(),
            })
            .into_response(),
        }
    } else {
        Json(ServerMessage::Error {
            message: "Invalid login request".to_string(),
        })
        .into_response()
    }
}

async fn handle_logout_request(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Some(session_id) = parse_cookie(&headers, "polymsnp_session") {
        if let Some(state) = remove_session(&ctx, &session_id).await {
            *state.persistent.lock().await = false;
            cleanup_session_state(&state).await;
        }
    }

    (
        [(header::SET_COOKIE, HeaderValue::from_str(&cleared_session_cookie()).unwrap())],
        Json(ServerMessage::Disconnected),
    )
        .into_response()
}

async fn handle_session_request(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
 ) -> impl IntoResponse {
    use serde_json::json;

    if let Some(session_id) = parse_cookie(&headers, "polymsnp_session") {
        if let Some(state) = ctx.sessions.read().await.get(&session_id).cloned() {
            let email_opt = state.user_email.read().await.clone();

            let (display_name, personal_message) = state.own_profile_snapshot().await;

            let resp = json!({
                "type": "authenticated",
                "email": email_opt.unwrap_or_default(),
                "display_name": display_name.unwrap_or_default(),
                "personal_message": personal_message.unwrap_or_default()
            });

            return ([(header::CONTENT_TYPE, HeaderValue::from_static("application/json"))], Json(resp)).into_response();
        }
    }

    Json(ServerMessage::Disconnected).into_response()
}

#[derive(Deserialize)]
struct PollQuery {
    cursor: Option<u64>,
}

async fn handle_poll_request(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
    Query(query): Query<PollQuery>,
) -> impl IntoResponse {
    use serde_json::json;

    if let Some(session_id) = parse_cookie(&headers, "polymsnp_session") {
        if let Some(state) = ctx.sessions.read().await.get(&session_id).cloned() {
            let cursor = query.cursor.unwrap_or(0);
            let mut messages: Vec<ServerMessage> = Vec::new();
            let mut latest_cursor = cursor;

            // If the client is asking from cursor 0, include the historical replay so
            // legacy polling clients see the initial contact list and presence state.
            if cursor == 0 {
                let hist = state.history.read().await.clone();
                for m in hist.into_iter() {
                    messages.push(m);
                }
            }

            // Now append any newer events from the event log
            let (mut newer, new_cursor) = state.event_messages_since(cursor).await;
            if !newer.is_empty() {
                for m in newer.drain(..) {
                    messages.push(m);
                }
                latest_cursor = new_cursor;
            }

            let resp = json!({
                "type": "events",
                "cursor": latest_cursor,
                "messages": messages,
            });

            return ([(header::CONTENT_TYPE, HeaderValue::from_static("application/json"))], Json(resp)).into_response();
        }
    }

    Json(ServerMessage::Disconnected).into_response()
}

async fn handle_command_request(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
    Json(payload): Json<ClientMessage>,
) -> impl IntoResponse {
    if let Some(session_id) = parse_cookie(&headers, "polymsnp_session") {
        if let Some(state) = ctx.sessions.read().await.get(&session_id).cloned() {
            if let ClientMessage::Login { .. } = payload {
                return Json(ServerMessage::Error {
                    message: "Login must use /api/login".to_string(),
                })
                .into_response();
            }

            if let Some(response) = handle_client_message(payload, &session_id, &state).await {
                return Json(response).into_response();
            }

            return Json(serde_json::json!({ "type": "ok" })).into_response();
        }
    }

    Json(ServerMessage::Disconnected).into_response()
}

#[tokio::main]
async fn main() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new("debug")
            .add_directive("hyper::proto::h1::conn=warn".parse().unwrap())
            .add_directive("hyper::proto::h1::io=warn".parse().unwrap())
            .add_directive("tokio::io=error".parse().unwrap())
            .add_directive("msnp11_sdk=warn".parse().unwrap())
            .add_directive("tokio::net=error".parse().unwrap())
            .add_directive("tokio::task=warn".parse().unwrap())
            .add_directive("tungstenite=warn".parse().unwrap())
            .add_directive("tokio_tungstenite=warn".parse().unwrap())
    });

    tracing_subscriber::registry()
        .with(filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_target(false)
                .compact(),
        )
        .init();

    let ctx = ServerContext {
        sessions: Arc::new(RwLock::new(HashMap::new())),
    };

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/login", post(handle_login_request))
        .route("/api/command", post(handle_command_request))
        .route("/api/poll", get(handle_poll_request))
        .route("/api/logout", post(handle_logout_request))
        .route("/api/session", get(handle_session_request))
        .fallback_service(ServeDir::new("static"))
        .layer(TraceLayer::new_for_http())
        .with_state(ctx);

    // POLY -> 7659 (T9)
    let listener = tokio::net::TcpListener::bind("0.0.0.0:7659")
        .await
        .unwrap();

    info!("Web server listening on 0.0.0.0, port 7659");
    info!("Your server's IP address is {}", local_ip().unwrap());
    axum::serve(listener, app).await.unwrap();
}

async fn ws_handler(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let session_state = if let Some(session_id) = parse_cookie(&headers, "polymsnp_session") {
        ctx.sessions.read().await.get(&session_id).cloned()
    } else {
        None
    };

    ws.on_upgrade(move |socket| handle_socket(socket, session_state))
}

async fn handle_socket(socket: WebSocket, session_state: Option<Arc<AppState>>) {
    let (mut sender, mut receiver) = socket.split();
    let state = if let Some(state) = session_state {
        state
    } else {
        Arc::new(new_app_state(Uuid::new_v4().to_string(), false))
    };

    info!(
        "[WEBSOCKET] New WebSocket connection established - Session ID: {}",
        state.session_id
    );

    // create event channel for this connection
    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    attach_websocket(&state, event_tx).await;

    // spawn task to forward events to websocket

    let forward_task = tokio::spawn(async move {
        while let Some(msg) = event_rx.recv().await {
            if let Ok(json) = serde_json::to_string(&msg)
                && let Err(_e) = sender.send(Message::Text(json.into())).await
            {
                // Client probably disconnected, stop forwarding
                // Suppress error logging for normal disconnections
                break;
            }
        }
    });

    while let Some(result) = receiver.next().await {
        match result {
            Ok(Message::Text(text)) => {
                let response = match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(client_msg) => {
                        info!(
                            "[WEBSOCKET] Parsed client message successfully for session: {}",
                            state.session_id
                        );
                        handle_client_message(client_msg, &state.session_id, &state).await
                    }
                    Err(e) => {
                        error!(
                            "[WEBSOCKET] Failed to parse message for session: {} - Error: {} - Raw message: {}",
                            state.session_id, e, text
                        );
                        Some(ServerMessage::Error {
                            message: format!("Invalid message format: {}", e),
                        })
                    }
                };

                if let Some(response) = response {
                    publish_server_message(&state, response).await;
                }
            }
            Ok(Message::Close(_)) => {
                // Client closed connection gracefully
                break;
            }
            Ok(_) => {
                // Ignore ping/pong and other message types
            }
            Err(_) => {
                // Connection error - client probably disconnected abruptly
                // Suppress normal disconnection errors (Winsock 10053/10052)
                // These are: WSAECONNABORTED (10053) and WSAENETRESET (10052)
                // Only log if it's an unexpected error
                break;
            }
        }
    }

    detach_websocket(&state).await;

    if !*state.persistent.lock().await {
        cleanup_session_state(&state).await;
    }

    // Wait for forward task to finish
    let _ = forward_task.await;

    info!("WebSocket connection closed: {}", state.session_id);
}
