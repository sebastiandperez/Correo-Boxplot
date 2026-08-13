# ADR-005 — Renderizado seguro de HTML de correo

**Status:** Accepted for Tauri MVP

## Context

El HTML de email es contenido remoto no confiable y puede intentar ejecutar código, enviar forms, cargar trackers o interferir con el DOM privilegiado de Application.

## Decision

Se persiste solo el raw `{ text, html }` dentro de SQLCipher. Cada render aplica DOMPurify con allow-list estricta y muestra el resultado en un `iframe sandbox` bajo CSP restrictiva. Scripts, forms, handlers, URLs peligrosas, etiquetas/atributos de estilo y recursos remotos se eliminan o bloquean. No se persiste una copia sanitizada.

El adaptador JMAP selecciona un único HTML preferido o cae a texto plano; no concatena HTML crudo multipart.

## Why

Sanitizador, sandbox, CSP y bloqueo remoto forman capas independientes. Sanitizar al render permite aplicar correcciones futuras sin migrar la base.

## Consequences

El correo no comparte libremente el DOM de Application. Enlaces `http`/`https` se abren mediante código controlado y nunca navegan el webview principal. Las pruebas deben comprobar cero ejecución, forms y requests remotos.

## Deferred work

Render inline CID y cualquier relajación de la política requieren una revisión de seguridad explícita.
