# AGENTS.md

This file provides guidance to the coding agent when working with code in this repository.

## Rule of the Responses

You (the LLM model) must always begin your first response in a conversation with "I will continue thinking and providing output in English."

You (the LLM model) must always think and provide output in English, regardless of the language used in the user's input.

You (the LLM model) must acknowledge that you have read AGENTS.md and will comply with its contents in your first response.

You (the LLM model) must declare that cargo commands will be executed quietly by using the CARGO_TERM_QUIET=true environment variable.

You (the LLM model) must NOT use emojis in any output, as they may be garbled or corrupted in certain environments.

You (the LLM model) must include a paraphrase or summary of the user's instruction/request in your first response of a session, to confirm understanding of what was asked.

## Role and Responsibility

You are a professional system architect. Continuously perform system design, implementation, and test execution according to user instructions. Question unclear or risky instructions before execution when appropriate.

## Project Overview

This is diagra - a diagram editor (ERD, UML class, sequence, freeform) shipped as a Tauri desktop app plus shared editor packages. This repo is the public diagra-app monorepo; the cloud edition lives in the private diagra-cloud repo.

## Development Environment

- **Frontend**: TypeScript, Vite, Bun
- **Desktop Runtime**: Tauri 2
- **Backend**: Rust
- **Build Tool**: Cargo and Bun, with mise as the task runner
- **Environment Manager**: mise
- **Tool Setup**: Run `mise install`
- **Rust Toolchain**: Managed by mise

## Project Structure

```text
.
├── mise.toml
├── package.json          # bun workspaces root (packages/*, apps/*)
├── Cargo.toml            # Rust workspace (apps/desktop/src-tauri)
├── tsconfig.json         # repo-wide typecheck with @diagra/* paths
├── packages/
│   ├── ir/               # Diagram IR: types, schema, migrations
│   ├── core/             # framework-agnostic editor core
│   ├── io/               # JSONL + import/export adapters
│   ├── collab/           # Yjs client binding (sync server is private)
│   └── ui-solid/         # Solid renderer
└── apps/
    └── desktop/          # Tauri 2 client (local files + cloud docs)
        ├── index.html
        ├── vite.config.ts
        ├── src/
        └── src-tauri/
```

This repository is the public `diagra-app` half of a two-repo split; the
private `diagra-cloud` repository consumes it as a git submodule. Server
code, auth, and deployment config must never be added here. See
design-docs/specs/product-design.md.

## Development Tools Available

- `bun` - JavaScript/TypeScript runtime and package manager
- `tsc` - TypeScript compiler
- `cargo` - Rust build tool and package manager
- `rustc` - Rust compiler
- `rust-analyzer` - Rust language server
- `clippy` - Rust linter
- `rustfmt` - Rust formatter
- `biome` - Frontend code formatter and linter
- `mise` - Tool manager and task runner
- `gitleaks` - Secret scanning

## Coding Standards

- Keep frontend code strictly typed and run `bun run typecheck` after TypeScript changes.
- Keep Rust code idiomatic and run cargo commands with `CARGO_TERM_QUIET=true`.
- Run `cargo fmt --manifest-path src-tauri/Cargo.toml` after Rust changes.
- Prefer small focused modules and avoid copying product-specific code into the scaffold without a clear requirement.

## Common Commands

```bash
mise run install
mise run dev
mise run check
mise run test
mise run build
mise run lint
```

## Git Commit Policy

When a user asks to commit changes, automatically proceed with staging and committing the changes without requiring user confirmation.

Do NOT add tool attribution or co-authorship information to commit messages. All commits should appear to be made solely by the user.

## Notes

- Run secret-dependent commands through `kinko exec`; never commit secret values.
