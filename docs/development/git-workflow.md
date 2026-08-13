# Git workflow

* Cada cambio parte de una rama corta y termina en una PR revisable.
* Los upgrades se hacen en PRs deliberados con locks, release notes relevantes y evidencia de pruebas.
* `package.json`, `pnpm-lock.yaml`, `rust-toolchain.toml`, `Cargo.toml` y `Cargo.lock` cambian juntos cuando corresponde; los lockfiles nunca se editan a mano.
* Antes de solicitar review ejecuta `pnpm install --frozen-lockfile` y `pnpm check`.
* Si SQLCipher no está provisionado, documenta exactamente los comandos nativos bloqueados. No sustituyas el motor ni ocultes el fallo.
* Una PR que cambie una frontera, invariante o decisión actualiza la documentación/ADR correspondiente. No se requiere un ADR para cada paquete.
* No mezcles refactors, upgrades y features sin una dependencia real entre ellos.
