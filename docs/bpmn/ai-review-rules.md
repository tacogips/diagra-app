# AI review rules for BPMN operation flows

Save this original guideline as `.claude/rules/bpmn-operation-flow.md` in a
project that stores operation flows as Nodetto JSONL.

## Conformance target

Use the Descriptive palette by default. Analytic constructs may be used when
they express a real process need. Keep each page readable as a handoff between
roles; do not add executable-engine behavior or implementation details to the
process model.

## Modeling rules

- Use one lane for each accountable role. Keep work in the lane of the role
  that performs it.
- Make each task one actor's one verb-object action, such as `Review request`
  or `Place order`. Split work when actor or action changes.
- Name decision gateways as questions, such as `Approve request?`.
- Label each outgoing decision flow `YES` or `NO` and connect each answer to
  the matching outcome.
- Label message throw events in a `Send ...` form and message catch events in
  a `Receive ...` form. Match each send with its intended receive and preserve
  throw/catch direction.
- Keep the semantic element type aligned with its meaning: use a user task
  for human work, a service task for automated work, and message flows only
  between different participants.
- Give each process an explicit start and end. Name tasks, decision points,
  participants, and lanes so reviewers can understand them without relying on
  color or position.

## Review checklist

1. Read JSONL `semantic` fields first. Check page kind, element types,
   participant and lane membership, event position and definitions, flow
   endpoints, default-flow markers, conditions, and throw/catch pairing.
2. Check that every task has one actor and one verb-object action, gateway
   branches state clear outcomes, and message labels describe the send or
   receive action consistently.
3. Check that the visual layout supports the process meaning and that labels
   remain readable. Do not infer semantics from color or coordinates alone.
4. Run `nodetto-cli lint <document.jsonl>` in CI. Treat error findings as a
   required correction; review warnings and document intentional exceptions.
5. Review `.bpmn` interchange warnings when importing XML. Preserve unknown
   content for follow-up instead of silently deleting it.
