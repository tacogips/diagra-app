import type {
  Arrowhead,
  Cardinality,
  Document,
  Element,
  ErdRelationSemantic,
  ErdTableSemantic,
  GenericEdgeSemantic,
  GenericNodeSemantic,
  GroupSemantic,
  SequenceActivationSemantic,
  SequenceMessageSemantic,
  SequenceParticipantSemantic,
  UmlAssociationSemantic,
  UmlClassSemantic,
} from "@diagra/ir";
import { erdEndpointColumnIds } from "@diagra/ir";

export interface D2ExportWarning {
  readonly elementId?: string;
  readonly message: string;
}

export interface D2ExportReport {
  readonly code: string;
  readonly elementCount: number;
  readonly relationCount: number;
  readonly warnings: readonly D2ExportWarning[];
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

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown, key: string): string {
  const field = record(value)[key];
  return typeof field === "string" ? field : "";
}

function quote(value: string): string {
  return JSON.stringify(value.replace(/\r\n?/g, "\n"));
}

function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() || "element"
  );
}

function aliases(elements: readonly Element[]): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const element of ordered(elements)) {
    const stem = `n_${slug(element.id)}`;
    let alias = stem;
    let suffix = 2;
    while (used.has(alias.toLowerCase())) alias = `${stem}_${suffix++}`;
    used.add(alias.toLowerCase());
    result.set(element.id, alias);
  }
  return result;
}

function labelOf(element: Element): string {
  if (element.type === "node.generic")
    return (element.semantic as GenericNodeSemantic).label;
  if (element.type === "shape.geo")
    return stringField(element.semantic, "label");
  if (element.type === "text.note")
    return stringField(element.semantic, "text");
  if (element.type === "image.raster")
    return stringField(element.semantic, "alt") || "Image";
  if (element.type === "frame")
    return stringField(element.semantic, "name") || "Frame";
  if (element.type === "erd.table")
    return (element.semantic as ErdTableSemantic).tableName;
  if (element.type === "uml.class")
    return (element.semantic as UmlClassSemantic).name;
  return element.visual.layerName ?? element.type;
}

function styleLines(
  element: Element,
  indent: string,
  warnings: D2ExportWarning[],
): string[] {
  const style = element.visual.style;
  if (!style) return [];
  const lines: string[] = [];
  if (style.fill) lines.push(`${indent}style.fill: ${quote(style.fill)}`);
  if (style.stroke) lines.push(`${indent}style.stroke: ${quote(style.stroke)}`);
  if (style.color)
    lines.push(`${indent}style.font-color: ${quote(style.color)}`);
  if (style.strokeWidth !== undefined)
    lines.push(
      `${indent}style.stroke-width: ${Math.min(15, Math.max(1, Math.round(style.strokeWidth)))}`,
    );
  if (style.opacity !== undefined)
    lines.push(
      `${indent}style.opacity: ${Math.min(1, Math.max(0, style.opacity))}`,
    );
  if (style.cornerRadius !== undefined)
    lines.push(
      `${indent}style.border-radius: ${Math.min(20, Math.max(0, Math.round(style.cornerRadius)))}`,
    );
  if (style.dash === "dashed") lines.push(`${indent}style.stroke-dash: 5`);
  if (style.dash === "dotted") lines.push(`${indent}style.stroke-dash: 2`);
  if (style.fontSize !== undefined)
    lines.push(
      `${indent}style.font-size: ${Math.min(100, Math.max(8, Math.round(style.fontSize)))}`,
    );
  if (style.fontWeight !== undefined && style.fontWeight >= 600)
    lines.push(`${indent}style.bold: true`);
  if (style.fontStyle === "italic") lines.push(`${indent}style.italic: true`);
  if (style.textDecoration?.includes("underline"))
    lines.push(`${indent}style.underline: true`);
  if (
    style.fillGradient ||
    style.strokeGradient ||
    style.cornerRadii ||
    style.blendMode ||
    style.letterSpacing !== undefined ||
    style.lineHeight !== undefined ||
    style.verticalAlign ||
    style.textDecoration?.includes("line-through")
  )
    warnings.push({
      elementId: element.id,
      message:
        "Some visual styling has no portable D2 equivalent and was omitted.",
    });
  const hasShadow =
    style.shadow !== undefined ||
    style.effects?.some(
      (effect) => effect.type === "drop-shadow" && effect.enabled !== false,
    );
  if (hasShadow) lines.push(`${indent}style.shadow: true`);
  return lines;
}

function dimensionLines(element: Element, indent: string): string[] {
  const lines: string[] = [];
  if (element.visual.width !== undefined && element.visual.width > 0)
    lines.push(
      `${indent}width: ${Math.round(element.visual.width * 100) / 100}`,
    );
  if (element.visual.height !== undefined && element.visual.height > 0)
    lines.push(
      `${indent}height: ${Math.round(element.visual.height * 100) / 100}`,
    );
  return lines;
}

function uniqueColumnIds(table: ErdTableSemantic): Set<string> {
  return new Set(
    (table.indexes ?? [])
      .filter((index) => index.unique && index.columns.length === 1)
      .map((index) => index.columns[0] as string),
  );
}

function columnAliases(table: ErdTableSemantic): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const column of table.columns) {
    const stem = `c_${slug(column.name || column.id)}`;
    let alias = stem;
    let suffix = 2;
    while (used.has(alias)) alias = `${stem}_${suffix++}`;
    used.add(alias);
    out.set(column.id, alias);
  }
  return out;
}

function shapeKind(element: Element): string | null {
  if (element.type === "shape.geo") {
    const kind = stringField(element.semantic, "geo");
    return (
      (
        {
          rect: "rectangle",
          ellipse: "oval",
          diamond: "diamond",
          triangle: "triangle",
          hexagon: "hexagon",
          parallelogram: "parallelogram",
          cylinder: "cylinder",
          star: "star",
        } as Record<string, string>
      )[kind] ?? "rectangle"
    );
  }
  if (element.type === "text.note") return "text";
  return element.type === "image.raster" ? "rectangle" : null;
}

function memberIds(element: Element): readonly string[] {
  if (element.type === "group")
    return (element.semantic as GroupSemantic).memberIds;
  if (element.type === "frame") {
    const ids = record(element.semantic)["memberIds"];
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string")
      : [];
  }
  return [];
}

function regularShapeLines(
  element: Element,
  alias: string,
  indent: string,
  warnings: D2ExportWarning[],
  children: readonly string[],
): string[] {
  if (element.type === "erd.table") {
    const table = element.semantic as ErdTableSemantic;
    const unique = uniqueColumnIds(table);
    const columnIds = columnAliases(table);
    const lines = [
      `${indent}${alias}: ${quote(table.tableName)} {`,
      `${indent}  shape: sql_table`,
    ];
    for (const column of table.columns) {
      const constraints = [
        ...(column.pk ? ["primary_key"] : []),
        ...(unique.has(column.id) ? ["unique"] : []),
      ];
      const constraint =
        constraints.length === 0
          ? ""
          : constraints.length === 1
            ? ` { constraint: ${constraints[0]} }`
            : ` { constraint: [${constraints.join("; ")}] }`;
      lines.push(
        `${indent}  ${columnIds.get(column.id)}: ${quote(`${column.dataType}${column.nullable ? "?" : ""}`)}${constraint}`,
      );
    }
    if ((table.indexes ?? []).some((index) => index.columns.length > 1))
      warnings.push({
        elementId: element.id,
        message:
          "Composite indexes are not expressible on D2 SQL-table rows and were omitted.",
      });
    if ((table.checks?.length ?? 0) > 0)
      warnings.push({
        elementId: element.id,
        message:
          "Check constraints are not expressible on D2 SQL-table rows and were omitted.",
      });
    if (table.columns.some((column) => column.generatedExpression))
      warnings.push({
        elementId: element.id,
        message:
          "Generated column expressions are not expressible on D2 SQL-table rows and were omitted.",
      });
    lines.push(
      ...styleLines(element, `${indent}  `, warnings),
      ...children,
      `${indent}}`,
    );
    return lines;
  }
  if (element.type === "uml.class") {
    const semantic = element.semantic as UmlClassSemantic;
    const lines = [
      `${indent}${alias}: ${quote(semantic.name)} {`,
      `${indent}  shape: class`,
    ];
    if (semantic.stereotype)
      warnings.push({
        elementId: element.id,
        message:
          "UML stereotypes have no native D2 class field and were omitted.",
      });
    const used = new Set<string>();
    const row = (source: string): string => {
      let value = source || "member";
      let suffix = 2;
      while (used.has(value.toLowerCase())) value = `${source}_${suffix++}`;
      used.add(value.toLowerCase());
      return quote(value);
    };
    for (const attribute of semantic.attributes) {
      const visibility = attribute.visibility ?? "+";
      lines.push(
        `${indent}  ${row(`${visibility}${attribute.name}${attribute.static ? "$" : ""}`)}: ${quote(attribute.type ?? "")}`,
      );
    }
    for (const method of semantic.methods) {
      const visibility = method.visibility ?? "+";
      const parameters = (method.parameters ?? [])
        .map(
          (parameter) =>
            `${parameter.name}${parameter.type ? ` ${parameter.type}` : ""}`,
        )
        .join(", ");
      lines.push(
        `${indent}  ${row(`${visibility}${method.name}(${parameters})${method.static ? "$" : ""}${method.abstract ? "*" : ""}`)}: ${quote(method.returnType ?? "")}`,
      );
    }
    lines.push(
      ...styleLines(element, `${indent}  `, warnings),
      ...children,
      `${indent}}`,
    );
    return lines;
  }
  const isContainer = element.type === "frame" || element.type === "group";
  const lines = [
    `${indent}${alias}: ${quote(element.type === "group" ? (element.visual.layerName ?? "") : labelOf(element))} {`,
  ];
  const shape = shapeKind(element);
  if (shape) lines.push(`${indent}  shape: ${shape}`);
  if (!isContainer) lines.push(...dimensionLines(element, `${indent}  `));
  lines.push(
    ...styleLines(element, `${indent}  `, warnings),
    ...children,
    `${indent}}`,
  );
  if (element.type === "image.raster")
    warnings.push({
      elementId: element.id,
      message: "Embedded image data was represented as a labelled rectangle.",
    });
  return lines;
}

function endpointArrow(head: Arrowhead | undefined): boolean {
  return head !== undefined && head !== "none";
}

function genericArrow(semantic: GenericEdgeSemantic): string {
  const start = endpointArrow(semantic.arrowheads?.start);
  const end = endpointArrow(semantic.arrowheads?.end ?? "arrow");
  return start && end ? "<->" : start ? "<-" : end ? "->" : "--";
}

function arrowheadFields(semantic: GenericEdgeSemantic): readonly string[] {
  const fields: string[] = [];
  const add = (end: "source" | "target", head: Arrowhead | undefined) => {
    if (!head || head === "none") return;
    if (head === "dot") {
      fields.push(`${end}-arrowhead.shape: circle`);
      fields.push(`${end}-arrowhead.style.filled: true`);
    } else fields.push(`${end}-arrowhead.shape: ${head}`);
  };
  add("source", semantic.arrowheads?.start);
  if (semantic.arrowheads?.end !== undefined)
    add("target", semantic.arrowheads.end);
  return fields;
}

function cardinalityShape(cardinality: Cardinality, end: 0 | 1): string {
  const part = cardinality.split(":")[end];
  return part === "*" ? "cf-many-required" : "cf-one-required";
}

function connectionBlock(
  base: string,
  fields: readonly string[],
  indent = "",
): string[] {
  if (fields.length === 0) return [`${indent}${base}`];
  return [
    `${indent}${base} {`,
    ...fields.map((field) => `${indent}  ${field}`),
    `${indent}}`,
  ];
}

function exportD2Sequence(
  pageName: string,
  elements: readonly Element[],
  allAliases: ReadonlyMap<string, string>,
  warnings: D2ExportWarning[],
): { lines: string[]; elements: number; relations: number } | null {
  const participants = ordered(
    elements.filter((element) => element.type === "sequence.participant"),
  ).sort((left, right) => {
    const a = (left.semantic as SequenceParticipantSemantic).order;
    const b = (right.semantic as SequenceParticipantSemantic).order;
    return compare(a, b) || compare(left.id, right.id);
  });
  if (participants.length === 0) return null;
  const participantIds = new Set(participants.map((element) => element.id));
  const activations = elements
    .filter((element) => element.type === "sequence.activation")
    .map((element, index) => ({
      element,
      semantic: element.semantic as SequenceActivationSemantic,
      name: `span_${index + 1}`,
    }));
  const usedActivations = new Set<string>();
  const activeEndpoint = (participant: string, order: string): string => {
    const active = activations.filter(
      ({ semantic }) =>
        semantic.participant === participant &&
        compare(semantic.fromOrder, order) <= 0 &&
        compare(order, semantic.toOrder) <= 0,
    );
    for (const activation of active) usedActivations.add(activation.element.id);
    return `${allAliases.get(participant)}${active.map((activation) => `.${activation.name}`).join("")}`;
  };
  const lines = [
    `d2_sequence: ${quote(pageName)} {`,
    "  shape: sequence_diagram",
  ];
  for (const participant of participants) {
    const semantic = participant.semantic as SequenceParticipantSemantic;
    const alias = allAliases.get(participant.id) as string;
    if (semantic.kind === "service")
      lines.push(`  ${alias}: ${quote(semantic.name)}`);
    else
      lines.push(
        `  ${alias}: ${quote(semantic.name)} { shape: ${semantic.kind === "actor" ? "person" : "cylinder"} }`,
      );
  }
  let relationCount = 0;
  const messages = elements
    .filter((element) => element.type === "sequence.message")
    .sort((left, right) => {
      const a = (left.semantic as SequenceMessageSemantic).order;
      const b = (right.semantic as SequenceMessageSemantic).order;
      return compare(a, b) || compare(left.id, right.id);
    });
  for (const message of messages) {
    const semantic = message.semantic as SequenceMessageSemantic;
    if (
      !participantIds.has(semantic.from) ||
      !participantIds.has(semantic.to)
    ) {
      warnings.push({
        elementId: message.id,
        message:
          "Sequence message has an unavailable endpoint and was omitted.",
      });
      continue;
    }
    const from = activeEndpoint(semantic.from, semantic.order);
    const to = activeEndpoint(semantic.to, semantic.order);
    const fields = semantic.kind === "return" ? ["style.stroke-dash: 5"] : [];
    if (semantic.kind === "async")
      warnings.push({
        elementId: message.id,
        message:
          "D2 has no distinct asynchronous message arrow; a directed message was emitted.",
      });
    lines.push(
      ...connectionBlock(
        `${from} -> ${to}${semantic.label ? `: ${quote(semantic.label)}` : ""}`,
        fields,
        "  ",
      ),
    );
    relationCount += 1;
  }
  for (const activation of activations) {
    if (!participantIds.has(activation.semantic.participant))
      warnings.push({
        elementId: activation.element.id,
        message:
          "Sequence activation has an unavailable participant and was omitted.",
      });
    else if (!usedActivations.has(activation.element.id))
      warnings.push({
        elementId: activation.element.id,
        message:
          "A sequence activation with no message in its interval has no D2 span equivalent and was omitted.",
      });
  }
  lines.push("}");
  return {
    lines,
    elements: participants.length,
    relations: relationCount,
  };
}

export function exportD2(document: Document, pageId: string): D2ExportReport {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error(`page not found: ${pageId}`);
  const pageElements = ordered(
    document.elements.filter((element) => element.page === pageId),
  );
  const warnings: D2ExportWarning[] = [];
  const hidden = new Set(
    pageElements
      .filter((element) => element.visual.hidden)
      .map((element) => element.id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const container of pageElements) {
      if (!hidden.has(container.id)) continue;
      for (const id of memberIds(container)) {
        if (!hidden.has(id)) {
          hidden.add(id);
          changed = true;
        }
      }
    }
  }
  const visible = pageElements.filter((element) => !hidden.has(element.id));
  const alias = aliases(visible);
  const byId = new Map(visible.map((element) => [element.id, element]));
  const sequenceIds = new Set(
    visible
      .filter((element) => element.type.startsWith("sequence."))
      .map((element) => element.id),
  );
  const supportedNodes = visible.filter(
    (element) =>
      !sequenceIds.has(element.id) &&
      !["edge.generic", "erd.relation", "uml.association"].includes(
        element.type,
      ) &&
      ![
        "design.token",
        "design.guide",
        "design.text-style",
        "review.comment",
      ].includes(element.type),
  );
  for (const element of supportedNodes) {
    if (element.type === "draw.freehand")
      warnings.push({
        elementId: element.id,
        message: "Freehand paths have no native D2 shape and were omitted.",
      });
  }
  const exportable = supportedNodes.filter(
    (element) => element.type !== "draw.freehand",
  );
  const exportableIds = new Set(exportable.map((element) => element.id));
  const parent = new Map<string, string>();
  for (const container of exportable.filter(
    (element) => element.type === "frame" || element.type === "group",
  )) {
    for (const child of memberIds(container)) {
      if (!exportableIds.has(child) || child === container.id) continue;
      if (parent.has(child)) {
        warnings.push({
          elementId: child,
          message:
            "The layer belongs to multiple explicit containers; the first container was used.",
        });
      } else parent.set(child, container.id);
    }
  }
  for (const [child, owner] of [...parent]) {
    const seen = new Set([child]);
    let at: string | undefined = owner;
    while (at !== undefined) {
      if (seen.has(at)) {
        parent.delete(child);
        warnings.push({
          elementId: child,
          message: "Cyclic container membership was flattened.",
        });
        break;
      }
      seen.add(at);
      at = parent.get(at);
    }
  }
  const children = new Map<string, Element[]>();
  for (const element of exportable) {
    const owner = parent.get(element.id);
    if (owner) children.set(owner, [...(children.get(owner) ?? []), element]);
  }
  const renderNode = (element: Element, indent = ""): string[] => {
    const nested = ordered(children.get(element.id) ?? []).flatMap((child) =>
      renderNode(child, `${indent}  `),
    );
    return regularShapeLines(
      element,
      alias.get(element.id) as string,
      indent,
      warnings,
      nested,
    );
  };
  const path = (id: string): string | null => {
    if (!exportableIds.has(id)) return null;
    const parts: string[] = [];
    const seen = new Set<string>();
    let at: string | undefined = id;
    while (at) {
      if (seen.has(at)) return null;
      seen.add(at);
      parts.unshift(alias.get(at) as string);
      at = parent.get(at);
    }
    return parts.join(".");
  };
  const lines = ["direction: right"];
  for (const element of exportable.filter((element) => !parent.has(element.id)))
    lines.push(...renderNode(element));
  let relationCount = 0;
  for (const element of visible) {
    if (element.type === "edge.generic") {
      const semantic = element.semantic as GenericEdgeSemantic;
      const from = path(semantic.from);
      const to = path(semantic.to);
      if (!from || !to) {
        warnings.push({
          elementId: element.id,
          message: "Generic edge has an unavailable endpoint and was omitted.",
        });
        continue;
      }
      const fields = [
        ...arrowheadFields(semantic),
        ...styleLines(element, "", warnings).map((line) => line.trim()),
      ];
      lines.push(
        ...connectionBlock(
          `${from} ${genericArrow(semantic)} ${to}${semantic.label ? `: ${quote(semantic.label)}` : ""}`,
          fields,
        ),
      );
      relationCount += 1;
    } else if (element.type === "erd.relation") {
      const semantic = element.semantic as ErdRelationSemantic;
      const from = path(semantic.from.table);
      const to = path(semantic.to.table);
      const fromTable = byId.get(semantic.from.table);
      const toTable = byId.get(semantic.to.table);
      if (
        !from ||
        !to ||
        fromTable?.type !== "erd.table" ||
        toTable?.type !== "erd.table"
      ) {
        warnings.push({
          elementId: element.id,
          message:
            "ER relation has an unavailable table endpoint and was omitted.",
        });
        continue;
      }
      if (
        (semantic.onDelete && semantic.onDelete !== "no-action") ||
        (semantic.onUpdate && semantic.onUpdate !== "no-action")
      )
        warnings.push({
          elementId: element.id,
          message:
            "Referential actions are not expressible on D2 SQL-table connections and were omitted.",
        });
      if (semantic.deferrability && semantic.deferrability !== "not-deferrable")
        warnings.push({
          elementId: element.id,
          message:
            "Foreign-key constraint timing is not expressible on D2 SQL-table connections and was omitted.",
        });
      const fromColumnIds = erdEndpointColumnIds(semantic.from);
      const toColumnIds = erdEndpointColumnIds(semantic.to);
      const fromColumn = fromColumnIds[0]
        ? columnAliases(fromTable.semantic as ErdTableSemantic).get(
            fromColumnIds[0],
          )
        : undefined;
      const toColumn = toColumnIds[0]
        ? columnAliases(toTable.semantic as ErdTableSemantic).get(
            toColumnIds[0],
          )
        : undefined;
      const fields = [
        `source-arrowhead.shape: ${cardinalityShape(semantic.cardinality, 0)}`,
        `target-arrowhead.shape: ${cardinalityShape(semantic.cardinality, 1)}`,
      ];
      if (fromColumnIds[0] && !fromColumn)
        warnings.push({
          elementId: element.id,
          message:
            "The ER source column was unavailable; the connection targets its table.",
        });
      if (toColumnIds[0] && !toColumn)
        warnings.push({
          elementId: element.id,
          message:
            "The ER target column was unavailable; the connection targets its table.",
        });
      if (fromColumnIds.length > 1 || toColumnIds.length > 1)
        warnings.push({
          elementId: element.id,
          message:
            "Composite foreign-key endpoints are not expressible on one D2 connection; only the first column pair was targeted.",
        });
      lines.push(
        ...connectionBlock(
          `${from}${fromColumn ? `.${fromColumn}` : ""} -> ${to}${toColumn ? `.${toColumn}` : ""}${semantic.label ? `: ${quote(semantic.label)}` : ""}`,
          fields,
        ),
      );
      relationCount += 1;
    } else if (element.type === "uml.association") {
      const semantic = element.semantic as UmlAssociationSemantic;
      const from = path(semantic.from);
      const to = path(semantic.to);
      if (!from || !to) {
        warnings.push({
          elementId: element.id,
          message:
            "UML association has an unavailable endpoint and was omitted.",
        });
        continue;
      }
      const fields: string[] = [];
      if (semantic.kind === "inherit")
        fields.push(
          "target-arrowhead.shape: triangle",
          "target-arrowhead.style.filled: false",
        );
      else if (semantic.kind === "aggregate")
        fields.push(
          "source-arrowhead.shape: diamond",
          "source-arrowhead.style.filled: false",
        );
      else if (semantic.kind === "compose")
        fields.push(
          "source-arrowhead.shape: diamond",
          "source-arrowhead.style.filled: true",
        );
      if (semantic.cardinalities)
        warnings.push({
          elementId: element.id,
          message:
            "UML endpoint multiplicities were omitted because D2 arrowhead labels are not layout-safe.",
        });
      const arrow = semantic.kind === "inherit" ? "->" : "--";
      lines.push(
        ...connectionBlock(
          `${from} ${arrow} ${to}${semantic.label ? `: ${quote(semantic.label)}` : ""}`,
          fields,
        ),
      );
      relationCount += 1;
    }
  }
  const sequence = exportD2Sequence(page.name, visible, alias, warnings);
  if (sequence) {
    lines.push(...sequence.lines);
    relationCount += sequence.relations;
  }
  const elementCount = exportable.length + (sequence?.elements ?? 0);
  if (elementCount === 0)
    warnings.push({
      message: "The page contains no layers that D2 export can represent.",
    });
  return {
    code: `${lines.join("\n")}\n`,
    elementCount,
    relationCount,
    warnings,
  };
}
