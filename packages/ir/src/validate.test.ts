import { describe, expect, test } from "bun:test";
import { DocumentValidationError, type ValidationIssue } from "./issues.ts";
import { type Document, elementsByPage } from "./types.ts";
import {
  assertValidDocument,
  isValidDocument,
  validateDocument,
} from "./validate.ts";

function base(): Document {
  return {
    schemaVersion: 1,
    id: "01JDOC00000000000000000000",
    title: "Doc",
    pages: [{ id: "p1", name: "Page", kind: "erd" }],
    elements: [
      {
        id: "t1",
        page: "p1",
        type: "erd.table",
        index: "a0",
        semantic: { tableName: "users", columns: [] },
        visual: { x: 0, y: 0 },
      },
    ],
  };
}

function withElements(elements: Document["elements"]): Document {
  return { ...base(), elements };
}

function codes(issues: readonly ValidationIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function errorsOf(document: Document): ValidationIssue[] {
  return validateDocument(document).filter(
    (issue) => issue.severity === "error",
  );
}

function warningsOf(document: Document): ValidationIssue[] {
  return [...validateDocument(document)].filter(
    (issue) => issue.severity === "warning",
  );
}

test("reserves Default as the implicit page token mode", () => {
  const doc = base();
  const pages = [{ ...doc.pages[0], tokenMode: "Default" }];
  expect(codes(errorsOf({ ...doc, pages }))).toContain(
    "page.tokenModeReserved",
  );
});

describe("valid documents", () => {
  test("a well-formed document has no issues", () => {
    expect(validateDocument(base())).toEqual([]);
    expect(isValidDocument(base())).toBe(true);
  });

  test("accepts portable accessibility metadata", () => {
    const doc = base();
    const element = doc.elements[0];
    expect(
      errorsOf({
        ...doc,
        elements: [
          {
            ...element,
            accessibility: {
              role: "heading",
              label: "Users",
              hint: "Account records",
              value: "12 rows",
              disabled: true,
              headingLevel: 2,
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  test("an empty document is valid", () => {
    expect(
      validateDocument({
        schemaVersion: 1,
        id: "d",
        title: "",
        pages: [],
        elements: [],
      }),
    ).toEqual([]);
  });

  test("assertValidDocument returns the (warning-only) issues", () => {
    expect(assertValidDocument(base())).toEqual([]);
  });
});

describe("accessibility errors", () => {
  test("rejects invalid roles, empty labels, and invalid heading levels", () => {
    const doc = base();
    const element = doc.elements[0];
    const invalid = {
      ...element,
      accessibility: {
        role: "dialog",
        label: "",
        headingLevel: 7,
      },
    } as unknown as Document["elements"][number];
    expect(codes(errorsOf(withElements([invalid])))).toEqual(
      expect.arrayContaining([
        "value.enum",
        "value.empty",
        "value.max",
        "accessibility.headingRole",
      ]),
    );
  });

  test("requires a level for the heading role", () => {
    const doc = base();
    const invalid = {
      ...doc.elements[0],
      accessibility: { role: "heading" },
    } as Document["elements"][number];
    expect(codes(errorsOf(withElements([invalid])))).toContain("field.missing");
  });
});

describe("document-level errors", () => {
  test("rejects a bad schemaVersion", () => {
    expect(codes(errorsOf({ ...base(), schemaVersion: 0 }))).toEqual([
      "value.min",
    ]);
    expect(codes(errorsOf({ ...base(), schemaVersion: 1.5 }))).toEqual([
      "value.integer",
    ]);
  });

  test("rejects an empty id but allows an empty title", () => {
    expect(codes(errorsOf({ ...base(), id: "" }))).toEqual(["value.empty"]);
    expect(errorsOf({ ...base(), title: "" })).toEqual([]);
  });

  test("rejects missing pages/elements arrays", () => {
    const noPages = { ...base(), pages: undefined } as unknown as Document;
    expect(codes(errorsOf(noPages))).toContain("type.array");
    const noElements = {
      ...base(),
      elements: undefined,
    } as unknown as Document;
    expect(codes(errorsOf(noElements))).toContain("type.array");
  });

  test("rejects a non-object document", () => {
    expect(codes(validateDocument(null as unknown as Document))).toEqual([
      "type.object",
    ]);
  });
});

describe("page errors", () => {
  test("rejects duplicate page ids", () => {
    const document: Document = {
      ...base(),
      pages: [
        { id: "p1", name: "A", kind: "erd" },
        { id: "p1", name: "B", kind: "uml" },
      ],
    };
    expect(codes(errorsOf(document))).toEqual(["id.duplicate"]);
  });

  test("rejects an unknown page kind", () => {
    const document = {
      ...base(),
      pages: [{ id: "p1", name: "A", kind: "mindmap" }],
    } as unknown as Document;
    expect(codes(errorsOf(document))).toEqual(["value.enum"]);
  });
});

describe("element errors", () => {
  test("rejects duplicate element ids", () => {
    const document = withElements([
      base().elements[0] as Document["elements"][number],
      { ...(base().elements[0] as Document["elements"][number]), index: "a1" },
    ]);
    expect(codes(errorsOf(document))).toEqual(["id.duplicate"]);
  });

  test("rejects an element on a page that does not exist", () => {
    const document = withElements([
      {
        ...(base().elements[0] as Document["elements"][number]),
        page: "ghost",
      },
    ]);
    expect(codes(errorsOf(document))).toEqual(["reference.missingPage"]);
  });

  test("rejects an empty fractional index", () => {
    const document = withElements([
      { ...(base().elements[0] as Document["elements"][number]), index: "" },
    ]);
    expect(codes(errorsOf(document))).toEqual(["value.empty"]);
  });

  test("rejects a negative width or height", () => {
    const document = withElements([
      {
        ...(base().elements[0] as Document["elements"][number]),
        visual: { width: -1, height: -2 },
      },
    ]);
    expect(codes(errorsOf(document))).toEqual(["value.min", "value.min"]);
  });

  test("validates finite ordered auto-layout size limits", () => {
    const element = base().elements[0] as Document["elements"][number];
    expect(
      errorsOf(
        withElements([
          {
            ...element,
            visual: {
              ...element.visual,
              minWidth: 120,
              maxWidth: 100,
              minHeight: 0,
            },
          },
        ]),
      ).map((issue) => [issue.code, issue.path]),
    ).toEqual([
      ["value.min", "elements[0].visual.minHeight"],
      ["value.range", "elements[0].visual.minWidth"],
    ]);
  });

  test("validates persistent aspect ratios against size limits", () => {
    const source = base().elements[0] as Document["elements"][number];
    const issues = errorsOf(
      withElements([
        {
          ...source,
          visual: {
            ...source.visual,
            aspectRatio: 2,
            minWidth: 300,
            maxHeight: 100,
          },
        },
      ]),
    );
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["value.range", "elements[0].visual.aspectRatio"],
    ]);
    expect(
      codes(
        errorsOf(
          withElements([
            { ...source, visual: { ...source.visual, aspectRatio: 0 } },
          ]),
        ),
      ),
    ).toEqual(["value.min"]);
  });

  test("rejects a non-finite coordinate", () => {
    const document = withElements([
      {
        ...(base().elements[0] as Document["elements"][number]),
        visual: { x: Number.POSITIVE_INFINITY },
      },
    ]);
    expect(codes(errorsOf(document))).toEqual(["type.number"]);
  });

  test("rejects a non-object semantic, registered type or not", () => {
    // Element<S>.semantic is a record, never a scalar. Registered types got
    // this from their own validateSemantic; unregistered types had nothing
    // checking it, so a scalar payload passed with only a type.unknown
    // warning and then serialized non-idempotently.
    for (const type of ["node.generic", "vendor.unregistered"]) {
      for (const semantic of ["a string", 42, true, null, []]) {
        const document = withElements([
          {
            ...(base().elements[0] as Document["elements"][number]),
            type,
            semantic,
          },
        ] as unknown as Document["elements"]);
        expect({ type, semantic, codes: codes(errorsOf(document)) }).toEqual({
          type,
          semantic,
          codes: ["type.object"],
        });
      }
    }
  });

  test("an object semantic is accepted for an unregistered type", () => {
    const document = withElements([
      {
        ...(base().elements[0] as Document["elements"][number]),
        type: "vendor.unregistered",
        semantic: { anything: 1 },
      },
    ] as unknown as Document["elements"]);
    expect(errorsOf(document)).toEqual([]);
    expect(codes(warningsOf(document))).toEqual(["type.unknown"]);
  });

  test("rejects an unknown style enum value", () => {
    const document = withElements([
      {
        ...(base().elements[0] as Document["elements"][number]),
        visual: { style: { dash: "wavy" } },
      },
    ] as unknown as Document["elements"]);
    expect(codes(errorsOf(document))).toEqual(["value.enum"]);
  });

  test("validates bounded portable custom dash intervals and phase", () => {
    const valid = withElements([
      {
        ...(base().elements[0] as Document["elements"][number]),
        visual: { style: { strokeDashArray: [8, 3], strokeDashOffset: -2 } },
      },
    ] as unknown as Document["elements"]);
    expect(errorsOf(valid)).toEqual([]);
    const invalid = withElements([
      {
        ...(base().elements[0] as Document["elements"][number]),
        visual: { style: { strokeDashArray: [0, 0] } },
      },
    ] as unknown as Document["elements"]);
    expect(codes(errorsOf(invalid))).toEqual(["value.range"]);
  });

  test("accepts portable blend modes and rejects unknown compositing values", () => {
    const valid = withElements([
      {
        ...(base().elements[0] as Document["elements"][number]),
        visual: { style: { blendMode: "luminosity" } },
      },
    ]);
    expect(errorsOf(valid)).toEqual([]);
    const invalid = withElements([
      {
        ...(base().elements[0] as Document["elements"][number]),
        visual: { style: { blendMode: "pass-through" } },
      },
    ] as unknown as Document["elements"]);
    expect(codes(errorsOf(invalid))).toEqual(["value.enum"]);
  });

  test("validates portable stroke caps, joins and miter limits", () => {
    const valid = withElements([
      {
        ...(base().elements[0] as Document["elements"][number]),
        visual: {
          style: {
            strokeCap: "square",
            strokeJoin: "bevel",
            strokeMiterLimit: 8,
          },
        },
      },
    ]);
    expect(errorsOf(valid)).toEqual([]);
    const invalid = withElements([
      {
        ...(base().elements[0] as Document["elements"][number]),
        visual: {
          style: {
            strokeCap: "flat",
            strokeJoin: "sharp",
            strokeMiterLimit: 0.5,
          },
        },
      },
    ] as unknown as Document["elements"]);
    expect(codes(errorsOf(invalid))).toEqual([
      "value.enum",
      "value.enum",
      "value.min",
    ]);
  });

  test("validates all four independent corner radii", () => {
    const valid = withElements([
      {
        ...(base().elements[0] as Document["elements"][number]),
        visual: {
          style: {
            cornerRadii: {
              topLeft: 1,
              topRight: 2,
              bottomRight: 3,
              bottomLeft: 4,
            },
          },
        },
      },
    ]);
    expect(errorsOf(valid)).toEqual([]);
    const invalid = structuredClone(valid) as unknown as {
      elements: { visual: { style: { cornerRadii: { topLeft: number } } } }[];
    };
    invalid.elements[0]!.visual.style.cornerRadii.topLeft = -1;
    expect(codes(errorsOf(invalid as unknown as Document))).toEqual([
      "value.min",
    ]);
  });
});

describe("forward-compatible warnings", () => {
  test("an unknown element type warns instead of failing", () => {
    const document = withElements([
      {
        id: "x1",
        page: "p1",
        type: "vendor.future",
        index: "a0",
        semantic: { anything: true },
        visual: {},
      },
    ]);
    expect(errorsOf(document)).toEqual([]);
    expect(codes(warningsOf(document))).toEqual(["type.unknown"]);
    expect(isValidDocument(document)).toBe(true);
  });

  test("unknown visual and style fields warn identically", () => {
    // Both levels are a closed set of modelled keys plus an extensions bag,
    // so neither should be quieter than the other. These are in-memory
    // documents on purpose: parseDocument relocates unmodelled keys into
    // `extensions`, so a parsed document never reaches this path.
    function warnAt(visual: unknown): ValidationIssue[] {
      return warningsOf(
        withElements([
          {
            ...(base().elements[0] as Document["elements"][number]),
            visual,
          },
        ] as unknown as Document["elements"]),
      );
    }

    const onVisual = warnAt({ x: 1, blur: 3 });
    expect(codes(onVisual)).toEqual(["field.unknown"]);
    expect(onVisual[0]?.path).toBe("elements[0].visual.blur");

    const onStyle = warnAt({ style: { blur: 3 } });
    expect(codes(onStyle)).toEqual(["field.unknown"]);
    expect(onStyle[0]?.path).toBe("elements[0].visual.style.blur");

    // Both at once, and never for a modelled key or the extensions bag.
    expect(
      codes(warnAt({ x: 1, blur: 3, style: { fill: "#000", glow: 1 } })),
    ).toEqual(["field.unknown", "field.unknown"]);
    expect(
      warnAt({ x: 1, extensions: { a: 1 }, style: { extensions: { b: 2 } } }),
    ).toEqual([]);
  });

  test("prototype fixed position is a validated visual field", () => {
    const valid = withElements([
      {
        ...(base().elements[0] as Document["elements"][number]),
        visual: { prototypeFixed: true },
      },
    ]);
    expect(errorsOf(valid)).toEqual([]);
    const invalid = structuredClone(valid) as unknown as {
      elements: { visual: { prototypeFixed: string } }[];
    };
    invalid.elements[0]!.visual.prototypeFixed = "yes";
    expect(
      errorsOf(invalid as unknown as Document).map(({ code, path }) => ({
        code,
        path,
      })),
    ).toEqual([
      { code: "type.boolean", path: "elements[0].visual.prototypeFixed" },
    ]);
  });

  test("an unknown style field warns instead of failing", () => {
    const document = withElements([
      {
        ...(base().elements[0] as Document["elements"][number]),
        visual: { style: { futureGlow: 1 } },
      },
    ] as unknown as Document["elements"]);
    expect(errorsOf(document)).toEqual([]);
    expect(codes(warningsOf(document))).toEqual(["field.unknown"]);
  });

  test("a dangling reference warns instead of failing", () => {
    const document = withElements([
      ...base().elements,
      {
        id: "r1",
        page: "p1",
        type: "erd.relation",
        index: "a1",
        semantic: {
          from: { table: "t1" },
          to: { table: "gone" },
          cardinality: "1:*",
        },
        visual: {},
      },
    ]);
    const warnings = warningsOf(document);
    expect(codes(warnings)).toEqual(["reference.dangling"]);
    expect(warnings[0]?.path).toBe("elements[1].semantic.to.table");
  });

  test("checkReferences:false suppresses dangling-reference warnings", () => {
    const document = withElements([
      {
        id: "e1",
        page: "p1",
        type: "edge.generic",
        index: "a0",
        semantic: { from: "gone", to: "also-gone" },
        visual: {},
      },
    ]);
    expect(warningsOf(document).length).toBe(2);
    expect(validateDocument(document, { checkReferences: false })).toEqual([]);
  });
});

describe("assertValidDocument", () => {
  test("throws with every issue attached", () => {
    const document = { ...base(), id: "" };
    let thrown: unknown;
    try {
      assertValidDocument(document);
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBeInstanceOf(DocumentValidationError);
    expect(codes((thrown as DocumentValidationError).issues)).toEqual([
      "value.empty",
    ]);
  });

  test("does not throw on warnings alone", () => {
    const document = withElements([
      {
        id: "x1",
        page: "p1",
        type: "vendor.future",
        index: "a0",
        semantic: {},
        visual: {},
      },
    ]);
    expect(() => assertValidDocument(document)).not.toThrow();
  });
});

describe("elementsByPage", () => {
  test("groups elements and keeps empty pages", () => {
    const document: Document = {
      ...base(),
      pages: [
        { id: "p1", name: "A", kind: "erd" },
        { id: "p2", name: "B", kind: "uml" },
      ],
    };
    const grouped = elementsByPage(document);
    expect(grouped.get("p1")?.map((element) => element.id)).toEqual(["t1"]);
    expect(grouped.get("p2")).toEqual([]);
  });

  test("keeps orphaned elements under their own page id", () => {
    const document = withElements([
      {
        ...(base().elements[0] as Document["elements"][number]),
        page: "ghost",
      },
    ]);
    expect(elementsByPage(document).get("ghost")?.length).toBe(1);
  });
});
