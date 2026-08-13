# 003 — Baseline exacta de versiones

**Status:** Accepted

## Context

Tres personas y agentes automatizados necesitan una base reproducible sin adoptar prereleases o upgrades implícitos.

## Decision

La baseline del 2026-08-13 se fija mediante `.node-version`, `packageManager`/`engines`, dependencias directas exactas, `rust-toolchain.toml` y dependencias Cargo exactas. Ambos lockfiles se versionan.

## Consequences

Los upgrades ocurren en PRs intencionales con pruebas y revisión de locks. Vue 3.6 RC, pnpm 12 RC y otras líneas no congeladas no entran por automatismo.
