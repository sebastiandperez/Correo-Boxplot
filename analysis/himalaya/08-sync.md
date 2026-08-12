# 08 - Sincronización

[COMPROBADO]

**Himalaya no tiene ningún mecanismo de sincronización.**

El concepto de sincronización ("determinar la diferencia entre A y B para llegar al mismo estado") solo aplica cuando existen al menos dos repositorios de datos persistentes. En Stormbox, había que sincronizar el "Estado JMAP" con el "Estado SQLite Local".

En Himalaya, al ser una herramienta CLI sin estado persistente (stateless), la "sincronización" es inexistente.

## Diseño de "Pasarela" (Passthrough)
Himalaya actúa estrictamente como una pasarela.
Tú envías un comando unificado al binario de Himalaya. Él traduce el comando a las especificaciones del servidor IMAP/JMAP de destino, recolecta la respuesta, la formatea y la escupe a la consola, destruyendo cualquier estado en memoria al terminar.

No hay `sinceState`, no hay reintentos en background (`retry`), no hay Detección de Desvío (`Drift Detection`).

## ¿Qué pasa offline?
A diferencia de Stormbox, Himalaya no funciona sin conexión a internet (excepto si estás usando el backend puramente local `maildir`/`m2dir`). 
Si intentas leer un correo o marcarlo como favorito (`himalaya flag add`) sin conexión a internet usando el backend IMAP, el proceso generará un error fatal (panic o error exit code) inmediatamente.

## Lección para nuestro proyecto Python
Si queremos construir una aplicación "Local-First" en Python, debemos alejarnos del modelo de Himalaya para el core de almacenamiento, y acercarnos más a la filosofía de Stormbox, donde el cliente actúa sobre la caché local y sincroniza en background. Sin embargo, usaremos el modelo de Himalaya de **Traducción Compartida** ("Shared API") para saber cómo adaptar nuestra caché a servidores IMAP antiguos cuando un servidor JMAP no esté disponible.
