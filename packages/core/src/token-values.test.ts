import { expect, test } from "bun:test";
import { document, element, makeEditor, TEST_PAGE } from "./test-helpers.ts";
import {
  activeTokenAlias,
  designTokenModes,
  resolveColorToken,
} from "./token-values.ts";

test("imported alias cycles and wrong-kind targets use the root portable fallback", () => {
  const editor = makeEditor({
    document: document([
      element({
        id: "a",
        type: "design.token",
        semantic: {
          name: "A",
          kind: "color",
          value: "#111111",
          alias: "b",
        },
      }),
      element({
        id: "b",
        type: "design.token",
        semantic: {
          name: "B",
          kind: "color",
          value: "#222222",
          alias: "a",
        },
      }),
      element({
        id: "number",
        type: "design.token",
        semantic: { name: "Number", kind: "number", value: 8 },
      }),
      element({
        id: "wrong",
        type: "design.token",
        semantic: {
          name: "Wrong",
          kind: "color",
          value: "#abcdef",
          alias: "number",
        },
      }),
    ]),
  });
  expect(resolveColorToken(editor.store, "a", TEST_PAGE.id)).toEqual({
    value: "#111111",
    aliased: true,
    broken: true,
    chain: ["a", "b"],
  });
  expect(resolveColorToken(editor.store, "wrong", TEST_PAGE.id)).toEqual({
    value: "#abcdef",
    aliased: true,
    broken: true,
    chain: ["wrong", "number"],
  });
});

test("mode discovery includes page-only modes and literal overrides hide default aliases", () => {
  const editor = makeEditor({
    document: document(
      [
        element({
          id: "token",
          type: "design.token",
          semantic: {
            name: "Action",
            kind: "color",
            value: "#111111",
            alias: "base",
            modes: [
              { name: "Dark", value: "#ffffff" },
              { name: "Android", alias: "mobile" },
            ],
          },
        }),
      ],
      [{ ...TEST_PAGE, tokenMode: "High contrast" }],
    ),
  });
  expect(designTokenModes(editor.store)).toEqual([
    "Android",
    "Dark",
    "High contrast",
  ]);
  const semantic = editor.store.get("token")?.semantic as Parameters<
    typeof activeTokenAlias
  >[0];
  expect(activeTokenAlias(semantic, "Dark")).toBeNull();
  expect(activeTokenAlias(semantic, "Android")).toBe("mobile");
  expect(activeTokenAlias(semantic, undefined)).toBe("base");
});
