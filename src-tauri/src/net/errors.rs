use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeMailErrorDto {
    pub kind: NativeMailErrorKind,
    pub retry: NativeMailRetry,
    pub session: NativeMailSessionDisposition,
    pub outcome: NativeMailOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<&'static str>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NativeMailErrorKind {
    Auth,
    Network,
    Unavailable,
    Protocol,
    MalformedRemoteData,
    StateInvalid,
    Conflict,
    Unsupported,
    RateLimited,
    TooLarge,
    Rejected,
    Unexpected,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NativeMailRetry {
    Never,
    SafeImmediate,
    SafeBackoff,
    Reconcile,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NativeMailSessionDisposition {
    Keep,
    Expire,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NativeMailOutcome {
    NotApplicable,
    KnownNotApplied,
    Unknown,
}

impl NativeMailErrorDto {
    pub fn unavailable(code: &'static str) -> Self {
        Self {
            kind: NativeMailErrorKind::Unavailable,
            retry: NativeMailRetry::SafeBackoff,
            session: NativeMailSessionDisposition::Expire,
            outcome: NativeMailOutcome::KnownNotApplied,
            code: Some(code),
        }
    }

    pub fn auth() -> Self {
        Self {
            kind: NativeMailErrorKind::Auth,
            retry: NativeMailRetry::Never,
            session: NativeMailSessionDisposition::Expire,
            outcome: NativeMailOutcome::KnownNotApplied,
            code: Some("authentication_failed"),
        }
    }

    pub fn protocol(code: &'static str) -> Self {
        Self {
            kind: NativeMailErrorKind::Protocol,
            retry: NativeMailRetry::Never,
            session: NativeMailSessionDisposition::Expire,
            outcome: NativeMailOutcome::KnownNotApplied,
            code: Some(code),
        }
    }

    pub fn state_invalid(code: &'static str) -> Self {
        Self {
            kind: NativeMailErrorKind::StateInvalid,
            retry: NativeMailRetry::Never,
            session: NativeMailSessionDisposition::Keep,
            outcome: NativeMailOutcome::KnownNotApplied,
            code: Some(code),
        }
    }

    pub fn session_absent() -> Self {
        Self {
            kind: NativeMailErrorKind::StateInvalid,
            retry: NativeMailRetry::Never,
            session: NativeMailSessionDisposition::Expire,
            outcome: NativeMailOutcome::NotApplicable,
            code: Some("native_session_absent"),
        }
    }

    pub fn conflict(code: &'static str) -> Self {
        Self {
            kind: NativeMailErrorKind::Conflict,
            retry: NativeMailRetry::SafeImmediate,
            session: NativeMailSessionDisposition::Keep,
            outcome: NativeMailOutcome::KnownNotApplied,
            code: Some(code),
        }
    }

    pub fn unsupported(code: &'static str) -> Self {
        Self {
            kind: NativeMailErrorKind::Unsupported,
            retry: NativeMailRetry::Never,
            session: NativeMailSessionDisposition::Keep,
            outcome: NativeMailOutcome::KnownNotApplied,
            code: Some(code),
        }
    }

    pub fn rejected(code: &'static str) -> Self {
        Self {
            kind: NativeMailErrorKind::Rejected,
            retry: NativeMailRetry::Never,
            session: NativeMailSessionDisposition::Keep,
            outcome: NativeMailOutcome::KnownNotApplied,
            code: Some(code),
        }
    }

    pub fn transient(code: &'static str) -> Self {
        Self {
            kind: NativeMailErrorKind::Unavailable,
            retry: NativeMailRetry::SafeBackoff,
            session: NativeMailSessionDisposition::Keep,
            outcome: NativeMailOutcome::KnownNotApplied,
            code: Some(code),
        }
    }

    pub fn too_large() -> Self {
        Self {
            kind: NativeMailErrorKind::TooLarge,
            retry: NativeMailRetry::Never,
            session: NativeMailSessionDisposition::Keep,
            outcome: NativeMailOutcome::KnownNotApplied,
            code: Some("message_too_large"),
        }
    }

    pub fn ambiguous(code: &'static str) -> Self {
        Self {
            kind: NativeMailErrorKind::Network,
            retry: NativeMailRetry::Reconcile,
            session: NativeMailSessionDisposition::Keep,
            outcome: NativeMailOutcome::Unknown,
            code: Some(code),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::NativeMailErrorDto;

    #[test]
    fn serialized_error_is_sanitized_and_remote_compatible() {
        let value = serde_json::to_value(NativeMailErrorDto::ambiguous("smtp_acceptance_unknown"))
            .expect("error serializes");
        assert_eq!(value["kind"], "network");
        assert_eq!(value["retry"], "reconcile");
        assert_eq!(value["session"], "keep");
        assert_eq!(value["outcome"], "unknown");
        assert_eq!(value["code"], "smtp_acceptance_unknown");
        assert_eq!(value.as_object().map(|object| object.len()), Some(5));
    }
}
