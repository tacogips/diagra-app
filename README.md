# diagra

A diagram editor for ER diagrams, UML class diagrams, sequence diagrams,
and freeform drawing, with a semantic JSONL file format and real-time
collaboration.

This repository is **diagra-app**, the public half of the project:

- Shared editor packages (`packages/*`): Diagram IR, framework-agnostic
  editor core, JSONL and import/export adapters, Yjs client binding, and
  the Solid renderer.
- The standalone desktop client (`apps/desktop`): a Tauri 2 app that edits
  local JSONL files and, when signed in, cloud documents.

The cloud edition (Cloudflare Workers sync server, hosted web SPA, auth,
infrastructure) lives in the private `diagra-cloud` repository, which
consumes this repository as a git submodule. Do not add server-side code
or deployment config here.

The full product design lives in the private `diagra-cloud` repository (`design-docs/specs/product-design.md`).

## Layout

```text
packages/
  ir/        Diagram IR: types, schema, migrations
  core/      Editor core (no framework dependencies)
  io/        JSONL persistence, SVG/Mermaid/D2 adapters
  collab/    Yjs client binding (sync server is private)
  ui-solid/  Solid renderer
apps/
  desktop/   Tauri 2 desktop client
```

## Development

```bash
mise install
bun install
mise run dev
```

## Common Tasks

```bash
mise run check
mise run test
mise run build
mise run tauri-build
mise run lint
```

mise installs Bun, Rust, and rust-analyzer. Install the native Tauri system
libraries required by your operating system separately.
