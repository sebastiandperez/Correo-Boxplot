use zeroize::Zeroizing;

pub const DEK_LENGTH: usize = 32;

pub struct Dek(Zeroizing<[u8; DEK_LENGTH]>);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidDekLength {
    pub actual: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DekGenerationError;

impl Dek {
    pub fn generate() -> Result<Self, DekGenerationError> {
        let mut bytes = Zeroizing::new([0_u8; DEK_LENGTH]);
        getrandom::fill(bytes.as_mut()).map_err(|_| DekGenerationError)?;
        Ok(Self(bytes))
    }

    pub fn from_secret(secret: Vec<u8>) -> Result<Self, InvalidDekLength> {
        let secret = Zeroizing::new(secret);
        if secret.len() != DEK_LENGTH {
            return Err(InvalidDekLength {
                actual: secret.len(),
            });
        }
        let mut bytes = Zeroizing::new([0_u8; DEK_LENGTH]);
        bytes.copy_from_slice(secret.as_slice());
        Ok(Self(bytes))
    }

    pub(crate) fn expose(&self) -> &[u8; DEK_LENGTH] {
        &self.0
    }
}

impl From<[u8; DEK_LENGTH]> for Dek {
    fn from(value: [u8; DEK_LENGTH]) -> Self {
        Self(Zeroizing::new(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dek_requires_exact_length_and_generation_is_not_zero() {
        assert_eq!(
            Dek::from_secret(vec![1; 31]).err(),
            Some(InvalidDekLength { actual: 31 })
        );
        assert_eq!(
            Dek::from_secret(vec![1; 33]).err(),
            Some(InvalidDekLength { actual: 33 })
        );
        let generated = Dek::generate().expect("OS random source is available");
        assert_ne!(generated.expose(), &[0_u8; DEK_LENGTH]);
    }
}
