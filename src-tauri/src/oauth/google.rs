use std::{
    io::{Read, Write},
    net::TcpListener,
    time::{Duration, Instant},
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use url::Url;
use zeroize::{Zeroize, Zeroizing};

use super::store::GoogleRefreshTokenStore;
use crate::net::errors::NativeMailErrorDto;

const AUTHORIZE_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const MAIL_SCOPE: &str = "https://mail.google.com/";
const AUTHORIZE_TIMEOUT: Duration = Duration::from_secs(180);
const ACCESS_TOKEN_SAFETY_MARGIN: Duration = Duration::from_secs(60);

pub struct GoogleOAuthService {
    store: GoogleRefreshTokenStore,
}

pub struct GoogleAccessToken {
    value: Zeroizing<String>,
    expires_at: Instant,
}

impl GoogleAccessToken {
    fn new(value: String, expires_in: Option<u64>) -> Self {
        let lifetime = Duration::from_secs(expires_in.unwrap_or_default());
        Self {
            value: Zeroizing::new(value),
            expires_at: Instant::now() + lifetime,
        }
    }

    pub fn as_str(&self) -> &str {
        self.value.as_str()
    }

    pub fn is_usable(&self) -> bool {
        Instant::now()
            .checked_add(ACCESS_TOKEN_SAFETY_MARGIN)
            .is_some_and(|deadline| deadline < self.expires_at)
    }
}

impl GoogleOAuthService {
    pub fn new() -> Result<Self, NativeMailErrorDto> {
        Ok(Self {
            store: GoogleRefreshTokenStore::new()?,
        })
    }

    pub fn authorize(
        &self,
        account_key: &str,
        username: &str,
    ) -> Result<String, NativeMailErrorDto> {
        let client_id = google_client_id()?;
        let credential_ref = credential_ref_for_account(account_key);
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|_| NativeMailErrorDto::unavailable("oauth_callback_bind_failed"))?;
        listener
            .set_nonblocking(true)
            .map_err(|_| NativeMailErrorDto::unavailable("oauth_callback_setup_failed"))?;
        let redirect_uri = format!(
            "http://{}/",
            listener
                .local_addr()
                .map_err(|_| NativeMailErrorDto::unavailable("oauth_callback_setup_failed"))?
        );
        let mut state = random_urlsafe(32)?;
        let mut verifier = random_urlsafe(64)?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let authorize_url =
            authorization_url(&client_id, username, &redirect_uri, &state, &challenge)?;
        if authorize_url.scheme() != "https"
            || authorize_url.host_str() != Some("accounts.google.com")
        {
            state.zeroize();
            verifier.zeroize();
            return Err(NativeMailErrorDto::protocol("oauth_authorize_url_invalid"));
        }
        tauri_plugin_opener::open_url(authorize_url.as_str(), None::<&str>)
            .map_err(|_| NativeMailErrorDto::unavailable("oauth_browser_open_failed"))?;
        let code = wait_for_callback(&listener, &state)?;
        let exchanged = exchange_code(&client_id, &redirect_uri, &code, &verifier);
        state.zeroize();
        verifier.zeroize();
        let mut code = code;
        code.zeroize();
        let token = exchanged?;
        let mut refresh_token = Zeroizing::new(
            token
                .refresh_token
                .ok_or_else(|| NativeMailErrorDto::protocol("oauth_token_malformed"))?,
        );
        self.store.replace(&credential_ref, &refresh_token)?;
        refresh_token.zeroize();
        Ok(credential_ref)
    }

    pub fn forget(&self, credential_ref: &str) -> Result<(), NativeMailErrorDto> {
        self.store.forget(credential_ref)
    }

    pub fn refresh_access_token(
        &self,
        credential_ref: &str,
    ) -> Result<GoogleAccessToken, NativeMailErrorDto> {
        let refresh = self
            .store
            .load(credential_ref)?
            .ok_or_else(NativeMailErrorDto::auth)?;
        let client_id = google_client_id()?;
        let result = ureq::post(TOKEN_ENDPOINT).send_form([
            ("client_id", client_id.as_str()),
            ("refresh_token", refresh.as_str()),
            ("grant_type", "refresh_token"),
        ]);
        let mut refresh = refresh;
        refresh.zeroize();
        let mut response = match result {
            Ok(response) => response,
            Err(ureq::Error::StatusCode(400 | 401)) => {
                self.store.forget(credential_ref)?;
                return Err(NativeMailErrorDto::auth());
            }
            Err(_) => {
                return Err(NativeMailErrorDto::unavailable(
                    "oauth_token_network_failed",
                ));
            }
        };
        let token: TokenResponse = response
            .body_mut()
            .read_json()
            .map_err(|_| NativeMailErrorDto::protocol("oauth_token_malformed"))?;
        if token.token_type.as_deref() != Some("Bearer") || token.access_token.is_empty() {
            return Err(NativeMailErrorDto::protocol("oauth_token_malformed"));
        }
        Ok(GoogleAccessToken::new(token.access_token, token.expires_in))
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    token_type: Option<String>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

fn exchange_code(
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    verifier: &str,
) -> Result<TokenResponse, NativeMailErrorDto> {
    let mut response = ureq::post(TOKEN_ENDPOINT)
        .send_form([
            ("client_id", client_id),
            ("code", code),
            ("code_verifier", verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .map_err(|_| NativeMailErrorDto::unavailable("oauth_token_network_failed"))?;
    let token: TokenResponse = response
        .body_mut()
        .read_json()
        .map_err(|_| NativeMailErrorDto::protocol("oauth_token_malformed"))?;
    if token.token_type.as_deref() != Some("Bearer")
        || token.access_token.is_empty()
        || token.refresh_token.as_deref().is_none_or(str::is_empty)
        || !token
            .scope
            .as_deref()
            .is_some_and(|scope| scope.split_whitespace().any(|value| value == MAIL_SCOPE))
    {
        return Err(NativeMailErrorDto::protocol("oauth_token_malformed"));
    }
    Ok(token)
}

fn google_client_id() -> Result<String, NativeMailErrorDto> {
    option_env!("BOXPLOT_GOOGLE_OAUTH_CLIENT_ID")
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| NativeMailErrorDto::unsupported("google_oauth_client_id_missing"))
}

pub fn credential_ref_for_account(account_key: &str) -> String {
    format!(
        "gmail-oauth-v1/{}",
        url::form_urlencoded::byte_serialize(account_key.as_bytes()).collect::<String>()
    )
}

fn random_urlsafe(bytes: usize) -> Result<Zeroizing<String>, NativeMailErrorDto> {
    let mut value = vec![0_u8; bytes];
    getrandom::fill(&mut value)
        .map_err(|_| NativeMailErrorDto::unavailable("oauth_entropy_failed"))?;
    let output = Zeroizing::new(URL_SAFE_NO_PAD.encode(&value));
    value.zeroize();
    Ok(output)
}

fn authorization_url(
    client_id: &str,
    username: &str,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> Result<Url, NativeMailErrorDto> {
    let mut url = Url::parse(AUTHORIZE_ENDPOINT)
        .map_err(|_| NativeMailErrorDto::protocol("oauth_url_invalid"))?;
    url.query_pairs_mut().extend_pairs([
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("response_type", "code"),
        ("scope", MAIL_SCOPE),
        ("state", state),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("login_hint", username),
        ("access_type", "offline"),
        // This flow is only user-initiated. Asking consent again makes an
        // explicit reauthorization capable of replacing a revoked token.
        ("prompt", "consent"),
    ]);
    Ok(url)
}

fn wait_for_callback(
    listener: &TcpListener,
    expected_state: &str,
) -> Result<Zeroizing<String>, NativeMailErrorDto> {
    let deadline = Instant::now() + AUTHORIZE_TIMEOUT;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut request = [0_u8; 8192];
                let count = stream
                    .read(&mut request)
                    .map_err(|_| NativeMailErrorDto::protocol("oauth_callback_malformed"))?;
                let line = std::str::from_utf8(&request[..count])
                    .map_err(|_| NativeMailErrorDto::protocol("oauth_callback_malformed"))?
                    .lines()
                    .next()
                    .ok_or_else(|| NativeMailErrorDto::protocol("oauth_callback_malformed"))?;
                let path = line
                    .split_whitespace()
                    .nth(1)
                    .ok_or_else(|| NativeMailErrorDto::protocol("oauth_callback_malformed"))?;
                let url = Url::parse(&format!("http://localhost{path}"))
                    .map_err(|_| NativeMailErrorDto::protocol("oauth_callback_malformed"))?;
                let pairs: std::collections::HashMap<_, _> =
                    url.query_pairs().into_owned().collect();
                let valid = pairs
                    .get("state")
                    .is_some_and(|state| state_matches(expected_state, state));
                let code = pairs.get("code").filter(|_| valid).cloned();
                let _ = stream.write_all(if code.is_some() { b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\nAutorizaci&oacute;n completada. Puedes volver a Correo Boxplot." } else { b"HTTP/1.1 400 Bad Request\r\nContent-Type: text/html\r\n\r\nNo se pudo completar la autorizaci&oacute;n." });
                return code
                    .map(Zeroizing::new)
                    .ok_or_else(NativeMailErrorDto::auth);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Err(_) => return Err(NativeMailErrorDto::unavailable("oauth_callback_failed")),
        }
    }
    Err(NativeMailErrorDto::unavailable("oauth_callback_timeout"))
}

fn state_matches(expected: &str, received: &str) -> bool {
    if expected.len() != received.len() {
        return false;
    }
    expected
        .as_bytes()
        .iter()
        .zip(received.as_bytes())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[cfg(test)]
mod tests {
    use super::{
        GoogleAccessToken, MAIL_SCOPE, authorization_url, credential_ref_for_account, state_matches,
    };

    #[test]
    fn authorization_url_uses_loopback_pkce_and_mail_scope_without_a_client_secret() {
        let url = authorization_url(
            "desktop-client.apps.googleusercontent.com",
            "alice@gmail.com",
            "http://127.0.0.1:49152/",
            "state-canary",
            "s256-challenge",
        )
        .expect("authorization URL");
        let pairs = url
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(
            pairs.get("redirect_uri"),
            Some(&"http://127.0.0.1:49152/".into())
        );
        assert_eq!(pairs.get("code_challenge_method"), Some(&"S256".into()));
        assert_eq!(pairs.get("scope"), Some(&MAIL_SCOPE.into()));
        assert_eq!(pairs.get("prompt"), Some(&"consent".into()));
        assert!(!url.as_str().contains("client_secret"));
    }

    #[test]
    fn credential_reference_is_stable_and_contains_no_oauth_value() {
        let first = credential_ref_for_account("account-a");
        assert_eq!(first, credential_ref_for_account("account-a"));
        assert_ne!(first, credential_ref_for_account("account-b"));
        assert!(!first.contains("refresh"));
        assert!(!first.contains("access"));
    }

    #[test]
    fn oauth_state_requires_an_exact_match() {
        assert!(state_matches("same-state", "same-state"));
        assert!(!state_matches("same-state", "different"));
        assert!(!state_matches("same-state", "same-state-extra"));
    }

    #[test]
    fn access_token_uses_a_sixty_second_safety_margin() {
        assert!(!GoogleAccessToken::new("token".to_owned(), Some(60)).is_usable());
        assert!(GoogleAccessToken::new("token".to_owned(), Some(61)).is_usable());
    }
}
