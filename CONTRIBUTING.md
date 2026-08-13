# Contributing

Antes de modificar código, lee `AGENTS.md`, `docs/development/stack.md`, `docs/architecture/security.md` y `docs/planning/roadmap.md`.

Configura el entorno con `docs/development/setup.md` y verifica los cambios mediante:

```bash
pnpm install --frozen-lockfile
pnpm check
```

Consulta `docs/development/testing.md` para el alcance de pruebas y `docs/development/git-workflow.md` para locks, upgrades y PRs. Los bloqueos de SQLCipher se reportan; nunca se resuelven con SQLite plaintext.
