# 14 - Lecciones de Arquitectura

## Decisiones que copiaría

1. **El patrón Actor/Worker con canales:** La separación absoluta entre UI y Red mediante canales tipados de Go (o el equivalente en Python: `asyncio.Queue` con dataclasses tipadas) es la mejor decisión de diseño de los tres clientes. No hay variables compartidas entre capas, no hay condiciones de carrera, los backends son completamente sustituibles.
2. **IMAP IDLE correctamente implementado:** Si nuestro backend Python tiene que hablar IMAP con servidores viejos, implementar IDLE es imprescindible para no hacer polling cada 30 segundos. El patrón de aerc (goroutine dedicada con señal de stop + debounce) es la referencia a seguir.
3. **LevelDB para caché de estado JMAP:** Usar una base de datos de clave-valor liviana para persistir únicamente los `state` tokens y los metadatos de correos (sin tener que persistir los cuerpos completos) es un enfoque más pragmático y portable que el SQLite completo de Stormbox para nuestro core Python.
4. **El SeqMap (SeqNum → UID):** Gestionar este mapa es imprescindible para cualquier cliente IMAP. Sin él, los `EXPUNGE` del servidor son imposibles de mapear a UIDs concretos. Deberemos replicarlo.

## Decisiones que adaptaría

1. **EventSource vs WebSockets para JMAP Push:** Aerc usa SSE (Server-Sent Events), que es más simple que WebSockets pero unidireccional. JMAP también define push por WebSockets. Para nuestro cliente Python, deberíamos admitir ambos según lo que soporte el servidor, comenzando por SSE (más fácil de implementar con `httpx` o `aiohttp`).
2. **Caché de blobs opcional:** La decisión de aerc de hacer la caché de cuerpos de mensajes opcional es sensata. Permite al usuario controlar el uso de disco. Deberíamos adoptar el mismo enfoque.

## Decisiones que evitaría

1. **Sin queue de mutaciones offline:** Aerc, igual que Himalaya, no tiene un Outbox de mutaciones. Si pierdes internet mientras borras un correo, la operación falla y tienes que repetirla. Para nuestro cliente JMAP-first, la cola de mutaciones (como en Stormbox) es crucial.
2. **Go-específico:** La arquitectura de goroutines + canales es elegante en Go. En Python, el equivalente limpio es `asyncio` con `asyncio.Queue`. No intentar replicar el modelo de hilos de Go en Python síncronamente; usar el event loop de `asyncio` desde el principio.

## La Lección más Importante de Aerc

**Aerc es la prueba de que IMAP IDLE + JMAP EventSource pueden coexistir en el mismo cliente de forma transparente para la UI.** Los widgets de la pantalla no saben si el mensaje nuevo llegó por un IDLE de IMAP, por un StateChange de JMAP, o por un archivo Maildir nuevo. Solo reciben un `MessageInfo` del bus de mensajes.

Para nuestro cliente Python con soporte IMAP como capa de compatibilidad, este es el diseño definitivo: definir un bus interno de eventos de dominio, y que cada adaptador de backend (JMAP, IMAP, o nuestro futuro adaptador IMAP→JMAP) emita los mismos eventos cuando detecte cambios.
