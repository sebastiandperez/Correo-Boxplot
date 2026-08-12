# Arquitectura de Himalaya - Resumen Pedagógico

Este documento ofrece un vistazo rápido a Himalaya, una herramienta de línea de comandos en Rust para leer y enviar correos, y qué podemos extraer de ella para nuestro propio proyecto (JMAP-first con soporte IMAP en Python).

---

### 1. ¿Qué es Himalaya?

A diferencia de clientes web completos o aplicaciones pesadas, Himalaya es una herramienta de terminal al más puro estilo UNIX. Escribes un comando (por ejemplo, `himalaya envelope list`), la herramienta se conecta a tu cuenta, imprime una tabla bonita con tus últimos correos, y se cierra.
No hay procesos en segundo plano, no hay bases de datos ocupando espacio en tu disco (salvo que uses carpetas Maildir locales), y no hay una interfaz gráfica que mantener. Todo se hace mediante comandos de texto.

### 2. Su Superpoder: La Traducción Universal (Interoperabilidad)

El diseño más interesante de Himalaya es que no le importa qué proveedor de correo uses. 
Internamente, tiene un diccionario centralizado (Shared API) que define qué es un "Correo", qué es una "Búsqueda" o qué es una "Carpeta".
Debajo de esto, tiene varios "Traductores" (Adapters):
*   Un traductor para **IMAP**.
*   Un traductor para **JMAP**.
*   Traductores para las APIs de **Google (Gmail)** y **Microsoft (Graph)**.

Cuando le dices a Himalaya: *"Búscame los correos enviados por Alice desde ayer"*, Himalaya no manda eso a la red. Lo pasa al "traductor" de tu proveedor. Si usas IMAP, el traductor lo convierte en comandos arcaicos de los años 90. Si usas JMAP, lo convierte en un moderno JSON.

### 3. El Problema del "Borrón y Cuenta Nueva" (Stateless)

Como Himalaya es una herramienta que se cierra en cuanto termina su trabajo, sufre de amnesia.
Cada vez que pides leer un correo, tiene que volver a conectarse a internet, volver a loguearse, y volver a descargar el texto. Esto hace que desaproveche las grandes ventajas de JMAP, como la capacidad de preguntar "qué cambió desde la última vez", ya que Himalaya no recuerda "la última vez".

### 4. IMAP vs SMTP: El Enrutador

En el mundo moderno de JMAP o de las APIs de Google, un solo sistema sirve para leer y enviar correos. En el mundo antiguo, IMAP solo sirve para leer, y SMTP solo para enviar.
Himalaya resuelve esto elegantemente con un "Enrutador" (Router). Si pides enviar un correo y tienes configurado IMAP, el enrutador sabe que IMAP no puede hacer eso. Así que internamente levanta el protocolo SMTP auxiliar, envía tu correo por ahí, y luego usa IMAP para guardar una copia en tu carpeta de "Enviados". Todo es transparente para el usuario.

### 5. ¿Qué nos llevamos para nuestro Cliente Python?

Nuestro cliente de Python será "Local-First" con una base de datos local (como Stormbox), pero necesita **soportar IMAP**. 
Himalaya nos da el mapa del tesoro perfecto: nos enseña **cómo construir la capa de traducción**. 

Nuestro cliente en Python usará JMAP para todo por defecto. Cuando detectemos que el usuario tiene un servidor IMAP antiguo, no reescribiremos todo el cliente. En su lugar, construiremos un "Traductor IMAP" (igual que Himalaya) que tomará nuestras modernas peticiones JMAP y las convertirá en operaciones IMAP bajo el capó. 

Nos llevaremos especialmente los algoritmos de Himalaya para **simular la paginación de correos en IMAP** (algo muy difícil) y **traducir filtros complejos de búsqueda humana a código IMAP**.
