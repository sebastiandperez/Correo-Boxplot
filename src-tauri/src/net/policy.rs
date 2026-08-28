use std::net::{IpAddr, SocketAddr, ToSocketAddrs};

use super::errors::NativeMailErrorDto;

pub fn resolve_verified_loopback(host: &str, port: u16) -> Result<SocketAddr, NativeMailErrorDto> {
    let addresses: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|_| NativeMailErrorDto::unavailable("host_resolution_failed"))?
        .collect();
    if addresses.is_empty() || addresses.iter().any(|address| !address.ip().is_loopback()) {
        return Err(NativeMailErrorDto::unsupported("loopback_required"));
    }
    addresses
        .into_iter()
        .find(|address| matches!(address.ip(), IpAddr::V4(_)))
        .or_else(|| (host, port).to_socket_addrs().ok()?.next())
        .ok_or_else(|| NativeMailErrorDto::unavailable("host_resolution_failed"))
}

#[cfg(test)]
mod tests {
    use super::resolve_verified_loopback;

    #[test]
    fn accepts_loopback_literals_and_localhost() {
        assert!(resolve_verified_loopback("127.0.0.1", 1143).is_ok());
        assert!(resolve_verified_loopback("127.99.1.2", 1143).is_ok());
        assert!(resolve_verified_loopback("::1", 1143).is_ok());
        assert!(resolve_verified_loopback("localhost", 1143).is_ok());
    }

    #[test]
    fn rejects_non_loopback_before_connecting() {
        for host in ["192.168.1.10", "10.0.0.1", "8.8.8.8"] {
            let error = resolve_verified_loopback(host, 1143).expect_err("must fail closed");
            assert_eq!(error.code, Some("loopback_required"));
        }
    }
}
