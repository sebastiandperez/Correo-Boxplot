use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::State;

use super::GoogleOAuthService;
use crate::net::errors::NativeMailErrorDto;

#[derive(Default)]
pub struct ManagedGoogleOAuth {
    service: Mutex<Option<Arc<GoogleOAuthService>>>,
}

impl ManagedGoogleOAuth {
    pub fn service(&self) -> Result<Arc<GoogleOAuthService>, NativeMailErrorDto> {
        let mut value = self
            .service
            .lock()
            .map_err(|_| NativeMailErrorDto::unavailable("oauth_service_unavailable"))?;
        if value.is_none() {
            *value = Some(Arc::new(GoogleOAuthService::new()?));
        }
        value
            .clone()
            .ok_or_else(|| NativeMailErrorDto::unavailable("oauth_service_unavailable"))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleAuthorizeRequest {
    pub account_key: String,
    pub username: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleAuthorizeResponse {
    pub credential_ref: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GoogleForgetRequest {
    pub credential_ref: String,
}

#[tauri::command]
pub fn native_google_oauth_authorize(
    request: GoogleAuthorizeRequest,
    oauth: State<'_, ManagedGoogleOAuth>,
) -> Result<GoogleAuthorizeResponse, NativeMailErrorDto> {
    if request.username.trim().is_empty() || !request.username.contains('@') {
        return Err(NativeMailErrorDto::rejected("google_username_invalid"));
    }
    let credential_ref = oauth
        .service()?
        .authorize(&request.account_key, &request.username)?;
    Ok(GoogleAuthorizeResponse { credential_ref })
}

#[tauri::command]
pub fn native_google_oauth_forget(
    request: GoogleForgetRequest,
    oauth: State<'_, ManagedGoogleOAuth>,
) -> Result<(), NativeMailErrorDto> {
    oauth.service()?.forget(&request.credential_ref)
}
