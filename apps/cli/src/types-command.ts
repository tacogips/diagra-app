// `nodetto-cli types`: the element types an agent can add, and for one type
// its semantic fields, the editor's defaults and a ready-to-edit example.

import { Editor } from "@nodetto/core";
import {
  getElementTypeDefinition,
  isKnownElementType,
  type KeyOrder,
  listElementTypeDefinitions,
  PAGE_KINDS,
  type PageKind,
} from "@nodetto/ir";
import {
  type CommandIo,
  type CommandResult,
  fail,
  ok,
  parseArgs,
} from "./commands.ts";
import { helpFor } from "./help.ts";

const TYPES_OPTIONS = new Set(["--kind", "--format"]);

const GENERAL = [
  "node.generic",
  "edge.generic",
  "shape.geo",
  "text.note",
  "frame",
  "group",
  "draw.freehand",
  "draw.path",
  "image.raster",
];

/** Types typically drawn on each page kind (a guide, not an enforced rule). */
const TYPICAL: Readonly<Record<PageKind, readonly string[]>> = {
  freeform: GENERAL,
  architecture: GENERAL,
  erd: ["erd.table", "erd.relation", "text.note", "frame"],
  uml: [
    "uml.class",
    "uml.association",
    "uml.component",
    "uml.interface",
    "uml.port",
    "uml.component-relationship",
    "text.note",
    "frame",
  ],
  sequence: [
    "sequence.participant",
    "sequence.message",
    "sequence.activation",
    "text.note",
  ],
  bpmn: [
    "bpmn.participant",
    "bpmn.lane",
    "bpmn.task",
    "bpmn.subProcess",
    "bpmn.callActivity",
    "bpmn.event",
    "bpmn.boundaryEvent",
    "bpmn.gateway",
    "bpmn.dataObject",
    "bpmn.dataStore",
    "bpmn.textAnnotation",
    "bpmn.group",
    "bpmn.sequenceFlow",
    "bpmn.messageFlow",
    "bpmn.association",
    "bpmn.dataAssociation",
  ],
};

function isPageKind(value: string): value is PageKind {
  return (PAGE_KINDS as readonly string[]).includes(value);
}

function fieldTree(order: KeyOrder, indent: string): string[] {
  const lines: string[] = [];
  for (const key of order.keys) {
    lines.push(`${indent}${key}`);
    const child = order.children?.[key];
    if (child) lines.push(...fieldTree(child, `${indent}  `));
  }
  return lines;
}

export function typesCommand(
  _io: CommandIo,
  args: readonly string[],
): CommandResult {
  const parsed = parseArgs(args, TYPES_OPTIONS, new Set());
  if (typeof parsed === "string")
    return fail(`${parsed}\n\n${helpFor("types")}`);
  if (parsed.positional.length > 1)
    return fail(`types takes at most one type.\n\n${helpFor("types")}`);
  const format = parsed.options.get("--format") ?? "text";
  if (format !== "text" && format !== "json")
    return fail(`Unsupported format "${format}". Choose text or json.`);
  const kind = parsed.options.get("--kind");
  if (kind !== undefined && !isPageKind(kind))
    return fail(
      `Unknown page kind "${kind}". Choose ${PAGE_KINDS.join(", ")}.`,
    );

  const type = parsed.positional[0];
  if (type === undefined) {
    const definitions = listElementTypeDefinitions().filter(
      (definition) =>
        kind === undefined || TYPICAL[kind].includes(definition.type),
    );
    if (format === "json")
      return ok(
        `${JSON.stringify(
          definitions.map((definition) => ({
            type: definition.type,
            category: definition.category,
            pageKinds: PAGE_KINDS.filter((pageKind) =>
              TYPICAL[pageKind].includes(definition.type),
            ),
          })),
          null,
          2,
        )}\n`,
      );
    const lines = PAGE_KINDS.filter(
      (pageKind) => kind === undefined || pageKind === kind,
    ).map(
      (pageKind) =>
        `${pageKind}: ${TYPICAL[pageKind].filter((name) => definitions.some((definition) => definition.type === name)).join(", ")}`,
    );
    return ok(
      `Element types typically used per page kind:\n${lines.map((line) => `  ${line}`).join("\n")}\n\nRun "nodetto-cli types <type>" for its fields and an example.\n`,
    );
  }

  if (!isKnownElementType(type))
    return fail(
      `Unknown element type "${type}". Run "nodetto-cli types" for the list.`,
    );
  const definition = getElementTypeDefinition(type);
  if (!definition) return fail(`Unknown element type "${type}".`);
  const util = new Editor().registry.getOrFallback(type);
  const semantic = util.defaultSemantic();
  const visual = util.defaultVisual();
  const pageKinds = PAGE_KINDS.filter((pageKind) =>
    TYPICAL[pageKind].includes(type),
  );
  const example = {
    op: "add",
    page: "<page id>",
    type,
    semantic,
    visual: { ...visual, x: 0, y: 0 },
  };
  if (format === "json")
    return ok(
      `${JSON.stringify(
        {
          type,
          category: definition.category,
          pageKinds,
          fields: definition.keyOrder,
          defaultSemantic: semantic,
          defaultVisual: visual,
          example,
        },
        null,
        2,
      )}\n`,
    );
  const lines = [
    `${type} (${definition.category}${pageKinds.length ? `; used on ${pageKinds.join(", ")} pages` : ""})`,
    "",
    "Semantic fields (nested fields indented):",
    ...fieldTree(definition.keyOrder, "  "),
    "",
    `Default semantic: ${JSON.stringify(semantic)}`,
    `Default visual: ${JSON.stringify(visual)}`,
    `References: deleting a referenced element ${definition.onReferenceDeleted === "cascade" ? "deletes this element too" : "clears the reference"}.`,
    "",
    "Example operation for nodetto-cli edit:",
    `  ${JSON.stringify(example)}`,
  ];
  return ok(`${lines.join("\n")}\n`);
}
