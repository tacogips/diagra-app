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
  checkFontSettings,
  checkNumber,
  checkObject,
  checkString,
} from "./checks.ts";
import { error, type ValidationIssue } from "./issues.ts";
import { isRasterDataUrl } from "./image.ts";
import type { KeyOrder } from "./keyOrder.ts";
import {
  ARROWHEADS,
  CARDINALITIES,
  CONNECTOR_ROUTINGS,
  CONNECTOR_ROUTING_AXES,
  type ElementType,
  GEO_KINDS,
  FRAME_PLATFORMS,
  FOREIGN_KEY_DEFERRABILITIES,
  MESSAGE_KINDS,
  PATH_FILL_RULES,
  MAX_CONNECTOR_WAYPOINTS,
  PARTICIPANT_KINDS,
  PROTOTYPE_ACTIONS,
  PROTOTYPE_OVERLAY_POSITIONS,
  PROTOTYPE_OVERFLOWS,
  PROTOTYPE_TRIGGERS,
  PROTOTYPE_TRANSITIONS,
  REFERENTIAL_ACTIONS,
  TEXT_MARK_KINDS,
  UML_ASSOCIATION_KINDS,
  UML_VISIBILITIES,
} from "./semantics.ts";
import { type ElementId, isPlainObject } from "./types.ts";

/** How an element reacts when an element it points at is deleted. */
export type ReferencePolicy = "cascade" | "detach";

export interface ElementReference {
  /** Dotted path of the referring field within `semantic`. */
  readonly field: string;
  readonly id: ElementId;
}

export type ElementCategory =
  | "node"
  | "edge"
  | "container"
  | "annotation"
  | "resource";

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

function validateConnectorRouting(
  out: ValidationIssue[],
  semantic: Record<string, unknown>,
  path: string,
): void {
  checkEnum(out, semantic["routing"], `${path}.routing`, CONNECTOR_ROUTINGS, {
    optional: true,
  });
  checkEnum(
    out,
    semantic["routingAxis"],
    `${path}.routingAxis`,
    CONNECTOR_ROUTING_AXES,
    { optional: true },
  );
  if (
    checkNumber(out, semantic["routingBend"], `${path}.routingBend`, {
      optional: true,
      min: 0,
    }) &&
    typeof semantic["routingBend"] === "number" &&
    semantic["routingBend"] > 1
  )
    out.push(
      error(
        "value.max",
        `${path}.routingBend`,
        "must be less than or equal to 1",
      ),
    );
  checkBoolean(
    out,
    semantic["routingAvoidObstacles"],
    `${path}.routingAvoidObstacles`,
    { optional: true },
  );
  const waypoints = semantic["routingWaypoints"];
  if (
    waypoints !== undefined &&
    checkArray(out, waypoints, `${path}.routingWaypoints`)
  ) {
    if (waypoints.length > MAX_CONNECTOR_WAYPOINTS)
      out.push(
        error(
          "value.max",
          `${path}.routingWaypoints`,
          `must contain at most ${MAX_CONNECTOR_WAYPOINTS} waypoints`,
        ),
      );
    for (const [index, waypoint] of waypoints.entries()) {
      const at = `${path}.routingWaypoints[${index}]`;
      if (!checkObject(out, waypoint, at)) continue;
      checkNumber(out, waypoint["u"], `${at}.u`);
      checkNumber(out, waypoint["v"], `${at}.v`);
    }
  }
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
  const columns = value["columns"];
  if (columns !== undefined && checkArray(out, columns, `${path}.columns`)) {
    const seen = new Set<string>();
    for (const [index, column] of columns.entries()) {
      const at = `${path}.columns[${index}]`;
      if (checkString(out, column, at)) {
        if (seen.has(column as string))
          out.push(
            error(
              "id.duplicate",
              at,
              `duplicate endpoint column id "${column as string}"`,
            ),
          );
        seen.add(column as string);
      }
    }
    if (columns.length === 0)
      out.push(
        error(
          "erd.emptyEndpointColumns",
          `${path}.columns`,
          "composite endpoint columns must not be empty",
        ),
      );
  }
  if (value["column"] !== undefined && columns !== undefined)
    out.push(
      error(
        "erd.endpointColumnConflict",
        path,
        "an ERD endpoint cannot use both column and columns",
      ),
    );
}

function endpointColumnCount(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  const endpoint = value as Record<string, unknown>;
  if (Array.isArray(endpoint["columns"])) return endpoint["columns"].length;
  return typeof endpoint["column"] === "string" ? 1 : 0;
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
    keys: [
      "from",
      "to",
      "label",
      "arrowheads",
      "routing",
      "routingAxis",
      "routingBend",
      "routingAvoidObstacles",
      "routingWaypoints",
      "prototype",
      "prototypeAction",
      "prototypeTrigger",
      "prototypeDelay",
      "prototypeTransition",
      "prototypeDuration",
      "prototypeOverlayPosition",
      "prototypeOverlayX",
      "prototypeOverlayY",
      "prototypeOverlayBackdrop",
      "prototypeOverlayDismiss",
    ],
    children: {
      arrowheads: { keys: ["start", "end"] },
      routingWaypoints: { keys: ["u", "v"] },
    },
  },
  onReferenceDeleted: "cascade",
  references: (semantic) => refFields(semantic, ["from", "to"]),
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (checkObject(out, semantic, path)) {
      checkString(out, semantic["from"], `${path}.from`);
      checkString(out, semantic["to"], `${path}.to`);
      checkBoolean(out, semantic["prototype"], `${path}.prototype`, {
        optional: true,
      });
      checkEnum(
        out,
        semantic["prototypeAction"],
        `${path}.prototypeAction`,
        PROTOTYPE_ACTIONS,
        { optional: true },
      );
      checkEnum(
        out,
        semantic["prototypeTrigger"],
        `${path}.prototypeTrigger`,
        PROTOTYPE_TRIGGERS,
        { optional: true },
      );
      checkNumber(out, semantic["prototypeDelay"], `${path}.prototypeDelay`, {
        optional: true,
        min: 100,
      });
      if (
        typeof semantic["prototypeDelay"] === "number" &&
        semantic["prototypeDelay"] > 60_000
      )
        out.push(
          error(
            "value.max",
            `${path}.prototypeDelay`,
            "must be at most 60000 milliseconds",
          ),
        );
      checkEnum(
        out,
        semantic["prototypeTransition"],
        `${path}.prototypeTransition`,
        PROTOTYPE_TRANSITIONS,
        { optional: true },
      );
      checkNumber(
        out,
        semantic["prototypeDuration"],
        `${path}.prototypeDuration`,
        { optional: true, min: 0 },
      );
      if (
        typeof semantic["prototypeDuration"] === "number" &&
        semantic["prototypeDuration"] > 5000
      )
        out.push(
          error(
            "value.max",
            `${path}.prototypeDuration`,
            "must be at most 5000 milliseconds",
          ),
        );
      checkEnum(
        out,
        semantic["prototypeOverlayPosition"],
        `${path}.prototypeOverlayPosition`,
        PROTOTYPE_OVERLAY_POSITIONS,
        { optional: true },
      );
      for (const field of ["prototypeOverlayX", "prototypeOverlayY"])
        checkNumber(out, semantic[field], `${path}.${field}`, {
          optional: true,
        });
      checkBoolean(
        out,
        semantic["prototypeOverlayBackdrop"],
        `${path}.prototypeOverlayBackdrop`,
        { optional: true },
      );
      checkBoolean(
        out,
        semantic["prototypeOverlayDismiss"],
        `${path}.prototypeOverlayDismiss`,
        { optional: true },
      );
      checkString(out, semantic["label"], `${path}.label`, {
        optional: true,
        allowEmpty: true,
      });
      validateArrowheads(out, semantic["arrowheads"], `${path}.arrowheads`);
      validateConnectorRouting(out, semantic, path);
    }
    return out;
  },
};

const ERD_TABLE: ElementTypeDefinition = {
  type: "erd.table",
  category: "node",
  keyOrder: {
    keys: ["tableName", "columns", "indexes", "checks"],
    children: {
      columns: {
        keys: [
          "id",
          "name",
          "dataType",
          "pk",
          "nullable",
          "defaultExpression",
          "generatedExpression",
        ],
      },
      indexes: { keys: ["id", "name", "columns", "unique"] },
      checks: { keys: ["id", "name", "expression"] },
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
      checkString(out, column["defaultExpression"], `${at}.defaultExpression`, {
        optional: true,
      });
      checkString(
        out,
        column["generatedExpression"],
        `${at}.generatedExpression`,
        { optional: true },
      );
      if (
        typeof column["defaultExpression"] === "string" &&
        column["defaultExpression"].trim() !== "" &&
        typeof column["generatedExpression"] === "string" &&
        column["generatedExpression"].trim() !== ""
      )
        out.push(
          error(
            "erd.columnExpressionConflict",
            at,
            "a column cannot have both a default and a generated expression",
          ),
        );
      if (
        column["pk"] === true &&
        typeof column["generatedExpression"] === "string" &&
        column["generatedExpression"].trim() !== ""
      )
        out.push(
          error(
            "erd.generatedPrimaryKey",
            at,
            "a portable generated column cannot be a primary key",
          ),
        );
    }
    const indexes = semantic["indexes"];
    if (indexes !== undefined && checkArray(out, indexes, `${path}.indexes`)) {
      const seenIndexes = new Set<string>();
      for (const [i, index] of indexes.entries()) {
        const at = `${path}.indexes[${i}]`;
        if (!checkObject(out, index, at)) continue;
        if (checkString(out, index["id"], `${at}.id`)) {
          const id = index["id"] as string;
          if (seenIndexes.has(id))
            out.push(
              error("id.duplicate", `${at}.id`, `duplicate index id "${id}"`),
            );
          seenIndexes.add(id);
        }
        checkString(out, index["name"], `${at}.name`, {
          optional: true,
        });
        const indexedColumns = index["columns"];
        if (checkArray(out, indexedColumns, `${at}.columns`)) {
          const seenColumns = new Set<string>();
          for (const [columnIndex, columnId] of indexedColumns.entries()) {
            const columnPath = `${at}.columns[${columnIndex}]`;
            if (checkString(out, columnId, columnPath)) {
              if (seenColumns.has(columnId as string))
                out.push(
                  error(
                    "id.duplicate",
                    columnPath,
                    `duplicate indexed column id "${columnId as string}"`,
                  ),
                );
              if (!seen.has(columnId as string))
                out.push(
                  error(
                    "erd.indexColumn",
                    columnPath,
                    `index references unknown column id "${columnId as string}"`,
                  ),
                );
              seenColumns.add(columnId as string);
            }
          }
        }
        checkBoolean(out, index["unique"], `${at}.unique`, {
          optional: true,
        });
      }
    }
    const checks = semantic["checks"];
    if (checks !== undefined && checkArray(out, checks, `${path}.checks`)) {
      const seenChecks = new Set<string>();
      for (const [i, check] of checks.entries()) {
        const at = `${path}.checks[${i}]`;
        if (!checkObject(out, check, at)) continue;
        if (checkString(out, check["id"], `${at}.id`)) {
          const id = check["id"] as string;
          if (seenChecks.has(id))
            out.push(
              error("id.duplicate", `${at}.id`, `duplicate check id "${id}"`),
            );
          seenChecks.add(id);
        }
        checkString(out, check["name"], `${at}.name`, { optional: true });
        checkString(out, check["expression"], `${at}.expression`);
      }
    }
    return out;
  },
};

const ERD_RELATION: ElementTypeDefinition = {
  type: "erd.relation",
  category: "edge",
  keyOrder: {
    keys: [
      "from",
      "to",
      "cardinality",
      "onDelete",
      "onUpdate",
      "deferrability",
      "label",
      "routing",
      "routingAxis",
      "routingBend",
      "routingAvoidObstacles",
      "routingWaypoints",
    ],
    children: {
      routingWaypoints: { keys: ["u", "v"] },
      from: { keys: ["table", "column", "columns"] },
      to: { keys: ["table", "column", "columns"] },
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
    const fromColumns = endpointColumnCount(semantic["from"]);
    const toColumns = endpointColumnCount(semantic["to"]);
    if (fromColumns > 0 && toColumns > 0 && fromColumns !== toColumns)
      out.push(
        error(
          "erd.foreignKeyArity",
          path,
          "foreign-key endpoints must contain the same number of columns",
        ),
      );
    checkEnum(
      out,
      semantic["cardinality"],
      `${path}.cardinality`,
      CARDINALITIES,
    );
    checkEnum(
      out,
      semantic["onDelete"],
      `${path}.onDelete`,
      REFERENTIAL_ACTIONS,
      { optional: true },
    );
    checkEnum(
      out,
      semantic["onUpdate"],
      `${path}.onUpdate`,
      REFERENTIAL_ACTIONS,
      { optional: true },
    );
    checkEnum(
      out,
      semantic["deferrability"],
      `${path}.deferrability`,
      FOREIGN_KEY_DEFERRABILITIES,
      { optional: true },
    );
    checkString(out, semantic["label"], `${path}.label`, {
      optional: true,
      allowEmpty: true,
    });
    validateConnectorRouting(out, semantic, path);
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
    keys: [
      "from",
      "to",
      "kind",
      "cardinalities",
      "label",
      "routing",
      "routingAxis",
      "routingBend",
      "routingAvoidObstacles",
      "routingWaypoints",
    ],
    children: {
      cardinalities: { keys: ["from", "to"] },
      routingWaypoints: { keys: ["u", "v"] },
    },
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
    validateConnectorRouting(out, semantic, path);
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
    keys: ["points", "closed"],
    children: {
      points: {
        keys: ["x", "y", "pressure", "controlIn", "controlOut"],
        coordinates: ["x", "y"],
        children: {
          controlIn: { keys: ["x", "y"], coordinates: ["x", "y"] },
          controlOut: { keys: ["x", "y"], coordinates: ["x", "y"] },
        },
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
    const points = semantic["points"];
    checkBoolean(out, semantic["closed"], `${path}.closed`, { optional: true });
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
      for (const field of ["controlIn", "controlOut"]) {
        const control = point[field];
        if (
          control !== undefined &&
          checkObject(out, control, `${at}.${field}`)
        ) {
          checkNumber(out, control["x"], `${at}.${field}.x`);
          checkNumber(out, control["y"], `${at}.${field}.y`);
        }
      }
      checkNumber(out, point["pressure"], `${at}.pressure`, {
        optional: true,
      });
    }
    return out;
  },
};

const DRAW_PATH: ElementTypeDefinition = {
  type: "draw.path",
  category: "annotation",
  keyOrder: {
    keys: ["name", "contours", "fillRule"],
    children: {
      contours: {
        keys: ["points"],
        children: {
          points: {
            keys: ["x", "y", "pressure", "controlIn", "controlOut"],
            coordinates: ["x", "y"],
            children: {
              controlIn: { keys: ["x", "y"], coordinates: ["x", "y"] },
              controlOut: { keys: ["x", "y"], coordinates: ["x", "y"] },
            },
          },
        },
      },
    },
  },
  onReferenceDeleted: "detach",
  references: noReferences,
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (!checkObject(out, semantic, path)) return out;
    checkString(out, semantic["name"], `${path}.name`, { optional: true });
    checkEnum(out, semantic["fillRule"], `${path}.fillRule`, PATH_FILL_RULES);
    const contours = semantic["contours"];
    if (!checkArray(out, contours, `${path}.contours`)) return out;
    if (contours.length === 0 || contours.length > 1024)
      out.push(
        error(
          "path.contours",
          `${path}.contours`,
          "expected between 1 and 1024 contours",
        ),
      );
    let total = 0;
    for (const [contourIndex, contour] of contours.entries()) {
      const contourPath = `${path}.contours[${contourIndex}]`;
      if (!checkObject(out, contour, contourPath)) continue;
      const points = contour["points"];
      if (!checkArray(out, points, `${contourPath}.points`)) continue;
      total += points.length;
      if (points.length < 3)
        out.push(
          error(
            "path.points",
            `${contourPath}.points`,
            "a closed contour requires at least three points",
          ),
        );
      for (const [pointIndex, point] of points.entries()) {
        const at = `${contourPath}.points[${pointIndex}]`;
        if (!checkObject(out, point, at)) continue;
        checkNumber(out, point["x"], `${at}.x`);
        checkNumber(out, point["y"], `${at}.y`);
        checkNumber(out, point["pressure"], `${at}.pressure`, {
          optional: true,
        });
        for (const field of ["controlIn", "controlOut"]) {
          const control = point[field];
          if (
            control !== undefined &&
            checkObject(out, control, `${at}.${field}`)
          ) {
            checkNumber(out, control["x"], `${at}.${field}.x`);
            checkNumber(out, control["y"], `${at}.${field}.y`);
          }
        }
      }
    }
    if (total > 20000)
      out.push(
        error(
          "path.points",
          `${path}.contours`,
          "a compound path may contain at most 20000 points",
        ),
      );
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
      const kindOk = checkEnum(
        out,
        mark["kind"],
        `${at}.kind`,
        TEXT_MARK_KINDS,
      );
      const hrefOk = checkString(out, mark["href"], `${at}.href`, {
        optional: true,
      });
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
      if (end === start) {
        out.push({
          severity: "error",
          code: "range.empty",
          path: at,
          message: "mark range must contain at least one character",
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
      if (kindOk && mark["kind"] === "link" && mark["href"] === undefined) {
        out.push({
          severity: "error",
          code: "field.missing",
          path: `${at}.href`,
          message: "link marks require a destination",
        });
      }
      if (
        kindOk &&
        hrefOk &&
        mark["kind"] !== "link" &&
        mark["href"] !== undefined
      ) {
        out.push({
          severity: "error",
          code: "field.unexpected",
          path: `${at}.href`,
          message: "only link marks may carry a destination",
        });
      }
    }
    return out;
  },
};

const REVIEW_COMMENT: ElementTypeDefinition = {
  type: "review.comment",
  category: "resource",
  keyOrder: {
    keys: ["target", "resolved", "messages"],
    children: { messages: { keys: ["id", "author", "body", "createdAt"] } },
  },
  onReferenceDeleted: "detach",
  references: (semantic) => refFields(semantic, ["target"]),
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (!checkObject(out, semantic, path)) return out;
    checkString(out, semantic["target"], `${path}.target`, { optional: true });
    checkBoolean(out, semantic["resolved"], `${path}.resolved`, {
      optional: true,
    });
    const messages = semantic["messages"];
    if (!checkArray(out, messages, `${path}.messages`)) return out;
    if (messages.length === 0)
      out.push(
        error(
          "comment.empty",
          `${path}.messages`,
          "a comment thread needs a message",
        ),
      );
    const ids = new Set<string>();
    for (const [index, message] of messages.entries()) {
      const at = `${path}.messages[${index}]`;
      if (!checkObject(out, message, at)) continue;
      for (const field of ["id", "author", "body", "createdAt"] as const)
        checkString(out, message[field], `${at}.${field}`);
      if (typeof message["id"] === "string") {
        if (ids.has(message["id"]))
          out.push(
            error(
              "comment.messageDuplicate",
              `${at}.id`,
              "message ids must be unique within a thread",
            ),
          );
        ids.add(message["id"]);
      }
      if (
        typeof message["createdAt"] === "string" &&
        !Number.isFinite(Date.parse(message["createdAt"]))
      )
        out.push(
          error(
            "comment.timestamp",
            `${at}.createdAt`,
            "expected an ISO-8601 timestamp",
          ),
        );
    }
    return out;
  },
};

const TEXT_STYLE: ElementTypeDefinition = {
  type: "design.text-style",
  category: "resource",
  keyOrder: {
    keys: ["name", "value"],
    children: {
      value: {
        keys: [
          "fontFamily",
          "fontSize",
          "fontWeight",
          "fontStyle",
          "fontVariations",
          "fontFeatures",
          "lineHeight",
          "letterSpacing",
          "textAlign",
          "textDecoration",
          "verticalAlign",
        ],
        children: {
          fontVariations: { keys: ["tag", "value"] },
          fontFeatures: { keys: ["tag", "value"] },
        },
      },
    },
  },
  onReferenceDeleted: "detach",
  references: noReferences,
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (!checkObject(out, semantic, path)) return out;
    checkString(out, semantic["name"], `${path}.name`);
    const value = semantic["value"];
    if (!checkObject(out, value, `${path}.value`)) return out;
    checkString(out, value["fontFamily"], `${path}.value.fontFamily`);
    checkNumber(out, value["fontSize"], `${path}.value.fontSize`, { min: 1 });
    checkNumber(out, value["fontWeight"], `${path}.value.fontWeight`, {
      min: 1,
    });
    if (typeof value["fontWeight"] === "number" && value["fontWeight"] > 1000)
      out.push(
        error("value.max", `${path}.value.fontWeight`, "must not exceed 1000"),
      );
    checkEnum(out, value["fontStyle"], `${path}.value.fontStyle`, [
      "normal",
      "italic",
    ]);
    checkFontSettings(
      out,
      value["fontVariations"],
      `${path}.value.fontVariations`,
      { optional: true },
    );
    checkFontSettings(
      out,
      value["fontFeatures"],
      `${path}.value.fontFeatures`,
      { optional: true, integer: true },
    );
    checkNumber(out, value["lineHeight"], `${path}.value.lineHeight`, {
      min: 0.1,
    });
    checkNumber(out, value["letterSpacing"], `${path}.value.letterSpacing`);
    checkEnum(out, value["textAlign"], `${path}.value.textAlign`, [
      "start",
      "middle",
      "end",
    ]);
    checkEnum(out, value["textDecoration"], `${path}.value.textDecoration`, [
      "none",
      "underline",
      "line-through",
      "underline line-through",
    ]);
    checkEnum(out, value["verticalAlign"], `${path}.value.verticalAlign`, [
      "top",
      "middle",
      "bottom",
    ]);
    return out;
  },
};

const FRAME: ElementTypeDefinition = {
  type: "frame",
  category: "container",
  keyOrder: {
    keys: [
      "name",
      "platform",
      "safeArea",
      "responsiveSource",
      "memberIds",
      "showTitle",
      "layout",
      "layoutGrids",
      "component",
      "variantSet",
      "variantName",
      "variantProperties",
      "instanceOf",
      "autoRefresh",
      "prototypeStart",
      "prototypeOverflow",
      "clipContent",
      "instanceBindings",
    ],
    children: {
      layout: {
        keys: [
          "direction",
          "gap",
          "crossGap",
          "wrap",
          "padding",
          "paddingTop",
          "paddingRight",
          "paddingBottom",
          "paddingLeft",
          "sizing",
          "widthSizing",
          "heightSizing",
          "align",
          "justify",
        ],
      },
      safeArea: { keys: ["top", "right", "bottom", "left"] },
      layoutGrids: {
        keys: [
          "id",
          "kind",
          "size",
          "count",
          "gutter",
          "margin",
          "color",
          "opacity",
          "visible",
        ],
      },
      instanceBindings: { keys: ["source", "target", "baseline"] },
      variantProperties: { keys: ["id", "name", "value"] },
    },
  },
  onReferenceDeleted: "detach",
  references(semantic) {
    const members = read(semantic, "memberIds");
    const instanceOf = read(semantic, "instanceOf");
    const responsiveSource = read(semantic, "responsiveSource");
    const bindings = read(semantic, "instanceBindings");
    return [
      ...(Array.isArray(bindings)
        ? bindings.flatMap((binding, index) =>
            ["source", "target"].flatMap((key) => {
              const id = read(binding, key);
              return typeof id === "string"
                ? [{ id, field: `instanceBindings[${index}].${key}` }]
                : [];
            }),
          )
        : []),
      ...(typeof instanceOf === "string"
        ? [{ id: instanceOf, field: "instanceOf" }]
        : []),
      ...(typeof responsiveSource === "string"
        ? [{ id: responsiveSource, field: "responsiveSource" }]
        : []),
      ...(Array.isArray(members)
        ? members.flatMap((id, index) =>
            typeof id === "string"
              ? [{ id, field: `memberIds[${index}]` }]
              : [],
          )
        : []),
    ];
  },
  validateSemantic(semantic, path) {
    const out: ValidationIssue[] = [];
    if (checkObject(out, semantic, path)) {
      checkString(out, semantic["name"], `${path}.name`, {
        allowEmpty: true,
      });
      checkEnum(
        out,
        semantic["platform"],
        `${path}.platform`,
        FRAME_PLATFORMS,
        { optional: true },
      );
      const safeArea = semantic["safeArea"];
      if (
        safeArea !== undefined &&
        checkObject(out, safeArea, `${path}.safeArea`)
      ) {
        for (const side of ["top", "right", "bottom", "left"])
          checkNumber(out, safeArea[side], `${path}.safeArea.${side}`, {
            min: 0,
          });
      }
      const members = semantic["memberIds"];
      checkBoolean(out, semantic["showTitle"], `${path}.showTitle`, {
        optional: true,
      });
      const bindings = semantic["instanceBindings"];
      if (
        bindings !== undefined &&
        checkArray(out, bindings, `${path}.instanceBindings`)
      ) {
        for (const [index, binding] of bindings.entries()) {
          const at = `${path}.instanceBindings[${index}]`;
          if (!checkObject(out, binding, at)) continue;
          checkString(out, binding["source"], `${at}.source`, {
            optional: true,
          });
          checkString(out, binding["target"], `${at}.target`, {
            optional: true,
          });
          checkString(out, binding["baseline"], `${at}.baseline`);
        }
      }
      checkBoolean(out, semantic["clipContent"], `${path}.clipContent`, {
        optional: true,
      });
      checkBoolean(out, semantic["prototypeStart"], `${path}.prototypeStart`, {
        optional: true,
      });
      checkEnum(
        out,
        semantic["prototypeOverflow"],
        `${path}.prototypeOverflow`,
        PROTOTYPE_OVERFLOWS,
        { optional: true },
      );
      checkBoolean(out, semantic["autoRefresh"], `${path}.autoRefresh`, {
        optional: true,
      });
      checkBoolean(out, semantic["component"], `${path}.component`, {
        optional: true,
      });
      for (const key of ["variantSet", "variantName"])
        checkString(out, semantic[key], `${path}.${key}`, { optional: true });
      const variantProperties = semantic["variantProperties"];
      if (
        variantProperties !== undefined &&
        checkArray(out, variantProperties, `${path}.variantProperties`)
      ) {
        if (variantProperties.length > 16)
          out.push(
            error(
              "frame.variantPropertyLimit",
              `${path}.variantProperties`,
              "at most sixteen variant properties are allowed",
            ),
          );
        const ids = new Set<string>();
        const names = new Set<string>();
        for (const [index, property] of variantProperties.entries()) {
          const at = `${path}.variantProperties[${index}]`;
          if (!checkObject(out, property, at)) continue;
          const id = property["id"];
          const name = property["name"];
          if (checkString(out, id, `${at}.id`) && typeof id === "string") {
            if (ids.has(id))
              out.push(
                error(
                  "frame.variantPropertyDuplicateId",
                  `${at}.id`,
                  `duplicate variant property id "${id}"`,
                ),
              );
            ids.add(id);
          }
          if (
            checkString(out, name, `${at}.name`) &&
            typeof name === "string"
          ) {
            const normalized = name.trim().toLowerCase();
            if (!normalized)
              out.push(
                error(
                  "frame.variantPropertyName",
                  `${at}.name`,
                  "variant property names must contain non-whitespace characters",
                ),
              );
            else if (names.has(normalized))
              out.push(
                error(
                  "frame.variantPropertyDuplicateName",
                  `${at}.name`,
                  `duplicate variant property name "${name}"`,
                ),
              );
            names.add(normalized);
          }
          if (
            checkString(out, property["value"], `${at}.value`) &&
            typeof property["value"] === "string" &&
            !property["value"].trim()
          )
            out.push(
              error(
                "frame.variantPropertyValue",
                `${at}.value`,
                "variant property values must contain non-whitespace characters",
              ),
            );
        }
      }
      checkString(out, semantic["instanceOf"], `${path}.instanceOf`, {
        optional: true,
      });
      checkString(
        out,
        semantic["responsiveSource"],
        `${path}.responsiveSource`,
        { optional: true },
      );
      if (
        typeof semantic["instanceOf"] === "string" &&
        typeof semantic["responsiveSource"] === "string"
      )
        out.push(
          error(
            "frame.sourceMode",
            `${path}.responsiveSource`,
            "a frame cannot be both a component instance and a responsive variant",
          ),
        );
      if (
        members !== undefined &&
        checkArray(out, members, `${path}.memberIds`)
      ) {
        for (const [index, id] of members.entries())
          checkString(out, id, `${path}.memberIds[${index}]`);
      }
      const layout = semantic["layout"];
      if (layout !== undefined && checkObject(out, layout, `${path}.layout`)) {
        checkEnum(out, layout["direction"], `${path}.layout.direction`, [
          "horizontal",
          "vertical",
        ]);
        checkEnum(out, layout["sizing"], `${path}.layout.sizing`, [
          "fixed",
          "hug",
        ]);
        checkEnum(out, layout["align"], `${path}.layout.align`, [
          "start",
          "center",
          "end",
          "stretch",
        ]);
        for (const axis of ["widthSizing", "heightSizing"])
          checkEnum(
            out,
            layout[axis],
            `${path}.layout.${axis}`,
            ["fixed", "hug"],
            { optional: true },
          );
        checkNumber(out, layout["gap"], `${path}.layout.gap`, { min: 0 });
        checkNumber(out, layout["crossGap"], `${path}.layout.crossGap`, {
          min: 0,
          optional: true,
        });
        checkBoolean(out, layout["wrap"], `${path}.layout.wrap`, {
          optional: true,
        });
        checkEnum(
          out,
          layout["justify"],
          `${path}.layout.justify`,
          ["start", "center", "end", "space-between"],
          { optional: true },
        );
        checkNumber(out, layout["padding"], `${path}.layout.padding`, {
          min: 0,
        });
        for (const side of [
          "paddingTop",
          "paddingRight",
          "paddingBottom",
          "paddingLeft",
        ])
          checkNumber(out, layout[side], `${path}.layout.${side}`, {
            min: 0,
            optional: true,
          });
      }
      const grids = semantic["layoutGrids"];
      if (
        grids !== undefined &&
        checkArray(out, grids, `${path}.layoutGrids`)
      ) {
        if (grids.length > 8)
          out.push(
            error(
              "frame.layoutGridLimit",
              `${path}.layoutGrids`,
              "at most eight layout grids are allowed",
            ),
          );
        const gridIds = new Set<string>();
        for (const [index, grid] of grids.entries()) {
          const at = `${path}.layoutGrids[${index}]`;
          if (!checkObject(out, grid, at)) continue;
          if (
            checkString(out, grid["id"], `${at}.id`) &&
            typeof grid["id"] === "string"
          ) {
            if (gridIds.has(grid["id"]))
              out.push(
                error(
                  "frame.layoutGridDuplicate",
                  `${at}.id`,
                  `duplicate layout grid id "${grid["id"]}"`,
                ),
              );
            gridIds.add(grid["id"]);
          }
          const kind = grid["kind"];
          checkEnum(out, kind, `${at}.kind`, ["grid", "columns", "rows"]);
          checkString(out, grid["color"], `${at}.color`);
          if (
            typeof grid["color"] === "string" &&
            !/^#[\da-f]{6}$/i.test(grid["color"])
          )
            out.push(
              error(
                "frame.layoutGridColor",
                `${at}.color`,
                "expected a six-digit hex color",
              ),
            );
          checkNumber(out, grid["opacity"], `${at}.opacity`, { min: 0 });
          if (typeof grid["opacity"] === "number" && grid["opacity"] > 1)
            out.push(
              error(
                "frame.layoutGridOpacity",
                `${at}.opacity`,
                "opacity must be less than or equal to 1",
              ),
            );
          checkBoolean(out, grid["visible"], `${at}.visible`, {
            optional: true,
          });
          if (kind === "grid") {
            checkNumber(out, grid["size"], `${at}.size`, { min: 1 });
          } else if (kind === "columns" || kind === "rows") {
            checkNumber(out, grid["count"], `${at}.count`, {
              integer: true,
              min: 1,
            });
            if (typeof grid["count"] === "number" && grid["count"] > 24)
              out.push(
                error(
                  "frame.layoutGridCount",
                  `${at}.count`,
                  "count must be less than or equal to 24",
                ),
              );
            checkNumber(out, grid["gutter"], `${at}.gutter`, { min: 0 });
            checkNumber(out, grid["margin"], `${at}.margin`, { min: 0 });
          }
        }
      }
    }
    return out;
  },
};

const GROUP: ElementTypeDefinition = {
  type: "group",
  category: "container",
  keyOrder: {
    keys: ["memberIds", "maskId", "maskMode", "booleanOperation", "isolate"],
  },
  onReferenceDeleted: "detach",
  references(semantic) {
    const members = read(semantic, "memberIds");
    if (!Array.isArray(members)) {
      return [];
    }
    const refs: ElementReference[] = [];
    const mask = read(semantic, "maskId");
    if (typeof mask === "string" && mask.length > 0)
      refs.push({ field: "maskId", id: mask });
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
    const mask = semantic["maskId"];
    if (checkString(out, mask, `${path}.maskId`, { optional: true })) {
      if (typeof mask === "string" && !members.includes(mask))
        out.push(
          error(
            "group.maskMember",
            `${path}.maskId`,
            "a mask must also be a group member",
          ),
        );
    }
    checkEnum(
      out,
      semantic["maskMode"],
      `${path}.maskMode`,
      ["alpha", "luminance"],
      { optional: true },
    );
    if (semantic["maskMode"] !== undefined && mask === undefined)
      out.push(
        error(
          "group.maskMode",
          `${path}.maskMode`,
          "a mask mode requires a mask member",
        ),
      );
    checkEnum(
      out,
      semantic["booleanOperation"],
      `${path}.booleanOperation`,
      ["union", "subtract", "intersect", "exclude"],
      { optional: true },
    );
    if (semantic["booleanOperation"] !== undefined && members.length < 2)
      out.push(
        error(
          "group.booleanMembers",
          `${path}.memberIds`,
          "a boolean group requires at least two members",
        ),
      );
    if (mask !== undefined && semantic["booleanOperation"] !== undefined)
      out.push(
        error(
          "group.clipConflict",
          path,
          "a group cannot be both a layer mask group and a boolean group",
        ),
      );
    checkBoolean(out, semantic["isolate"], `${path}.isolate`, {
      optional: true,
    });
    return out;
  },
};

const DEFINITIONS: readonly ElementTypeDefinition[] = [
  {
    type: "design.guide",
    category: "resource",
    keyOrder: {
      keys: ["axis", "position", "color", "hidden", "locked"],
    },
    onReferenceDeleted: "detach",
    references: noReferences,
    validateSemantic(semantic, path) {
      const out: ValidationIssue[] = [];
      if (!checkObject(out, semantic, path)) return out;
      checkEnum(out, semantic["axis"], `${path}.axis`, ["x", "y"]);
      checkNumber(out, semantic["position"], `${path}.position`);
      checkString(out, semantic["color"], `${path}.color`, {
        optional: true,
      });
      if (
        semantic["color"] !== undefined &&
        (typeof semantic["color"] !== "string" ||
          !/^#[\da-f]{6}$/i.test(semantic["color"]))
      )
        out.push(
          error(
            "guide.color",
            `${path}.color`,
            "expected a six-digit hex color",
          ),
        );
      checkBoolean(out, semantic["hidden"], `${path}.hidden`, {
        optional: true,
      });
      checkBoolean(out, semantic["locked"], `${path}.locked`, {
        optional: true,
      });
      return out;
    },
  },
  {
    type: "design.token",
    category: "resource",
    keyOrder: {
      keys: ["name", "kind", "value", "alias", "modes"],
      children: { modes: { keys: ["name", "value", "alias"] } },
    },
    onReferenceDeleted: "detach",
    references(semantic) {
      if (!isPlainObject(semantic)) return [];
      const refs: ElementReference[] = [];
      if (typeof semantic["alias"] === "string" && semantic["alias"])
        refs.push({ field: "alias", id: semantic["alias"] });
      const modes = semantic["modes"];
      if (Array.isArray(modes))
        for (const [index, mode] of modes.entries())
          if (
            isPlainObject(mode) &&
            typeof mode["alias"] === "string" &&
            mode["alias"]
          )
            refs.push({
              field: `modes[${index}].alias`,
              id: mode["alias"],
            });
      return refs;
    },
    validateSemantic(semantic, path) {
      const out: ValidationIssue[] = [];
      if (checkObject(out, semantic, path)) {
        checkString(out, semantic["name"], `${path}.name`);
        checkEnum(out, semantic["kind"], `${path}.kind`, ["color", "number"]);
        if (
          semantic["kind"] === "color" &&
          (typeof semantic["value"] !== "string" ||
            !/^#[\da-f]{6}$/i.test(semantic["value"]))
        )
          out.push(
            error(
              "token.color",
              `${path}.value`,
              "expected a six-digit hex color",
            ),
          );
        if (
          semantic["kind"] === "number" &&
          (typeof semantic["value"] !== "number" ||
            !Number.isFinite(semantic["value"]) ||
            semantic["value"] < 0)
        )
          out.push(
            error(
              "token.number",
              `${path}.value`,
              "expected a finite non-negative number",
            ),
          );
        if (semantic["alias"] !== undefined)
          checkString(out, semantic["alias"], `${path}.alias`);
        const modes = semantic["modes"];
        if (modes !== undefined && checkArray(out, modes, `${path}.modes`)) {
          const names = new Set<string>();
          for (const [index, mode] of modes.entries()) {
            const modePath = `${path}.modes[${index}]`;
            if (!checkObject(out, mode, modePath)) continue;
            const name = mode["name"];
            if (
              checkString(out, name, `${modePath}.name`) &&
              typeof name === "string"
            ) {
              if (names.has(name))
                out.push(
                  error(
                    "token.modeDuplicate",
                    `${modePath}.name`,
                    `duplicate token mode "${name}"`,
                  ),
                );
              if (name.toLowerCase() === "default")
                out.push(
                  error(
                    "token.modeReserved",
                    `${modePath}.name`,
                    'the token mode name "Default" is reserved',
                  ),
                );
              names.add(name);
            }
            if (mode["value"] !== undefined && mode["alias"] !== undefined)
              out.push(
                error(
                  "token.modeChoice",
                  modePath,
                  "a mode cannot define both value and alias",
                ),
              );
            if (mode["alias"] !== undefined)
              checkString(out, mode["alias"], `${modePath}.alias`);
            if (
              mode["value"] !== undefined &&
              semantic["kind"] === "color" &&
              (typeof mode["value"] !== "string" ||
                !/^#[\da-f]{6}$/i.test(mode["value"]))
            )
              out.push(
                error(
                  "token.color",
                  `${modePath}.value`,
                  "expected a six-digit hex color",
                ),
              );
            if (
              mode["value"] !== undefined &&
              semantic["kind"] === "number" &&
              (typeof mode["value"] !== "number" ||
                !Number.isFinite(mode["value"]) ||
                mode["value"] < 0)
            )
              out.push(
                error(
                  "token.number",
                  `${modePath}.value`,
                  "expected a finite non-negative number",
                ),
              );
          }
        }
      }
      return out;
    },
  },
  {
    type: "image.raster",
    category: "node",
    keyOrder: {
      keys: ["src", "alt", "fit", "crop"],
      children: { crop: { keys: ["x", "y", "width", "height"] } },
    },
    onReferenceDeleted: "detach",
    references: noReferences,
    validateSemantic(semantic, path) {
      const out: ValidationIssue[] = [];
      if (checkObject(out, semantic, path)) {
        if (!isRasterDataUrl(semantic["src"]))
          out.push(
            error(
              "image.source",
              `${path}.src`,
              "expected an embedded PNG, JPEG, WebP or GIF up to 1 MiB",
            ),
          );
        checkString(out, semantic["alt"], `${path}.alt`, { allowEmpty: true });
        checkEnum(
          out,
          semantic["fit"],
          `${path}.fit`,
          ["contain", "cover", "fill"],
          { optional: true },
        );
        const crop = semantic["crop"];
        if (crop !== undefined && checkObject(out, crop, `${path}.crop`)) {
          const fields = ["x", "y", "width", "height"] as const;
          for (const field of fields)
            checkNumber(out, crop[field], `${path}.crop.${field}`, {
              min: field === "width" || field === "height" ? Number.EPSILON : 0,
            });
          const x = crop["x"];
          const y = crop["y"];
          const width = crop["width"];
          const height = crop["height"];
          if (
            typeof x === "number" &&
            typeof y === "number" &&
            typeof width === "number" &&
            typeof height === "number" &&
            Number.isFinite(x) &&
            Number.isFinite(y) &&
            Number.isFinite(width) &&
            Number.isFinite(height) &&
            (x + width > 1 || y + height > 1)
          )
            out.push(
              error(
                "image.crop.bounds",
                `${path}.crop`,
                "crop rectangle must stay within the normalized image bounds",
              ),
            );
        }
      }
      return out;
    },
  },
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
  DRAW_PATH,
  SHAPE_GEO,
  TEXT_NOTE,
  REVIEW_COMMENT,
  TEXT_STYLE,
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
