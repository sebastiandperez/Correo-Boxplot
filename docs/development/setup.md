# Setup de desarrollo

Esta guía prepara el MVP Tauri. Web/PWA no forma parte del entorno actual.

## 1. Prerequisites

Necesitas Git, un compilador/linker nativo para tu plataforma y acceso al registro npm/crates.io para la instalación inicial. Los toolchains del repositorio son exactos:

```text
Node.js 24.19.0
pnpm 11.20.0
Rust 1.97.1 + rustfmt + clippy
```

## 2. Node.js

Instala Node `24.19.0` con el version manager de tu equipo. El archivo `.node-version` permite que gestores compatibles seleccionen la versión.

```bash
node --version
# v24.19.0
```

El repositorio usa `engine-strict`; otra versión no es un entorno soportado.

## 3. pnpm

Instala pnpm exactamente en `11.20.0`. Si tu distribución de Node incluye Corepack:

```bash
corepack enable
corepack prepare pnpm@11.20.0 --activate
```

Si Corepack no está disponible, instala esa versión con el mecanismo aprobado por tu entorno. Verifica:

```bash
pnpm --version
# 11.20.0
```

No desactives frozen lockfile, release-age protections ni controles de scripts de instalación.

## 4. Rust y rustup

Instala rustup y entra al repositorio. `rust-toolchain.toml` selecciona automáticamente:

```bash
rustc --version
cargo --version
rustup component list --installed
```

`rustc` debe reportar `1.97.1`; `rustfmt` y `clippy` deben estar instalados.

## 5. Requisitos Tauri por plataforma

Sigue los [prerequisitos oficiales de Tauri](https://v2.tauri.app/start/prerequisites/) para tu sistema.

* Windows: toolchain MSVC, Windows SDK y WebView2 Evergreen mantenido.
* macOS: Xcode Command Line Tools y una versión de macOS con parches vigentes.
* Linux: compilador, `pkg-config`, WebKitGTK 4.1 y librerías nativas requeridas por Tauri. Los nombres de paquetes dependen de la distribución.

Las versiones mínimas de Windows/macOS, distribuciones Linux y WebViews siguen **OPEN** hasta definir y probar la matriz de soporte.

## 6. SQLCipher — capacidad de desarrollo y baseline de release

El desarrollo local compila la stack pinned del repositorio: `rusqlite 0.40.2` → patch local `libsqlite3-sys 0.38.2` → SQLCipher `4.17.0 community` / SQLite `3.53.3` → OpenSSL vendored. No descubre una biblioteca SQLCipher/OpenSSL externa y no tiene fallback plaintext.

Estas comprobaciones son diagnósticas; `PRAGMA cipher_version` es la fuente correcta para la versión de SQLCipher:

```bash
pnpm native:vendor:check
pnpm native:doctor
```

La baseline de **release** es SQLCipher `4.17.0 community` sobre SQLite `3.53.3`. Linux build/DEB/runtime están verificados; Windows x86_64 MSVC permanece pendiente de ejecución nativa. La ausencia de SQLCipher/OpenSSL del host no cambia la selección. Un mismatch runtime bloquea bootstrap y nunca activa SQLite común.

## 7. Instalar dependencias

Con los lockfiles versionados:

```bash
pnpm install --frozen-lockfile
cargo fetch --locked --manifest-path src-tauri/Cargo.toml
```

Solo una PR deliberada de dependencias ejecuta una instalación que regenere locks.

## 8. Desarrollo

Frontend aislado, útil aun si SQLCipher no está provisionado:

```bash
pnpm dev:frontend
```

Aplicación Tauri completa:

```bash
pnpm dev
```

`pnpm dev` requiere toolchain nativo y WebView. SQLCipher `4.17.0` y su proveedor OpenSSL se compilan desde los sources pinned del repositorio; no se requiere un paquete SQLCipher/OpenSSL del host para esa stack.

## 9. Tests, lint y formato

```bash
pnpm typecheck
pnpm test
pnpm test:rust
pnpm lint
pnpm lint:rust
pnpm format:check
pnpm format:rust
```

La interfaz principal es:

```bash
pnpm check
```

## 10. Health check

Un entorno sano cumple:

```bash
node --version
pnpm --version
rustc --version
cargo --version
pnpm install --frozen-lockfile
pnpm check
```

Además, `PRAGMA cipher_version` debe ser exactamente `4.17.0 community` y `sqlite_version()` exactamente `3.53.3`; los tests prueban cifrado, reapertura, rechazo de clave incorrecta y compatibilidad 4.14→4.17. La aceptación Windows de ese mismo pin continúa pendiente en un host Windows/MSVC.
