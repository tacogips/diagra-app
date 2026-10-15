import type { Document, Element, PageId } from "@nodetto/ir";

export interface BpmnElementSpec {
  readonly id: string;
  readonly type: string;
  readonly semantic?: Readonly<Record<string, unknown>>;
  readonly visual?: Element["visual"];
}
export interface BpmnTestSpec {
  readonly elements?: readonly BpmnElementSpec[];
}
export function buildLintTestDocument(
  spec: BpmnTestSpec = {},
  pageId: PageId = "page",
): Document {
  const elements = (spec.elements ?? []).map(
    (entry, index): Element => ({
      id: entry.id,
      page: pageId,
      type: entry.type,
      index: `a${(index + 1).toString().padStart(3, "0")}`,
      semantic: entry.semantic ?? {},
      visual: entry.visual ?? {},
    }),
  );
  return {
    schemaVersion: 1,
    id: "lint-test-document",
    title: "Lint test",
    pages: [{ id: pageId, name: "BPMN", kind: "bpmn" }],
    elements,
  };
}
