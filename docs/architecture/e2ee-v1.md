# Boxplot E2EE V1

## Estado y alcance

BOXPLOT-E2EE-V1 implementa cifrado autenticado extremo a extremo, neutral respecto de JMAP, IMAP, SMTP y MIME. Protege `text` y `html` antes de la entrega al transporte remoto. `From`, `To`, `Subject`, fecha, Message-ID, hora de envío y tamaño aproximado permanecen visibles al servidor. El Subject también se incluye dentro del contenido cifrado para detectar modificaciones al descifrar.

No protege adjuntos ni Subject exterior. V1 admite exactamente un destinatario efectivo cuando Persona C integre `SendIntent`: un `to`, ningún `cc` y ningún `bcc`. Esa restricción pertenece a la capacidad E2EE, no modifica el Domain.

## Algoritmo y envelope

Rust usa `libsodium-rs 0.2.4` y su `crypto_box`: X25519 + XSalsa20 + Poly1305. Cada mensaje usa un nonce aleatorio nuevo de 24 bytes generado por libsodium. Las claves pública y privada son de 32 bytes. No existen cifras, MAC, KDF ni nonces propios.

El envelope transportable es JSON camelCase:

```json
{
  "version": 1,
  "algorithm": "boxplot-crypto-box-v1",
  "sender": "alice@boxplot.test",
  "recipient": "bob@boxplot.test",
  "senderPublicKey": "<base64url-public-key>",
  "recipientPublicKey": "<base64url-public-key>",
  "nonce": "<base64url-nonce>",
  "ciphertext": "<base64url-ciphertext>"
}
```

Las claves del envelope son solamente datos de cross-check. La clave pública del remitente confiada localmente y la clave pública derivada de la privada local del destinatario son las autoridades. Versión, algoritmo, identities, claves, nonce, autenticación, JSON y metadata interior se validan antes de devolver plaintext; cualquier fallo cierra la operación sin plaintext parcial.

El payload interior tiene `version`, `sender`, `recipient`, `subject`, `text` y `html`. Persona C será responsable de envolver/desenvolver el envelope como MIME (`application/vnd.boxplot.e2ee+json`) sin introducir esa responsabilidad en crypto.

## Claves y confianza

Cada identity autenticada exacta posee un keypair estático de largo plazo. No se normaliza el identificador. La clave privada permanece exclusivamente en el secure store nativo bajo un slot `private-v1/<identity-base64url>` y nunca atraviesa IPC, TypeScript, SQLCipher, logs ni configuración. Solo la clave pública es exportable.

Las claves peer se intercambian manualmente fuera de banda y se guardan en `peer-v1/<local-base64url>/<peer-base64url>`. Guardar la misma clave es idempotente; intentar reemplazarla falla con `keyMismatch`. No hay descubrimiento automático, PKI, TOFU replacement, key transparency ni rotación en V1.

Los servicios E2EE están separados de los servicios `.local-cache` y del usuario `sqlcipher-dek-v1`. Resetear/recrear SQLCipher no elimina claves E2EE ni confianza peer. El reset E2EE es otra operación, solo Development y protegida por confirmación explícita.

## Fronteras

`ManagedE2eeService` es independiente de `ManagedLocalEngine`. Los cinco comandos `e2ee_*` forman una capacidad nativa separada; los 25 comandos `local_*` de Local Engine IPC v1 no cambian. TypeScript consume `E2eePort` mediante `TauriE2eeAdapter`, sin Vue, Pinia ni protocolo remoto. El helper puro `encryptSendIntent` aplica el subconjunto de un destinatario y devuelve `multipleRecipientsUnsupported` sin modificar `SendIntent`.

Tras descifrar, Persona C puede construir un `EmailBody` completo y persistir plaintext por el `SyncPort` existente. Ese plaintext queda protegido en reposo por SQLCipher para conservar lectura offline. No se añaden columnas de ciphertext ni cambios de schema.

## Limitaciones aceptadas

Los keypairs estáticos de `crypto_box` no ofrecen forward secrecy: comprometer una private key futura puede hacer descifrable tráfico histórico capturado. Tampoco existe recuperación; perder la private key puede hacer permanentemente indecriptable el correo remoto anterior. Multi-device, backup remoto, rotación/revocación, recovery phrases, key transparency, descubrimiento, fingerprints UX, adjuntos cifrados, Subject cifrado, grupos y múltiples destinatarios quedan diferidos.
