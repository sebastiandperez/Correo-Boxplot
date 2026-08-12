# Arquitectura de Stormbox - Resumen Pedagógico

Este documento es una guía amigable para entender de un vistazo cómo funciona Stormbox, un moderno cliente de correo web, y qué podemos aprender de él para construir nuestro propio cliente de correo (JMAP-first con compatibilidad IMAP).

---

### 1. Qué hace este cliente

Stormbox es un cliente de correo web "Local-First". Esto significa que cuando lo abres, no está constantemente pidiéndole correos a internet. En su lugar, descarga tus correos y los guarda localmente en el navegador (usando una base de datos SQLite ultra-rápida). La interfaz gráfica interactúa exclusivamente con esa base de datos local. Por detrás, en un hilo secundario invisible para el usuario (SharedWorker), Stormbox se encarga de hablar con el servidor real usando el protocolo JMAP para mantener esa base local actualizada. Es rápido, funciona offline y se siente como una aplicación de escritorio nativa.

### 2. Los componentes más importantes

Para hacer que esto funcione, Stormbox se divide en piezas claras:

1.  **La Interfaz Visual (Vue 3):** Los botones, listas y ventanas. Es "tonta", no sabe nada de redes.
2.  **El State (Pinia):** La memoria a corto plazo de la interfaz. Guarda cosas como "qué correo tengo seleccionado" o "qué carpeta estoy viendo".
3.  **El RPC Client (El Mensajero):** Un puente que envía mensajes desde la interfaz visual hacia el cuarto de máquinas en background.
4.  **El Sync Host (El Cerebro en Background):** Se ejecuta en un "SharedWorker" separado. Coordina el almacenamiento y la red sin congelar la pantalla.
5.  **Local Storage (SQLite):** La base de datos persistente. Es la fuente de la verdad absoluta para la interfaz.
6.  **JMAP Backend:** El traductor que sabe cómo hablar el protocolo JMAP con el servidor real de correo.
7.  **Outbox Runner (El Cartero Local):** Un proceso en background que toma las acciones que hiciste (como enviar un correo o borrarlo) y las reintenta constantemente hasta que el servidor remoto las confirma.

### 3. Cómo recibe un correo

Imagínate que tienes Stormbox abierto. El **JMAP Backend** mantiene un tubo abierto (WebSocket) con el servidor de correo. 
Cuando te mandan un correo, el servidor no te manda el correo entero; simplemente empuja un mensaje pequeño por el tubo diciendo: "¡Ey, el estado de tus correos cambió!".
El cliente, al escuchar esto, le pregunta al servidor: "¿Qué cambió desde mi último estado conocido?". El servidor le responde con el ID del nuevo correo. El cliente descarga los metadatos de ese ID, los guarda en **SQLite**, y lanza un aviso general. La **Interfaz Visual** escucha ese aviso, recarga la base local y, mágicamente, el correo aparece en pantalla.

### 4. Cómo abre un correo

Cuando haces clic en el correo nuevo para leerlo, la interfaz le pregunta a SQLite si ya tiene el texto completo. Como al principio solo bajó los metadatos, SQLite dice que no. 
Inmediatamente, el cerebro de background hace una petición rápida por red (prioritaria) al servidor JMAP pidiendo específicamente el cuerpo de ese correo (el HTML). Una vez descargado, lo guarda en SQLite, se lo pasa a la interfaz, lo limpia de código malicioso, y lo muestra en pantalla. Todo esto pasa en fracciones de segundo. La próxima vez que abras el correo, cargará instantáneamente porque ya estará en SQLite.

### 5. Cómo envía un correo

Redactas tu mensaje y pulsas "Enviar". La interfaz engaña a tu cerebro: oculta la ventana, te dice que se envió, y pasa a otra cosa. Sin embargo, en realidad no ha tocado internet.
Ha guardado el correo en la base de datos local con una marca de "Pendiente por enviar" (en una tabla de SQLite). En el background, el **Outbox Runner** ve esto, envuelve el texto en una petición JMAP de creación y envío simultánea (`Email/set` + `EmailSubmission/set`) y lo manda al servidor de correo. Si estás en un túnel sin cobertura de red, el cartero se detiene y seguirá intentándolo cuando vuelva el internet.

### 6. Cómo sincroniza

El protocolo JMAP y Stormbox están obsesionados con la eficiencia usando "States" (Estados). Cada vez que Stormbox recibe datos del servidor, el servidor le regala una pequeña estampilla o token (ej: `estado-abc`). 
Si te desconectas y vuelves mañana, Stormbox no pregunta "dame todo mi buzón". Pregunta "dame todo lo que pasó desde `estado-abc`". El servidor responde con exactitud quirúrgica qué correos se crearon, modificaron o eliminaron desde entonces. No hay escaneos masivos ni pérdida de tiempo comparando fechas.

### 7. Cómo almacena información localmente

Lo hace usando un archivo de base de datos **SQLite** directamente en el navegador del usuario (gracias a WebAssembly y OPFS). Esto permite que el cliente realice consultas SQL complejas (`SELECT`, `JOIN`, `ORDER BY`) al instante. Guarda metadatos de correos, jerarquía de carpetas, agendas de contactos, identidades y colas de mutaciones pendientes. No almacena archivos masivos (adjuntos gigantes) para no ahogar el almacenamiento del navegador, los cuales se descargan vía URL bajo demanda.

### 8. Cómo utiliza JMAP

Stormbox está enamorado de JMAP. Es su lengua materna. No usa adaptadores de red genéricos, su base de datos local es prácticamente un clon de las tablas teóricas que describe el RFC 8621 (el estándar de JMAP). Aprovecha características avanzadas como el "Batching" (hacer 5 preguntas complejas en una sola petición de red) y los "Back-references" (hacer peticiones donde el paso B usa los resultados del paso A sin volver al cliente). Todo ocurre mandando JSONs sobre HTTPS o WebSockets.

### 9. Cómo utiliza IMAP

No lo utiliza. En absoluto. Stormbox es un cliente puramente moderno que asume que del otro lado hay un servidor JMAP nativo.

### 10. Qué arquitectura podemos aprender de él

Para nuestro futuro cliente de correo en Python (JMAP-first con soporte para IMAP), Stormbox es una mina de oro:

1. **La idea de Local-First + SQLite es brillante.** Nuestro cliente en Python debería tener una base de datos local SQLite y comportarse igual: la aplicación responde leyendo la base de datos local, mientras los hilos secundarios se pelean con la red y sincronizan.
2. **Cola de Envíos (Outbox Runner).** Toda mutación (borrar, mover, enviar) debería ser un registro en la base de datos local. Esto da resiliencia a cortes de red y mejora la percepción de velocidad.
3. **El diseño JMAP en la base local.** Puesto que nuestro cliente es "JMAP-first", nuestro SQLite debe reflejar JMAP (donde un correo tiene un ID universal y un array de `mailboxIds` o carpetas a las que pertenece, no como en IMAP donde se clona por carpeta). 
4. **El dilema de IMAP.** La lección más grande es que, como la arquitectura moderna es JMAP-céntrica (por eficiencia), nuestro cliente tendrá que tratar a IMAP como un "ciudadano de segunda clase". Para soportar IMAP, probablemente construiremos un adaptador que hable con el servidor antiguo de IMAP pero que traduzca todo y mienta hacia adentro para hacer creer a nuestro SQLite que está hablando con un servidor moderno de JMAP que soporta *States*.
