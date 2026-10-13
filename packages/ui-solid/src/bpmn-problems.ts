import {
  lintBpmnPage,
  recommendedLintConfig,
  type Editor,
  type ViewportSize,
} from "@diagra/core";
import type { Document, Element, ElementId, PageId } from "@diagra/ir";

export interface BpmnProblemRow {
  readonly key: string;
  readonly severity: "error" | "warning";
  readonly elementId: string;
  readonly label: string;
  readonly message: string;
  readonly ruleId: string;
  readonly selectable: boolean;
}

const elementLabel = (element: Element | undefined): string => {
  if (!element) return "";
  const semantic = element.semantic;
  if (typeof semantic === "object" && semantic !== null && "name" in semantic) {
    const name = (semantic as { readonly name?: unknown }).name;
    if (typeof name === "string" && name.length > 0) return name;
  }
  return element.id;
};

export function bpmnProblemRows(
  document: Document,
  pageId: PageId,
): readonly BpmnProblemRow[] {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (page?.kind !== "bpmn") return [];
  const findings = lintBpmnPage(document, pageId, recommendedLintConfig());
  return findings.map((finding, index) => {
    const pageLevel = finding.elementId === pageId;
    const element = pageLevel
      ? undefined
      : document.elements.find(
          (candidate) => candidate.id === finding.elementId,
        );
    return {
      key: `${finding.ruleId}:${finding.elementId}:${index}`,
      severity: finding.severity,
      elementId: finding.elementId,
      label: pageLevel ? page.name : elementLabel(element) || finding.elementId,
      message: finding.message,
      ruleId: finding.ruleId,
      selectable: !pageLevel && element !== undefined,
    };
  });
}

export function focusBpmnProblem(
  editor: Editor,
  row: BpmnProblemRow,
  viewport: ViewportSize,
): boolean {
  if (!row.selectable) return false;
  const element = editor.store.get(row.elementId as ElementId);
  if (!element) return false;
  editor.setCurrentPage(element.page);
  editor.selection.set([element.id]);
  editor.zoomToSelection(viewport);
  return true;
}
