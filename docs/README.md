# Documentación

## Arquitectura vigente

* [Overview](architecture/overview.md)
* [Capas y reglas de dependencia](architecture/layers.md)
* [Componentes](architecture/components.md)
* [Dominio local](architecture/domain.md)
* [Estado de Application](architecture/application-state.md)
* [Seguridad](architecture/security.md)
* [Bootstrap seguro de la caché local](architecture/secure-local-cache.md)
* [Contrato de persistencia](architecture/persistence-contract.md)
* [Diseño SQLite / SQLCipher PERSIST-01](architecture/persistence-01-design.md)
* [Contrato IPC TypeScript ↔ Rust IPC-00](architecture/ipc-contract.md)
* [Diagrama de capas y componentes](diagrams/layers-components.mmd)

## Planificación

* [Roadmap del MVP Tauri](planning/roadmap.md)

## Desarrollo

* [Stack canónico](development/stack.md)
* [Setup](development/setup.md)
* [Entornos locales Production/Development](development/local-environments.md)
* [Vendor y mantenimiento de SQLCipher](development/sqlcipher-vendor.md)
* [Testing](development/testing.md)
* [Arquitectura de contract testing de Ports](testing/port-contract-testing.md)
* [Git workflow](development/git-workflow.md)

## Diseño

* [Mockup de referencia del cliente de correo](design/mockups/mail-client-reference.html)

## Decisiones

* [Índice de decisiones](decisions/README.md)
* `decisions/architecture/` — seguridad, autenticación, drafts, adjuntos y HTML.
* `decisions/development/` — baseline exacta, historial de provisioning SQLCipher e interfaz JMAP.

## Investigación fuente

Los informes conservan el razonamiento y la evidencia histórica. Las decisiones operativas vigentes se leen en arquitectura, roadmap y stack.

* [Cierre técnico de Gate 0-C/0-D](research/gate-0-c-0-d-research.md)
* [Secure compatible version baseline](research/secure-compatible-version-baseline.md)
* [Initial SQLite schema research](research/minimal-secure-compatible-initial-sql-schema.md)
