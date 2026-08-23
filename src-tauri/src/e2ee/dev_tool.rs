use super::{E2eeError, PeerKeyStatus, development_service};
use crate::security::{DEMO1_IDENTIFIER, DEMO2_IDENTIFIER, DEVELOPMENT_IDENTIFIER};

pub fn run(arguments: impl Iterator<Item = String>) -> i32 {
    match execute(arguments.collect()) {
        Ok(output) => {
            if !output.is_empty() {
                println!("{output}");
            }
            0
        }
        Err(error) => {
            eprintln!("E2EE operation failed: {error}");
            1
        }
    }
}

fn execute(arguments: Vec<String>) -> Result<String, E2eeError> {
    let mut values = arguments.into_iter();
    if values.next().as_deref() != Some("--profile") {
        return Err(E2eeError::Unexpected);
    }
    let identifier = match values.next().as_deref() {
        Some("default") => DEVELOPMENT_IDENTIFIER,
        Some("demo1") => DEMO1_IDENTIFIER,
        Some("demo2") => DEMO2_IDENTIFIER,
        _ => return Err(E2eeError::Unavailable),
    };
    let service = development_service(identifier)?;
    match values.next().as_deref() {
        Some("ensure" | "print-public") => {
            let identity = values.next().ok_or(E2eeError::Unexpected)?;
            ensure_end(&mut values)?;
            Ok(service.ensure_local_identity(&identity)?.public_key)
        }
        Some("trust-peer") => {
            let local = values.next().ok_or(E2eeError::Unexpected)?;
            let peer = values.next().ok_or(E2eeError::Unexpected)?;
            let key = values.next().ok_or(E2eeError::Unexpected)?;
            ensure_end(&mut values)?;
            service.trust_peer_public_key(&local, &peer, &key)?;
            Ok("trusted".to_owned())
        }
        Some("peer-status") => {
            let local = values.next().ok_or(E2eeError::Unexpected)?;
            let peer = values.next().ok_or(E2eeError::Unexpected)?;
            ensure_end(&mut values)?;
            Ok(match service.peer_key_status(&local, &peer)? {
                PeerKeyStatus::Missing => "missing".to_owned(),
                PeerKeyStatus::Trusted { public_key } => format!("trusted {public_key}"),
            })
        }
        Some("reset-development-e2ee") => {
            if values.next().as_deref() != Some("--confirm-loss-of-e2ee-keys") {
                return Err(E2eeError::Unexpected);
            }
            ensure_end(&mut values)?;
            service.reset_development()?;
            Ok("reset".to_owned())
        }
        _ => Err(E2eeError::Unexpected),
    }
}

fn ensure_end(values: &mut impl Iterator<Item = String>) -> Result<(), E2eeError> {
    if values.next().is_none() {
        Ok(())
    } else {
        Err(E2eeError::Unexpected)
    }
}
