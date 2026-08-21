use super::Dek;

pub enum DekLookup {
    Absent,
    Present(Dek),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DekStoreError {
    Unavailable,
    Corrupt,
    InvalidStoredDek,
    Configuration,
}

pub trait DekStore: Send + Sync {
    fn load(&self) -> Result<DekLookup, DekStoreError>;
    fn store(&self, dek: &Dek) -> Result<(), DekStoreError>;
    fn delete(&self) -> Result<(), DekStoreError>;
}
