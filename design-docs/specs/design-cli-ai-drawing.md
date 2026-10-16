# AI drawing through nodetto-cli with live human co-editing

Status: IMPLEMENTED, 2026-10-16

## Overview

An AI agent (or any script) draws and edits a nodetto document with `nodetto-cli`,
checks the result as an image, and a human watches the same file update live in the
desktop app and keeps editing it. The JSONL file is the only shared medium; there is
no server, socket or lock.

```text
AI agent ──nodetto-cli inspect──> compact outline / JSON (what is on the page)
         ──nodetto-cli edit─────> document.jsonl (atomic write)
         ──nodetto-cli export───> PNG / SVG / PDF (look at the result)
Human    <──desktop app watches document.jsonl, merges changes live──> edits, autosave
```

## Commands

The top-level help is a one-screen overview; `nodetto-cli help <command>` and
`nodetto-cli <command> --help` print the full usage, options, exit codes and examples
of one command.

### export

`nodetto-cli export <doc.jsonl> --format svg|png|pdf [--page <id|name>] [--output
<file>] [--padding <n>] [--background <#rrggbb|transparent>] [--scale <n>]
[--pdf-page artwork|a4|letter] [--orientation portrait|landscape] [--margin <mm>]`

- SVG comes from the same core serializer the app uses (`Editor.exportPageSvg`).
- PNG rasterizes that SVG with resvg (native addon embedded in the compiled CLI) using
  system fonts. Scales and pixel limits are the app's (`RASTER_SCALES`, 8192 px per
  side, 32 megapixels). Fonts may differ slightly from the app's browser rasterizer.
- PDF embeds the PNG with the app's page layout rules (`pdfLayout`), so it matches the
  app's PDF export. The shared, framework-free helpers live in `@nodetto/core`
  (`export-geometry.ts`) and the app re-exports them.
- SVG may go to stdout; PNG and PDF require `--output`.

### inspect

`nodetto-cli inspect <doc.jsonl> [--page <id|name>] [--format outline|json]
[--type <prefix>] [--ids short|full]`

AI agents read structure far more cheaply as an indented outline than as raw JSONL
(the same idea as the accessibility-tree outline agents use to read web pages): one
line per object, children indented under their container, geometry and the essential
semantic fields inline, styling omitted. Example:

```text
document "Telescreen database schema"
  page schema "Telescreen schema" erd (146 elements)
    frame f-alerts "Alerting" @4453,932 904x456
      erd.table 01M4WD inventory_outbox_streams @-59,3394 w240
        column id varchar(256) pk
        column last_sequence integer
    erd.relation 01M4WG inventory_outbox.stream_id -> inventory_outbox_streams.id *:1 logical
```

- Short ids are the shortest unique prefix of at least six characters (like git);
  every command that takes an element id accepts a unique prefix.
- Containment uses frame membership as the editor computes it; elements outside any
  frame are listed at page level.
- `--format json` prints the full element records for exact reads.

### types

`nodetto-cli types [<type>] [--kind <page kind>]` lists the element types typically
drawn on each page kind, and for one type prints its semantic field tree (from the
registry key order), the editor's default semantic and visual payloads and a minimal
`add` operation, so an agent can write valid operations without reading source code.
The registry has no field-type schema; validation errors from `edit` name the field.

### edit

`nodetto-cli edit <doc.jsonl> [--ops <file.json|->] [--arrange] [--dry-run]`

Operations (a JSON array; JSON Lines is also accepted):

| op | fields | effect |
| --- | --- | --- |
| `add-page` | `name`, `kind`, `id?` | add a page |
| `add` | `page`, `type`, `semantic`, `visual?`, `id?`, `ref?` | add an element; `ref` names it for later operations in the same batch |
| `update` | `id`, `semantic?`, `visual?` | deep-merge objects; arrays replace |
| `move` | `id`, `x`, `y` | set position |
| `delete` | `id` | delete an element (relations that reference it follow editor rules) |
| `rename-page` / `delete-page` | `id`, `name?` | page maintenance |

- Operations go through the editor's command layer, so validation and derived state
  (relations, frame membership, z-order) are exactly what the app produces. A batch is
  all-or-nothing; any invalid operation prints its index and reason and writes nothing.
- `--arrange` runs Tidy layout on the touched pages afterwards.
- Output reports the ids created (with their `ref`) and a one-line summary per page.
- Concurrency: the CLI reads the file, applies the batch, and before the atomic rename
  re-reads the file. If a human saved in between, it reapplies the batch to the new
  contents (operations are intent-level, not byte patches) up to three times, then
  fails with exit code 4. It never overwrites a change it has not seen.

### Additions after the first live trial

- `edit`: given semantic fields merge over the type defaults; `place` (rightOf,
  leftOf, below, above, gap, align) and automatic row placement for elements without
  a position; `connect` uses the editor's connectSmart (ERD relation with column
  names, UML association or component connector, sequence message on the next row,
  BPMN flow under BPMN rules, generic edge); `append` / `remove-item` for list
  fields; `--snapshot` writes the result as a baseline.
- `diff <before> <after>`: added, changed (with field names) and removed elements as
  outline lines, so an agent sees what the person changed since its last write.
- `export --element` renders one frame (artboard export) or element (selection
  export); a page export clipped to a viewport made resvg panic. Without `--scale`
  a too-large drawing renders at the largest scale that fits. PNG loads a short
  list of common fonts (plus `--font-dir`) instead of scanning every system font,
  which took tens of seconds on a busy machine.
- `inspect` orders shapes by rows (vertical centre), then connectors; sequence
  messages keep timeline order.
- The app shows "updated from disk +a ~u -r" after an outside change until the next
  local edit.

## Live co-editing in the desktop app

The app already watches the open file (`watch.rs`, `document-file-changed`) and today
always shows a reload/keep banner. The new behavior:

Outside changes are applied live only for the same document id while no write of
our own is in flight; otherwise the existing banner asks (a write in flight would
overwrite what was merged).

1. **Clean (no unsaved local edits):** apply the disk version immediately as an
   element-level diff through `store.commit` (view, zoom, selection of surviving
   elements and undo history kept), then update `lastSavedText`. A short status note
   says the file changed on disk.
2. **Dirty:** three-way merge at element and field level with base = last saved text,
   local = editor snapshot, remote = disk. Disjoint changes merge automatically and the
   merged document is autosaved, so the CLI sees the human's edits on its next read.
   The same field changed differently on both sides, or delete vs modify, is a
   conflict: local wins for that field, autosave pauses, and the banner reports how
   many items conflicted and offers "Use disk version" (the whole disk file) or
   "Keep mine".
3. Unparseable disk content keeps the existing banner; reload reports the parse error.

Autosave and the CLI both write atomically (temp file plus rename), so neither side
reads a partial file.

## Verification

- CLI unit tests for each command (fixtures, golden outline, ops validation, prefix
  ids, concurrent re-apply), PNG/PDF smoke tests (dimensions, magic bytes), compiled
  sidecar smoke test (export PNG without node_modules).
- Session tests for clean apply, dirty disjoint merge, field conflict, delete vs modify,
  invalid disk content and autosave after merge.
- Live end-to-end (done 2026-10-16 with the dev app and the compiled CLI): a CLI edit
  appeared in the open app without a banner (verified through the accessibility
  tree); an app edit was autosaved and read back by the CLI; a concurrent app edit
  and CLI edit both survived.
