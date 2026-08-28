use std::net::{IpAddr, SocketAddr, ToSocketAddrs};

use super::errors::NativeMailErrorDto;

pub fn resolve_verified_loopback(host: &str, port: u16) -> Result<SocketAddr, NativeMailErrorDto> {
    let addresses: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|_| NativeMailErrorDto::unavailable("host_resolution_failed"))?
        .collect();
    choose_verified_loopback(&addresses)
}

fn choose_verified_loopback(addresses: &[SocketAddr]) -> Result<SocketAddr, NativeMailErrorDto> {
    if addresses.is_empty() {
        return Err(NativeMailErrorDto::unavailable("host_resolution_failed"));
    }
    if addresses.iter().any(|address| !address.ip().is_loopback()) {
        return Err(NativeMailErrorDto::unsupported("loopback_required"));
    }
    addresses
        .iter()
        .copied()
        .find(|address| matches!(address.ip(), IpAddr::V4(_)))
        .or_else(|| addresses.first().copied())
        .ok_or_else(|| NativeMailErrorDto::unavailable("host_resolution_failed"))
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

    use super::{choose_verified_loopback, resolve_verified_loopback};

    fn v4(value: [u8; 4]) -> SocketAddr {
        SocketAddr::new(IpAddr::V4(Ipv4Addr::from(value)), 1143)
    }

    fn v6(value: Ipv6Addr) -> SocketAddr {
        SocketAddr::new(IpAddr::V6(value), 1143)
    }

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

    #[test]
    fn chooses_only_from_the_once_validated_set_and_prefers_ipv4() {
        let ipv4 = v4([127, 0, 0, 1]);
        let ipv6 = v6(Ipv6Addr::LOCALHOST);
        assert_eq!(choose_verified_loopback(&[ipv4]).expect("IPv4"), ipv4);
        assert_eq!(choose_verified_loopback(&[ipv6]).expect("IPv6"), ipv6);
        let validated = [ipv6, ipv4];
        let selected = choose_verified_loopback(&validated).expect("mixed loopback family");
        assert_eq!(selected, ipv4);
        assert!(validated.contains(&selected));
    }

    #[test]
    fn rejects_empty_mixed_and_non_loopback_sets() {
        let loopback = v4([127, 0, 0, 1]);
        let public = v4([8, 8, 8, 8]);
        let private = v4([192, 168, 1, 10]);
        assert_eq!(
            choose_verified_loopback(&[]).expect_err("empty").code,
            Some("host_resolution_failed")
        );
        assert_eq!(
            choose_verified_loopback(&[loopback, public])
                .expect_err("mixed set must fail")
                .code,
            Some("loopback_required")
        );
        assert_eq!(
            choose_verified_loopback(&[private])
                .expect_err("non-loopback must fail")
                .code,
            Some("loopback_required")
        );
    }
}
