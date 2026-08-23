---
name: tauri-lint-verify
description: Run mixed Tauri Rust and TypeScript lint, typecheck, formatting, and verification commands. Use when Codex is asked to lint, check, test, verify, or prepare Rust/TypeScript/Tauri changes in a Tauri template project, especially after editing src-tauri, src, package.json, mise.toml, or agent lint scripts.
---

# Tauri Lint Verify

## Workflow

Prefer the mise task entry points so frontend and backend checks stay consistent:

- Run `mise run lint-ts` for Biome checks and TypeScript typechecking.
- Run `mise run lint-rust` for Rust clippy with `CARGO_TERM_QUIET=true`.
- Run `mise run lint` before handoff when linting was requested.
- Run `mise run verify` after behavior-changing Rust, TypeScript, or Tauri edits.

Use the underlying scripts only when a task target is unavailable:

```bash
bash .agents/scripts/format-ts.sh
bash .agents/scripts/lint-ts.sh
bash .agents/scripts/lint-rust.sh
```

## Expectations

- Keep Cargo commands quiet with `CARGO_TERM_QUIET=true`.
- Prefer `bun run lint:biome`, `bun run typecheck`, and Cargo commands through mise tasks.
- Report skipped checks explicitly when local dependencies or platform requirements are unavailable.
