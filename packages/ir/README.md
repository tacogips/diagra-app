# @diagra/ir

The Diagram IR: the canonical, render-independent data model every other
package agrees on. Implements sections 5 and 6 of the product design
(`design-docs/specs/product-design.md` in the private `diagra-cloud` repo).

Runtime-agnostic by contract — it must run in a browser, the Tauri webview,
Node/Bun, and Cloudflare Workers. No DOM, no framework, no dependencies.

## Model

```ts
Document { schemaVersion, id, title, pages[], elements[], unknownRecords?, extensions? }
Page     { id, name, kind, extensions? }
Element  { id, page, type, index, semantic, visual, extensions? }
Visual   { x?, y?, width?, height?, rotation?, style?, extensions? }
```

Every element separates `semantic` (domain meaning — "table `users` with
columns ...") from `visual` (position, size, style). Rendering is derived
from the semantic payload; the file never stores pixels-as-meaning.

`Visual.rotation` is clockwise **degrees** about the element's own centre.
Degrees rather than radians so that the 0.01 rounding `@diagra/io` applies
to it stays imperceptible; renderers convert.

`Document.elements` is a flat list, not nested under `Page`. The design's
section 5.1 sketch shows only `pages`, but element records are top-level in
the JSONL format and carry a `page` back-reference, so the in-memory shape
mirrors the file.

## Element type registry

`registry.ts` holds one `ElementTypeDefinition` per type in the v1 table
(design section 5.2). Each definition owns:

- `validateSemantic(semantic, path)` — structured issues, never throws.
- `references(semantic)` — the element ids this payload points at, so
  deletes can cascade or detach.
- `onReferenceDeleted` — `cascade` for edges (a relation without its table
  is meaningless), `detach` for containers (a group survives losing a
  member).
- `keyOrder` — the declared serialization order for the payload. The IR
  declares it; `@diagra/io` applies it.

Renderers and `ShapeUtil`s live in `core` / `ui-solid`; only data lives here.

## Validation severities

`validateDocument` returns issues, it never throws (use `assertValidDocument`
for that). The severity split is the forward-compatibility contract:

- **error** — the document is structurally unusable: duplicate ids, an
  element on a page that does not exist, a wrong field type, a `semantic`
  that is not an object, an out-of-range text mark. Readers must refuse it.
  `semantic` is checked whether or not the element type is registered: it is
  a record by definition, so an unregistered type does not get a free pass.
- **warning** — usable, but this build cannot fully interpret it: an unknown
  element type, an unknown field on `visual` or `visual.style`, a reference
  to an absent element. A file written by a newer diagra still loads, and
  still round-trips.

`visual` and `visual.style` warn identically on unmodelled keys. Note that
this fires for documents built in memory, not for documents that came from
`parseDocument`: the JSONL reader relocates unmodelled keys into `extensions`
before validation runs, so a parsed document has no inline unknown keys left.
Whether a populated `extensions` bag should itself warn — here and at the
document, page and element levels, which never warn — is still open.

## Schema versions

`SCHEMA_VERSION` is the current schema. `migrateSnapshot` runs the
`MIGRATIONS` chain forward one version at a time and refuses to open a
document written by a newer build. v1 is the first published schema, so the
chain is empty; the runner is live code that `parseDocument` always calls,
and `migrations.test.ts` exercises it with a synthetic chain, so adding a v2
means adding one entry.
