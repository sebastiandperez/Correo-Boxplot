use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    sync::Arc,
    time::Duration,
};

use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned, pki_types::ServerName};

use super::errors::NativeMailErrorDto;

pub enum MailStream {
    Plain(TcpStream),
    Tls(Box<StreamOwned<ClientConnection, TcpStream>>),
}

impl Read for MailStream {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        match self {
            Self::Plain(value) => value.read(buffer),
            Self::Tls(value) => value.read(buffer),
        }
    }
}
impl Write for MailStream {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        match self {
            Self::Plain(value) => value.write(buffer),
            Self::Tls(value) => value.write(buffer),
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Self::Plain(value) => value.flush(),
            Self::Tls(value) => value.flush(),
        }
    }
}

pub fn connect_plain(
    endpoint: SocketAddr,
    connect_timeout: Duration,
    command_timeout: Duration,
) -> Result<MailStream, NativeMailErrorDto> {
    let stream = TcpStream::connect_timeout(&endpoint, connect_timeout)
        .map_err(|_| NativeMailErrorDto::unavailable("mail_connect_failed"))?;
    configure(&stream, command_timeout)?;
    Ok(MailStream::Plain(stream))
}

pub fn connect_tls(
    host: &str,
    port: u16,
    connect_timeout: Duration,
    command_timeout: Duration,
) -> Result<MailStream, NativeMailErrorDto> {
    let stream = TcpStream::connect_timeout(
        &(host, port)
            .to_socket_addrs()
            .map_err(|_| NativeMailErrorDto::unavailable("gmail_resolution_failed"))?
            .next()
            .ok_or_else(|| NativeMailErrorDto::unavailable("gmail_resolution_failed"))?,
        connect_timeout,
    )
    .map_err(|_| NativeMailErrorDto::unavailable("gmail_tls_connect_failed"))?;
    configure(&stream, command_timeout)?;
    let mut roots = RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let server_name = ServerName::try_from(host.to_owned())
        .map_err(|_| NativeMailErrorDto::protocol("gmail_tls_hostname_invalid"))?;
    let connection = ClientConnection::new(Arc::new(config), server_name)
        .map_err(|_| NativeMailErrorDto::protocol("gmail_tls_setup_failed"))?;
    Ok(MailStream::Tls(Box::new(StreamOwned::new(
        connection, stream,
    ))))
}

fn configure(stream: &TcpStream, timeout: Duration) -> Result<(), NativeMailErrorDto> {
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|_| NativeMailErrorDto::unavailable("mail_timeout_setup_failed"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|_| NativeMailErrorDto::unavailable("mail_timeout_setup_failed"))
}
