import {
  SCHEMA_VERSION,
  assertValidDocument,
  type Cardinality,
  type Document,
  type Element,
  type ErdColumn,
  type MessageKind,
  type PageKind,
  type ParticipantKind,
  type UmlAssociationKind,
  type UmlAttribute,
  type UmlMethod,
} from "@diagra/ir";
import type { MermaidDiagramKind } from "./export.ts";

const MAX_MERMAID_BYTES = 1024 * 1024;

export interface MermaidImportOptions {
  readonly documentId?: string;
  readonly pageId?: string;
  readonly title?: string;
}

export interface MermaidImportWarning {
  readonly line: number;
  readonly message: string;
}

export interface MermaidImportReport {
  readonly kind: MermaidDiagramKind;
  readonly document: Document;
  readonly warnings: readonly MermaidImportWarning[];
}

export class MermaidParseError extends Error {
  readonly line?: number;

  constructor(message: string, line?: number) {
    super(line === undefined ? message : `line ${line}: ${message}`);
    this.name = "MermaidParseError";
    this.line = line;
  }
}

interface SourceLine {
  readonly number: number;
  readonly text: string;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function decodeText(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/#(34|35|59|101);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function displayName(alias: string, label?: string): string {
  return decodeText((label ?? alias).replace(/^['"`]|['"`]$/g, "").trim());
}

function slug(value: string, fallback: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || fallback
  );
}

class ElementBuilder {
  readonly elements: Element[] = [];
  private readonly used = new Set<string>();
  private index = 0;

  constructor(private readonly page: string) {}

  id(kind: string, name: string): string {
    const stem = `mermaid-${kind}-${slug(name, "item")}`;
    let id = stem;
    let suffix = 2;
    while (this.used.has(id)) id = `${stem}-${suffix++}`;
    this.used.add(id);
    return id;
  }

  add(
    id: string,
    type: string,
    semantic: unknown,
    visual: Element["visual"],
  ): void {
    this.index += 1;
    this.elements.push({
      id,
      page: this.page,
      type,
      index: `a${String(this.index).padStart(6, "0")}`,
      semantic,
      visual,
    });
  }
}

function sourceLines(input: string): {
  kind: MermaidDiagramKind;
  lines: SourceLine[];
} {
  if (new TextEncoder().encode(input).byteLength > MAX_MERMAID_BYTES)
    throw new MermaidParseError("Mermaid input exceeds the 1 MiB limit");
  const raw = input.replace(/^\uFEFF/, "").split(/\r?\n/);
  let at = 0;
  while (at < raw.length && !raw[at]?.trim()) at += 1;
  if (raw[at]?.trim() === "---") {
    at += 1;
    while (at < raw.length && raw[at]?.trim() !== "---") at += 1;
    if (at >= raw.length)
      throw new MermaidParseError("unterminated Mermaid frontmatter");
    at += 1;
  }
  while (
    at < raw.length &&
    (!raw[at]?.trim() || raw[at]?.trim().startsWith("%%"))
  )
    at += 1;
  const declaration = raw[at]?.trim();
  const kind = declaration?.split(/\s+/)[0] as MermaidDiagramKind | undefined;
  if (
    kind !== "erDiagram" &&
    kind !== "classDiagram" &&
    kind !== "sequenceDiagram"
  )
    throw new MermaidParseError(
      "expected erDiagram, classDiagram or sequenceDiagram",
      at + 1,
    );
  return {
    kind,
    lines: raw.slice(at + 1).map((text, offset) => ({
      number: at + offset + 2,
      text: text.trim(),
    })),
  };
}

function relationCardinality(marker: string): Cardinality | null {
  const match = /^([|o}{]{2})(?:--|\.\.)([|o}{]{2})$/.exec(marker);
  if (!match) return null;
  const many = (value: string): boolean =>
    value.includes("{") || value.includes("}");
  return `${many(match[1] as string) ? "*" : "1"}:${many(match[2] as string) ? "*" : "1"}` as Cardinality;
}

interface ErdDraft {
  readonly alias: string;
  name: string;
  columns: ErdColumn[];
  unique: string[];
}

function parseEr(
  lines: readonly SourceLine[],
  builder: ElementBuilder,
  warnings: MermaidImportWarning[],
): void {
  const tables = new Map<string, ErdDraft>();
  const relationships: Array<{
    line: number;
    from: string;
    to: string;
    cardinality: Cardinality;
    label?: string;
  }> = [];
  const ensure = (alias: string, label?: string): ErdDraft => {
    let table = tables.get(alias);
    if (!table) {
      table = {
        alias,
        name: displayName(alias, label),
        columns: [],
        unique: [],
      };
      tables.set(alias, table);
    } else if (label) table.name = displayName(alias, label);
    return table;
  };
  let current: ErdDraft | null = null;
  for (const line of lines) {
    if (
      !line.text ||
      line.text.startsWith("%%") ||
      /^direction\s+/i.test(line.text)
    )
      continue;
    if (line.text === "}") {
      if (!current)
        warnings.push({
          line: line.number,
          message: "Unmatched closing brace was ignored.",
        });
      current = null;
      continue;
    }
    if (current) {
      const attribute = /^(\S+)\s+(\S+)(?:\s+(.+))?$/.exec(line.text);
      if (!attribute) {
        warnings.push({
          line: line.number,
          message: "Unsupported ER attribute was ignored.",
        });
        continue;
      }
      const keys = new Set(
        (attribute[3] ?? "").split(/[\s,]+/).map((item) => item.toUpperCase()),
      );
      const id = `column-${current.columns.length + 1}`;
      current.columns.push({
        id,
        name: decodeText(attribute[2] as string).replace(/^\*/, ""),
        dataType: decodeText((attribute[1] as string).replace(/\?$/, "")),
        ...(keys.has("PK") || (attribute[2] as string).startsWith("*")
          ? { pk: true }
          : {}),
        ...((attribute[1] as string).endsWith("?") ? { nullable: true } : {}),
      });
      if (keys.has("UK")) current.unique.push(id);
      continue;
    }
    const entity = /^(\S+?)(?:\["(.*)"\])?\s*\{$/.exec(line.text);
    if (entity) {
      current = ensure(entity[1] as string, entity[2]);
      continue;
    }
    const relation =
      /^(\S+)\s+([|o}{]{2}(?:--|\.\.)[|o}{]{2})\s+(\S+)\s*:\s*(.*)$/.exec(
        line.text,
      );
    if (relation) {
      const cardinality = relationCardinality(relation[2] as string);
      if (!cardinality) {
        warnings.push({
          line: line.number,
          message: "Unsupported ER cardinality was ignored.",
        });
        continue;
      }
      ensure(relation[1] as string);
      ensure(relation[3] as string);
      relationships.push({
        line: line.number,
        from: relation[1] as string,
        to: relation[3] as string,
        cardinality,
        ...(relation[4]?.trim()
          ? { label: decodeText(relation[4].trim()) }
          : {}),
      });
      continue;
    }
    const bare = /^(\S+?)(?:\["(.*)"\])?$/.exec(line.text);
    if (bare) ensure(bare[1] as string, bare[2]);
    else
      warnings.push({
        line: line.number,
        message: "Unsupported ER statement was ignored.",
      });
  }
  if (current)
    warnings.push({
      line: lines.at(-1)?.number ?? 1,
      message: "Unclosed ER entity block was accepted.",
    });
  const ids = new Map<string, string>();
  [...tables.values()].forEach((table, index) => {
    const id = builder.id("table", table.alias);
    ids.set(table.alias, id);
    const indexes = table.unique.map((column, uniqueIndex) => ({
      id: `unique-${uniqueIndex + 1}`,
      columns: [column],
      unique: true as const,
    }));
    builder.add(
      id,
      "erd.table",
      {
        tableName: table.name,
        columns: table.columns,
        ...(indexes.length ? { indexes } : {}),
      },
      {
        x: 80 + (index % 3) * 340,
        y: 80 + Math.floor(index / 3) * 280,
        width: 280,
        height: Math.max(96, 48 + table.columns.length * 28),
      },
    );
  });
  for (const relationship of relationships) {
    const from = ids.get(relationship.from);
    const to = ids.get(relationship.to);
    if (!from || !to) {
      warnings.push({
        line: relationship.line,
        message: "ER relationship endpoint was not imported.",
      });
      continue;
    }
    builder.add(
      builder.id("relation", `${relationship.from}-${relationship.to}`),
      "erd.relation",
      {
        from: { table: from },
        to: { table: to },
        cardinality: relationship.cardinality,
        ...(relationship.label ? { label: relationship.label } : {}),
      },
      {},
    );
  }
}

interface ClassDraft {
  readonly alias: string;
  name: string;
  stereotype?: string;
  attributes: UmlAttribute[];
  methods: UmlMethod[];
}

function parseClassMember(value: string, draft: ClassDraft): boolean {
  let member = value.trim();
  const visibility = /^[+\-#~]/.test(member) ? member[0] : undefined;
  if (visibility) member = member.slice(1);
  const staticMember = member.endsWith("$") || member.endsWith("$*");
  const abstract = member.endsWith("*");
  member = member.replace(/[$*]+$/, "").trim();
  const method = /^([^\s(]+)\(([^)]*)\)(?:\s+(\S+))?$/.exec(member);
  if (method) {
    const parameters = (method[2] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const parts = item.split(/\s+/);
        return parts.length > 1
          ? {
              type: decodeText(parts.slice(0, -1).join(" ")),
              name: decodeText(parts.at(-1) as string),
            }
          : { name: decodeText(parts[0] as string) };
      });
    draft.methods.push({
      id: `method-${draft.methods.length + 1}`,
      name: decodeText(method[1] as string),
      ...(parameters.length ? { parameters } : {}),
      ...(method[3] ? { returnType: decodeText(method[3]) } : {}),
      ...(visibility
        ? { visibility: visibility as "+" | "-" | "#" | "~" }
        : {}),
      ...(staticMember ? { static: true } : {}),
      ...(abstract ? { abstract: true } : {}),
    });
    return true;
  }
  const attribute = /^(\S+)\s+(\S+)$/.exec(member);
  if (!attribute) return false;
  draft.attributes.push({
    id: `attribute-${draft.attributes.length + 1}`,
    type: decodeText(attribute[1] as string),
    name: decodeText(attribute[2] as string),
    ...(visibility ? { visibility: visibility as "+" | "-" | "#" | "~" } : {}),
    ...(staticMember ? { static: true } : {}),
  });
  return true;
}

function parseClass(
  lines: readonly SourceLine[],
  builder: ElementBuilder,
  warnings: MermaidImportWarning[],
): void {
  const classes = new Map<string, ClassDraft>();
  const associations: Array<{
    line: number;
    from: string;
    to: string;
    kind: UmlAssociationKind;
    fromCardinality?: string;
    toCardinality?: string;
    label?: string;
  }> = [];
  const ensure = (alias: string, label?: string): ClassDraft => {
    let item = classes.get(alias);
    if (!item) {
      item = {
        alias,
        name: displayName(alias, label),
        attributes: [],
        methods: [],
      };
      classes.set(alias, item);
    } else if (label) item.name = displayName(alias, label);
    return item;
  };
  let current: ClassDraft | null = null;
  for (const line of lines) {
    if (
      !line.text ||
      line.text.startsWith("%%") ||
      /^direction\s+/i.test(line.text)
    )
      continue;
    if (line.text === "}") {
      current = null;
      continue;
    }
    if (current) {
      const stereotype = /^<<(.+)>>$/.exec(line.text);
      if (stereotype) current.stereotype = decodeText(stereotype[1] as string);
      else if (!parseClassMember(line.text, current))
        warnings.push({
          line: line.number,
          message: "Unsupported class member was ignored.",
        });
      continue;
    }
    const declaration = /^class\s+(\S+?)(?:\["(.*)"\])?\s*(\{)?$/.exec(
      line.text,
    );
    if (declaration) {
      const item = ensure(declaration[1] as string, declaration[2]);
      current = declaration[3] ? item : null;
      continue;
    }
    const relation =
      /^(\S+)(?:\s+"([^"]*)")?\s+([<|>*o.\-]+)(?:\s+"([^"]*)")?\s+(\S+)(?:\s*:\s*(.*))?$/.exec(
        line.text,
      );
    if (relation) {
      let from = relation[1] as string;
      let to = relation[5] as string;
      let fromCardinality = relation[2];
      let toCardinality = relation[4];
      const arrow = relation[3] as string;
      let kind: UmlAssociationKind = "assoc";
      if (arrow.includes("<|")) {
        kind = "inherit";
        [from, to] = [to, from];
        [fromCardinality, toCardinality] = [toCardinality, fromCardinality];
      } else if (arrow.includes("|>")) kind = "inherit";
      else if (arrow.startsWith("*")) kind = "compose";
      else if (arrow.endsWith("*")) {
        kind = "compose";
        [from, to] = [to, from];
        [fromCardinality, toCardinality] = [toCardinality, fromCardinality];
      } else if (arrow.startsWith("o")) kind = "aggregate";
      else if (arrow.endsWith("o")) {
        kind = "aggregate";
        [from, to] = [to, from];
        [fromCardinality, toCardinality] = [toCardinality, fromCardinality];
      }
      ensure(from);
      ensure(to);
      associations.push({
        line: line.number,
        from,
        to,
        kind,
        ...(fromCardinality
          ? { fromCardinality: decodeText(fromCardinality) }
          : {}),
        ...(toCardinality ? { toCardinality: decodeText(toCardinality) } : {}),
        ...(relation[6]?.trim()
          ? { label: decodeText(relation[6].trim()) }
          : {}),
      });
      continue;
    }
    warnings.push({
      line: line.number,
      message: "Unsupported class statement was ignored.",
    });
  }
  const ids = new Map<string, string>();
  [...classes.values()].forEach((item, index) => {
    const id = builder.id("class", item.alias);
    ids.set(item.alias, id);
    builder.add(
      id,
      "uml.class",
      {
        name: item.name,
        ...(item.stereotype ? { stereotype: item.stereotype } : {}),
        attributes: item.attributes,
        methods: item.methods,
      },
      {
        x: 80 + (index % 3) * 360,
        y: 80 + Math.floor(index / 3) * 320,
        width: 300,
        height: Math.max(
          120,
          64 + (item.attributes.length + item.methods.length) * 28,
        ),
      },
    );
  });
  for (const association of associations) {
    const from = ids.get(association.from);
    const to = ids.get(association.to);
    if (!from || !to) {
      warnings.push({
        line: association.line,
        message: "Class relationship endpoint was not imported.",
      });
      continue;
    }
    builder.add(
      builder.id("association", `${association.from}-${association.to}`),
      "uml.association",
      {
        from,
        to,
        kind: association.kind,
        ...(association.fromCardinality || association.toCardinality
          ? {
              cardinalities: {
                from: association.fromCardinality,
                to: association.toCardinality,
              },
            }
          : {}),
        ...(association.label ? { label: association.label } : {}),
      },
      {},
    );
  }
}

interface ParticipantDraft {
  readonly alias: string;
  name: string;
  kind: ParticipantKind;
  readonly ordinal: number;
}

function parseSequence(
  lines: readonly SourceLine[],
  builder: ElementBuilder,
  warnings: MermaidImportWarning[],
): void {
  const participants = new Map<string, ParticipantDraft>();
  const messages: Array<{
    from: string;
    to: string;
    label?: string;
    kind: MessageKind;
    order: string;
  }> = [];
  const activations: Array<{
    participant: string;
    fromOrder: string;
    toOrder: string;
  }> = [];
  const open = new Map<string, string[]>();
  let timeline = 0;
  const order = (): string => `b${String(timeline).padStart(6, "0")}`;
  const ensure = (
    alias: string,
    name?: string,
    kind: ParticipantKind = "service",
  ): ParticipantDraft => {
    let participant = participants.get(alias);
    if (!participant) {
      participant = {
        alias,
        name: displayName(alias, name),
        kind,
        ordinal: participants.size + 1,
      };
      participants.set(alias, participant);
    } else {
      if (name) participant.name = displayName(alias, name);
      if (kind === "actor") participant.kind = kind;
    }
    return participant;
  };
  for (const line of lines) {
    if (
      !line.text ||
      line.text.startsWith("%%") ||
      /^autonumber(?:\s|$)/i.test(line.text)
    )
      continue;
    const declaration = /^(actor|participant)\s+(\S+)(?:\s+as\s+(.+))?$/i.exec(
      line.text,
    );
    if (declaration) {
      const alias = declaration[2] as string;
      const configured = alias.includes("@{");
      if (configured)
        warnings.push({
          line: line.number,
          message:
            "Participant JSON configuration was reduced to a standard participant.",
        });
      ensure(
        alias.split("@{")[0] as string,
        declaration[3],
        declaration[1]?.toLowerCase() === "actor" ? "actor" : "service",
      );
      continue;
    }
    const message =
      /^(\S+?)(<<-->>|<<->>|-->>|--\)|--x|-->|->>|-\)|-x|->)(\S+)\s*:\s*(.*)$/.exec(
        line.text,
      );
    if (message) {
      timeline += 1;
      const from = message[1] as string;
      const to = message[3] as string;
      ensure(from);
      ensure(to);
      const arrow = message[2] as string;
      messages.push({
        from,
        to,
        kind: arrow.includes(")")
          ? "async"
          : arrow.startsWith("--")
            ? "return"
            : "sync",
        order: order(),
        ...(message[4]?.trim() ? { label: decodeText(message[4].trim()) } : {}),
      });
      continue;
    }
    const activation = /^(activate|deactivate)\s+(\S+)$/i.exec(line.text);
    if (activation) {
      timeline += 1;
      const alias = activation[2] as string;
      ensure(alias);
      if (activation[1]?.toLowerCase() === "activate")
        open.set(alias, [...(open.get(alias) ?? []), order()]);
      else {
        const stack = [...(open.get(alias) ?? [])];
        const fromOrder = stack.pop();
        if (!fromOrder)
          warnings.push({
            line: line.number,
            message: "Unmatched deactivate statement was ignored.",
          });
        else {
          open.set(alias, stack);
          activations.push({ participant: alias, fromOrder, toOrder: order() });
        }
      }
      continue;
    }
    warnings.push({
      line: line.number,
      message: "Unsupported sequence statement was ignored.",
    });
  }
  for (const [alias, stack] of open) {
    for (const fromOrder of stack) {
      timeline += 1;
      activations.push({ participant: alias, fromOrder, toOrder: order() });
      warnings.push({
        line: lines.at(-1)?.number ?? 1,
        message: `Open activation for ${alias} was closed at the end.`,
      });
    }
  }
  const ids = new Map<string, string>();
  [...participants.values()]
    .sort(
      (left, right) =>
        left.ordinal - right.ordinal || compare(left.alias, right.alias),
    )
    .forEach((participant, index) => {
      const id = builder.id("participant", participant.alias);
      ids.set(participant.alias, id);
      builder.add(
        id,
        "sequence.participant",
        {
          name: participant.name,
          kind: participant.kind,
          order: `a${String(index + 1).padStart(6, "0")}`,
        },
        {
          x: 80 + index * 220,
          y: 60,
          width: 160,
          height: Math.max(180, 112 + timeline * 52),
        },
      );
    });
  for (const message of messages) {
    const from = ids.get(message.from);
    const to = ids.get(message.to);
    if (!from || !to) continue;
    const timelinePosition = Number.parseInt(message.order.slice(1), 10);
    builder.add(
      builder.id("message", `${message.from}-${message.to}`),
      "sequence.message",
      {
        from,
        to,
        order: message.order,
        kind: message.kind,
        ...(message.label ? { label: message.label } : {}),
      },
      {
        y: 140 + timelinePosition * 52,
        ...(message.kind === "return"
          ? { style: { dash: "dashed" as const } }
          : {}),
      },
    );
  }
  for (const activation of activations) {
    const participant = ids.get(activation.participant);
    if (!participant) continue;
    const participantElement = builder.elements.find(
      (element) => element.id === participant,
    );
    const from = Number.parseInt(activation.fromOrder.slice(1), 10);
    const to = Number.parseInt(activation.toOrder.slice(1), 10);
    builder.add(
      builder.id("activation", activation.participant),
      "sequence.activation",
      {
        participant,
        fromOrder: activation.fromOrder,
        toOrder: activation.toOrder,
      },
      {
        x:
          (participantElement?.visual.x ?? 0) +
          (participantElement?.visual.width ?? 160) / 2 -
          5,
        y: 140 + from * 52,
        width: 10,
        height: Math.max(12, (to - from) * 52),
      },
    );
  }
}

export function importMermaid(
  input: string,
  options: MermaidImportOptions = {},
): MermaidImportReport {
  const source = sourceLines(input);
  const pageId = options.pageId?.trim() || "mermaid-page";
  const builder = new ElementBuilder(pageId);
  const warnings: MermaidImportWarning[] = [];
  if (source.kind === "erDiagram") parseEr(source.lines, builder, warnings);
  else if (source.kind === "classDiagram")
    parseClass(source.lines, builder, warnings);
  else parseSequence(source.lines, builder, warnings);
  const pageKind: Readonly<Record<MermaidDiagramKind, PageKind>> = {
    erDiagram: "erd",
    classDiagram: "uml",
    sequenceDiagram: "sequence",
  };
  const title = options.title?.trim() || `Imported ${source.kind}`;
  const document: Document = {
    schemaVersion: SCHEMA_VERSION,
    id: options.documentId?.trim() || "mermaid-document",
    title,
    pages: [{ id: pageId, name: title, kind: pageKind[source.kind] }],
    elements: builder.elements,
  };
  assertValidDocument(document);
  return { kind: source.kind, document, warnings };
}
