# bpmn-02-fixtures

- planId: bpmn-02-fixtures
- planPath: impl-plans/active/bpmn-02-fixtures.md
- wave: 1; dependsOn: none
- design: design-docs/specs/design-bpmn.md section 11 (fixtures), 7.3
  (required fixture lint outcome), 1 (no copying from `.reference`)
- progress log: impl-plans/progress/bpmn-02-fixtures.md
- protocol: follow impl-plans/active/bpmn-00-overview.md "Per-worker
  protocol".

## Intent

Author the four original BPMN 2.0 XML fixtures that every later plan tests
against: a complete purchase-request flow, a draft with exactly the three
lint findings, a throw/catch-swapped variant and a YES/NO-inverted
variant. They are hand-written data files, independent of any code, so
they are written in wave 1.

The structure (one pool with three lanes, 13 flow nodes, 12 sequence
flows, 6 message events) mirrors what the article demonstrates, but every
id, label, coordinate and line of XML here is original and is specified
below. Do not open, copy or paraphrase the `.reference/` files.

## Non-goals

- No code, no tests, no JSONL (bpmn-06 generates
  `purchase-request.jsonl` from the complete fixture with the importer).
- No other BPMN constructs (sub-processes, data, boundary events): those
  are covered by inline test inputs in bpmn-05 and bpmn-06.

## writePaths

- packages/io/src/__fixtures__/bpmn/purchase-request.bpmn (new)
- packages/io/src/__fixtures__/bpmn/purchase-request-draft.bpmn (new)
- packages/io/src/__fixtures__/bpmn/purchase-request-swapped.bpmn (new)
- packages/io/src/__fixtures__/bpmn/purchase-request-inverted.bpmn (new)
- impl-plans/progress/bpmn-02-fixtures.md

sharedPaths: none.

## File format (all four files)

- UTF-8, LF, 2-space indent, ASCII only, trailing newline.
- First line `<?xml version="1.0" encoding="UTF-8"?>`.
- Root `<bpmn:definitions>` with exactly these namespace declarations
  (standard OMG URIs) and attributes:
  `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`,
  `xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"`,
  `xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"`,
  `xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"`,
  `xmlns:di="http://www.omg.org/spec/DD/20100524/DI"`,
  `id="Definitions_OfficeSupply"`,
  `targetNamespace="http://bpmn.io/schema/bpmn"`.
- Children order: `bpmn:collaboration`, `bpmn:process`,
  `bpmndi:BPMNDiagram`.
- Collaboration `id="Collaboration_OfficeSupply"` with one
  `<bpmn:participant id="Participant_OfficeSupply" name="Office supply
  purchase" processRef="Process_OfficeSupply" />`.
- Process `id="Process_OfficeSupply" isExecutable="false"` containing, in
  order: one `bpmn:laneSet id="LaneSet_OfficeSupply"`, the flow nodes in
  the table order below, then the sequence flows in the table order below.
- Every flow node lists its `<bpmn:incoming>` and `<bpmn:outgoing>` flow
  ids as children (bpmn.io convention), incoming first.
- Each message event has one child
  `<bpmn:messageEventDefinition id="<eventId>_def" />`.
- Diagram `id="Diagram_OfficeSupply"`, plane `id="Plane_OfficeSupply"
  bpmnElement="Collaboration_OfficeSupply"`. Shapes in order: participant,
  lanes, flow nodes (table order); then edges (table order). Shape ids are
  `<elementId>_di`. Participant and lane shapes carry
  `isHorizontal="true"`. The gateway shape carries
  `isMarkerVisible="true"`. Each shape has one `<dc:Bounds x y width
  height />`; each edge has `<di:waypoint x y />` children.

## Content of `purchase-request.bpmn` (complete)

Lanes (`bpmn:lane`, name, bounds x,y,w,h, flowNodeRef in this order):
- `Lane_Requester` "Requester" (130,80,1170,160): Start_NeedIdentified,
  Task_SubmitRequest, Event_RequestNoticeRequester,
  Event_RejectionNoticeRequester, End_RequestRejected,
  Event_OrderNoticeRequester, End_PurchaseComplete
- `Lane_Approver` "Approver" (130,240,1170,160):
  Event_RequestNoticeApprover, Task_ReviewRequest, Gateway_Approve,
  Event_RejectionNoticeApprover
- `Lane_Procurement` "Procurement" (130,400,1170,160): Task_PlaceOrder,
  Event_OrderNoticeProcurement

Participant shape bounds: (100,80,1200,480).

Flow nodes (XML tag, id, name, bounds x,y,w,h, label bounds x,y,w,h):

| tag | id | name | bounds | label bounds |
|---|---|---|---|---|
| startEvent | Start_NeedIdentified | Need identified | 182,142,36,36 | 155,185,90,27 |
| userTask | Task_SubmitRequest | Submit purchase request | 260,120,100,80 | none |
| intermediateThrowEvent (message) | Event_RequestNoticeRequester | Send request notice | 412,142,36,36 | 385,185,90,27 |
| intermediateCatchEvent (message) | Event_RequestNoticeApprover | Receive request notice | 412,302,36,36 | 385,345,90,27 |
| userTask | Task_ReviewRequest | Review request | 510,280,100,80 | none |
| exclusiveGateway | Gateway_Approve | Approve? | 675,295,50,50 | 655,352,90,14 |
| intermediateThrowEvent (message) | Event_RejectionNoticeApprover | Send rejection notice | 832,302,36,36 | 805,345,90,27 |
| intermediateCatchEvent (message) | Event_RejectionNoticeRequester | Receive rejection notice | 832,142,36,36 | 805,185,90,27 |
| endEvent | End_RequestRejected | Request rejected | 932,142,36,36 | 905,185,90,27 |
| userTask | Task_PlaceOrder | Place order | 800,440,100,80 | none |
| intermediateThrowEvent (message) | Event_OrderNoticeProcurement | Send order notice | 1082,462,36,36 | 1055,505,90,27 |
| intermediateCatchEvent (message) | Event_OrderNoticeRequester | Receive order notice | 1082,142,36,36 | 1055,185,90,27 |
| endEvent | End_PurchaseComplete | Purchase complete | 1192,142,36,36 | 1165,185,90,27 |

Sequence flows (id, name, sourceRef -> targetRef, waypoints, label
bounds):

| id | name | source -> target | waypoints | label bounds |
|---|---|---|---|---|
| Flow_StartToSubmit | - | Start_NeedIdentified -> Task_SubmitRequest | (218,160) (260,160) | none |
| Flow_SubmitToNotice | - | Task_SubmitRequest -> Event_RequestNoticeRequester | (360,160) (412,160) | none |
| Flow_RequestNotice | - | Event_RequestNoticeRequester -> Event_RequestNoticeApprover | (430,178) (430,302) | none |
| Flow_NoticeToReview | - | Event_RequestNoticeApprover -> Task_ReviewRequest | (448,320) (510,320) | none |
| Flow_ReviewToGateway | - | Task_ReviewRequest -> Gateway_Approve | (610,320) (675,320) | none |
| Flow_ToRejection | NO | Gateway_Approve -> Event_RejectionNoticeApprover | (725,320) (832,320) | 765,302,20,14 |
| Flow_RejectionNotice | - | Event_RejectionNoticeApprover -> Event_RejectionNoticeRequester | (850,302) (850,178) | none |
| Flow_RejectionToEnd | - | Event_RejectionNoticeRequester -> End_RequestRejected | (868,160) (932,160) | none |
| Flow_ToOrder | YES | Gateway_Approve -> Task_PlaceOrder | (700,345) (700,480) (800,480) | 708,410,22,14 |
| Flow_OrderToNotice | - | Task_PlaceOrder -> Event_OrderNoticeProcurement | (900,480) (1082,480) | none |
| Flow_OrderNotice | - | Event_OrderNoticeProcurement -> Event_OrderNoticeRequester | (1100,462) (1100,178) | none |
| Flow_OrderNoticeToEnd | - | Event_OrderNoticeRequester -> End_PurchaseComplete | (1118,160) (1192,160) | none |

"-" means no `name` attribute. A shape or edge with label bounds gets
`<bpmndi:BPMNLabel><dc:Bounds .../></bpmndi:BPMNLabel>`; without label
bounds it gets no `BPMNLabel`.

## Variants (copy the complete file, then apply exactly these edits)

- `purchase-request-draft.bpmn`:
  - `Task_PlaceOrder` has no `name` attribute.
  - Remove the `Flow_OrderToNotice` sequence flow, its BPMNEdge, and its
    `incoming`/`outgoing` references on `Task_PlaceOrder` and
    `Event_OrderNoticeProcurement`.
  - Change the definitions id to `Definitions_OfficeSupplyDraft`.
  - Expected recommended lint (asserted by bpmn-13 and bpmn-12): exactly
    `label-required` on Task_PlaceOrder, `no-implicit-end` on
    Task_PlaceOrder, `no-implicit-start` on Event_OrderNoticeProcurement.
- `purchase-request-swapped.bpmn`:
  - `Event_RequestNoticeRequester` becomes a `bpmn:intermediateCatchEvent`
    and `Event_RequestNoticeApprover` becomes a
    `bpmn:intermediateThrowEvent`. Ids, names, flows, definitions and DI
    stay unchanged (a semantic error that lint does not detect).
  - Definitions id `Definitions_OfficeSupplySwapped`.
- `purchase-request-inverted.bpmn`:
  - `Flow_ToRejection` is named "YES" and `Flow_ToOrder` is named "NO".
    Label bounds stay.
  - Definitions id `Definitions_OfficeSupplyInverted`.

## Pitfalls

- Waypoints and bounds must be exactly as tabulated; bpmn-13 counts SVG
  primitives and bpmn-05/13 assert that no element overlaps another
  (`no-overlapping-elements` must stay silent).
- Do not add `exporter`, `exporterVersion`, `bioc:`/`color:` namespaces,
  `documentation` or extension elements.
- The swapped and inverted files must still lint clean: do not change any
  flow.
- ASCII only. "Approve?" contains a plain question mark.

## Verification

```
cd /Users/taco/gits/tacogips/diagra-app-bpmn
for f in packages/io/src/__fixtures__/bpmn/*.bpmn; do xmllint --noout "$f" || exit 1; done; echo ok   # prints ok, exit 0 (well-formed XML)
grep -c '<bpmn:sequenceFlow ' packages/io/src/__fixtures__/bpmn/purchase-request.bpmn          # 12
grep -c '<bpmn:sequenceFlow ' packages/io/src/__fixtures__/bpmn/purchase-request-draft.bpmn    # 11
grep -c '<bpmn:flowNodeRef>' packages/io/src/__fixtures__/bpmn/purchase-request.bpmn           # 13
grep -c '<bpmn:messageEventDefinition ' packages/io/src/__fixtures__/bpmn/purchase-request.bpmn  # 6
grep -c '<bpmndi:BPMNShape ' packages/io/src/__fixtures__/bpmn/purchase-request.bpmn           # 17
grep -c '<bpmndi:BPMNEdge ' packages/io/src/__fixtures__/bpmn/purchase-request.bpmn            # 12
grep -lP '[^\x00-\x7F]' packages/io/src/__fixtures__/bpmn/*.bpmn                                # no output
diff <(grep -v 'Definitions_' packages/io/src/__fixtures__/bpmn/purchase-request.bpmn) <(grep -v 'Definitions_' packages/io/src/__fixtures__/bpmn/purchase-request-inverted.bpmn)
                                       # shows only the two name="YES"/"NO" swaps
```

`xmllint` ships with macOS (`/usr/bin/xmllint`). If it is unavailable in
the sandbox, record that as a verification gap in the progress log; do not
substitute a hand-rolled check. bpmn-06 parses all four files in its
import tests, which then provides the well-formedness evidence.

## Done criteria

- Four files exist with the counts above; xmllint well-formedness passes.
- No non-ASCII characters; no text taken from `.reference/`.
- Progress log lists the file hashes and command exit codes.
