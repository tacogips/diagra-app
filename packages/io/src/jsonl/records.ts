// JSONL record shapes and their declared key orders.
// See the product design (diagra-cloud repo), section 6.

import { type KeyOrder, VISUAL_KEY_ORDER } from "@diagra/ir";

export const DOCUMENT_KIND = "document";
export const PAGE_KIND = "page";
export const ELEMENT_KIND = "element";

/** Record kinds this build models; anything else is preserved verbatim. */
export const KNOWN_RECORD_KINDS: readonly string[] = [
  DOCUMENT_KIND,
  PAGE_KIND,
  ELEMENT_KIND,
];

export const DOCUMENT_RECORD_KEYS: readonly string[] = [
  "kind",
  "schemaVersion",
  "id",
  "title",
];

/**
 * The page record spells the diagram kind `pageKind`: `kind` is taken by the
 * record discriminator, so `Page.kind` maps to `pageKind` on the wire.
 */
export const PAGE_RECORD_KEYS: readonly string[] = [
  "kind",
  "id",
  "name",
  "pageKind",
];

export const ELEMENT_RECORD_KEYS: readonly string[] = [
  "kind",
  "id",
  "page",
  "type",
  "index",
  "semantic",
  "visual",
];

export const DOCUMENT_RECORD_ORDER: KeyOrder = {
  keys: DOCUMENT_RECORD_KEYS,
};

export const PAGE_RECORD_ORDER: KeyOrder = { keys: PAGE_RECORD_KEYS };

/** Element order with the semantic payload order spliced in per type. */
export function elementRecordOrder(semantic?: KeyOrder): KeyOrder {
  const children: Record<string, KeyOrder> = { visual: VISUAL_KEY_ORDER };
  if (semantic) {
    children["semantic"] = semantic;
  }
  return { keys: ELEMENT_RECORD_KEYS, children };
}

/** Unknown records are ordered by kind first, then by their own keys. */
export const UNKNOWN_RECORD_ORDER: KeyOrder = { keys: ["kind"] };
