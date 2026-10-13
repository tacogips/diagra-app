# Implementation plans

- `active/`: plans still in progress, plus dispatch manifests.
- `completed/`: plans whose implementation passed final verification.
- `progress/`: per-plan worker progress logs (evidence, kept after
  archival).

## Active

BPMN rendering-defect fix (session-360; design: `design-docs/specs/design-bpmn.md`
6.1, 6.2, 6.4, 11, 13). One wave; both plans run in parallel with
disjoint writePaths. Evidence: `tmp/bpmn-render-fix-s360/<planId>/`.

| Plan | Scope |
|---|---|
| [bpmn-r1-connector-backdrops](active/bpmn-r1-connector-backdrops.md) | Pools, lanes, expanded sub-processes and BPMN groups as connector backdrops; layer, routing and canvas-partition tests |
| [bpmn-r2-task-icons-labels](active/bpmn-r2-task-icons-labels.md) | Original top-left task-type icons, unfilled group body, single label origin for canvas and export |

`active/` also holds the historical BPMN dispatch
manifests (`bpmn-operation-flow-s356-dispatch.json`,
`bpmn-operation-flow-s357-dispatch.json`,
`bpmn-operation-flow-s359-dispatch.json`). Only s359 was the final dispatch.
Their `planPath` values name the pre-archive `active/` locations.

## Completed

BPMN 2.0 operation flow (design: `design-docs/specs/design-bpmn.md`,
user QA: `design-docs/user-qa/bpmn-operation-flow.md`). Accepted by the
session-359 final verification.

| Plan | Scope |
|---|---|
| [bpmn-00-overview](completed/bpmn-00-overview.md) | Waves, ownership, gates, final verification |
| [bpmn-01-ir-core-contract](completed/bpmn-01-ir-core-contract.md) | IR registry types, semantics, validation, waypoint move |
| [bpmn-02-fixtures](completed/bpmn-02-fixtures.md) | Original purchase-request fixtures |
| [bpmn-03-core-editing](completed/bpmn-03-core-editing.md) | Connection legality, containment, pool/lane editing |
| [bpmn-04-core-notation-svg](completed/bpmn-04-core-notation-svg.md) | Shared notation module and SVG export |
| [bpmn-05-core-lint](completed/bpmn-05-core-lint.md) | bpmnlint-equivalent rules and config |
| [bpmn-06-io-bpmn-xml](completed/bpmn-06-io-bpmn-xml.md) | BPMN 2.0 XML import/export |
| [bpmn-07-collab](completed/bpmn-07-collab.md) | Yjs round trip |
| [bpmn-08-ui-solid-views](completed/bpmn-08-ui-solid-views.md) | Canvas views |
| [bpmn-09-ui-solid-palette](completed/bpmn-09-ui-solid-palette.md) | Palette and Add BPMN page |
| [bpmn-10-ui-solid-inspector](completed/bpmn-10-ui-solid-inspector.md) | Inspector BPMN section |
| [bpmn-11-ui-solid-problems-panel](completed/bpmn-11-ui-solid-problems-panel.md) | Problems panel |
| [bpmn-12-cli](completed/bpmn-12-cli.md) | `diagra-cli lint` and `bpmn import/export` |
| [bpmn-13-core-integration-tests](completed/bpmn-13-core-integration-tests.md) | Cross-package fixture tests |
| [bpmn-14-docs](completed/bpmn-14-docs.md) | README and `docs/bpmn/` |
| [bpmn-15-desktop](completed/bpmn-15-desktop.md) | Desktop menus, `.bpmn` open, dialog filter, file association |
