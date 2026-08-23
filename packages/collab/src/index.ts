// Yjs client binding: IR <-> Y.Doc mapping, sync provider, awareness.
// Client side only; the sync server lives in the private diagra-cloud repo.

export { CollabBinding, type CollabBindingOptions } from "./binding.ts";
export { syncElementToY } from "./diff.ts";
export {
  clearPresence,
  observePresence,
  type PresenceListener,
  type PresencePeer,
  type PresenceState,
  type PresenceUser,
  publishPresence,
  readPeers,
} from "./presence.ts";
export {
  type CreateDocProviderOptions,
  createDocProvider,
  DOCUMENT_WS_PREFIX,
  type DocProviderParams,
  documentSocketPath,
  type EndpointTarget,
  parseEndpoint,
  toQueryParams,
} from "./provider.ts";
export {
  applyIrToDoc,
  countElements,
  ELEMENTS_KEY,
  elementFromY,
  elementToY,
  fromY,
  irToYDoc,
  META_KEY,
  PAGES_KEY,
  pageFromY,
  pageToY,
  toY,
  ydocToIr,
} from "./ydoc.ts";
