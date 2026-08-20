use crate::persistence::PersistenceError;

use super::dto::{
    IpcError, IpcFalse, IpcReadErrorKind, IpcReadResult, IpcResult, IpcWriteErrorKind,
    IpcWriteResult,
};

pub fn read_error<T>(error: PersistenceError) -> IpcReadResult<T> {
    let kind = match error {
        PersistenceError::CorruptState(_) => IpcReadErrorKind::CorruptState,
        PersistenceError::Serialization(_) => IpcReadErrorKind::Unexpected,
        PersistenceError::Conflict => IpcReadErrorKind::Unexpected,
        PersistenceError::EncryptionUnavailable
        | PersistenceError::Migration(_)
        | PersistenceError::Storage(_) => IpcReadErrorKind::Unavailable,
    };
    IpcResult::Error {
        ok: IpcFalse,
        error: IpcError { kind },
    }
}

pub fn write_error(error: PersistenceError) -> IpcWriteResult {
    let kind = match error {
        PersistenceError::Conflict => IpcWriteErrorKind::Conflict,
        PersistenceError::CorruptState(_) => IpcWriteErrorKind::CorruptState,
        PersistenceError::Serialization(_) => IpcWriteErrorKind::Unexpected,
        PersistenceError::EncryptionUnavailable
        | PersistenceError::Migration(_)
        | PersistenceError::Storage(_) => IpcWriteErrorKind::Unavailable,
    };
    IpcResult::Error {
        ok: IpcFalse,
        error: IpcError { kind },
    }
}

pub fn unavailable_read<T>() -> IpcReadResult<T> {
    IpcResult::Error {
        ok: IpcFalse,
        error: IpcError {
            kind: IpcReadErrorKind::Unavailable,
        },
    }
}
pub fn unavailable_write() -> IpcWriteResult {
    IpcResult::Error {
        ok: IpcFalse,
        error: IpcError {
            kind: IpcWriteErrorKind::Unavailable,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semantic_errors_map_to_frozen_envelope_categories() {
        assert!(matches!(
            read_error::<()>(PersistenceError::CorruptState("invalid row".into())),
            IpcResult::Error {
                error: IpcError {
                    kind: IpcReadErrorKind::CorruptState
                },
                ..
            }
        ));
        assert!(matches!(
            write_error(PersistenceError::Conflict),
            IpcResult::Error {
                error: IpcError {
                    kind: IpcWriteErrorKind::Conflict
                },
                ..
            }
        ));
        assert!(matches!(
            unavailable_read::<()>(),
            IpcResult::Error {
                error: IpcError {
                    kind: IpcReadErrorKind::Unavailable
                },
                ..
            }
        ));
    }
}
