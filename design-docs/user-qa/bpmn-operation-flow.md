# User QA: BPMN operation flow pages

These questions concern design-docs/specs/design-bpmn.md. Each has a
default, and implementation proceeds with that default unless the user
overrides it.

## Q1. Deleting a lane

Should deleting a lane also delete the nodes in it?

- Default: yes. The delete cascades, consistent with the registry
  `onReferenceDeleted: "cascade"` used by every BPMN type, and undo restores
  the nodes.
- Alternative: keep the nodes and re-parent them to the lane's parent, as
  bpmn-js does. This needs a lane-specific delete expansion in
  `packages/core/src/commands.ts`.

## Q2. Lint config in the desktop app

- Default: the desktop problems panel always uses the bpmnlint recommended
  set. `.bpmnlintrc` and `--config` apply to `nodetto-cli lint` only.
- Alternative: store a per-page or per-document rules override in
  `extensions` and make it editable in the inspector.

## Q3. Older builds and `bpmn` pages

Builds older than this change validate `page.kind` against a closed enum.
They reject a document that contains a `bpmn` page with a `value.enum`
error.

- Default: accept this, and keep `SCHEMA_VERSION` at 1 with no migration,
  because the change is additive. Older builds cannot render BPMN anyway.
- Alternative: bump to schema version 2, so older builds report "newer
  schema" instead. Every document, including those without BPMN, would
  then become unreadable to older builds.
