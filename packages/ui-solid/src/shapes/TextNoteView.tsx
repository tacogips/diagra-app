// text.note: free text in a box. Plain DOM with `pre-wrap`, so line breaks
// the user typed survive and long lines wrap at the box edge; the box clips
// whatever does not fit, matching the core's bounds. The background is
// transparent unless the document gives the note a fill, so a note sits on
// the canvas like writing rather than like another shape.

import { richTextSegments, textNoteText } from "@diagra/core";
import type { Element, TextMark } from "@diagra/ir";
import { For, type JSX } from "solid-js";
import {
  fillPaintStyle,
  strokeBorderStyle,
  typographyStyle,
} from "./visual.ts";

export function textNoteWhiteSpace(
  mode: Element["visual"]["textResize"],
): "pre" | "pre-wrap" {
  return mode === "auto-width" ? "pre" : "pre-wrap";
}

export interface TextNoteViewProps {
  readonly element: Element;
}

export function textMarkStyle(marks: readonly TextMark[]): JSX.CSSProperties {
  const kinds = new Set(marks.map((mark) => mark.kind));
  return {
    ...(kinds.has("bold") ? { "font-weight": 700 } : {}),
    ...(kinds.has("italic") ? { "font-style": "italic" } : {}),
    ...(kinds.has("code")
      ? {
          "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
          background: "color-mix(in srgb, currentColor 10%, transparent)",
          "border-radius": "2px",
        }
      : {}),
    ...(kinds.has("strike") ? { "text-decoration-line": "line-through" } : {}),
    ...(kinds.has("underline")
      ? {
          "text-decoration-line": kinds.has("strike")
            ? "underline line-through"
            : "underline",
        }
      : {}),
    ...(kinds.has("link")
      ? {
          color: "var(--diagra-accent)",
          "text-decoration-line": kinds.has("strike")
            ? "underline line-through"
            : "underline",
        }
      : {}),
  };
}

export function textNoteStyle(element: Element): JSX.CSSProperties {
  const style = element.visual.style;
  if (!style) {
    return { "white-space": textNoteWhiteSpace(element.visual.textResize) };
  }
  return {
    display: "flex",
    "flex-direction": "column",
    ...typographyStyle(element.visual),
    ...(style.color === undefined ? {} : { color: style.color }),
    ...(style.fontSize === undefined
      ? {}
      : { "font-size": `${style.fontSize}px` }),
    ...(style.textAlign === undefined
      ? {}
      : {
          "text-align":
            style.textAlign === "start"
              ? "left"
              : style.textAlign === "end"
                ? "right"
                : "center",
        }),
    ...(style.fill === undefined && style.fillGradient === undefined
      ? {}
      : fillPaintStyle(element.visual)),
    ...strokeBorderStyle(element.visual),
    "white-space": textNoteWhiteSpace(element.visual.textResize),
  };
}

export function TextNoteView(props: TextNoteViewProps): JSX.Element {
  const text = () => textNoteText(props.element.semantic);
  const segments = () => richTextSegments(props.element.semantic);
  return (
    <div
      class="diagra-text-note"
      data-smart-paint="box"
      data-smart-text
      classList={{ "diagra-text-note-empty": text() === "" }}
      style={textNoteStyle(props.element)}
    >
      <span
        style={{
          "flex-shrink": 0,
          "margin-top":
            props.element.visual.style?.verticalAlign &&
            props.element.visual.style.verticalAlign !== "top"
              ? "auto"
              : "0",
          "margin-bottom":
            props.element.visual.style?.verticalAlign === "middle"
              ? "auto"
              : "0",
        }}
      >
        <For each={segments()}>
          {(segment) => (
            <span
              style={textMarkStyle(segment.marks)}
              data-rich-link={
                segment.marks.find((mark) => mark.kind === "link")?.href
              }
            >
              {segment.text}
            </span>
          )}
        </For>
      </span>
    </div>
  );
}
