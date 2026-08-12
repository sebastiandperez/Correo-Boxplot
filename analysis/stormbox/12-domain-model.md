# 12 - Modelo de Dominio

[COMPROBADO]

El modelo de dominio de Stormbox está casi totalmente acoplado al modelo de datos definido por el protocolo JMAP. Esto se refleja claramente en el esquema de la base de datos local y en los tipos de TypeScript.

Las entidades principales son:

*   **Account (Cuenta):** La base del árbol de pertenencia. Un usuario puede tener una cuenta primaria y acceder a múltiples cuentas compartidas.
*   **Mailbox (Carpeta):** Representa una carpeta de correos (Inbox, Sent, Trash, etc). Tiene una jerarquía padre-hijo (propiedad `parentId`). A diferencia de IMAP, un correo puede estar en múltiples Mailboxes.
*   **Email (Mensaje):** La entidad central. Contiene los metadatos y el cuerpo. Tiene un identificador único en JMAP (`remote_id`). No pertenece a una sola carpeta, sino que guarda un objeto (relación NxM localmente resuelta) de IDs de Mailboxes a los que pertenece.
*   **Thread (Hilo):** Una abstracción de JMAP que agrupa varios Emails que pertenecen a una misma conversación lógica.
*   **Identity (Identidad):** Direcciones de correo desde las que la cuenta está autorizada a enviar. Incluye firmas, dirección y nombre a mostrar.
*   **AddressBook / ContactCard:** Entidades del servicio de contactos de JMAP (JSContact), usadas para autocompletado en el compositor.
*   **Pending Mutation:** Entidad local sintética usada para trackear cambios encolados que deben enviarse al servidor.

## Diagrama de relaciones

(Ver `diagrams/domain-model.mmd`)
