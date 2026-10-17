import { expect, test } from "bun:test";
import { Editor } from "./editor.ts";
import { generateInterfaceCode } from "./interface-code.ts";
import { fontFamilyCss } from "./css-font-family.ts";
import { typographyCssValue } from "./token-handoff.ts";
test("CSS handoff preserves generic fonts and quoted font stacks", () => {
  expect(fontFamilyCss("sans-serif")).toBe("sans-serif");
  expect(fontFamilyCss('"A, B", Arial, sans-serif')).toBe(
    '"A, B", "Arial", sans-serif',
  );
  expect(typographyCssValue("fontFamily", "Arial, sans-serif")).toBe(
    '"Arial", sans-serif',
  );
  const editor = new Editor();
  const root = editor.createElement("frame", {
    semantic: { name: "Page" },
    visual: { width: 300, height: 200 },
  });
  editor.createElement("text.note", {
    semantic: { text: "Imported type" },
    visual: {
      x: 10,
      y: 10,
      width: 200,
      height: 40,
      style: { fontFamily: "Arial, sans-serif" },
    },
  });
  const code = generateInterfaceCode(editor, root);
  expect(code?.css).toContain('font-family: "Arial", sans-serif;');
  expect(code?.linkedCss).toContain('font-family: "Arial", sans-serif;');
});
test("font family names cannot terminate a CSS declaration or style tag", () => {
  const value = fontFamilyCss('Name"; color:red; } </style>');
  expect(value).toContain("\\22 ");
  expect(value).not.toContain("</style>");
  expect(value.startsWith('"')).toBe(true);
  expect(value.endsWith('"')).toBe(true);
});
