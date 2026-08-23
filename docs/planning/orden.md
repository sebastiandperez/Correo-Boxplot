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
└── P-03 LocalChangeSource · CLOSED

P0 — Port contract testing · COMPLETE PARA MVP ACTUAL
│
├── TEST-00 arquitectura de tests · COMPLETE
├── TEST-01 infraestructura reusable · COMPLETE
├── TEST-02 ReadRepository suite · COMPLETE / 45 PASS AGAINST MEMORY
├── TEST-03A SyncPort state suite · COMPLETE / 48 PASS AGAINST MEMORY
├── TEST-03B SyncPort mutations suite · COMPLETE / 43 PASS AGAINST MEMORY
├── TEST-04 LocalChangeSource suite · COMPLETE / 23 PASS AGAINST MEMORY
├── TEST-05 Local Engine system suite · COMPLETE / 20 PASS AGAINST MEMORY
├── TEST-06 Memory hardening · COMPLETE / 18 PASS
├── MEM-01 MemoryLocalEngine · FINAL AUDIT PASS
└── LOCAL ENGINE CONTRACT SUITE · CLOSED / 179 OF 179 PASS

P0 — primer IUT y adapters
│
└── MemoryLocalEngine conformant; listo para Application/Coordinator integration

P0 — Local Engine / persistence integration
│
├── PERSIST-00 Persistence Contract · COMPLETE
├── PERSIST-01 SQLite/SQLCipher · COMPLETE
├── IPC-00 Production Local Engine Bridge · COMPLETE
├── B-03 SQLCipher lifecycle y migrations
├── B-04 local reads
├── B-05 atomic writes
├── B-06 TAURI-ADAPTERS-01 · COMPLETE
├── B-07 PROD-CONFORMANCE-01 contra engine real · COMPLETE / 179 PASS
├── B-08 SECURE-BOOTSTRAP-01 · COMPLETE
├── B-09 LOCAL-SECURE-STORE-01 · COMPLETE LINUX + WINDOWS
└── B-10 SQLCIPHER-PACKAGING-01 · COMPLETE LINUX + WINDOWS x86_64 MSVC

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
