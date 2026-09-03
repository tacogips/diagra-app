// text.note: free text in a box. Plain DOM with `pre-wrap`, so line breaks
// the user typed survive and long lines wrap at the box edge; the box clips
// whatever does not fit, matching the core's bounds. The background is
// transparent unless the document gives the note a fill, so a note sits on
// the canvas like writing rather than like another shape.

import { textNoteText } from "@diagra/core";
import type { Element } from "@diagra/ir";
import type { JSX } from "solid-js";

export interface TextNoteViewProps {
  readonly element: Element;
}

function noteStyle(element: Element): JSX.CSSProperties {
  const style = element.visual.style;
  if (!style) {
    return {};
  }
  return {
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
    ...(style.fill === undefined ? {} : { background: style.fill }),
    ...(style.opacity === undefined ? {} : { opacity: style.opacity }),
  };
}

export function TextNoteView(props: TextNoteViewProps): JSX.Element {
  const text = () => textNoteText(props.element.semantic);
  return (
    <div
      class="diagra-text-note"
      classList={{ "diagra-text-note-empty": text() === "" }}
      style={noteStyle(props.element)}
    >
      {text()}
    </div>
  );
}
