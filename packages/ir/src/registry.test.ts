import { describe, expect, test } from "bun:test";
import { hasErrors, type ValidationIssue } from "./issues.ts";
import {
  ELEMENT_TYPES,
  getElementTypeDefinition,
  isKnownElementType,
  listElementTypeDefinitions,
} from "./registry.ts";

/** The v1 registry, verbatim from product design section 5.2. */
const DESIGN_TABLE_TYPES: readonly string[] = [
  "node.generic",
  "edge.generic",
  "erd.table",
  "erd.relation",
  "uml.class",
  "uml.association",
  "sequence.participant",
  "sequence.message",
  "sequence.activation",
  "draw.freehand",
  "draw.path",
  "shape.geo",
  "text.note",
  "frame",
  "group",
];

function codes(issues: readonly ValidationIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function validate(type: string, semantic: unknown): readonly ValidationIssue[] {
  const definition = getElementTypeDefinition(type);
  if (!definition) {
    throw new Error(`unregistered type ${type}`);
  }
  return definition.validateSemantic(semantic, "semantic");
}

function expectValid(type: string, semantic: unknown): void {
  const issues = validate(type, semantic);
  expect({ type, issues }).toEqual({ type, issues: [] });
}

describe("registry contents", () => {
  test("registers the design table plus assets and token resources", () => {
    expect(Array.from<string>(ELEMENT_TYPES).sort()).toEqual(
      [
        ...DESIGN_TABLE_TYPES,
        "image.raster",
        "design.token",
        "design.guide",
        "review.comment",
        "design.text-style",
      ].sort(),
    );
  });

  test("has no duplicate entries", () => {
    expect(new Set(ELEMENT_TYPES).size).toBe(ELEMENT_TYPES.length);
  });

  test("every definition declares a key order covering its own fields", () => {
    for (const definition of listElementTypeDefinitions()) {
      expect(definition.keyOrder.keys.length).toBeGreaterThan(0);
      const declared = new Set(definition.keyOrder.keys);
      for (const child of Object.keys(definition.keyOrder.children ?? {})) {
        expect(declared.has(child)).toBe(true);
      }
    }
  });

  test("isKnownElementType tracks the registry", () => {
    expect(isKnownElementType("erd.table")).toBe(true);
    expect(isKnownElementType("vendor.future")).toBe(false);
    expect(getElementTypeDefinition("vendor.future")).toBeUndefined();
  });

  test("edges cascade and containers detach on a deleted reference", () => {
    expect(getElementTypeDefinition("erd.relation")?.onReferenceDeleted).toBe(
      "cascade",
    );
    expect(getElementTypeDefinition("edge.generic")?.onReferenceDeleted).toBe(
      "cascade",
    );
    expect(getElementTypeDefinition("group")?.onReferenceDeleted).toBe(
      "detach",
    );
  });
});

describe("semantic validation", () => {
  test("accepts the design's example payloads", () => {
    expectValid("design.guide", { axis: "x", position: 320 });
    expectValid("node.generic", { label: "" });
    expectValid("edge.generic", { from: "a", to: "b" });
    expectValid("erd.table", {
      tableName: "users",
      columns: [
        {
          id: "c1",
          name: "id",
          dataType: "uuid",
          pk: true,
          defaultExpression: "gen_random_uuid()",
        },
      ],
      indexes: [
        { id: "i1", name: "users_id_uq", columns: ["c1"], unique: true },
      ],
      checks: [{ id: "ck1", name: "id_present", expression: "id IS NOT NULL" }],
    });
    expectValid("erd.relation", {
      from: { table: "users", columns: ["tenant", "c1"] },
      to: { table: "orders", columns: ["tenant", "c9"] },
      cardinality: "1:*",
      onDelete: "cascade",
      onUpdate: "restrict",
      deferrability: "initially-deferred",
    });
    expectValid("uml.class", {
      name: "Invoice",
      attributes: [],
      methods: [],
    });
    expectValid("uml.association", { from: "a", to: "b", kind: "inherit" });
    expectValid("sequence.participant", {
      name: "API",
      kind: "service",
      order: "a1",
    });
    expectValid("sequence.message", {
      from: "a",
      to: "b",
      order: "a1",
      kind: "sync",
    });
    expectValid("sequence.activation", {
      participant: "a",
      fromOrder: "a1",
      toOrder: "a2",
    });
    expectValid("draw.freehand", { points: [{ x: 0, y: 0 }] });
    expectValid("shape.geo", { geo: "rect" });
    expectValid("text.note", { text: "hi" });
    expectValid("review.comment", {
      target: "shape",
      messages: [
        {
          id: "message-1",
          author: "Ada",
          body: "Increase contrast",
          createdAt: "2026-09-07T00:00:00.000Z",
        },
      ],
    });
    expectValid("design.text-style", {
      name: "Heading",
      value: {
        fontFamily: "Inter, sans-serif",
        fontSize: 32,
        fontWeight: 700,
        fontStyle: "normal",
        lineHeight: 1.2,
        letterSpacing: -0.5,
        textAlign: "start",
        textDecoration: "none",
        verticalAlign: "top",
      },
    });
    expectValid("frame", { name: "Group A" });
    expectValid("group", { memberIds: ["a", "b"] });
    expectValid("group", { memberIds: ["mask", "content"], maskId: "mask" });
    expectValid("group", {
      memberIds: ["mask", "content"],
      maskId: "mask",
      maskMode: "luminance",
    });
    expectValid("group", { memberIds: ["a", "b"], isolate: true });
    expectValid("group", {
      memberIds: ["base", "cutout"],
      booleanOperation: "subtract",
    });
  });

  test("validates persistent page guide coordinates and colors", () => {
    expect(
      validate("design.guide", {
        axis: "diagonal",
        position: Number.NaN,
        color: "red",
        hidden: "yes",
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([
      { code: "value.enum", path: "semantic.axis" },
      { code: "type.number", path: "semantic.position" },
      { code: "guide.color", path: "semantic.color" },
      { code: "type.boolean", path: "semantic.hidden" },
    ]);
  });

  test("requires group isolation to be boolean", () => {
    expect(
      codes(validate("group", { memberIds: ["a"], isolate: "yes" })),
    ).toContain("type.boolean");
  });

  test("tolerates unknown fields inside a known payload", () => {
    expectValid("shape.geo", { geo: "rect", futureField: { a: 1 } });
  });

  test("rejects a non-object payload", () => {
    expect(codes(validate("shape.geo", "rect"))).toEqual(["type.object"]);
    expect(codes(validate("shape.geo", null))).toEqual(["type.object"]);
  });

  test("rejects a missing required field", () => {
    expect(codes(validate("erd.table", { columns: [] }))).toEqual([
      "field.missing",
    ]);
  });

  test("validates normalized image crop rectangles", () => {
    const src =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    expectValid("image.raster", {
      src,
      alt: "Portrait",
      crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    });
    expect(
      validate("image.raster", {
        src,
        alt: "Portrait",
        crop: { x: 0.6, y: 0, width: 0.5, height: 1 },
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([{ code: "image.crop.bounds", path: "semantic.crop" }]);
    expect(
      validate("image.raster", {
        src,
        alt: "Portrait",
        crop: { x: 0, y: 0, width: 0, height: 1 },
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([{ code: "value.min", path: "semantic.crop.width" }]);
  });

  test("rejects a value outside an enum", () => {
    expect(codes(validate("shape.geo", { geo: "octagon" }))).toEqual([
      "value.enum",
    ]);
    expect(
      codes(
        validate("erd.relation", {
          from: { table: "a" },
          to: { table: "b" },
          cardinality: "many-to-many",
        }),
      ),
    ).toEqual(["value.enum"]);
  });

  test("rejects invalid ERD referential actions", () => {
    expect(
      codes(
        validate("erd.relation", {
          from: { table: "a" },
          to: { table: "b" },
          cardinality: "*:1",
          onDelete: "destroy",
          onUpdate: "replace",
          deferrability: "eventually",
        }),
      ),
    ).toEqual(["value.enum", "value.enum", "value.enum"]);
  });

  test("validates composite foreign-key endpoint structure", () => {
    const base = {
      from: { table: "a", columns: ["tenant", "id"] },
      to: { table: "b", columns: ["tenant"] },
      cardinality: "*:1",
    };
    expect(codes(validate("erd.relation", base))).toEqual([
      "erd.foreignKeyArity",
    ]);
    expect(
      codes(
        validate("erd.relation", {
          ...base,
          from: {
            table: "a",
            column: "id",
            columns: ["id", "id"],
          },
          to: { table: "b", columns: [] },
        }),
      ),
    ).toEqual([
      "id.duplicate",
      "erd.endpointColumnConflict",
      "erd.emptyEndpointColumns",
    ]);
  });

  test("validates prototype transition settings", () => {
    expectValid("edge.generic", {
      from: "a",
      to: "b",
      prototype: true,
      prototypeTransition: "smart",
      prototypeDuration: 420,
    });
    expect(
      validate("edge.generic", {
        from: "a",
        to: "b",
        prototype: true,
        prototypeTransition: "dissolve",
        prototypeDuration: 5001,
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([
      { code: "value.enum", path: "semantic.prototypeTransition" },
      { code: "value.max", path: "semantic.prototypeDuration" },
    ]);
  });

  test("validates portable connector routing", () => {
    for (const type of ["edge.generic", "uml.association"]) {
      const base =
        type === "uml.association"
          ? { from: "a", to: "b", kind: "assoc" }
          : { from: "a", to: "b" };
      expectValid(type, {
        ...base,
        routing: "orthogonal",
        routingAxis: "vertical",
        routingBend: 0.75,
        routingAvoidObstacles: true,
      });
      expectValid(type, {
        ...base,
        routing: "manual",
        routingWaypoints: [
          { u: 0.25, v: 40 },
          { u: 0.75, v: -20 },
        ],
      });
      expect(
        validate(type, {
          ...base,
          routing: "curved",
          routingBend: 1.5,
          routingAvoidObstacles: "yes",
        }).map(({ code, path }) => ({ code, path })),
      ).toEqual([
        { code: "value.enum", path: "semantic.routing" },
        { code: "value.max", path: "semantic.routingBend" },
        { code: "type.boolean", path: "semantic.routingAvoidObstacles" },
      ]);
    }
    expect(
      validate("edge.generic", {
        from: "a",
        to: "b",
        routing: "manual",
        routingWaypoints: [{ u: "middle", v: Number.NaN }],
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([
      { code: "type.number", path: "semantic.routingWaypoints[0].u" },
      { code: "type.number", path: "semantic.routingWaypoints[0].v" },
    ]);
    expect(
      validate("edge.generic", {
        from: "a",
        to: "b",
        routing: "manual",
        routingWaypoints: Array.from({ length: 33 }, () => ({ u: 0.5, v: 0 })),
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([{ code: "value.max", path: "semantic.routingWaypoints" }]);
  });

  test("validates prototype interaction triggers and bounded delays", () => {
    for (const prototypeAction of [
      "navigate",
      "change-to",
      "open-overlay",
      "close-overlay",
    ])
      expectValid("edge.generic", {
        from: "a",
        to: "b",
        prototype: true,
        prototypeAction,
      });
    for (const prototypeTrigger of ["click", "hover", "press", "after-delay"])
      expectValid("edge.generic", {
        from: "a",
        to: "b",
        prototype: true,
        prototypeTrigger,
        ...(prototypeTrigger === "after-delay" ? { prototypeDelay: 750 } : {}),
      });
    expect(
      validate("edge.generic", {
        from: "a",
        to: "b",
        prototype: true,
        prototypeTrigger: "double-click",
        prototypeDelay: 99,
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([
      { code: "value.enum", path: "semantic.prototypeTrigger" },
      { code: "value.min", path: "semantic.prototypeDelay" },
    ]);
    expect(
      validate("edge.generic", {
        from: "a",
        to: "b",
        prototypeDelay: 60_001,
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([{ code: "value.max", path: "semantic.prototypeDelay" }]);
    expect(
      validate("edge.generic", {
        from: "a",
        to: "b",
        prototype: true,
        prototypeAction: "swap-screen",
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([{ code: "value.enum", path: "semantic.prototypeAction" }]);
  });

  test("validates prototype overlay presentation", () => {
    for (const prototypeOverlayPosition of ["center", "top-left", "manual"])
      expectValid("edge.generic", {
        from: "a",
        to: "b",
        prototype: true,
        prototypeAction: "open-overlay",
        prototypeOverlayPosition,
        prototypeOverlayX: 24,
        prototypeOverlayY: -12,
        prototypeOverlayBackdrop: true,
        prototypeOverlayDismiss: true,
      });
    expect(
      validate("edge.generic", {
        from: "a",
        to: "b",
        prototypeOverlayPosition: "bottom",
        prototypeOverlayBackdrop: "yes",
        prototypeOverlayDismiss: 1,
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([
      { code: "value.enum", path: "semantic.prototypeOverlayPosition" },
      { code: "type.boolean", path: "semantic.prototypeOverlayBackdrop" },
      { code: "type.boolean", path: "semantic.prototypeOverlayDismiss" },
    ]);
  });

  test("rejects duplicate column ids in a table", () => {
    const issues = validate("erd.table", {
      tableName: "t",
      columns: [
        { id: "c1", name: "a", dataType: "int" },
        { id: "c1", name: "b", dataType: "int" },
      ],
    });
    expect(codes(issues)).toEqual(["id.duplicate"]);
    expect(issues[0]?.path).toBe("semantic.columns[1].id");
  });

  test("validates database defaults and composite indexes", () => {
    const issues = validate("erd.table", {
      tableName: "t",
      columns: [{ id: "c1", name: "a", dataType: "int", defaultExpression: 7 }],
      indexes: [
        { id: "i1", columns: ["c1", "c1"] },
        { id: "i1", name: 2, columns: "c1", unique: "yes" },
      ],
    });
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "type.string", path: "semantic.columns[0].defaultExpression" },
      { code: "id.duplicate", path: "semantic.indexes[0].columns[1]" },
      { code: "id.duplicate", path: "semantic.indexes[1].id" },
      { code: "type.string", path: "semantic.indexes[1].name" },
      { code: "type.array", path: "semantic.indexes[1].columns" },
      { code: "type.boolean", path: "semantic.indexes[1].unique" },
    ]);
  });

  test("validates portable generated columns and expression conflicts", () => {
    expectValid("erd.table", {
      tableName: "line_items",
      columns: [
        {
          id: "total",
          name: "total",
          dataType: "decimal",
          generatedExpression: "quantity * unit_price",
        },
      ],
    });
    const issues = validate("erd.table", {
      tableName: "line_items",
      columns: [
        {
          id: "total",
          name: "total",
          dataType: "decimal",
          pk: true,
          defaultExpression: "0",
          generatedExpression: "quantity * unit_price",
        },
        { id: "bad", name: "bad", dataType: "int", generatedExpression: 7 },
      ],
    });
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "erd.columnExpressionConflict", path: "semantic.columns[0]" },
      { code: "erd.generatedPrimaryKey", path: "semantic.columns[0]" },
      { code: "type.string", path: "semantic.columns[1].generatedExpression" },
    ]);
  });

  test("validates database check constraint fields and ids", () => {
    const issues = validate("erd.table", {
      tableName: "t",
      columns: [],
      checks: [
        { id: "ck1", name: "valid", expression: "score >= 0" },
        { id: "ck1", name: 2, expression: false },
      ],
    });
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "id.duplicate", path: "semantic.checks[1].id" },
      { code: "type.string", path: "semantic.checks[1].name" },
      { code: "type.string", path: "semantic.checks[1].expression" },
    ]);
  });

  test("rejects an index reference to an unknown table column", () => {
    const issues = validate("erd.table", {
      tableName: "t",
      columns: [{ id: "c1", name: "id", dataType: "int" }],
      indexes: [{ id: "i1", columns: ["missing"] }],
    });
    expect(issues.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "erd.indexColumn", path: "semantic.indexes[0].columns[0]" },
    ]);
  });

  test("rejects wrong field types with a precise path", () => {
    const issues = validate("erd.table", {
      tableName: "t",
      columns: [{ id: "c1", name: 7, dataType: "int" }],
    });
    expect(issues[0]?.path).toBe("semantic.columns[0].name");
    expect(issues[0]?.code).toBe("type.string");
  });

  test("validates nested uml method parameters", () => {
    const issues = validate("uml.class", {
      name: "C",
      attributes: [],
      methods: [{ id: "m", name: "f", parameters: [{ type: "int" }] }],
    });
    expect(issues[0]?.path).toBe("semantic.methods[0].parameters[0].name");
  });

  test("rejects a text mark reaching past the end of the text", () => {
    expect(
      codes(
        validate("text.note", {
          text: "abc",
          marks: [{ start: 0, end: 9, kind: "bold" }],
        }),
      ),
    ).toEqual(["range.overflow"]);
  });

  test("rejects an inverted text mark range", () => {
    expect(
      codes(
        validate("text.note", {
          text: "abcdef",
          marks: [{ start: 4, end: 1, kind: "bold" }],
        }),
      ),
    ).toEqual(["range.inverted"]);
  });

  test("rejects empty marks and invalid link destinations", () => {
    expect(
      validate("text.note", {
        text: "underlined",
        marks: [{ start: 0, end: 10, kind: "underline" }],
      }),
    ).toEqual([]);
    expect(
      codes(
        validate("text.note", {
          text: "abc",
          marks: [
            { start: 1, end: 1, kind: "bold" },
            { start: 0, end: 1, kind: "link" },
            { start: 1, end: 2, kind: "italic", href: "https://example.com" },
          ],
        }),
      ),
    ).toEqual(["range.empty", "field.missing", "field.unexpected"]);
  });

  test("rejects non-finite freehand coordinates", () => {
    expect(
      hasErrors(
        validate("draw.freehand", {
          points: [{ x: Number.NaN, y: 0 }],
        }),
      ),
    ).toBe(true);
  });

  test("validates review thread messages", () => {
    expect(codes(validate("review.comment", { messages: [] }))).toEqual([
      "comment.empty",
    ]);
    expect(
      codes(
        validate("review.comment", {
          messages: [
            { id: "m", author: "Ada", body: "One", createdAt: "bad" },
            {
              id: "m",
              author: "Grace",
              body: "Two",
              createdAt: "2026-09-07T00:00:00.000Z",
            },
          ],
        }),
      ),
    ).toEqual(["comment.timestamp", "comment.messageDuplicate"]);
  });

  test("validates complete reusable typography", () => {
    const value = {
      fontFamily: "Inter",
      fontSize: 0,
      fontWeight: 1200,
      fontStyle: "oblique",
      lineHeight: 0,
      letterSpacing: 0,
      textAlign: "justify",
      textDecoration: "blink",
      verticalAlign: "baseline",
    };
    expect(
      codes(validate("design.text-style", { name: "Bad", value })),
    ).toEqual([
      "value.min",
      "value.max",
      "value.enum",
      "value.min",
      "value.enum",
      "value.enum",
      "value.enum",
    ]);
  });

  test("requires a group mask to be one of its members", () => {
    expect(
      codes(validate("group", { memberIds: ["content"], maskId: "mask" })),
    ).toEqual(["group.maskMember"]);
  });

  test("validates raster mask mode only with a mask member", () => {
    expect(
      codes(validate("group", { memberIds: ["a"], maskMode: "alpha" })),
    ).toEqual(["group.maskMode"]);
    expect(
      codes(
        validate("group", {
          memberIds: ["a"],
          maskId: "a",
          maskMode: "opaque",
        }),
      ),
    ).toEqual(["value.enum"]);
  });

  test("validates Boolean group operation, arity and mask exclusivity", () => {
    expect(
      codes(
        validate("group", {
          memberIds: ["only"],
          booleanOperation: "divide",
        }),
      ),
    ).toEqual(["value.enum", "group.booleanMembers"]);
    expect(
      codes(
        validate("group", {
          memberIds: ["a", "b"],
          maskId: "a",
          booleanOperation: "union",
        }),
      ),
    ).toEqual(["group.clipConflict"]);
  });

  test("validates editable compound path contours and controls", () => {
    expectValid("draw.path", {
      name: "Cutout",
      fillRule: "evenodd",
      contours: [
        {
          points: [
            { x: 0, y: 0, controlOut: { x: 25, y: 0 } },
            { x: 100, y: 0 },
            { x: 50, y: 100, controlIn: { x: 75, y: 100 } },
          ],
        },
      ],
    });
    expect(
      codes(
        validate("draw.path", {
          fillRule: "invalid",
          contours: [
            {
              points: [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
              ],
            },
          ],
        }),
      ),
    ).toEqual(["value.enum", "path.points"]);
    expect(
      codes(validate("draw.path", { fillRule: "nonzero", contours: [] })),
    ).toEqual(["path.contours"]);
  });

  test("validates token mode literals, aliases and unique names", () => {
    expectValid("design.token", {
      name: "Action",
      kind: "color",
      value: "#2563eb",
      alias: "primitive",
      modes: [
        { name: "Dark", value: "#60a5fa" },
        { name: "Android", alias: "android-primary" },
      ],
    });
    expect(
      validate("design.token", {
        name: "Space",
        kind: "number",
        value: 8,
        modes: [
          { name: "Compact", value: -1, alias: "other" },
          { name: "Compact", value: "wide" },
        ],
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([
      { code: "token.modeChoice", path: "semantic.modes[0]" },
      { code: "token.number", path: "semantic.modes[0].value" },
      {
        code: "token.modeDuplicate",
        path: "semantic.modes[1].name",
      },
      { code: "token.number", path: "semantic.modes[1].value" },
    ]);
    expect(
      validate("design.token", {
        name: "Brand",
        kind: "color",
        value: "#123456",
        modes: [{ name: "Default", value: "#abcdef" }],
      }).map(({ code }) => code),
    ).toEqual(["token.modeReserved"]);
  });

  test("validates frame layout grids and their bounded dimensions", () => {
    expectValid("frame", {
      name: "Web",
      layoutGrids: [
        {
          id: "minor",
          kind: "grid",
          size: 8,
          color: "#3b82f6",
          opacity: 0.2,
        },
        {
          id: "desktop-columns",
          kind: "columns",
          count: 12,
          gutter: 20,
          margin: 80,
          color: "#ef4444",
          opacity: 0.12,
          visible: false,
        },
      ],
    });
    expect(
      validate("frame", {
        name: "Bad",
        layoutGrids: [
          { id: "bad-grid", kind: "grid", size: 0, color: "red", opacity: 2 },
          {
            id: "bad-rows",
            kind: "rows",
            count: 25,
            gutter: -1,
            margin: -2,
            color: "#123456",
            opacity: 0.5,
          },
        ],
      }).map(({ code }) => code),
    ).toEqual([
      "frame.layoutGridColor",
      "frame.layoutGridOpacity",
      "value.min",
      "frame.layoutGridCount",
      "value.min",
      "value.min",
    ]);
    expect(
      validate("frame", {
        name: "Duplicate",
        layoutGrids: [
          {
            id: "same",
            kind: "grid",
            size: 8,
            color: "#123456",
            opacity: 0.2,
          },
          {
            id: "same",
            kind: "grid",
            size: 16,
            color: "#abcdef",
            opacity: 0.1,
          },
        ],
      }).map(({ code }) => code),
    ).toEqual(["frame.layoutGridDuplicate"]);
  });

  test("validates target platforms and complete non-negative safe areas", () => {
    expectValid("frame", {
      name: "iPhone",
      platform: "ios",
      safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
    });
    expect(
      validate("frame", {
        name: "Bad device",
        platform: "watch",
        safeArea: { top: -1, right: 0, bottom: 0 },
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([
      { code: "value.enum", path: "semantic.platform" },
      { code: "value.min", path: "semantic.safeArea.top" },
      { code: "field.missing", path: "semantic.safeArea.left" },
    ]);
  });

  test("validates prototype viewport overflow modes", () => {
    for (const prototypeOverflow of ["none", "vertical", "horizontal", "both"])
      expectValid("frame", { name: "Scrollable", prototypeOverflow });
    expect(
      validate("frame", {
        name: "Bad scroll",
        prototypeOverflow: "diagonal",
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([{ code: "value.enum", path: "semantic.prototypeOverflow" }]);
  });

  test("rejects frames with conflicting refresh source modes", () => {
    expect(
      validate("frame", {
        name: "Ambiguous",
        instanceOf: "component",
        responsiveSource: "desktop",
      }).map(({ code, path }) => ({ code, path })),
    ).toEqual([
      { code: "frame.sourceMode", path: "semantic.responsiveSource" },
    ]);
  });

  test("validates stable and uniquely named component variant properties", () => {
    expectValid("frame", {
      name: "Button",
      component: true,
      variantSet: "Button",
      variantProperties: [
        { id: "state", name: "State", value: "Hover" },
        { id: "size", name: "Size", value: "Large" },
      ],
    });
    expect(
      validate("frame", {
        name: "Bad button",
        component: true,
        variantProperties: [
          { id: "same", name: "State", value: " " },
          { id: "same", name: " state ", value: "Hover" },
        ],
      }).map(({ code }) => code),
    ).toEqual([
      "frame.variantPropertyValue",
      "frame.variantPropertyDuplicateId",
      "frame.variantPropertyDuplicateName",
    ]);
  });
});

describe("references", () => {
  function refs(type: string, semantic: unknown): unknown {
    return getElementTypeDefinition(type)?.references(semantic);
  }

  test("edges report both endpoints", () => {
    expect(refs("edge.generic", { from: "a", to: "b" })).toEqual([
      { field: "from", id: "a" },
      { field: "to", id: "b" },
    ]);
  });

  test("erd relations report the table, not the column", () => {
    expect(
      refs("erd.relation", {
        from: { table: "t1", column: "c1" },
        to: { table: "t2", column: "c2" },
      }),
    ).toEqual([
      { field: "from.table", id: "t1" },
      { field: "to.table", id: "t2" },
    ]);
  });

  test("groups report each member with its index", () => {
    expect(refs("group", { memberIds: ["a", "b"] })).toEqual([
      { field: "memberIds[0]", id: "a" },
      { field: "memberIds[1]", id: "b" },
    ]);
  });

  test("groups report the mask role as a detachable reference", () => {
    expect(
      refs("group", { memberIds: ["mask", "content"], maskId: "mask" }),
    ).toEqual([
      { field: "maskId", id: "mask" },
      { field: "memberIds[0]", id: "mask" },
      { field: "memberIds[1]", id: "content" },
    ]);
  });

  test("responsive frames report their source and refresh bindings", () => {
    expect(
      refs("frame", {
        name: "Mobile",
        responsiveSource: "desktop",
        instanceBindings: [
          { source: "desktop-label", target: "mobile-label", baseline: "{}" },
        ],
        memberIds: ["mobile-label"],
      }),
    ).toEqual([
      { field: "instanceBindings[0].source", id: "desktop-label" },
      { field: "instanceBindings[0].target", id: "mobile-label" },
      { field: "responsiveSource", id: "desktop" },
      { field: "memberIds[0]", id: "mobile-label" },
    ]);
  });

  test("sequence activations point at their participant", () => {
    expect(refs("sequence.activation", { participant: "p1" })).toEqual([
      { field: "participant", id: "p1" },
    ]);
  });

  test("nodes have no outgoing references", () => {
    expect(refs("erd.table", { tableName: "t", columns: [] })).toEqual([]);
    expect(refs("shape.geo", { geo: "rect" })).toEqual([]);
  });

  test("tokens report default and per-mode aliases", () => {
    expect(
      refs("design.token", {
        name: "Action",
        kind: "color",
        value: "#2563eb",
        alias: "base",
        modes: [
          { name: "Dark", alias: "dark" },
          { name: "Light", value: "#ffffff" },
        ],
      }),
    ).toEqual([
      { field: "alias", id: "base" },
      { field: "modes[0].alias", id: "dark" },
    ]);
  });

  test("review comments report their contextual target", () => {
    expect(
      getElementTypeDefinition("review.comment")?.references({
        target: "button",
        messages: [],
      }),
    ).toEqual([{ field: "target", id: "button" }]);
  });

  test("survives malformed payloads without throwing", () => {
    expect(refs("edge.generic", null)).toEqual([]);
    expect(refs("edge.generic", { from: 42 })).toEqual([]);
    expect(refs("group", { memberIds: "not-an-array" })).toEqual([]);
    expect(refs("erd.relation", { from: "not-an-object" })).toEqual([]);
  });
});
