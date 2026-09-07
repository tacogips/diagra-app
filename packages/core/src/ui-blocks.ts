import type { FrameLayout, VisualStyle } from "@diagra/ir";
import type { Editor } from "./editor.ts";
import type { Vec } from "./geometry.ts";

export const UI_BLOCKS = ["button", "input", "card", "navigation"] as const;
export type UiBlock = (typeof UI_BLOCKS)[number];

/** UI blocks are ordinary editable components, not opaque widgets. */
export function insertUiBlock(editor: Editor, kind: UiBlock, at: Vec): string {
  const horizontal = kind !== "card";
  const size =
    kind === "button"
      ? { width: 168, height: 48 }
      : kind === "input"
        ? { width: 320, height: 56 }
        : kind === "card"
          ? { width: 320, height: 224 }
          : { width: 720, height: 64 };
  const padding = kind === "card" ? 24 : kind === "button" ? 8 : 12;
  const title = {
    button: "Primary button",
    input: "Text input",
    card: "Content card",
    navigation: "Navigation bar",
  }[kind];
  const labels =
    kind === "button"
      ? [
          {
            key: "label",
            text: "Continue",
            width: 152,
            height: 32,
            size: 14,
            weight: 600,
          },
        ]
      : kind === "input"
        ? [
            {
              key: "placeholder",
              text: "Enter your email",
              width: 296,
              height: 32,
              size: 14,
              weight: 400,
            },
          ]
        : kind === "card"
          ? [
              {
                key: "title",
                text: "Your next project",
                width: 272,
                height: 40,
                size: 20,
                weight: 600,
              },
              {
                key: "description",
                text: "Add a clear description of what this card offers.",
                width: 272,
                height: 60,
                size: 14,
                weight: 400,
              },
              {
                key: "action",
                text: "View details →",
                width: 272,
                height: 32,
                size: 14,
                weight: 600,
              },
            ]
          : [
              {
                key: "brand",
                text: "Studio",
                width: 192,
                height: 40,
                size: 20,
                weight: 700,
              },
              ...["Product", "About", "Contact"].map((text) => ({
                key: text.toLowerCase(),
                text,
                width: 112,
                height: 40,
                size: 14,
                weight: 500,
              })),
            ];
  const children = labels.map((label) =>
    editor.buildElement("text.note", {
      semantic: { text: label.text },
      visual: {
        x: at.x + padding,
        y: at.y + padding,
        width: label.width,
        height: label.height,
        componentKey: label.key,
        style: {
          fill: "none",
          stroke: "none",
          strokeWidth: 0,
          color:
            kind === "button"
              ? "#ffffff"
              : label.key === "placeholder"
                ? "#64748b"
                : "#0f172a",
          fontFamily: "system-ui",
          fontSize: label.size,
          fontWeight: label.weight,
          lineHeight: 1.4,
          textAlign: kind === "button" ? "middle" : "start",
        },
      },
    }),
  );
  const layout: FrameLayout = {
    direction: horizontal ? "horizontal" : "vertical",
    padding,
    gap: kind === "card" ? 12 : 16,
    align: "center",
    sizing: "fixed",
  };
  const style: VisualStyle = {
    fill: kind === "button" ? "#2563eb" : "#ffffff",
    stroke: kind === "button" ? "#2563eb" : "#cbd5e1",
    strokeWidth: 1,
    cornerRadius: kind === "navigation" ? 0 : kind === "card" ? 16 : 8,
  };
  const frame = editor.buildElement("frame", {
    semantic: {
      name: title,
      showTitle: false,
      component: true,
      memberIds: children.map((child) => child.id),
      layout,
    },
    visual: { ...at, ...size, style },
  });
  editor.apply([
    { type: "createElement", element: frame },
    ...children.map((element) => ({
      type: "createElement" as const,
      element: { ...element, index: editor.nextIndex() },
    })),
  ]);
  editor.selection.set([frame.id]);
  return frame.id;
}
