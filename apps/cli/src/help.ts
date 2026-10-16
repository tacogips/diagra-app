// Help text. The top-level overview fits one screen; each command has its own
// page with every option, exit code and an example, printed by
// `nodetto-cli help <command>` or `nodetto-cli <command> --help`.

export const OVERVIEW = `nodetto-cli - read, draw, check and convert nodetto documents (.jsonl)

Usage: nodetto-cli <command> [options]

Look at a document
  nodetto-cli inspect <doc>       Compact outline (or JSON) of pages and elements
  nodetto-cli types [<type>]      Element types and the fields each one takes
  nodetto-cli validate <doc>      Check that a document parses and is valid
  nodetto-cli diff <old> <new>    What changed between two versions

Draw and edit
  nodetto-cli edit <doc>          Apply add/update/move/delete operations (JSON)
  nodetto-cli arrange <doc>       Tidy the layout of one page

Render
  nodetto-cli export <doc>        Render a page to SVG, PNG or PDF

Convert and check
  nodetto-cli ddl <doc>           Database DDL from an ERD page
  nodetto-cli format <doc>        Canonical JSONL formatting
  nodetto-cli lint <doc|bpmn>     Lint BPMN pages
  nodetto-cli bpmn import|export  BPMN 2.0 XML conversion

Run "nodetto-cli help <command>" or "nodetto-cli <command> --help" for details.
Typical AI drawing loop: inspect -> types -> edit --snapshot -> export (look at
the PNG) -> later, diff <snapshot> <doc> to see what the person changed -> repeat.
The desktop app shows changes to an open file live and merges them with the
human's own edits.`;

const EXIT_CODES = `Exit codes: 0 success, 1 out of date (--check), 2 usage or input error,
3 warnings with --strict.`;

export const COMMAND_HELP: Readonly<Record<string, string>> = {
  inspect: `Usage: nodetto-cli inspect <doc.jsonl> [--page <id|name>] [--format outline|json]
                           [--type <prefix>] [--ids short|full]

Print what the document contains.

  --format outline  (default) One line per page and element, indented under its
                    frame or container: type, id, name or label, position @x,y,
                    size WxH and the essential semantic fields (columns, relation
                    ends, message text). Styling is omitted. Cheap to read for AI.
  --format json     The exact element records, for precise reads.
  --page            Only this page (id or name). Default: every page.
  --type            Only elements whose type starts with this prefix
                    (for example erd.table, bpmn., frame).
  --ids short       (default) Shortest unique id prefix of at least six
                    characters. Every command that takes an element id accepts
                    such a prefix. --ids full prints complete ids.

Example:
  nodetto-cli inspect schema.jsonl --page Schema
  document "Shop"
    page p1 "Schema" erd (2 elements)
      erd.table t-users users @0,0 w280
        column id varchar(36) pk
        column email varchar(320) not-null

${EXIT_CODES}`,

  types: `Usage: nodetto-cli types [<type>] [--kind <page kind>] [--format text|json]

Without a type, list the element types grouped by the page kinds that use them.
With a type, print its semantic fields (name, type, required, default), its
visual fields and a minimal "add" operation for nodetto-cli edit.

  --kind     Only types typically drawn on this page kind
             (freeform, erd, uml, sequence, architecture, bpmn).
  --format   text (default) or json.

Example:
  nodetto-cli types erd.table

${EXIT_CODES}`,

  edit: `Usage: nodetto-cli edit <doc.jsonl> --ops <file.json|-> [--arrange] [--dry-run]
                        [--snapshot <file>] [--format text|json]

Apply a batch of operations through the editor's command layer, so the result is
exactly what the app would produce. The batch is all-or-nothing: an invalid
operation prints its index and reason and nothing is written. The document is
written atomically; if the file changed on disk while the batch was being
applied (for example the human saved in the app), the batch is applied again
to the new contents (up to three times) so no human edit is overwritten.

Operations (a JSON array, or JSON Lines; --ops - reads stdin):
  {"op":"add","page":"p1","type":"erd.table","ref":"orders",
   "semantic":{"tableName":"orders","columns":[{"name":"id","dataType":"uuid","pk":true}]}}
  {"op":"add","page":"p1","type":"node.generic","semantic":{"label":"Pay"},
   "place":{"rightOf":"@orders","gap":80,"align":"center"}}
  {"op":"connect","from":"@a","to":"@b","label":"next"}
  {"op":"connect","from":"@orders","to":"users","fromColumn":"user_id",
   "toColumn":"id","cardinality":"*:1"}
  {"op":"update","id":"t-users","semantic":{"tableName":"accounts"},"visual":{"x":40}}
  {"op":"append","id":"@orders","field":"columns","items":[{"name":"total","dataType":"integer"}]}
  {"op":"remove-item","id":"@orders","field":"columns","item":"total"}
  {"op":"move","id":"t-users","x":40,"y":80}
  {"op":"delete","id":"01M4WD"}
  {"op":"add-page","name":"Flow","kind":"bpmn","ref":"flow"}
  {"op":"rename-page","id":"p1","name":"Shop schema"}
  {"op":"delete-page","id":"p2"}

  - "id", "from", "to" and place targets accept a unique id prefix, or "@ref"
    for an element added earlier in the batch with "ref"; "page" accepts an id,
    a name or "@ref".
  - add: given semantic fields are merged over the type's defaults (run
    "nodetto-cli types <type>"). Without x/y or "place", the element goes to the
    right of the page content, centred on the previous auto-placed element.
    place: one of rightOf, leftOf, below, above, with optional gap (default 80)
    and align "start" (default) or "center".
  - connect: picks the connector the app's connect tool would: ERD relation
    (fromColumn/toColumn by name or id, cardinality default *:1), UML
    association or component connector, sequence message on the next timeline
    row, BPMN flow (BPMN rules apply), otherwise a generic edge with an arrow.
    "label" sets the label (name for BPMN); "type" and "semantic" override.
  - update deep-merges objects; arrays are replaced whole (use append and
    remove-item for single list items); null removes a key.
  - List items that need ids (columns, indexes, attributes) get generated ids.

  --arrange   Run Tidy layout on every page the batch touched.
  --dry-run   Validate and report without writing.
  --snapshot  Also write the result to this file, as the baseline for a later
              "nodetto-cli diff <snapshot> <doc>".
  --format    text (default) or json report on stdout.

Exit codes: 0 applied, 2 usage, input or operation error, 4 the file kept
changing during the write (retry later).`,

  diff: `Usage: nodetto-cli diff <before.jsonl> <after.jsonl> [--format text|json] [--exit-code]

Show elements and pages added (+), changed (~, with the changed fields) and
removed (-) between two versions, as outline lines. An agent keeps the version
it wrote ("edit --snapshot") and later diffs it against the file to see what
the person changed in the app.

  --format     text (default) or json.
  --exit-code  Exit 1 when there are changes (like git diff --exit-code).

Example:
  nodetto-cli diff .nodetto-last.jsonl flow.jsonl
  page p1 "Schema"
    ~ erd.table 01M4WD accounts @40,0 240x80  [semantic.tableName, visual.x]
  0 added, 1 changed, 0 removed.

${EXIT_CODES}`,

  export: `Usage: nodetto-cli export <doc.jsonl> --format svg|png|pdf [--page <id|name>]
                          [--element <id>] [--output <file>] [--font-dir <dir>] [--padding <n>]
                          [--background <#rrggbb|transparent>] [--scale <n>]
                          [--pdf-page artwork|a4|letter]
                          [--orientation portrait|landscape] [--margin <mm>]

Render one page exactly as the app's page export does.

  --format       svg, png or pdf (required).
  --page         Page id or name; required when the document has several pages.
  --element      Render only this element's area (a frame renders everything
                 inside it). Accepts a unique id prefix; implies its page.
                 Use it to check one part of a large diagram.
  --output       Output file. SVG prints to stdout without it; PNG and PDF
                 require it.
  --padding      Space around the content in canvas units, 0-256 (default 16).
  --background   Six-digit hex color, or transparent. Default: #ffffff for PNG
                 and PDF, transparent for SVG.
  --scale        Raster density: 0.5, 0.75, 1, 1.5, 2, 3 or 4 (default 1 for
                 PNG, 2 for the image embedded in a PDF). Limited to 8192 pixels
                 per side and 32 megapixels; without --scale a drawing that is
                 too large is rendered at the largest scale that fits.
  --pdf-page     artwork (page fits the drawing, default), a4 or letter.
  --orientation  portrait (default) or landscape, for a4 and letter.
  --margin       PDF margin in millimetres, 0-50 (default 10; artwork ignores it).

  --font-dir     Extra directory of fonts for PNG and PDF (for example CJK
                 fonts). Common system sans and mono faces are always loaded.

PNG text uses those fonts, so metrics can differ slightly from the app.

Example (check a drawing):
  nodetto-cli export flow.jsonl --page Flow --format png --output /tmp/flow.png

${EXIT_CODES}`,

  ddl: `Usage: nodetto-cli ddl <document.jsonl> [--dialect postgresql|mysql|sqlite]
                       [--page <page id or name>] [--output <file.sql>]
                       [--check <file.sql>] [--strict]

Print the deterministic schema DDL the editor's Database DDL panel generates for
one ERD page. Without --page, the document must contain exactly one page with
ERD tables.

  --dialect  postgresql (default), mysql or sqlite.
  --output   Write the SQL to a file instead of stdout.
  --check    Compare the generated SQL with an existing file; exit 1 when it is
             out of date.
  --strict   Exit 3 when the export reports warnings.

${EXIT_CODES}`,

  arrange: `Usage: nodetto-cli arrange <document.jsonl> [--mode tidy|overlaps]
                           [--direction LR|TB] [--page <page id or name>]
                           [--write] [--check]

Run the editor's Tidy layout (default) or Remove overlaps on one page and print
the canonical result. Without --page, the document must have exactly one page.

  --mode       tidy (default) or overlaps.
  --direction  LR or TB layout direction for tidy.
  --write      Rewrite the file in place.
  --check      Exit 1 when arranging would move anything.

${EXIT_CODES}`,

  format: `Usage: nodetto-cli format <document.jsonl> [--write] [--check]

Print the canonical JSONL form.

  --write  Rewrite the file in place.
  --check  Exit 1 when the file is not canonical.

${EXIT_CODES}`,

  validate: `Usage: nodetto-cli validate <document.jsonl>

Parse and validate a document; print warnings and errors and a one-line summary.

${EXIT_CODES}`,

  lint: `Usage: nodetto-cli lint <document.jsonl|file.bpmn> [--page <page id or name>]
                        [--config <file>] [--format text|json]

Lint BPMN pages from a nodetto document or BPMN XML. Text output is empty when
clean; --format json always prints a report. A .bpmnlintrc in the working
directory is used when --config is not given.

Exit codes: 0 clean, 1 error findings, 2 usage, parse or config errors.`,

  bpmn: `Usage: nodetto-cli bpmn import <file.bpmn> [--output <doc.jsonl>] [--strict]
       nodetto-cli bpmn export <document.jsonl> [--page <page id or name>]
                               [--output <file.bpmn> | --check <file.bpmn>] [--strict]

Import or export BPMN 2.0 XML.

  --strict  Exit 3 when import or export reports warnings.
  --check   (export) Exit 1 when the file is out of date.

${EXIT_CODES}`,
};

/** Detailed help for one command, or the overview for an unknown name. */
export function helpFor(command: string | undefined): string {
  return (command !== undefined && COMMAND_HELP[command]) || OVERVIEW;
}
