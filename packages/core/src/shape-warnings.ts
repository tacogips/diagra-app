import {
  type Element,
  type ErdTableSemantic,
  type FrameSemantic,
  type GenericEdgeSemantic,
  type ImageSemantic,
  type SequenceActivationSemantic,
  type UmlClassSemantic,
  UmlComponentType,
  getElementTypeDefinition,
  connectorEndpointIssues,
  CONNECTOR_ENDPOINT_TYPES,
  isDatabaseObjectType,
  type DatabaseObjectSemantic,
} from "@nodetto/ir";
import { erdForeignKeyWarning } from "./erd-foreign-key.ts";
import type { ShapeContext } from "./shape-util.ts";

/** Incomplete authoring states are warnings, never assertions or saved styles. */
export function shapeAuthoringWarnings(
  element: Element,
  context: Pick<ShapeContext, "resolve">,
): readonly string[] {
  const warnings: string[] = [];
  const semantic = element.semantic as Record<string, unknown>;
  const fk = erdForeignKeyWarning(element, (id) => context.resolve(id));
  if (fk) warnings.push(fk);
  warnings.push(
    ...connectorEndpointIssues(
      element.type,
      element.semantic,
      element.page,
      (id) => context.resolve(id),
    ).map((issue) => issue.message),
  );
  const names: Record<string, string> = {
    from: "Source endpoint",
    to: "Target endpoint",
    owner: "Port owner",
    participant: "Participant",
    instanceOf: "Component source",
    responsiveSource: "Responsive source",
    parent: "Parent",
    attachedTo: "Boundary event host",
  };
  for (const reference of getElementTypeDefinition(element.type)?.references(
    element.semantic,
  ) ?? []) {
    const name = names[reference.field] ?? "Referenced element";
    const target = context.resolve(reference.id);
    if (!target) {
      warnings.push(`${name} is ${reference.id ? "missing" : "not assigned"}.`);
      continue;
    }
    const typedConnector = Object.hasOwn(
      CONNECTOR_ENDPOINT_TYPES,
      element.type,
    );
    const local = [
      "from",
      "to",
      "owner",
      "participant",
      "parent",
      "attachedTo",
    ].includes(reference.field);
    const prototype =
      element.type === "edge.generic" && semantic.prototype === true;
    if (
      local &&
      !typedConnector &&
      target.page !== element.page &&
      !(prototype && reference.field === "to")
    )
      warnings.push(`${name} must be on the same page.`);
    let expected: readonly string[] | undefined;
    if (element.type === "sequence.activation")
      expected = ["sequence.participant"];
    if (element.type === UmlComponentType.Port && reference.field === "owner")
      expected = [UmlComponentType.Component];
    if (
      element.type === "frame" &&
      ["instanceOf", "responsiveSource"].includes(reference.field)
    )
      expected = ["frame"];
    if (element.type.startsWith("bpmn.") && reference.field === "attachedTo")
      expected = ["bpmn.task", "bpmn.subProcess", "bpmn.callActivity"];
    if (element.type.startsWith("bpmn.") && reference.field === "parent")
      expected =
        element.type === "bpmn.lane"
          ? ["bpmn.participant", "bpmn.lane"]
          : ["bpmn.participant", "bpmn.lane", "bpmn.subProcess"];
    if (expected && !expected.includes(target.type))
      warnings.push(`${name} has an incompatible shape type.`);
  }
  if (isDatabaseObjectType(element.type)) {
    const object = element.semantic as DatabaseObjectSemantic;
    if (!object.definition.trim())
      warnings.push(
        element.type === "erd.view" || element.type === "erd.materialized-view"
          ? "View query is not assigned."
          : "Routine body is not assigned.",
      );
    if (element.type === "erd.function" && !object.returnType?.trim())
      warnings.push("Function return type is not assigned.");
    const rows = object.columns ?? object.parameters ?? [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.name))
        warnings.push(`Duplicate field name: ${row.name}.`);
      seen.add(row.name);
    }
    if (
      element.type === "erd.function" &&
      object.parameters?.some(
        (parameter) => parameter.mode && parameter.mode !== "in",
      )
    )
      warnings.push("Function parameters must use IN mode.");
    for (const id of object.dependsOn ?? []) {
      const dependency = context.resolve(id);
      if (
        dependency &&
        dependency.type !== "erd.table" &&
        !isDatabaseObjectType(dependency.type)
      )
        warnings.push(
          "Database dependency must be a table, view, function, or procedure.",
        );
      if (dependency && dependency.page !== element.page)
        warnings.push("Database dependencies must be on the same page.");
    }
    const visit = (id: string, seen: Set<string>): boolean => {
      if (id === element.id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      const target = context.resolve(id);
      return Boolean(
        target &&
          isDatabaseObjectType(target.type) &&
          (target.semantic as DatabaseObjectSemantic).dependsOn?.some((next) =>
            visit(next, seen),
          ),
      );
    };
    if (object.dependsOn?.some((id) => visit(id, new Set())))
      warnings.push("Database dependencies contain a cycle.");
  }
  if (element.type === "erd.table") {
    const table = element.semantic as ErdTableSemantic;
    const seen = new Set<string>();
    const ids = new Set(table.columns.map((column) => column.id));
    for (const column of table.columns) {
      const name = column.name.trim();
      if (seen.has(name)) warnings.push(`Duplicate column name: ${name}.`);
      seen.add(name);
    }
    for (const [index, definition] of (table.indexes ?? []).entries()) {
      if (
        !definition.columns.length ||
        definition.columns.some((id) => !ids.has(id))
      )
        warnings.push(
          `Index ${definition.name || index + 1} needs existing columns.`,
        );
    }
  }
  if (element.type === "uml.class") {
    const seen = new Set<string>();
    for (const attribute of (element.semantic as UmlClassSemantic).attributes) {
      const name = attribute.name.trim();
      if (seen.has(name)) warnings.push(`Duplicate attribute name: ${name}.`);
      seen.add(name);
    }
  }
  if (element.type === "sequence.activation") {
    const activation = element.semantic as SequenceActivationSemantic;
    if (activation.fromOrder >= activation.toOrder)
      warnings.push("Activation must end after it starts.");
  }
  if (
    element.type === "image.raster" &&
    !(element.semantic as ImageSemantic).src.trim()
  )
    warnings.push("Image source is not assigned.");
  if (element.type === "frame") {
    const frame = element.semantic as FrameSemantic;
    const source = frame.instanceOf
      ? context.resolve(frame.instanceOf)
      : undefined;
    if (
      source?.type === "frame" &&
      (source.id === element.id ||
        !(source.semantic as FrameSemantic).component)
    )
      warnings.push(
        "Component source must be a different component definition.",
      );
    if (frame.responsiveSource === element.id)
      warnings.push("Responsive source cannot be the frame itself.");
  }
  if (element.type === "edge.generic") {
    const edge = element.semantic as GenericEdgeSemantic;
    if (edge.prototype && edge.prototypeAction !== "close-overlay") {
      const target = context.resolve(edge.to);
      if (target && target.type !== "frame")
        warnings.push(
          "Prototype target must be an artboard or component frame.",
        );
      if (edge.prototypeAction === "change-to") {
        const source = context.resolve(edge.from);
        if (
          source?.type !== "frame" ||
          !(source.semantic as FrameSemantic).instanceOf
        )
          warnings.push(
            "Change-to requires a component instance as its source.",
          );
        else {
          const sourceId = (source.semantic as FrameSemantic).instanceOf;
          const definition = sourceId ? context.resolve(sourceId) : undefined;
          const family =
            definition?.type === "frame"
              ? (definition.semantic as FrameSemantic).variantSet
              : undefined;
          const targetSemantic =
            target?.type === "frame"
              ? (target.semantic as FrameSemantic)
              : undefined;
          if (
            !family ||
            !targetSemantic?.component ||
            targetSemantic.variantSet !== family
          )
            warnings.push(
              "Change-to target must be a variant of the source component.",
            );
        }
      }
    }
  }
  return [...new Set(warnings)];
}
