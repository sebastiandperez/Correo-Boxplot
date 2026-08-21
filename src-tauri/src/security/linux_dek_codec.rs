use zeroize::Zeroizing;

use super::{Dek, DekStoreError};

const PREFIX: &str = "cbx-dek-v1:";

pub fn encode(dek: &Dek) -> Zeroizing<String> {
    use std::fmt::Write;

    let mut encoded = Zeroizing::new(String::with_capacity(PREFIX.len() + 64));
    encoded.push_str(PREFIX);
    for byte in dek.expose() {
        write!(encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    encoded
}

pub fn decode(secret: Vec<u8>) -> Result<Dek, DekStoreError> {
    if secret.len() == 32 {
        return Dek::from_secret(secret).map_err(|_| DekStoreError::InvalidStoredDek);
    }

    let secret = Zeroizing::new(secret);
    let encoded =
        std::str::from_utf8(secret.as_slice()).map_err(|_| DekStoreError::InvalidStoredDek)?;
    let payload = encoded
        .strip_prefix(PREFIX)
        .ok_or(DekStoreError::InvalidStoredDek)?;
    if payload.len() != 64
        || !payload
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        return Err(DekStoreError::InvalidStoredDek);
    }

    let mut decoded = Zeroizing::new([0_u8; 32]);
    for (index, pair) in payload.as_bytes().chunks_exact(2).enumerate() {
        decoded[index] = (hex_nibble(pair[0])? << 4) | hex_nibble(pair[1])?;
    }
    Ok(Dek::from(*decoded))
}

fn hex_nibble(value: u8) -> Result<u8, DekStoreError> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        _ => Err(DekStoreError::InvalidStoredDek),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v1_round_trips_every_representative_byte_shape() {
        for bytes in [
            [0_u8; 32],
            [0xff; 32],
            std::array::from_fn(|index| index as u8),
            std::array::from_fn(|index| if index % 2 == 0 { 0 } else { 0xff }),
        ] {
            let dek = Dek::from(bytes);
            let encoded = encode(&dek);
            assert_eq!(encoded.len(), PREFIX.len() + 64);
            assert!(encoded.starts_with(PREFIX));
            assert_eq!(
                decode(encoded.as_bytes().to_vec())
                    .expect("V1 decodes")
                    .expose(),
                &bytes
            );
        }
    }

    #[test]
    fn malformed_v1_and_invalid_legacy_lengths_are_rejected() {
        for invalid in [
            b"wrong:0000000000000000000000000000000000000000000000000000000000000000".to_vec(),
            b"cbx-dek-v1:00".to_vec(),
            format!("cbx-dek-v1:{}", "0".repeat(66)).into_bytes(),
            format!("cbx-dek-v1:{}", "G".repeat(64)).into_bytes(),
            vec![1; 31],
            vec![1; 33],
        ] {
            assert_eq!(decode(invalid).err(), Some(DekStoreError::InvalidStoredDek));
        }
    }

    #[test]
    fn legacy_raw_v0_preserves_exactly_32_bytes() {
        let legacy = std::array::from_fn(|index| (255 - index) as u8);
        assert_eq!(
            decode(legacy.to_vec())
                .expect("legacy V0 is readable")
                .expose(),
            &legacy
        );
    }
}
