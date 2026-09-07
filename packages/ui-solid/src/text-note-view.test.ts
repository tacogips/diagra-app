import { expect, test } from "bun:test";
import {
  textMarkStyle,
  textNoteStyle,
  textNoteWhiteSpace,
} from "./shapes/TextNoteView.tsx";

test("auto width preserves explicit lines while other text boxes wrap", () => {
  expect(textNoteWhiteSpace("auto-width")).toBe("pre");
  expect(textNoteWhiteSpace("auto-height")).toBe("pre-wrap");
  expect(textNoteWhiteSpace("fixed")).toBe("pre-wrap");
  expect(textNoteWhiteSpace(undefined)).toBe("pre-wrap");
  expect(
    textNoteStyle({
      id: "text",
      page: "page",
      type: "text.note",
      index: "a1",
      semantic: { text: "Intrinsic" },
      visual: { textResize: "auto-width" },
    }),
  ).toEqual({ "white-space": "pre" });
});

test("rich text marks map to composable inline canvas styles", () => {
  expect(
    textMarkStyle([
      { start: 0, end: 4, kind: "bold" },
      { start: 0, end: 4, kind: "italic" },
      { start: 0, end: 4, kind: "code" },
      { start: 0, end: 4, kind: "strike" },
      { start: 0, end: 4, kind: "underline" },
      { start: 0, end: 4, kind: "link", href: "https://diagra.app" },
    ]),
  ).toMatchObject({
    "font-weight": 700,
    "font-style": "italic",
    "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
    color: "var(--diagra-accent)",
    "text-decoration-line": "underline line-through",
  });
});
