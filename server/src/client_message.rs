use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClientMessage {
    #[serde(rename = "login")]
    Login {
        email: String,
        password: String,
        server: String,
        port: u16,
        nexus_url: String,
        config_server: Option<String>,
    },
    #[serde(rename = "setPresence")]
    SetPresence { status: String },
    #[serde(rename = "setPersonalMessage")]
    SetPersonalMessage { message: String },
    #[serde(rename = "setDisplayName")]
    SetDisplayName { display_name: String },
    #[serde(rename = "addContact")]
    AddContact { email: String },
    #[serde(rename = "removeContact")]
    RemoveContact { email: String },
    #[serde(rename = "blockContact")]
    BlockContact { email: String },
    #[serde(rename = "unblockContact")]
    UnblockContact { email: String },
    #[serde(rename = "startConversation")]
    StartConversation { email: String },
    #[serde(rename = "sendMessage")]
    SendMessage { email: String, message: String },
    #[serde(rename = "sendNudge")]
    SendNudge { email: String },
    #[serde(rename = "sendTyping")]
    SendTyping { email: String },
    #[serde(rename = "closeConversation")]
    CloseConversation { email: String },
    #[serde(rename = "logout")]
    Logout,
}
