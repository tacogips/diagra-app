# @diagra/io

Persistence and interchange adapters. Adapters consume and produce
`@diagra/ir` documents only — no editor state, no Yjs, no DOM, no framework.

Phase 1 (design section 11) ships JSONL in and out. SVG, PNG, Mermaid, D2
and DDL adapters land in later phases.

## JSONL

```ts
import { parseDocument, serializeDocument } from "@diagra/io";

const document = parseDocument(await readFile(path, "utf8"));
await writeFile(path, serializeDocument(document));
```

- `parseDocument(text, options?)` throws `DocumentParseError` on malformed
  text or validation errors. `parseDocumentResult` returns
  `{ ok, document?, issues }` instead, for callers that want to surface
  warnings.
- `serializeDocument(document, options?)` validates first by default;
  `{ validate: false }` skips it.

## Determinism

The design requires clean git diffs, so writers emit exactly one canonical
form (section 6):

- **Record order** — the document record, then pages by id, then elements by
  page then id, then unmodelled record kinds sorted by their canonical text.
  Readers do not depend on order; only writers sort.
- **Key order** — the declared order for the record and for the element's
  registered semantic payload, then every remaining key sorted by code unit.
  This is why the writer builds JSON text itself rather than calling
  `JSON.stringify`: JS objects hoist integer-like keys, which would make
  output depend on how an object was built.
- **Coordinates** — rounded to 0.01, half away from zero, with `-0`
  normalized to `0`. Rounding is total over the finite doubles: a finite
  coordinate is never turned into a non-finite one, so the writer can never
  emit a `null` the reader would then reject. Only keys declared as
  coordinates are rounded, so text offsets, pen pressure and opacity keep
  full precision. `visual.rotation` *is* declared a coordinate and so is
  rounded to 0.01 too; it is in degrees (see `Visual.rotation`), which makes
  that 0.01 degrees rather than the 0.57 degrees a radian-based field would
  have quantized to.

`serializeDocument` is idempotent: `serialize(parse(serialize(d)))` is
byte-equal to `serialize(d)`. Golden files in `src/__fixtures__/` pin this
for ERD, UML class, sequence, freeform and forward-compatible documents.

## Forward compatibility

Nothing a newer diagra writes is dropped on the way back out, with one
qualification for numeric literals that JavaScript itself cannot represent —
see "Numeric fidelity" below:

- Record kinds this build does not model are kept verbatim in
  `Document.unknownRecords` and rewritten at the end of the file.
- Unknown fields on document, page and element records land in an
  `extensions` bag and are spliced back in as plain fields on write.
- Unknown fields inside a `semantic` payload stay on the payload; the writer
  sorts them after the payload's declared keys.
- Unknown element types load with a warning and their semantic payload
  untouched.
- Field names that collide with the prototype chain are preserved, in both
  directions. A key that came out of a file never indexes a plain object
  directly — see `src/jsonl/objects.ts`. Writing through plain assignment
  would hit `Object.prototype`'s `__proto__` setter, drop the field and swap
  the object's prototype for file-controlled data; reading a nested key order
  through plain indexing would resolve `constructor` to the global `Object`
  and make the writer throw on a document it had just parsed cleanly.
  `__proto__`, `constructor`, `toString`, `valueOf` and friends all round-trip
  as ordinary fields, with object, array and primitive values alike.

A malformed `visual` that is not an object is also written back exactly as
it was read, so `{ validate: false }` on both ends round-trips it instead of
deleting it. With validation on — the default — such a document is rejected.

### Numeric fidelity

Preservation is exact for every value an IEEE-754 double can hold, including
coordinates all the way out to `Number.MAX_VALUE`: rounding is total over the
finite doubles, so a finite number in the file is never written back as
`null`.

Three cases fall outside that range, and in all three the value is already
gone before the writer runs, because `JSON.parse` is what loses it:

| JSON literal | after `JSON.parse` | written back as |
|--------------|--------------------|-----------------|
| `1e400` (magnitude past `MAX_VALUE`) | `Infinity` | `null` |
| `-1e400` | `-Infinity` | `null` |
| `1e-400` (magnitude below the smallest denormal) | `0` | `0` |

A `-0` literal is also written back as `0`, matching `JSON.stringify`.

Recovering these would take a custom number parser that keeps the literal as
text, which is not worth it for a diagram format. All four converge on the
first write and are idempotent from then on, so the file stays stable — but a
field a newer build wrote past the double range does not survive a load-save
cycle through this build.

## Round-trip contract

`parse -> serialize -> parse` returns an identical document. Byte equality
holds for text that is already canonical; non-canonical input (unsorted
records, unrounded coordinates, other key orders) converges to the canonical
form on the first write, which is the point of a normalizing writer.
