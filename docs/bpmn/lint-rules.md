# BPMN lint rules

The linter uses the bpmnlint rule ids and recommended severities. Messages
are Diagra wording. `warn` is displayed as `warning`.

| Rule id | Recommended severity | Description |
| --- | --- | --- |
| `label-required` | error | Require labels on decision points, named containers, and conditional flows. |
| `no-implicit-end` | error | Require flow nodes to lead to an explicit end event. |
| `no-implicit-start` | error | Require flow nodes to follow an explicit start event. |
| `start-event-required` | error | Require a start event in every process scope that contains flow nodes. |
| `end-event-required` | error | Require an end event in every process scope. |
| `no-disconnected` | error | Report flow nodes with no incoming or outgoing sequence flow. |
| `conditional-flows` | error | Require non-default sibling flows to be conditional after a conditional fork. |
| `no-duplicate-sequence-flows` | error | Report repeated sequence flows with the same endpoints and condition. |
| `no-gateway-join-fork` | error | Avoid gateways that join and fork at the same time. |
| `no-implicit-split` | error | Use an explicit gateway for an unconditioned multi-flow split. |
| `single-blank-start-event` | error | Allow at most one start event without an event definition in a scope. |
| `single-event-definition` | error | Use at most one event definition on an event. |
| `superfluous-gateway` | warning | Remove gateways with exactly one incoming and one outgoing sequence flow. |
| `fake-join` | warning | Use a gateway to join multiple incoming sequence flows. |
| `no-complex-gateway` | error | Avoid complex gateways in descriptive operation flows. |
| `no-inclusive-gateway` | error | Avoid inclusive gateways in descriptive operation flows. |
| `no-overlapping-elements` | warning | Keep visible flow-node bounds from overlapping within a scope. |
| `superfluous-termination` | warning | Use terminate events only when the scope has concurrent paths. |
| `sub-process-blank-start-event` | error | Give ordinary sub-process start events an event definition. |
| `event-sub-process-typed-start-event` | error | Use an event definition on event sub-process start events. |
| `link-event` | error | Give link events names and pair each throw event with a catch event. |
| `ad-hoc-sub-process` | error | Do not use start or end events inside an ad-hoc sub-process. |
| `no-bpmndi` | error | Provide diagram interchange geometry for every semantic element. |

## Configuration

The CLI accepts JSON `.bpmnlintrc` files with `extends` and per-rule
`off`, `warn`, or `error` overrides. Rule options are accepted and ignored.
Unknown rule ids, unsupported `extends` values (including `plugin:*`), and
invalid JSON are configuration errors.

```json
{
  "extends": "bpmnlint:recommended",
  "rules": {
    "label-required": "error",
    "no-overlapping-elements": "warn",
    "superfluous-gateway": "off"
  }
}
```

For `diagra-cli lint`, an explicit `--config <file>` takes precedence. If it
is absent, the CLI reads `.bpmnlintrc` from the working directory when present;
otherwise it uses recommended. The desktop problems panel always uses
recommended and has no per-document config.

## Known differences

- Rule messages use Diagra wording; the ids and recommended severities match
  bpmnlint.
- The text summary has no leading symbol.
- The desktop always uses recommended; config files apply to the CLI only.
- Vertical pools import with a warning and render horizontally.
