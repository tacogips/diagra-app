import type {
  Document,
  Element,
  ElementId,
  ErdRelationSemantic,
  ErdTableSemantic,
  PageId,
  SequenceActivationSemantic,
  SequenceMessageSemantic,
  SequenceParticipantSemantic,
  UmlAssociationSemantic,
  UmlClassSemantic,
} from "@diagra/ir";
import { erdEndpointColumnIds } from "@diagra/ir";

export const MERMAID_DIAGRAM_KINDS = [
  "erDiagram",
  "classDiagram",
  "sequenceDiagram",
] as const;

export type MermaidDiagramKind = (typeof MERMAID_DIAGRAM_KINDS)[number];

export interface MermaidExportWarning {
  readonly elementId?: ElementId;
  readonly message: string;
}

export interface MermaidExportReport {
  readonly kind: MermaidDiagramKind;
  readonly code: string;
  readonly elementCount: number;
  readonly relationCount: number;
  readonly warnings: readonly MermaidExportWarning[];
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ordered(elements: readonly Element[]): Element[] {
  return [...elements].sort(
    (left, right) =>
      compare(left.index, right.index) || compare(left.id, right.id),
  );
}

function pageElements(document: Document, pageId: PageId): Element[] {
  return ordered(
    document.elements.filter((element) => element.page === pageId),
  );
}

/** Mermaid entity codes avoid parser-significant punctuation in free text. */
function text(value: unknown, fallback: string): string {
  const source =
    typeof value === "string" && value.trim() ? value.trim() : fallback;
  const escaped = source.replace(/[&<>"#;\r\n]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "#34;";
      case "#":
        return "#35;";
      case ";":
        return "#59;";
      default:
        return "<br/>";
    }
  });
  return escaped.toLowerCase() === "end" ? "#101;nd" : escaped;
}

function token(value: unknown, fallback: string): string {
  const source = typeof value === "string" ? value.trim() : "";
  const normalized = source.replace(/[^\p{L}\p{N}_()[\]-]+/gu, "_");
  const safe = normalized || fallback;
  return /^\p{L}/u.test(safe) ? safe : `T_${safe}`;
}

function aliasMap(
  elements: readonly Element[],
  prefix: string,
): Map<ElementId, string> {
  const result = new Map<ElementId, string>();
  const used = new Set<string>();
  for (const element of elements) {
    const stem = `${prefix}_${element.id.replace(/[^\p{L}\p{N}_-]+/gu, "_") || "item"}`;
    let alias = stem;
    let suffix = 2;
    while (used.has(alias)) alias = `${stem}_${suffix++}`;
    used.add(alias);
    result.set(element.id, alias);
  }
  return result;
}

function relationWarning(
  warnings: MermaidExportWarning[],
  element: Element,
  kind: string,
): void {
  warnings.push({
    elementId: element.id,
    message: `${kind} references an endpoint outside this page and was omitted.`,
  });
}

function erDiagram(elements: readonly Element[]): MermaidExportReport {
  const tables = elements.filter((element) => element.type === "erd.table");
  const relations = elements.filter(
    (element) => element.type === "erd.relation",
  );
  const aliases = aliasMap(tables, "E");
  const warnings: MermaidExportWarning[] = [];
  const lines = ["erDiagram", "  direction LR"];
  for (const table of tables) {
    const semantic = table.semantic as ErdTableSemantic;
    const alias = aliases.get(table.id) as string;
    lines.push(`  ${alias}["${text(semantic.tableName, "Entity")}"] {`);
    const unique = new Set(
      (semantic.indexes ?? []).flatMap((index) =>
        index.unique && index.columns.length === 1 ? index.columns : [],
      ),
    );
    for (const index of semantic.indexes ?? []) {
      if (index.unique && index.columns.length > 1)
        warnings.push({
          elementId: table.id,
          message: `Composite unique index "${index.name ?? index.id}" is not expressible as an ER attribute key.`,
        });
    }
    if ((semantic.checks?.length ?? 0) > 0)
      warnings.push({
        elementId: table.id,
        message:
          "Check constraints are not expressible as Mermaid ER attributes and were omitted.",
      });
    if (semantic.columns.some((column) => column.generatedExpression))
      warnings.push({
        elementId: table.id,
        message:
          "Generated column expressions are not expressible as Mermaid ER attributes and were omitted.",
      });
    for (const column of semantic.columns ?? []) {
      const keys = [column.pk ? "PK" : "", unique.has(column.id) ? "UK" : ""]
        .filter(Boolean)
        .join(", ");
      lines.push(
        `    ${token(column.dataType, "text")} ${token(column.name, "column")}${keys ? ` ${keys}` : ""}`,
      );
    }
    lines.push("  }");
  }
  const cardinality: Readonly<Record<string, string>> = {
    "1:1": "||--||",
    "1:*": "||--o{",
    "*:1": "}o--||",
    "*:*": "}o--o{",
  };
  let relationCount = 0;
  for (const relation of relations) {
    const semantic = relation.semantic as ErdRelationSemantic;
    const from = aliases.get(semantic.from?.table);
    const to = aliases.get(semantic.to?.table);
    if (!from || !to) {
      relationWarning(warnings, relation, "ER relationship");
      continue;
    }
    if (
      erdEndpointColumnIds(semantic.from).length > 1 ||
      erdEndpointColumnIds(semantic.to).length > 1
    )
      warnings.push({
        elementId: relation.id,
        message:
          "Composite foreign-key column pairs are not expressible in Mermaid ER diagrams and were omitted.",
      });
    if (
      (semantic.onDelete && semantic.onDelete !== "no-action") ||
      (semantic.onUpdate && semantic.onUpdate !== "no-action")
    )
      warnings.push({
        elementId: relation.id,
        message:
          "Referential actions are not expressible in Mermaid ER diagrams and were omitted.",
      });
    if (semantic.deferrability && semantic.deferrability !== "not-deferrable")
      warnings.push({
        elementId: relation.id,
        message:
          "Foreign-key constraint timing is not expressible in Mermaid ER diagrams and was omitted.",
      });
    lines.push(
      `  ${from} ${cardinality[semantic.cardinality] ?? "||--||"} ${to} : ${text(semantic.label, "relates to")}`,
    );
    relationCount += 1;
  }
  return {
    kind: "erDiagram",
    code: `${lines.join("\n")}\n`,
    elementCount: tables.length,
    relationCount,
    warnings,
  };
}

function classDiagram(elements: readonly Element[]): MermaidExportReport {
  const classes = elements.filter((element) => element.type === "uml.class");
  const associations = elements.filter(
    (element) => element.type === "uml.association",
  );
  const aliases = aliasMap(classes, "C");
  const warnings: MermaidExportWarning[] = [];
  const lines = ["classDiagram", "  direction LR"];
  for (const element of classes) {
    const semantic = element.semantic as UmlClassSemantic;
    const alias = aliases.get(element.id) as string;
    lines.push(`  class ${alias}["${text(semantic.name, "Class")}"] {`);
    if (semantic.stereotype)
      lines.push(`    <<${token(semantic.stereotype, "type")}>>`);
    for (const attribute of semantic.attributes ?? []) {
      const visibility = attribute.visibility ?? "+";
      const classifier = attribute.static ? "$" : "";
      lines.push(
        `    ${visibility}${token(attribute.type, "any")} ${token(attribute.name, "field")}${classifier}`,
      );
    }
    for (const method of semantic.methods ?? []) {
      const visibility = method.visibility ?? "+";
      const parameters = (method.parameters ?? [])
        .map(
          (parameter) =>
            `${token(parameter.type, "any")} ${token(parameter.name, "value")}`,
        )
        .join(", ");
      const returns = method.returnType
        ? ` ${token(method.returnType, "any")}`
        : "";
      const classifiers = `${method.static ? "$" : ""}${method.abstract ? "*" : ""}`;
      lines.push(
        `    ${visibility}${token(method.name, "method")}(${parameters})${returns}${classifiers}`,
      );
    }
    lines.push("  }");
  }
  const arrows: Readonly<Record<string, string>> = {
    assoc: "-->",
    aggregate: "o--",
    compose: "*--",
    inherit: "--|>",
  };
  let relationCount = 0;
  for (const association of associations) {
    const semantic = association.semantic as UmlAssociationSemantic;
    const from = aliases.get(semantic.from);
    const to = aliases.get(semantic.to);
    if (!from || !to) {
      relationWarning(warnings, association, "UML association");
      continue;
    }
    const fromCardinality = semantic.cardinalities?.from
      ? ` "${text(semantic.cardinalities.from, "")}"`
      : "";
    const toCardinality = semantic.cardinalities?.to
      ? ` "${text(semantic.cardinalities.to, "")}"`
      : "";
    const label = semantic.label
      ? ` : ${text(semantic.label, "association")}`
      : "";
    lines.push(
      `  ${from}${fromCardinality} ${arrows[semantic.kind] ?? "-->"}${toCardinality} ${to}${label}`,
    );
    relationCount += 1;
  }
  return {
    kind: "classDiagram",
    code: `${lines.join("\n")}\n`,
    elementCount: classes.length,
    relationCount,
    warnings,
  };
}

interface SequenceEvent {
  readonly order: string;
  readonly phase: number;
  readonly id: string;
  readonly line: string;
  readonly relation: boolean;
}

function sequenceDiagram(elements: readonly Element[]): MermaidExportReport {
  const participants = elements.filter(
    (element) => element.type === "sequence.participant",
  );
  participants.sort((left, right) => {
    const a = (left.semantic as SequenceParticipantSemantic).order;
    const b = (right.semantic as SequenceParticipantSemantic).order;
    return compare(a, b) || compare(left.id, right.id);
  });
  const aliases = aliasMap(participants, "P");
  const warnings: MermaidExportWarning[] = [];
  const lines = ["sequenceDiagram"];
  for (const participant of participants) {
    const semantic = participant.semantic as SequenceParticipantSemantic;
    const declaration = semantic.kind === "actor" ? "actor" : "participant";
    lines.push(
      `  ${declaration} ${aliases.get(participant.id)} as ${text(semantic.name, "Participant")}`,
    );
  }
  const events: SequenceEvent[] = [];
  for (const element of elements) {
    if (element.type === "sequence.message") {
      const semantic = element.semantic as SequenceMessageSemantic;
      const from = aliases.get(semantic.from);
      const to = aliases.get(semantic.to);
      if (!from || !to) {
        relationWarning(warnings, element, "Sequence message");
        continue;
      }
      const arrow =
        semantic.kind === "return"
          ? "-->>"
          : semantic.kind === "async"
            ? "-)"
            : "->>";
      events.push({
        order: semantic.order,
        phase: 1,
        id: element.id,
        line: `  ${from}${arrow}${to}: ${text(semantic.label, "message")}`,
        relation: true,
      });
    } else if (element.type === "sequence.activation") {
      const semantic = element.semantic as SequenceActivationSemantic;
      const participant = aliases.get(semantic.participant);
      if (!participant) {
        relationWarning(warnings, element, "Sequence activation");
        continue;
      }
      events.push(
        {
          order: semantic.fromOrder,
          phase: 0,
          id: `${element.id}:start`,
          line: `  activate ${participant}`,
          relation: false,
        },
        {
          order: semantic.toOrder,
          phase: 2,
          id: `${element.id}:end`,
          line: `  deactivate ${participant}`,
          relation: false,
        },
      );
    }
  }
  events.sort(
    (left, right) =>
      compare(left.order, right.order) ||
      left.phase - right.phase ||
      compare(left.id, right.id),
  );
  lines.push(...events.map((event) => event.line));
  return {
    kind: "sequenceDiagram",
    code: `${lines.join("\n")}\n`,
    elementCount: participants.length,
    relationCount: events.filter((event) => event.relation).length,
    warnings,
  };
}

export function availableMermaidKinds(
  document: Document,
  pageId: PageId,
): readonly MermaidDiagramKind[] {
  const elements = pageElements(document, pageId);
  return MERMAID_DIAGRAM_KINDS.filter((kind) =>
    kind === "erDiagram"
      ? elements.some((element) => element.type === "erd.table")
      : kind === "classDiagram"
        ? elements.some((element) => element.type === "uml.class")
        : elements.some((element) => element.type === "sequence.participant"),
  );
}

export function exportMermaid(
  document: Document,
  pageId: PageId,
  kind: MermaidDiagramKind,
): MermaidExportReport {
  const elements = pageElements(document, pageId);
  switch (kind) {
    case "erDiagram":
      return erDiagram(elements);
    case "classDiagram":
      return classDiagram(elements);
    case "sequenceDiagram":
      return sequenceDiagram(elements);
  }
}
