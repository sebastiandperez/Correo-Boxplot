P0 — arquitectura, implementación y alineación documental Domain · COMPLETO
│
├── decisiones e implementación D-01…D-10
├── Pre-Domain repository diagnostic
└── documentation alignment canónico

P0 — Domain Final Audit #2 · COMPLETO / PASS
│
└── B-00B freeze final declarado · DOMAIN CLOSED

P0 — Ports · EN PROGRESO
│
├── P-01 ReadRepository · CLOSED
├── P-02 SyncPort · CLOSED
└── P-03 LocalChangeSource · IMPLEMENTADO / REVIEW PENDIENTE

P0 — adapters y conformance doubles
│
└── B-02 Memory adapters + harness

P0 — Local Engine / persistence integration
│
├── B-03 SQLCipher lifecycle y migrations
├── B-04 local reads
├── B-05 atomic writes
├── B-06 Tauri adapters/events
└── B-07 conformance contra engine real

P0/P1 — consumers e integración remota
│
├── A-01…A-08 Application / Presentation sobre Ports
├── C-01…C-08 JMAP Client después de Domain frozen
├── Coordinator con collection state separado de queryState
└── Outbox con familia PendingMutation discriminada

P0 — aceptación final Tauri
│
├── corte local-first
├── receive/open/sync
├── send/reconciliation
├── security/offline/recovery
└── Sprint-1 contracts verificados
