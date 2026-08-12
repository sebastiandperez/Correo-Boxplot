# 11 - Almacenamiento local (Persistencia)

[COMPROBADO]

La persistencia y el almacenamiento local es una de las mayores diferencias entre Himalaya y clientes como Stormbox.

**Himalaya no guarda correos en ninguna base de datos local** (en sus modos de red IMAP/JMAP/Gmail). 

## Ausencia de Caché
El diseño de una herramienta CLI de "un solo disparo" ("one-shot") requiere que la herramienta arranque, cumpla su trabajo, escupa el output (a consola o JSON) y termine la ejecución devolviendo el control al shell del SO en milisegundos.
Configurar, abrir, migrar esquemas y gestionar bases de datos embebidas pesadas (como SQLite) suele romper con este paradigma, por lo que el autor eligió mantener a Himalaya puramente *stateless* (sin estado).

## La excepción: `maildir` / `m2dir`
Himalaya sí tiene capacidades "Local-First", pero las delega.
Puedes configurar Himalaya para usar el backend `maildir`. En este modo, Himalaya ignora la red por completo. En su lugar, lee archivos de texto plano que residen en una estructura de carpetas en tu disco duro (el formato estándar Maildir de Unix).

**¿Cómo llegan los correos ahí?**
Los usuarios instalan herramientas en segundo plano, legendarias en el mundo Unix, como `mbsync` (isync) o `offlineimap`. Estas herramientas son las encargadas de conectarse vía IMAP en un hilo de fondo (como un demonio) y descargar/sincronizar los archivos Maildir en el disco.
Luego, tú usas Himalaya apuntando a esos archivos. Himalaya asume que el disco duro **es** el servidor.

Esta separación ("hago el cliente de lectura" vs "usa otra cosa para sincronizar") es muy propia de la filosofía Unix, pero significa que Himalaya no puede ser un cliente "todo-en-uno" Offline por sí solo.
