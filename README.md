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
  ir/        Diagram IR: types, element type registry, validation, migrations
  core/      Editor core (no framework dependencies)
  io/        JSONL persistence, SVG/Mermaid/D2 adapters
  collab/    Yjs client binding (sync server is private)
  ui-solid/  Solid renderer
apps/
  desktop/   Tauri 2 desktop client
```

`ir` and `io` implement the Diagram IR and the deterministic JSONL file
format; see [`packages/ir/README.md`](packages/ir/README.md) and
[`packages/io/README.md`](packages/io/README.md). `core` implements the
editor engine — store, commands, camera, selection, history, ShapeUtil
registry and hit testing — and `ui-solid` renders it to SVG and DOM; the
desktop client wires the two together, see
[`apps/desktop/README.md`](apps/desktop/README.md) for the canvas layout and
the manual gesture checklist. `collab` is still a scaffold.

## Development

```bash
mise install
bun install
mise run dev
```

## Common Tasks

```bash
mise run check
mise run test        # typecheck + bun test + cargo test
mise run build
mise run tauri-build
mise run lint
```

Frontend unit tests run under `bun test` and live next to their sources as
`packages/*/src/**/*.test.ts`. Pointer and keyboard gestures need a real
pointer, so they are covered by the manual checklist in
[`apps/desktop/README.md`](apps/desktop/README.md) instead.

mise installs Bun, Rust, and rust-analyzer. Install the native Tauri system
libraries required by your operating system separately.
