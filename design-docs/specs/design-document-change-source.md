# Document change sources

Local files and cloud documents use `DocumentChangeSource` from `@nodetto/core`.
A source watches one resource key and delivers transport-independent
`DocumentChange` notifications. The returned subscription exposes `ready` and an
idempotent `close`; notification delivery stops immediately on close, even if
native/network teardown finishes later.

`DocumentChangeMonitor.watch(source, key, listener)` switches resources or source
implementations. It closes the previous subscription, filters other resource
keys, and rejects late events from retired subscriptions. A failed setup releases
its resources and is reported to the caller.

Adapters:

- `createFileDocumentChangeSource(backend)` translates native filesystem events
  into document invalidations. Watch/unwatch operations are serialized because
  the desktop host owns one native watch. `DocumentSession` re-reads and merges
  the document through its existing three-way merge policy.
- `createYjsDocumentChangeSource(doc)` translates the cloud provider's synchronized
  Y.Doc into notifications. Nested changed element IDs and transaction origin are
  preserved, and page/metadata changes invalidate the full snapshot. One
  transaction emits one notification. `CollabBinding` consumes this same interface
  while retaining CRDT field merging, local undo and echo suppression.

A cloud push API can implement the same source without introducing filesystem
concepts to consumers. An invalidation-only API omits `elementIds`; consumers then
read the authoritative snapshot. Storage, authentication, presence, reconnect
permission checks and conflict policies remain responsibilities of the adapters
and sessions; notifications do not turn cloud edits into whole-file overwrites.

Tests cover local/cloud source switching, late readiness, failed setup, immediate
unsubscribe, serialized native teardown, nested cloud updates and coalesced
transactions. Existing binding/session suites cover merges, undo, viewer access
and local autosave. Page-only commands also mark local documents dirty; active
page changes do not.
