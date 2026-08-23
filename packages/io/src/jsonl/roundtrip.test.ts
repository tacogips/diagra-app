import { describe, expect, test } from "bun:test";
import type { Document } from "@diagra/ir";
import {
  DocumentParseError,
  parseDocument,
  parseDocumentResult,
} from "./parse.ts";
import { serializeDocument } from "./serialize.ts";

function issueCodes(issues: readonly { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

const MINIMAL: Document = {
  schemaVersion: 1,
  id: "01JMIN00000000000000000000",
  title: "Empty",
  pages: [],
  elements: [],
};

describe("record ordering", () => {
  // Every golden fixture is single-page, so the "by page, then id" rule is
  // pinned here instead.
  const multiPage: Document = {
    schemaVersion: 1,
    id: "01JMUL00000000000000000000",
    title: "Two pages",
    pages: [
      { id: "p2", name: "Second", kind: "uml" },
      { id: "p1", name: "First", kind: "erd" },
    ],
    elements: [
      {
        id: "z",
        page: "p1",
        type: "frame",
        index: "a1",
        semantic: { name: "z" },
        visual: {},
      },
      {
        id: "b",
        page: "p2",
        type: "frame",
        index: "a2",
        semantic: { name: "b" },
        visual: {},
      },
      {
        id: "a",
        page: "p1",
        type: "frame",
        index: "a0",
        semantic: { name: "a" },
        visual: {},
      },
    ],
  };

  function idsOf(text: string): string[] {
    return text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string; id?: string })
      .map((record) => `${record.kind}:${record.id ?? ""}`);
  }

  test("writes the document, then pages by id, then elements by page then id", () => {
    expect(idsOf(serializeDocument(multiPage))).toEqual([
      "document:01JMUL00000000000000000000",
      "page:p1",
      "page:p2",
      "element:a",
      "element:z",
      "element:b",
    ]);
  });

  test("does not mutate the caller's arrays while sorting", () => {
    serializeDocument(multiPage);
    expect(multiPage.pages.map((page) => page.id)).toEqual(["p2", "p1"]);
    expect(multiPage.elements.map((element) => element.id)).toEqual([
      "z",
      "b",
      "a",
    ]);
  });

  test("unmodelled record kinds are written last", () => {
    const withUnknown: Document = {
      ...multiPage,
      unknownRecords: [
        { kind: "zeta", data: { n: 1 } },
        { kind: "alpha", data: { n: 2 } },
      ],
    };
    const lines = serializeDocument(withUnknown).trim().split("\n");
    expect(lines.slice(-2)).toEqual([
      '{"kind":"alpha","n":2}',
      '{"kind":"zeta","n":1}',
    ]);
  });
});

describe("serializeDocument", () => {
  test("writes a document with no pages as a single line", () => {
    expect(serializeDocument(MINIMAL)).toBe(
      '{"kind":"document","schemaVersion":1,"id":"01JMIN00000000000000000000","title":"Empty"}\n',
    );
  });

  test("trailingNewline can be turned off", () => {
    expect(
      serializeDocument(MINIMAL, { trailingNewline: false }).endsWith("\n"),
    ).toBe(false);
  });

  test("refuses to write an invalid document", () => {
    const broken = { ...MINIMAL, title: 42 } as unknown as Document;
    expect(() => serializeDocument(broken)).toThrow(/validation error/);
  });

  test("validate:false lets a caller write a known-dirty document", () => {
    const broken = { ...MINIMAL, title: 42 } as unknown as Document;
    expect(serializeDocument(broken, { validate: false })).toContain(
      '"title":42',
    );
  });

  test("output is idempotent", () => {
    const once = serializeDocument(parseDocument(FORWARD_TEXT));
    const twice = serializeDocument(parseDocument(once));
    expect(twice).toBe(once);
  });
});

const FORWARD_TEXT = [
  '{"kind":"document","schemaVersion":1,"id":"01JX00000000000000000000AA","title":"T","newField":{"deep":[1,2]}}',
  '{"kind":"page","id":"p1","name":"P","pageKind":"freeform","newPageField":"keep"}',
  '{"kind":"element","id":"n1","page":"p1","type":"node.generic","index":"a0","semantic":{"label":"L","newSemanticField":true},"visual":{"x":1,"y":2,"newVisualField":"v","style":{"fill":"#000","newStyleField":9}}}',
  '{"kind":"element","id":"u1","page":"p1","type":"vendor.unknown","index":"a1","semantic":{"whatever":"kept"}}',
  '{"kind":"vendor.record","payload":{"a":1},"id":"v1"}',
  "",
].join("\n");

describe("forward compatibility", () => {
  test("preserves unknown record kinds", () => {
    const document = parseDocument(FORWARD_TEXT);
    expect(document.unknownRecords).toEqual([
      { kind: "vendor.record", data: { payload: { a: 1 }, id: "v1" } },
    ]);
    expect(serializeDocument(document)).toContain(
      '{"kind":"vendor.record","id":"v1","payload":{"a":1}}',
    );
  });

  test("preserves unknown fields on every known record", () => {
    const document = parseDocument(FORWARD_TEXT);
    expect(document.extensions).toEqual({ newField: { deep: [1, 2] } });
    expect(document.pages[0]?.extensions).toEqual({
      newPageField: "keep",
    });

    const node = document.elements[0];
    expect(node?.semantic).toEqual({
      label: "L",
      newSemanticField: true,
    });
    expect(node?.visual.extensions).toEqual({ newVisualField: "v" });
    expect(node?.visual.style?.extensions).toEqual({ newStyleField: 9 });
  });

  test("keeps an unknown element type as a warning, not an error", () => {
    const result = parseDocumentResult(FORWARD_TEXT);
    expect(result.ok).toBe(true);
    expect(issueCodes(result.issues)).toContain("type.unknown");
    expect(result.issues.every((issue) => issue.severity === "warning")).toBe(
      true,
    );
  });

  test("every unknown field survives a full round trip", () => {
    const text = serializeDocument(parseDocument(FORWARD_TEXT));
    expect(text).toContain('"newField":{"deep":[1,2]}');
    expect(text).toContain('"newPageField":"keep"');
    expect(text).toContain('"newSemanticField":true');
    expect(text).toContain('"newVisualField":"v"');
    expect(text).toContain('"newStyleField":9');
    expect(text).toContain('"whatever":"kept"');
  });
});

// `JSON.parse` makes `__proto__` an ordinary own property, so a file may
// legitimately carry it. Rebuilding a record with `target[key] = value`
// would instead hit `Object.prototype`'s `__proto__` setter: the field
// disappears and the accumulator's prototype is replaced by whatever the
// file said. That is both a round-trip hole and a prototype-pollution
// vector, and these tests pin the fix at every level that rebuilds a record.
const PROTO_TEXT = [
  '{"kind":"document","schemaVersion":1,"id":"01JP00000000000000000000AA","title":"T","__proto__":{"at":"document"}}',
  '{"kind":"page","id":"p1","name":"P","pageKind":"freeform","__proto__":{"at":"page"}}',
  '{"kind":"element","id":"n1","page":"p1","type":"node.generic","index":"a0","semantic":{"label":"L","__proto__":{"at":"semantic"}},"visual":{"x":1,"style":{"fill":"#000","__proto__":{"at":"style"}},"__proto__":{"at":"visual"}},"__proto__":{"at":"element"}}',
  '{"kind":"ghost","__proto__":{"at":"unknownRecord"},"keep":1}',
  "",
].join("\n");

describe("prototype-manipulating field names", () => {
  type Bag = Record<string, unknown>;

  function ownValue(bag: Bag, key: string): unknown {
    return Object.getOwnPropertyDescriptor(bag, key)?.value;
  }

  /** Every object the parser rebuilds field by field, keyed by level. */
  function bags(document: Document): Record<string, Bag> {
    const element = document.elements[0];
    const asBag = (value: unknown): Bag => value as Bag;
    return {
      document: asBag(document.extensions),
      page: asBag(document.pages[0]?.extensions),
      element: asBag(element?.extensions),
      semantic: asBag(element?.semantic),
      visual: asBag(element?.visual.extensions),
      style: asBag(element?.visual.style?.extensions),
      unknownRecord: asBag(document.unknownRecords?.[0]?.data),
    };
  }

  test("a __proto__ field is kept as an own property at every level", () => {
    const document = parseDocument(PROTO_TEXT);
    const at: Record<string, string> = {
      document: "document",
      page: "page",
      element: "element",
      semantic: "semantic",
      visual: "visual",
      style: "style",
      unknownRecord: "unknownRecord",
    };
    for (const [level, bag] of Object.entries(bags(document))) {
      expect({ level, own: Object.hasOwn(bag, "__proto__") }).toEqual({
        level,
        own: true,
      });
      expect({ level, value: ownValue(bag, "__proto__") }).toEqual({
        level,
        value: { at: at[level] },
      });
    }
  });

  test("no bag has its prototype replaced", () => {
    const document = parseDocument(PROTO_TEXT);
    for (const [level, bag] of Object.entries(bags(document))) {
      expect({ level, proto: Object.getPrototypeOf(bag) }).toEqual({
        level,
        proto: Object.prototype,
      });
    }
  });

  test("nothing leaks onto the global Object.prototype", () => {
    parseDocument(PROTO_TEXT);
    const probe: Record<string, unknown> = {};
    expect(Object.hasOwn(Object.prototype, "at")).toBe(false);
    expect(probe["at"]).toBeUndefined();
  });

  test("a __proto__ field survives a round trip byte-for-byte", () => {
    const document = parseDocument(PROTO_TEXT);
    const text = serializeDocument(document);
    for (const level of [
      "document",
      "page",
      "element",
      "semantic",
      "visual",
      "style",
      "unknownRecord",
    ]) {
      expect(text).toContain(`"__proto__":{"at":"${level}"}`);
    }
    expect(serializeDocument(parseDocument(text))).toBe(text);
  });

  test("other prototype-adjacent key names survive too", () => {
    // Already in canonical order (declared keys, then the rest sorted by
    // code unit) so byte equality is a real assertion about preservation.
    const text =
      '{"kind":"document","schemaVersion":1,"id":"d","title":"t","constructor":1,"hasOwnProperty":4,"prototype":2,"toString":3}\n';
    const document = parseDocument(text);
    expect(document.extensions).toEqual({
      constructor: 1,
      prototype: 2,
      toString: 3,
      hasOwnProperty: 4,
    });
    expect(serializeDocument(document)).toBe(text);
  });
});

// The tests above use primitive values, which return from writePrimitive
// before any nested key order is consulted. An OBJECT or ARRAY value is what
// makes the writer look the key up in `KeyOrder.children` — and a bare
// `children[key]` for `key === "constructor"` yields the global `Object`,
// whose `.keys` is a function, so `new Set(...)` on it throws. Object-valued
// is the load-bearing detail in every case below.
describe("prototype-adjacent field names with object values", () => {
  const HEAD =
    '{"kind":"document","schemaVersion":1,"id":"d","title":"t"}\n' +
    '{"kind":"page","id":"p1","name":"P","pageKind":"erd"}\n';

  // Each case is written in canonical form so byte equality is meaningful:
  // "constructor" sorts after the declared keys and before other extras
  // beginning with a lowercase letter later in the alphabet.
  const CASES: Record<string, string> = {
    "on an element record": `${HEAD}{"kind":"element","id":"e1","page":"p1","type":"node.generic","index":"a1","semantic":{"label":"x"},"visual":{"x":1},"constructor":{"a":1}}\n`,
    "on an element record, array-valued": `${HEAD}{"kind":"element","id":"e1","page":"p1","type":"node.generic","index":"a1","semantic":{"label":"x"},"constructor":[{"a":1}]}\n`,
    "inside visual": `${HEAD}{"kind":"element","id":"e1","page":"p1","type":"node.generic","index":"a1","semantic":{"label":"x"},"visual":{"x":1,"constructor":{"a":1}}}\n`,
    "inside a registered semantic payload": `${HEAD}{"kind":"element","id":"e1","page":"p1","type":"text.note","index":"a1","semantic":{"text":"hi","constructor":{"a":1}}}\n`,
    "inside visual.style": `${HEAD}{"kind":"element","id":"e1","page":"p1","type":"node.generic","index":"a1","semantic":{"label":"x"},"visual":{"style":{"fill":"#000","constructor":{"a":1}}}}\n`,
    "on a page record": `{"kind":"document","schemaVersion":1,"id":"d","title":"t"}\n{"kind":"page","id":"p1","name":"P","pageKind":"erd","constructor":{"a":1}}\n`,
    "on an unknown record kind": `{"kind":"document","schemaVersion":1,"id":"d","title":"t"}\n{"kind":"ghost","constructor":{"a":1}}\n`,
    "inside a nested unknown value": `${HEAD}{"kind":"element","id":"e1","page":"p1","type":"node.generic","index":"a1","semantic":{"label":"x"},"deep":{"constructor":{"a":1}}}\n`,
    "under a valueOf key": `${HEAD}{"kind":"element","id":"e1","page":"p1","type":"node.generic","index":"a1","semantic":{"label":"x"},"valueOf":{"a":1}}\n`,
    "under a toString key": `${HEAD}{"kind":"element","id":"e1","page":"p1","type":"node.generic","index":"a1","semantic":{"label":"x"},"toString":{"a":1}}\n`,
  };

  for (const [name, text] of Object.entries(CASES)) {
    test(`parses, serializes and round-trips ${name}`, () => {
      const result = parseDocumentResult(text);
      expect(result.ok).toBe(true);

      const document = result.document as Document;
      let written: string | undefined;
      expect(() => {
        written = serializeDocument(document);
      }).not.toThrow();

      // Preserved, byte-for-byte, and stable on a second pass.
      expect(written).toBe(text);
      expect(serializeDocument(parseDocument(written as string))).toBe(text);
    });
  }

  test("a declared key is never satisfied by Object.prototype", () => {
    // `visual` declares x/y/width/height/rotation/style. None is present
    // here, and none may be picked up off the prototype chain either.
    const text = `${HEAD}{"kind":"element","id":"e1","page":"p1","type":"node.generic","index":"a1","semantic":{"label":"x"},"visual":{"constructor":{"a":1}}}\n`;
    expect(serializeDocument(parseDocument(text))).toBe(text);
  });
});

describe("extreme but finite coordinates", () => {
  // Scaling by 100 overflows above MAX_VALUE / 100. When that turned a
  // finite coordinate into Infinity, the writer emitted `null` — so
  // serializeDocument certified a document through assertValidDocument and
  // then wrote a file parseDocument refuses to reopen.
  const HEAD =
    '{"kind":"document","schemaVersion":1,"id":"d","title":"t"}\n' +
    '{"kind":"page","id":"p","name":"P","pageKind":"erd"}\n';

  const CASES: Record<string, string> = {
    "visual.x": `${HEAD}{"kind":"element","id":"e1","page":"p","type":"node.generic","index":"a0","semantic":{"label":"x"},"visual":{"x":1e307,"y":0}}\n`,
    "a draw.freehand point": `${HEAD}{"kind":"element","id":"e1","page":"p","type":"draw.freehand","index":"a0","semantic":{"points":[{"x":1e308,"y":2}]}}\n`,
    "visual.width at MAX_VALUE": `${HEAD}{"kind":"element","id":"e1","page":"p","type":"node.generic","index":"a0","semantic":{"label":"x"},"visual":{"width":1.7976931348623157e308}}\n`,
    "a negative extreme": `${HEAD}{"kind":"element","id":"e1","page":"p","type":"node.generic","index":"a0","semantic":{"label":"x"},"visual":{"x":-1e307}}\n`,
  };

  for (const [name, text] of Object.entries(CASES)) {
    test(`${name} survives a write without becoming null`, () => {
      const parsed = parseDocumentResult(text);
      expect(parsed.ok).toBe(true);

      const written = serializeDocument(parsed.document as Document);
      expect(written).not.toContain("null");

      // The loop that was broken: the writer's own output must be
      // acceptable to the reader.
      const reparsed = parseDocumentResult(written);
      expect({ name, ok: reparsed.ok, issues: reparsed.issues }).toEqual({
        name,
        ok: true,
        issues: [],
      });

      expect(serializeDocument(reparsed.document as Document)).toBe(written);
    });
  }

  test("the coordinate value itself is preserved, not merely finite", () => {
    const document = parseDocument(CASES["visual.x"] as string);
    expect(document.elements[0]?.visual.x).toBe(1e307);
    expect(serializeDocument(document)).toContain('"x":1e+307');
  });

  test("literals outside the double range are lost by JSON.parse, not by us", () => {
    // Documented in packages/io/README.md under "Numeric fidelity". Pinned
    // here so the docs cannot drift from the behaviour. These arrive already
    // destroyed: the writer never sees the original literal.
    expect(JSON.parse("1e400")).toBe(Number.POSITIVE_INFINITY);
    expect(JSON.parse("1e-400")).toBe(0);

    const text = `${HEAD}{"kind":"element","id":"e1","page":"p","type":"z.unknown","index":"a0","semantic":{"big":1e400,"denorm":1e-400,"neg":-1e400,"tiny":-0}}\n`;
    const once = serializeDocument(parseDocument(text));
    expect(once).toContain(
      '"semantic":{"big":null,"denorm":0,"neg":null,"tiny":0}',
    );
    // Converges on the first write and is stable from then on.
    expect(serializeDocument(parseDocument(once))).toBe(once);
    expect(parseDocumentResult(once).ok).toBe(true);
  });
});

describe("a non-object visual", () => {
  // parseVisual keeps it verbatim so validation can name the bad value;
  // serializeDocument must therefore write it back unchanged rather than
  // silently deleting the field.
  const badVisual =
    '{"kind":"document","schemaVersion":1,"id":"d","title":"t"}\n' +
    '{"kind":"page","id":"p1","name":"P","pageKind":"erd"}\n' +
    '{"kind":"element","id":"n1","page":"p1","type":"node.generic","index":"a0","semantic":{"label":"x"},"visual":5}\n';

  test("is rejected by default", () => {
    const result = parseDocumentResult(badVisual);
    expect(result.ok).toBe(false);
    expect(issueCodes(result.issues)).toContain("type.object");
  });

  test("round-trips unchanged when validation is off at both ends", () => {
    const result = parseDocumentResult(badVisual, { validate: false });
    expect(result.ok).toBe(true);
    const document = result.document as Document;
    expect(document.elements[0]?.visual).toBe(
      5 as unknown as Document["elements"][number]["visual"],
    );
    expect(serializeDocument(document, { validate: false })).toBe(badVisual);
  });

  test("a malformed style follows the same contract", () => {
    const badStyle = badVisual.replace(
      '"visual":5',
      '"visual":{"x":1,"style":"chunky"}',
    );
    const result = parseDocumentResult(badStyle, { validate: false });
    expect(result.ok).toBe(true);
    expect(
      serializeDocument(result.document as Document, { validate: false }),
    ).toBe(badStyle);
  });

  test("a null visual is preserved rather than collapsed to absent", () => {
    const nullVisual = badVisual.replace('"visual":5', '"visual":null');
    const result = parseDocumentResult(nullVisual, { validate: false });
    expect(result.ok).toBe(true);
    expect(
      serializeDocument(result.document as Document, { validate: false }),
    ).toBe(nullVisual);
  });

  test("an absent visual stays absent, and an empty one is dropped", () => {
    const absent =
      '{"kind":"document","schemaVersion":1,"id":"d","title":"t"}\n' +
      '{"kind":"page","id":"p1","name":"P","pageKind":"erd"}\n' +
      '{"kind":"element","id":"n1","page":"p1","type":"node.generic","index":"a0","semantic":{"label":"x"}}\n';
    expect(serializeDocument(parseDocument(absent))).toBe(absent);
    const empty = absent.replace(
      '"semantic":{"label":"x"}}',
      '"semantic":{"label":"x"},"visual":{}}',
    );
    expect(empty).not.toBe(absent);
    expect(serializeDocument(parseDocument(empty))).toBe(absent);
  });
});

describe("parseDocument input tolerance", () => {
  const canonical = serializeDocument(parseDocument(FORWARD_TEXT));

  test("accepts CRLF line endings", () => {
    expect(parseDocument(canonical.replace(/\n/g, "\r\n"))).toEqual(
      parseDocument(canonical),
    );
  });

  test("accepts a leading BOM", () => {
    expect(parseDocument(`\uFEFF${canonical}`)).toEqual(
      parseDocument(canonical),
    );
  });

  test("skips blank lines", () => {
    const padded = `\n${canonical.replace(/\n/g, "\n\n")}\n   \n`;
    expect(parseDocument(padded)).toEqual(parseDocument(canonical));
  });
});

describe("parseDocument errors", () => {
  function codesFor(text: string): string[] {
    const result = parseDocumentResult(text);
    expect(result.ok).toBe(false);
    return issueCodes(result.issues);
  }

  test("reports the line number of malformed JSON", () => {
    const result = parseDocumentResult(
      '{"kind":"document","schemaVersion":1,"id":"d","title":"t"}\nnot json\n',
    );
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("json.invalid");
    expect(result.issues[0]?.path).toBe("line 2");
  });

  test("rejects a file with no document record", () => {
    expect(
      codesFor('{"kind":"page","id":"p1","name":"P","pageKind":"erd"}\n'),
    ).toContain("record.documentMissing");
  });

  test("rejects a second document record", () => {
    const text =
      '{"kind":"document","schemaVersion":1,"id":"a","title":"t"}\n' +
      '{"kind":"document","schemaVersion":1,"id":"b","title":"t"}\n';
    expect(codesFor(text)).toContain("record.duplicateDocument");
  });

  test("rejects non-object records", () => {
    expect(
      codesFor(
        '{"kind":"document","schemaVersion":1,"id":"a","title":"t"}\n[1,2]\n',
      ),
    ).toContain("record.notObject");
  });

  test("rejects records without a kind", () => {
    expect(
      codesFor(
        '{"kind":"document","schemaVersion":1,"id":"a","title":"t"}\n{"id":"x"}\n',
      ),
    ).toContain("record.kindMissing");
  });

  test("rejects duplicate element ids", () => {
    const text =
      '{"kind":"document","schemaVersion":1,"id":"a","title":"t"}\n' +
      '{"kind":"page","id":"p1","name":"P","pageKind":"erd"}\n' +
      '{"kind":"element","id":"n1","page":"p1","type":"node.generic","index":"a0","semantic":{"label":"x"}}\n' +
      '{"kind":"element","id":"n1","page":"p1","type":"node.generic","index":"a1","semantic":{"label":"y"}}\n';
    expect(codesFor(text)).toContain("id.duplicate");
  });

  test("rejects an element pointing at a missing page", () => {
    const text =
      '{"kind":"document","schemaVersion":1,"id":"a","title":"t"}\n' +
      '{"kind":"element","id":"n1","page":"ghost","type":"node.generic","index":"a0","semantic":{"label":"x"}}\n';
    expect(codesFor(text)).toContain("reference.missingPage");
  });

  test("rejects a document written by a newer schema version", () => {
    const text =
      '{"kind":"document","schemaVersion":99,"id":"a","title":"t"}\n';
    const result = parseDocumentResult(text);
    expect(result.ok).toBe(false);
    expect(issueCodes(result.issues)).toContain("schema.migration");
    expect(result.issues[0]?.message).toContain("newer than the supported");
  });

  test("parseDocument throws DocumentParseError carrying the issues", () => {
    let thrown: unknown;
    try {
      parseDocument("garbage\n");
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBeInstanceOf(DocumentParseError);
    expect((thrown as DocumentParseError).issues.length).toBeGreaterThan(0);
  });
});

describe("coordinate rounding", () => {
  const document: Document = {
    schemaVersion: 1,
    id: "01JRND00000000000000000000",
    title: "Rounding",
    pages: [{ id: "p1", name: "P", kind: "freeform" }],
    elements: [
      {
        id: "n1",
        page: "p1",
        type: "node.generic",
        index: "a0",
        semantic: { label: "x" },
        visual: {
          x: 10.123456,
          y: -0.001,
          width: 99.995,
          height: 0.004,
          rotation: 44.999,
        },
      },
    ],
  };

  test("rounds visual coordinates to 0.01 and normalizes -0", () => {
    expect(serializeDocument(document)).toContain(
      '"visual":{"x":10.12,"y":0,"width":100,"height":0,"rotation":45}',
    );
  });

  test("leaves non-coordinate numbers alone", () => {
    const withPressure: Document = {
      ...document,
      elements: [
        {
          id: "d1",
          page: "p1",
          type: "draw.freehand",
          index: "a0",
          semantic: { points: [{ x: 1.239, y: 2.001, pressure: 0.123456 }] },
          visual: {},
        },
      ],
    };
    expect(serializeDocument(withPressure)).toContain(
      '{"x":1.24,"y":2,"pressure":0.123456}',
    );
  });
});
