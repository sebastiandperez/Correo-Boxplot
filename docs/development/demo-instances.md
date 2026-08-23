# Instancias locales de demostración

## Perfiles fijos

| Perfil | Comando | Tauri identifier | Vite |
| --- | --- | --- | --- |
| Development | `pnpm dev` | `com.editorialhuellas.correoboxplot.dev` | `127.0.0.1:1420` |
| Demo 1 | `pnpm dev:demo1` | `com.editorialhuellas.correoboxplot.dev.demo1` | `127.0.0.1:1421` |
| Demo 2 | `pnpm dev:demo2` | `com.editorialhuellas.correoboxplot.dev.demo2` | `127.0.0.1:1422` |

Los perfiles solo aíslan estado local; no seleccionan Alice o Bob. La identity remota se determina posteriormente mediante login.

Cada identifier produce un `app_local_data_dir` Tauri distinto y, por tanto, base SQLCipher, lock y markers distintos. Los servicios DEK son respectivamente `.dev.local-cache`, `.dev.demo1.local-cache` y `.dev.demo2.local-cache`; los servicios E2EE equivalentes terminan en `.e2ee`. Dos procesos del mismo perfil chocan con el lock seguro existente. Demo 1 y Demo 2 pueden ejecutarse simultáneamente.

## Intercambio manual de claves

La herramienta se compila solo con `e2ee-dev-tool`. Nunca imprime private keys ni permite seleccionar Production.

```text
cargo run --manifest-path src-tauri/Cargo.toml --features e2ee-dev-tool --bin e2ee-key-tool -- --profile demo1 ensure alice@boxplot.test
cargo run --manifest-path src-tauri/Cargo.toml --features e2ee-dev-tool --bin e2ee-key-tool -- --profile demo2 ensure bob@boxplot.test
```

Intercambie las dos claves públicas por un canal manual y ejecute:

```text
... --profile demo1 trust-peer alice@boxplot.test bob@boxplot.test <PK_B>
... --profile demo2 trust-peer bob@boxplot.test alice@boxplot.test <PK_A>
... --profile demo1 peer-status alice@boxplot.test bob@boxplot.test
```

El reset E2EE destruye private keys y confianza y puede volver correo histórico indecriptable. Es independiente del reset de caché, solo acepta perfiles Development y exige confirmación textual:

```text
... --profile demo1 reset-development-e2ee --confirm-loss-of-e2ee-keys
```
