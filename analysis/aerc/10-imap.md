# 10 - IMAP

[COMPROBADO — `worker/imap/`]

El backend IMAP de aerc es el más rico y maduro de los tres clientes analizados, demostrando cómo exprimir IMAP al máximo en un cliente interactivo.

## IMAP IDLE (RFC 2177)
La característica más importante. El Idler mantiene la conexión TCP abierta en espera de notificaciones del servidor, convirtiendo a IMAP de un protocolo pull a push. Cuando hay acciones pendientes del usuario, el Idler se detiene gracefully (cerrando el canal `stop`) para liberar la conexión y permitir el comando.

Detalles de implementación (`idler.go`):
*   **Debounce:** El Idler no arranca inmediatamente. Espera 10ms tras la última acción antes de activarse, para evitar entrar y salir de IDLE en ráfagas cortas de comandos del usuario.
*   **Timeout:** Si el servidor no responde al cierre del IDLE en 10 segundos, el Idler reporta un `errIdleTimeout` y el Worker termina la conexión (la reconexión está gestionada por `observer.go`).

## SeqMap: Resolución de Secuencias
IMAP es un protocolo donde los mensajes tienen dos identificadores: un número de secuencia (`SeqNum`, relativo y cambia al borrar mensajes) y un UID (permanente). Aerc mantiene un `SeqMap` (`seqmap.go`) — un array que mapea posición secuencial a UID — para poder interpretar los `ExpungeUpdate` del servidor que solo hablan en términos de números de secuencia.

## Detección de Proveedor
El Worker detecta automáticamente el tipo de servidor IMAP conectado revisando las Capabilities:
*   Si anuncia `X-GM-EXT-1` → Gmail.
*   Si anuncia `Proton-WebDAV-Support` → Proton.
Esto le permite adaptar comportamientos especiales (ej. Google tiene extensiones propias para labels).

## Extensiones Soportadas
*   **SORT (RFC 5256):** Si el servidor soporta ordenamiento, aerc lo usa. Si no, hace sort client-side.
*   **THREAD (RFC 5256):** Si el servidor soporta threading (Referencias o Asunto Ordenado), aerc lo usa para agrupar conversaciones.
*   **LIST-STATUS (RFC 5819):** Combina `LIST` y `STATUS` en un solo comando para obtener carpetas + conteos en un RTT.
*   **UIDPLUS (RFC 4315):** Para operaciones de copia/movimiento con UIDs autoritativos.
