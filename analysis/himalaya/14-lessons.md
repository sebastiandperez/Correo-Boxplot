# 14 - Lecciones de Arquitectura

## Decisiones que copiaría (Para nuestro core Python)

1. **La Capa Universal ("Shared API"):** La forma en que Himalaya centraliza un solo modelo (Envelope, Mailbox, SearchEmailsQuery) y obliga a que todos los backends se ajusten a él, es magistral. Si construimos un cliente JMAP-first con compatibilidad IMAP, debemos usar una estructura similar, pero usando como centro el **Esquema JMAP**. Todo comando que el cliente Python ejecute (sea buscar, mover, borrar) debe expresarse en un formato estándar (JMAP), y si la cuenta actual resulta ser IMAP, usar un "Backend Adapter" (como `src/imap/backend.rs`) para traducir JMAP a IMAP y viceversa.
2. **El Traductor de Búsquedas (Search DSL a IMAP SearchKey):** La función `convert_filter` de Himalaya que traduce sentencias humanas (`from alice and after 2026-01-01`) a comandos IMAP crudos es una base espectacular. En Python, necesitaremos convertir JSON Filters de JMAP en comandos de búsqueda de IMAP. Podremos basarnos directamente en la lógica implementada aquí.
3. **El Workaround de Paginación en IMAP:** Himalaya sortea muy bien la carencia de buena paginación en IMAP. Su algoritmo para "calcular la ventana" (`compute_window`) desde un `EXISTS n`, y su fallback de ordenamiento de UIDs cliente-lado cuando el servidor no soporta `SORT`, son piezas de código valiosas que podemos portar 1:1 a nuestro adaptador IMAP en Python.

## Decisiones que evitaría

1. **El diseño Stateless (Sin Caché Local):** Si queremos un cliente de correo moderno (rápido como Stormbox), no podemos permitirnos que cada clic a "Ver correo" abra una conexión TLS a IMAP, pida el cuerpo y lo descargue. Himalaya asume que el usuario esperará unos milisegundos extra por cada comando. Necesitamos la base de datos SQLite como caché local persistente (lo que aprendimos de Stormbox).
2. **Ignorar WebSockets / Sincronización Diferencial:** Himalaya no tiene un demonio en segundo plano, así que desaprovecha las características más ricas de JMAP (Push y States).
3. **Manejo Manual de SMTP:** Al tener IMAP como ciudadano de primera clase, Himalaya tiene que separar el envío mediante SMTP (`lettre`). En un sistema JMAP-first, SMTP puede omitirse si el servidor lo soporta (JMAP tiene Submission), limitando la necesidad de manejar dos protocolos simultáneos, salvo explícitamente para compatibilidad antigua.
