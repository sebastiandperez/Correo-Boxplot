# ADR-004 — Alcance de attachments

**Status:** Accepted for Tauri MVP

## Context

JMAP separa metadata de partes y blobs binarios. Implementar archivos ahora añadiría filesystem, permisos, cuotas, limpieza, upload y composición MIME.

## Decision

El MVP persiste únicamente `AttachmentRef` con `partId`/`blobId`, nombre, tipo, tamaño, disposición y CID cuando existan. Puede mostrar metadata, pero no cachea bytes, descarga/guarda, sube, envía adjuntos ni renderiza CID inline.

## Why

Conserva el modelo necesario para ampliar la capacidad después sin introducir la superficie de archivos en el MVP.

## Consequences

El schema no contiene blobs de adjuntos y el compositor no ofrece adjuntar archivos. La UI debe comunicar la limitación sin intentar una operación de red.

## Deferred work

Caché binaria, descarga, guardado, upload, send attachment, CID inline, limpieza y cuotas.
