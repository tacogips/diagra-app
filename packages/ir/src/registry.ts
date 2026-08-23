// Element type registry (v1). See the product design, section 5.2.
//
// Each entry owns three things for its element type:
//   - semantic payload validation,
//   - the outgoing element references (so deletes can cascade or detach),
//   - the declared key order used for deterministic serialization.
//
// Renderers and ShapeUtils live in `core`/`ui-solid`; nothing here touches
// the DOM or any framework.

import {
  checkArray,
  checkBoolean,
  checkEnum,
  checkFractionalIndex,
  checkNumber,
  checkObject,
  checkString,
} from "./checks.ts";
import type { ValidationIssue } from "./issues.ts";
import type { KeyOrder } from "./keyOrder.ts";
import {
  ARROWHEADS,
  CARDINALITIES,
  type ElementType,
  GEO_KINDS,
  MESSAGE_KINDS,
  PARTICIPANT_KINDS,
  TEXT_MARK_KINDS,
  UML_ASSOCIATION_KINDS,
  UML_VISIBILITIES,
} from "./semantics.ts";
import type { ElementId } from "./types.ts";

/** How an element reacts when an element it points at is deleted. */
export type ReferencePolicy = "cascade" | "detach";

export interface ElementReference {
  /** Dotted path of the referring field within `semantic`. */
  readonly field: string;
  readonly id: ElementId;
}

export type ElementCategory = "node" | "edge" | "container" | "annotation";

export interface ElementTypeDefinition {
  readonly type: ElementType;
  readonly category: ElementCategory;
  /** Deterministic key order for the semantic payload. */
  readonly keyOrder: KeyOrder;
  /**
   * Deleting an element referenced by this one either deletes this element
   * too (`cascade`, e.g. a relation without its table) or clears the
   * reference (`detach`, e.g. a group losing one member).
   */
  readonly onReferenceDeleted: ReferencePolicy;
  validateSemantic(semantic: unknown, path: string): ValidationIssue[];
  /** Element ids this payload points at, in declaration order. */
  references(semantic: unknown): readonly ElementReference[];
}

function noReferences(): readonly ElementReference[] {
  return [];
}

/** Reads `field` off a payload only when the payload is an object. */
function read(semantic: unknown, field: string): unknown {
  if (typeof semantic !== "object" || semantic === null) {
    return undefined;
  }
  return (semantic as Record<string, unknown>)[field];
}

/** Collects `field` as a reference when it holds a non-empty string id. */
function refFields(
  semantic: unknown,
  fields: readonly string[],
): readonly ElementReference[] {
  const refs: ElementReference[] = [];
  for (const field of fields) {
    const value = read(semantic, field);
    if (typeof value === "string" && value.length > 0) {
      refs.push({ field, id: value });
    }
  }
  return refs;
}

function validateArrowheads(
  out: ValidationIssue[],
  value: unknown,
  path: string,
): void {
  if (value === undefined) {
    return;
  }
  if (!checkObject(out, value, path)) {
    return;
  }
  checkEnum(out, value["start"], `${path}.start`, ARROWHEADS, {
    optional: true,
  });
  checkEnum(out, value["end"], `${path}.end`, ARROWHEADS, {
    optional: true,
  });
}

function validateErdEndpoint(
  out: ValidationIssue[],
  value: unknown,
  path: string,
): void {
  if (!checkObject(out, value, path)) {
    return;
  }
  checkString(out, value["table"], `${path}.table`);
  checkString(out, value["column"], `${path}.column`, { optional: true });
}

function endpointRef(
  semantic: unknown,
  field: string,
): readonly ElementReference[] {
  const table = read(read(semantic, field), "table");
  if (typeof table === "string" && table.length > 0) {
    return [{ field: `${field}.table`, id: table }];
  }
  return [];
}

const GENERIC_NODE: ElementTypeDefinition = {
  type: "node.generic",
  category: "node",
  keyOrder: { keys: ["label"] },
  onReferenceDeleted: "detach",
  references: noReferences,
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (checkObject(out, semantic, path)) {
      checkString(out, semantic["label"], `${path}.label`, {
        allowEmpty: true,
      });
    }
    return out;
  },
};

const GENERIC_EDGE: ElementTypeDefinition = {
  type: "edge.generic",
  category: "edge",
  keyOrder: {
    keys: ["from", "to", "label", "arrowheads"],
    children: { arrowheads: { keys: ["start", "end"] } },
  },
  onReferenceDeleted: "cascade",
  references: (semantic) => refFields(semantic, ["from", "to"]),
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (checkObject(out, semantic, path)) {
      checkString(out, semantic["from"], `${path}.from`);
      checkString(out, semantic["to"], `${path}.to`);
      checkString(out, semantic["label"], `${path}.label`, {
        optional: true,
        allowEmpty: true,
      });
      validateArrowheads(out, semantic["arrowheads"], `${path}.arrowheads`);
    }
    return out;
  },
};

const ERD_TABLE: ElementTypeDefinition = {
  type: "erd.table",
  category: "node",
  keyOrder: {
    keys: ["tableName", "columns"],
    children: {
      columns: { keys: ["id", "name", "dataType", "pk", "nullable"] },
    },
  },
  onReferenceDeleted: "detach",
  references: noReferences,
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (!checkObject(out, semantic, path)) {
      return out;
    }
    checkString(out, semantic["tableName"], `${path}.tableName`);
    const columns = semantic["columns"];
    if (!checkArray(out, columns, `${path}.columns`)) {
      return out;
    }
    const seen = new Set<string>();
    for (const [i, column] of columns.entries()) {
      const at = `${path}.columns[${i}]`;
      if (!checkObject(out, column, at)) {
        continue;
      }
      if (checkString(out, column["id"], `${at}.id`)) {
        const id = column["id"] as string;
        if (seen.has(id)) {
          out.push({
            severity: "error",
            code: "id.duplicate",
            path: `${at}.id`,
            message: `duplicate column id "${id}"`,
          });
        }
        seen.add(id);
      }
      checkString(out, column["name"], `${at}.name`);
      checkString(out, column["dataType"], `${at}.dataType`);
      checkBoolean(out, column["pk"], `${at}.pk`, { optional: true });
      checkBoolean(out, column["nullable"], `${at}.nullable`, {
        optional: true,
      });
    }
    return out;
  },
};

const ERD_RELATION: ElementTypeDefinition = {
  type: "erd.relation",
  category: "edge",
  keyOrder: {
    keys: ["from", "to", "cardinality", "label"],
    children: {
      from: { keys: ["table", "column"] },
      to: { keys: ["table", "column"] },
    },
  },
  onReferenceDeleted: "cascade",
  references: (semantic) => [
    ...endpointRef(semantic, "from"),
    ...endpointRef(semantic, "to"),
  ],
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (!checkObject(out, semantic, path)) {
      return out;
    }
    validateErdEndpoint(out, semantic["from"], `${path}.from`);
    validateErdEndpoint(out, semantic["to"], `${path}.to`);
    checkEnum(
      out,
      semantic["cardinality"],
      `${path}.cardinality`,
      CARDINALITIES,
    );
    checkString(out, semantic["label"], `${path}.label`, {
      optional: true,
      allowEmpty: true,
    });
    return out;
  },
};

const UML_CLASS: ElementTypeDefinition = {
  type: "uml.class",
  category: "node",
  keyOrder: {
    keys: ["name", "stereotype", "attributes", "methods"],
    children: {
      attributes: {
        keys: ["id", "name", "type", "visibility", "static"],
      },
      methods: {
        keys: [
          "id",
          "name",
          "parameters",
          "returnType",
          "visibility",
          "static",
          "abstract",
        ],
        children: { parameters: { keys: ["name", "type"] } },
      },
    },
  },
  onReferenceDeleted: "detach",
  references: noReferences,
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (!checkObject(out, semantic, path)) {
      return out;
    }
    checkString(out, semantic["name"], `${path}.name`);
    checkString(out, semantic["stereotype"], `${path}.stereotype`, {
      optional: true,
    });

    const attributes = semantic["attributes"];
    if (checkArray(out, attributes, `${path}.attributes`)) {
      for (const [i, attribute] of attributes.entries()) {
        const at = `${path}.attributes[${i}]`;
        if (!checkObject(out, attribute, at)) {
          continue;
        }
        checkString(out, attribute["id"], `${at}.id`);
        checkString(out, attribute["name"], `${at}.name`);
        checkString(out, attribute["type"], `${at}.type`, {
          optional: true,
        });
        checkEnum(
          out,
          attribute["visibility"],
          `${at}.visibility`,
          UML_VISIBILITIES,
          { optional: true },
        );
        checkBoolean(out, attribute["static"], `${at}.static`, {
          optional: true,
        });
      }
    }

    const methods = semantic["methods"];
    if (checkArray(out, methods, `${path}.methods`)) {
      for (const [i, method] of methods.entries()) {
        const at = `${path}.methods[${i}]`;
        if (!checkObject(out, method, at)) {
          continue;
        }
        checkString(out, method["id"], `${at}.id`);
        checkString(out, method["name"], `${at}.name`);
        checkString(out, method["returnType"], `${at}.returnType`, {
          optional: true,
        });
        checkEnum(
          out,
          method["visibility"],
          `${at}.visibility`,
          UML_VISIBILITIES,
          { optional: true },
        );
        checkBoolean(out, method["static"], `${at}.static`, {
          optional: true,
        });
        checkBoolean(out, method["abstract"], `${at}.abstract`, {
          optional: true,
        });
        const parameters = method["parameters"];
        if (
          parameters !== undefined &&
          checkArray(out, parameters, `${at}.parameters`)
        ) {
          for (const [j, parameter] of parameters.entries()) {
            const paramAt = `${at}.parameters[${j}]`;
            if (!checkObject(out, parameter, paramAt)) {
              continue;
            }
            checkString(out, parameter["name"], `${paramAt}.name`);
            checkString(out, parameter["type"], `${paramAt}.type`, {
              optional: true,
            });
          }
        }
      }
    }
    return out;
  },
};

const UML_ASSOCIATION: ElementTypeDefinition = {
  type: "uml.association",
  category: "edge",
  keyOrder: {
    keys: ["from", "to", "kind", "cardinalities", "label"],
    children: { cardinalities: { keys: ["from", "to"] } },
  },
  onReferenceDeleted: "cascade",
  references: (semantic) => refFields(semantic, ["from", "to"]),
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (!checkObject(out, semantic, path)) {
      return out;
    }
    checkString(out, semantic["from"], `${path}.from`);
    checkString(out, semantic["to"], `${path}.to`);
    checkEnum(out, semantic["kind"], `${path}.kind`, UML_ASSOCIATION_KINDS);
    const cardinalities = semantic["cardinalities"];
    if (
      cardinalities !== undefined &&
      checkObject(out, cardinalities, `${path}.cardinalities`)
    ) {
      checkString(out, cardinalities["from"], `${path}.cardinalities.from`, {
        optional: true,
      });
      checkString(out, cardinalities["to"], `${path}.cardinalities.to`, {
        optional: true,
      });
    }
    checkString(out, semantic["label"], `${path}.label`, {
      optional: true,
      allowEmpty: true,
    });
    return out;
  },
};

const SEQUENCE_PARTICIPANT: ElementTypeDefinition = {
  type: "sequence.participant",
  category: "node",
  keyOrder: { keys: ["name", "kind", "order"] },
  onReferenceDeleted: "detach",
  references: noReferences,
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (checkObject(out, semantic, path)) {
      checkString(out, semantic["name"], `${path}.name`);
      checkEnum(out, semantic["kind"], `${path}.kind`, PARTICIPANT_KINDS);
      checkFractionalIndex(out, semantic["order"], `${path}.order`);
    }
    return out;
  },
};

const SEQUENCE_MESSAGE: ElementTypeDefinition = {
  type: "sequence.message",
  category: "edge",
  keyOrder: { keys: ["from", "to", "order", "label", "kind"] },
  onReferenceDeleted: "cascade",
  references: (semantic) => refFields(semantic, ["from", "to"]),
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (checkObject(out, semantic, path)) {
      checkString(out, semantic["from"], `${path}.from`);
      checkString(out, semantic["to"], `${path}.to`);
      checkFractionalIndex(out, semantic["order"], `${path}.order`);
      checkString(out, semantic["label"], `${path}.label`, {
        optional: true,
        allowEmpty: true,
      });
      checkEnum(out, semantic["kind"], `${path}.kind`, MESSAGE_KINDS);
    }
    return out;
  },
};

const SEQUENCE_ACTIVATION: ElementTypeDefinition = {
  type: "sequence.activation",
  category: "annotation",
  keyOrder: { keys: ["participant", "fromOrder", "toOrder"] },
  onReferenceDeleted: "cascade",
  references: (semantic) => refFields(semantic, ["participant"]),
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (checkObject(out, semantic, path)) {
      checkString(out, semantic["participant"], `${path}.participant`);
      checkFractionalIndex(out, semantic["fromOrder"], `${path}.fromOrder`);
      checkFractionalIndex(out, semantic["toOrder"], `${path}.toOrder`);
    }
    return out;
  },
};

const DRAW_FREEHAND: ElementTypeDefinition = {
  type: "draw.freehand",
  category: "annotation",
  keyOrder: {
    keys: ["points"],
    children: {
      points: { keys: ["x", "y", "pressure"], coordinates: ["x", "y"] },
    },
  },
  onReferenceDeleted: "detach",
  references: noReferences,
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (!checkObject(out, semantic, path)) {
      return out;
    }
    const points = semantic["points"];
    if (!checkArray(out, points, `${path}.points`)) {
      return out;
    }
    for (const [i, point] of points.entries()) {
      const at = `${path}.points[${i}]`;
      if (!checkObject(out, point, at)) {
        continue;
      }
      checkNumber(out, point["x"], `${at}.x`);
      checkNumber(out, point["y"], `${at}.y`);
      checkNumber(out, point["pressure"], `${at}.pressure`, {
        optional: true,
      });
    }
    return out;
  },
};

const SHAPE_GEO: ElementTypeDefinition = {
  type: "shape.geo",
  category: "node",
  keyOrder: { keys: ["geo", "label"] },
  onReferenceDeleted: "detach",
  references: noReferences,
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (checkObject(out, semantic, path)) {
      checkEnum(out, semantic["geo"], `${path}.geo`, GEO_KINDS);
      checkString(out, semantic["label"], `${path}.label`, {
        optional: true,
        allowEmpty: true,
      });
    }
    return out;
  },
};

const TEXT_NOTE: ElementTypeDefinition = {
  type: "text.note",
  category: "annotation",
  keyOrder: {
    keys: ["text", "marks"],
    children: { marks: { keys: ["start", "end", "kind", "href"] } },
  },
  onReferenceDeleted: "detach",
  references: noReferences,
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (!checkObject(out, semantic, path)) {
      return out;
    }
    const textOk = checkString(out, semantic["text"], `${path}.text`, {
      allowEmpty: true,
    });
    const length = textOk ? (semantic["text"] as string).length : undefined;
    const marks = semantic["marks"];
    if (marks === undefined) {
      return out;
    }
    if (!checkArray(out, marks, `${path}.marks`)) {
      return out;
    }
    for (const [i, mark] of marks.entries()) {
      const at = `${path}.marks[${i}]`;
      if (!checkObject(out, mark, at)) {
        continue;
      }
      const startOk = checkNumber(out, mark["start"], `${at}.start`, {
        integer: true,
        min: 0,
      });
      const endOk = checkNumber(out, mark["end"], `${at}.end`, {
        integer: true,
        min: 0,
      });
      checkEnum(out, mark["kind"], `${at}.kind`, TEXT_MARK_KINDS);
      checkString(out, mark["href"], `${at}.href`, { optional: true });
      if (!startOk || !endOk) {
        continue;
      }
      const start = mark["start"] as number;
      const end = mark["end"] as number;
      if (end < start) {
        out.push({
          severity: "error",
          code: "range.inverted",
          path: at,
          message: "mark end must not precede mark start",
        });
      }
      if (length !== undefined && end > length) {
        out.push({
          severity: "error",
          code: "range.overflow",
          path: `${at}.end`,
          message: `mark end ${end} exceeds text length ${length}`,
        });
      }
    }
    return out;
  },
};

const FRAME: ElementTypeDefinition = {
  type: "frame",
  category: "container",
  keyOrder: { keys: ["name"] },
  onReferenceDeleted: "detach",
  references: noReferences,
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (checkObject(out, semantic, path)) {
      checkString(out, semantic["name"], `${path}.name`, {
        allowEmpty: true,
      });
    }
    return out;
  },
};

const GROUP: ElementTypeDefinition = {
  type: "group",
  category: "container",
  keyOrder: { keys: ["memberIds"] },
  onReferenceDeleted: "detach",
  references(semantic) {
    const members = read(semantic, "memberIds");
    if (!Array.isArray(members)) {
      return [];
    }
    const refs: ElementReference[] = [];
    for (const [i, member] of members.entries()) {
      if (typeof member === "string" && member.length > 0) {
        refs.push({ field: `memberIds[${i}]`, id: member });
      }
    }
    return refs;
  },
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (!checkObject(out, semantic, path)) {
      return out;
    }
    const members = semantic["memberIds"];
    if (!checkArray(out, members, `${path}.memberIds`)) {
      return out;
    }
    for (const [i, member] of members.entries()) {
      checkString(out, member, `${path}.memberIds[${i}]`);
    }
    return out;
  },
};

const DEFINITIONS: readonly ElementTypeDefinition[] = [
  GENERIC_NODE,
  GENERIC_EDGE,
  ERD_TABLE,
  ERD_RELATION,
  UML_CLASS,
  UML_ASSOCIATION,
  SEQUENCE_PARTICIPANT,
  SEQUENCE_MESSAGE,
  SEQUENCE_ACTIVATION,
  DRAW_FREEHAND,
  SHAPE_GEO,
  TEXT_NOTE,
  FRAME,
  GROUP,
];

const BY_TYPE: ReadonlyMap<string, ElementTypeDefinition> = new Map(
  DEFINITIONS.map((definition) => [definition.type, definition]),
);

/** All registered element types, in registry declaration order. */
export const ELEMENT_TYPES: readonly ElementType[] = DEFINITIONS.map(
  (definition) => definition.type,
);

export function getElementTypeDefinition(
  type: string,
): ElementTypeDefinition | undefined {
  return BY_TYPE.get(type);
}

export function isKnownElementType(type: string): type is ElementType {
  return BY_TYPE.has(type);
}

export function listElementTypeDefinitions(): readonly ElementTypeDefinition[] {
  return DEFINITIONS;
}
