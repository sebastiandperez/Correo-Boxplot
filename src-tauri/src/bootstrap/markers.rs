use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

use super::BootstrapFailure;

pub fn create_durable(path: &Path) -> Result<(), BootstrapFailure> {
    let mut marker = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path)
        .map_err(|_| BootstrapFailure::LocalDataUnavailable)?;
    if marker
        .metadata()
        .map_err(|_| BootstrapFailure::LocalDataUnavailable)?
        .len()
        == 0
    {
        marker
            .write_all(b"v1\n")
            .map_err(|_| BootstrapFailure::LocalDataUnavailable)?;
    }
    marker
        .flush()
        .and_then(|()| marker.sync_all())
        .map_err(|_| BootstrapFailure::LocalDataUnavailable)?;
    sync_parent(path)
}

pub fn remove_durable(path: &Path) -> Result<(), BootstrapFailure> {
    match fs::remove_file(path) {
        Ok(()) => sync_parent(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(BootstrapFailure::LocalDataUnavailable),
    }
}

#[cfg(unix)]
fn sync_parent(path: &Path) -> Result<(), BootstrapFailure> {
    let parent = path
        .parent()
        .ok_or(BootstrapFailure::LocalDataUnavailable)?;
    std::fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| BootstrapFailure::LocalDataUnavailable)
}

#[cfg(not(unix))]
fn sync_parent(_path: &Path) -> Result<(), BootstrapFailure> {
    Ok(())
}
