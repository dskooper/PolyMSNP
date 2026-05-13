use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "redirected")]
    Redirected { server: String, port: u16 },
    #[serde(rename = "authenticated")]
    Authenticated,
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "contact")]
    Contact {
        email: String,
        display_name: String,
        lists: Vec<String>,
        groups: Option<Vec<String>>,
    },
    #[serde(rename = "group")]
    Group { name: String, guid: String },
    #[serde(rename = "presenceUpdate")]
    PresenceUpdate {
        email: String,
        display_name: String,
        status: String,
        client_id: Option<u64>,
    },
    #[serde(rename = "personalMessageUpdate")]
    PersonalMessageUpdate {
        email: String,
        message: String,
        current_media: String,
    },
    #[serde(rename = "contactOffline")]
    ContactOffline { email: String },
    #[serde(rename = "addedBy")]
    AddedBy { email: String, display_name: String },
    #[serde(rename = "removedBy")]
    RemovedBy { email: String },
    #[serde(rename = "conversationReady")]
    ConversationReady { email: String },
    #[serde(rename = "textMessage")]
    TextMessage {
        email: String,
        message: String,
        color: Option<String>,
    },
    #[serde(rename = "nudge")]
    Nudge { email: String },
    #[serde(rename = "typing")]
    Typing { email: String },
    #[serde(rename = "participantJoined")]
    ParticipantJoined { email: String },
    #[serde(rename = "participantLeft")]
    ParticipantLeft { email: String },
    #[serde(rename = "displayPicture")]
    DisplayPicture { email: String, data: String },
    #[serde(rename = "displayName")]
    DisplayName { display_name: String },
    #[serde(rename = "disconnected")]
    Disconnected,
}
