# BPMN JSONL format

A BPMN operation flow is a normal Diagra JSONL document with a page whose
`pageKind` is `bpmn`. Element meaning is stored in `semantic`; coordinates,
style and optional BPMN label bounds are stored in `visual`. This separation
lets a reader inspect or diff process meaning without interpreting drawing
coordinates.

The records below are element records from the `p-bpmn` page. Their ids and
labels are original examples. Endpoint and parent ids refer to other elements
in the same page.

## Element records

| Type | Semantic fields |
| --- | --- |
| `bpmn.participant` | `name`, `collapsed`, optional `processRef` |
| `bpmn.lane` | `name`, required `parent` participant or lane id |
| `bpmn.task` | optional `name`, `taskType`, `loop`, optional `forCompensation`, optional `parent` |
| `bpmn.subProcess` | optional `name`, `expanded`, `triggeredByEvent`, `adHoc`, `loop`, optional `forCompensation` and `parent` |
| `bpmn.callActivity` | optional `name`, optional `calledElement`, `loop`, optional `forCompensation` and `parent` |
| `bpmn.event` | optional `name`, `position`, `definitions`, optional `interrupting`, `parallelMultiple`, and `parent` |
| `bpmn.boundaryEvent` | optional `name`, `attachedTo` activity id, `cancelActivity`, `definitions` |
| `bpmn.gateway` | optional `name`, `gatewayType`, optional `markerVisible` and `parent` |
| `bpmn.dataObject` | optional `name`, `role`, `collection`, optional `parent` |
| `bpmn.dataStore` | optional `name` and `parent` |
| `bpmn.textAnnotation` | `text`, optional `parent` |
| `bpmn.group` | optional `name` |
| `bpmn.sequenceFlow` | `from`, `to`, optional `name`, `condition`, `isDefault`, and routing fields |
| `bpmn.messageFlow` | `from`, `to`, optional `name`, `messageRef`, and routing fields |
| `bpmn.association` | `from`, `to`, `direction`, and routing fields |
| `bpmn.dataAssociation` | `from`, `to`, and routing fields |

```jsonl
{"kind":"element","id":"pool-review","page":"p-bpmn","type":"bpmn.participant","index":"a0","semantic":{"name":"Review process","collapsed":false}}
{"kind":"element","id":"lane-approval","page":"p-bpmn","type":"bpmn.lane","index":"a1","semantic":{"name":"Approver","parent":"pool-review"}}
{"kind":"element","id":"task-review","page":"p-bpmn","type":"bpmn.task","index":"a2","semantic":{"name":"Review request","taskType":"user","loop":"none","parent":"lane-approval"}}
{"kind":"element","id":"subprocess-check","page":"p-bpmn","type":"bpmn.subProcess","index":"a3","semantic":{"name":"Check details","expanded":true,"triggeredByEvent":false,"adHoc":false,"loop":"none","parent":"lane-approval"}}
{"kind":"element","id":"call-audit","page":"p-bpmn","type":"bpmn.callActivity","index":"a4","semantic":{"name":"Record audit","calledElement":"AuditRecord","loop":"none","parent":"lane-approval"}}
{"kind":"element","id":"event-start-review","page":"p-bpmn","type":"bpmn.event","index":"a5","semantic":{"name":"Review requested","position":"start","definitions":[],"parent":"lane-approval"},"visual":{"x":40,"y":80,"width":36,"height":36,"labelBounds":{"x":13,"y":123,"width":90,"height":27}}}
{"kind":"element","id":"boundary-timeout","page":"p-bpmn","type":"bpmn.boundaryEvent","index":"a6","semantic":{"name":"Deadline reached","attachedTo":"task-review","cancelActivity":false,"definitions":[{"id":"def-timer","kind":"timer","timer":{"type":"duration","value":"PT2H"}}]}}
{"kind":"element","id":"gateway-approve","page":"p-bpmn","type":"bpmn.gateway","index":"a7","semantic":{"name":"Approve request?","gatewayType":"exclusive","markerVisible":true,"parent":"lane-approval"}}
{"kind":"element","id":"data-request","page":"p-bpmn","type":"bpmn.dataObject","index":"a8","semantic":{"name":"Request record","role":"reference","collection":false,"parent":"lane-approval"}}
{"kind":"element","id":"store-archive","page":"p-bpmn","type":"bpmn.dataStore","index":"a9","semantic":{"name":"Request archive","parent":"lane-approval"}}
{"kind":"element","id":"note-check","page":"p-bpmn","type":"bpmn.textAnnotation","index":"aa","semantic":{"text":"Confirm the request details","parent":"lane-approval"}}
{"kind":"element","id":"group-review","page":"p-bpmn","type":"bpmn.group","index":"ab","semantic":{"name":"Review stage"}}
{"kind":"element","id":"flow-review","page":"p-bpmn","type":"bpmn.sequenceFlow","index":"ac","semantic":{"from":"task-review","to":"gateway-approve","isDefault":false,"routing":"straight"}}
{"kind":"element","id":"flow-reminder","page":"p-bpmn","type":"bpmn.messageFlow","index":"ad","semantic":{"from":"pool-review","to":"pool-requester","name":"Send review update","routing":"straight"}}
{"kind":"element","id":"association-audit","page":"p-bpmn","type":"bpmn.association","index":"ae","semantic":{"from":"data-request","to":"task-review","direction":"one","routing":"straight"}}
{"kind":"element","id":"data-association-record","page":"p-bpmn","type":"bpmn.dataAssociation","index":"af","semantic":{"from":"task-review","to":"data-request","routing":"straight"}}
```

`parent` names the one innermost container for a node: a lane, a participant
without lanes, or a sub-process. A lane points to its participant or enclosing
lane. With no parent, a node belongs to the page's implicit process. Membership
is stored on the member record; lane membership lists are derived. A boundary
event uses `attachedTo` for its activity host.

An event's `definitions` is an array of `EventDefinition` values with the
shape `{id, kind, ref?, linkName?, timer?, condition?}`. `kind` is one of
`message`, `timer`, `error`, `escalation`, `cancel`, `compensation`,
`conditional`, `link`, `signal`, or `terminate`. A timer has a `type` of
`date`, `duration`, or `cycle` and a string `value`. An empty array means a
none event. Multiple entries represent a multiple event; `parallelMultiple`
marks parallel multiple.

Sequence flow semantics keep `isDefault` on the flow record. A conditional
flow stores its expression body in `condition` and may have a display `name`.
Flow routing remains semantic connector data, while its label geometry is
visual data.

## XML interchange metadata

The optional `extensions.bpmnXml` object retains XML-only information for the
BPMN adapter. Page-level metadata can contain `definitionsId`,
`targetNamespace`, `collaborationId`, `processId`, `laneSetIds`, `namespaces`,
`rootElements`, and `unsupported`. Element-level metadata can contain foreign
`attributes`, raw `children`, and a `dataObjectId`. Core, lint, and the IR treat
these values as opaque interchange metadata.

`visual.labelBounds` stores BPMNDI label placement as page-unit `x`, `y`,
`width`, and `height`. If absent, the renderer uses its default placement.
