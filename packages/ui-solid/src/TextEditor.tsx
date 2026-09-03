// Inline text editor (design editor-ux.md section 3.3).
//
// A textarea positioned in page space over the element's text, so it zooms
// with the canvas. It is mounted inside the viewport by the shell and lives
// for exactly one edit: Enter or blur commits through `editor.setText`
// (which costs no undo step when nothing changed), Escape restores, and
// `onDone` fires once either way. Pointer and key events stop here so the
// canvas underneath never mistakes typing for a shortcut or a click in the
// text for a drag; wheel events keep bubbling so the canvas can still zoom.

import {
  type EditableField,
  type Editor,
  ERD_TABLE_HEADER_HEIGHT,
  UML_CLASS_NAME_HEIGHT,
  umlNameHeight,
} from "@diagra/core";
import {
  type Element,
  type ElementId,
  getElementTypeDefinition,
} from "@diagra/ir";
import {
  createEffect,
  createMemo,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { createEditorSignals } from "./adapter.ts";

export interface TextEditorTarget {
  readonly id: ElementId;
  readonly field: EditableField;
}

export interface TextEditorProps {
  readonly editor: Editor;
  readonly target: TextEditorTarget;
  readonly onDone: () => void;
}

/** The stylesheet's shape font size; label styles override it. */
const BASE_FONT_SIZE = 13;
/** The connector label's font size in the stylesheet. */
const CONNECTOR_FONT_SIZE = 11;
const LINE_HEIGHT = 1.2;
const CONNECTOR_EDITOR_WIDTH = 160;

interface Placement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  readonly align: "left" | "center" | "right";
  readonly bold: boolean;
  readonly color: string | undefined;
  readonly padding: string;
}

function cssAlign(
  align: string | undefined,
  fallback: "left" | "center" | "right",
): "left" | "center" | "right" {
  switch (align) {
    case "start":
      return "left";
    case "middle":
      return "center";
    case "end":
      return "right";
    default:
      return fallback;
  }
}

function isComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/** Where the editor goes for this element, in page units. */
function placeEditor(
  editor: Editor,
  element: Element,
  field: EditableField,
): Placement | null {
  const box = editor.getBounds(element.id);
  if (!box) {
    return null;
  }
  const style = element.visual.style ?? {};
  const isEdge = getElementTypeDefinition(element.type)?.category === "edge";

  if (isEdge) {
    const fontSize = style.fontSize ?? CONNECTOR_FONT_SIZE;
    const height = fontSize * LINE_HEIGHT + 8;
    const centreX = box.x + box.width / 2;
    const centreY = box.y + box.height / 2;
    return {
      x: centreX - CONNECTOR_EDITOR_WIDTH / 2,
      y: centreY - height / 2 - 6,
      width: CONNECTOR_EDITOR_WIDTH,
      height,
      fontSize,
      align: "center",
      bold: false,
      color: style.color,
      padding: "4px 6px",
    };
  }

  if (element.type === "erd.table") {
    const height = ERD_TABLE_HEADER_HEIGHT;
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height,
      fontSize: BASE_FONT_SIZE,
      align: "left",
      bold: true,
      color: undefined,
      padding: `${(height - BASE_FONT_SIZE * LINE_HEIGHT) / 2}px 10px`,
    };
  }

  if (element.type === "uml.class") {
    const height = UML_CLASS_NAME_HEIGHT;
    return {
      x: box.x,
      y: box.y + umlNameHeight(element.semantic) - height,
      width: box.width,
      height,
      fontSize: BASE_FONT_SIZE,
      align: "center",
      bold: true,
      color: undefined,
      padding: `${(height - BASE_FONT_SIZE * LINE_HEIGHT) / 2}px 8px`,
    };
  }

  const fontSize = style.fontSize ?? BASE_FONT_SIZE;
  if (field === "text") {
    return {
      ...box,
      fontSize,
      align: cssAlign(style.textAlign, "left"),
      bold: false,
      color: style.color,
      padding: "6px 8px",
    };
  }

  // A label: a single line band centred in the box, so most of the shape
  // stays visible around it.
  const height = Math.min(box.height, fontSize * LINE_HEIGHT + 8);
  return {
    x: box.x + 4,
    y: box.y + (box.height - height) / 2,
    width: Math.max(24, box.width - 8),
    height,
    fontSize,
    align: cssAlign(style.textAlign, "center"),
    bold: false,
    color: style.color,
    padding: `${Math.max(0, (height - fontSize * LINE_HEIGHT) / 2)}px 4px`,
  };
}

export function TextEditor(props: TextEditorProps): JSX.Element {
  const signals = createEditorSignals(props.editor);
  let textarea: HTMLTextAreaElement | undefined;
  let done = false;
  const multiline = (): boolean => props.target.field === "text";
  const initial = props.editor.getText(props.target.id) ?? "";
  const previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  const placement = createMemo<Placement | null>(() => {
    signals.rev();
    const element = props.editor.store.get(props.target.id);
    return element
      ? placeEditor(props.editor, element, props.target.field)
      : null;
  });

  const finish = (commit: boolean, restoreFocus: boolean): void => {
    if (done) {
      return;
    }
    done = true;
    if (commit && textarea) {
      const raw = textarea.value;
      const value = multiline() ? raw : raw.replace(/\r?\n/g, " ");
      props.editor.setText(props.target.id, value);
    }
    props.onDone();
    if (restoreFocus && previouslyFocused?.isConnected) {
      previouslyFocused.focus();
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (isComposing(event)) {
      return;
    }
    if (event.key === "Enter") {
      if (multiline() && event.shiftKey) {
        return;
      }
      event.preventDefault();
      finish(true, true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false, true);
    }
  };

  // A pointer going down anywhere else ends the edit, whether or not the
  // browser gets to move focus: the canvas prevents the default on its own
  // pointerdown, so a blur cannot be relied on to arrive.
  const onOutsidePointerDown = (event: PointerEvent): void => {
    if (
      textarea &&
      event.target instanceof Node &&
      textarea.contains(event.target)
    ) {
      return;
    }
    finish(true, false);
  };

  // The element can vanish mid-edit (a remote delete, an undo): there is
  // nothing left to write to, so the edit ends without a commit.
  createEffect(() => {
    if (placement() === null) {
      finish(false, false);
    }
  });

  onMount(() => {
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
    if (textarea) {
      textarea.value = initial;
      textarea.focus();
      textarea.select();
    }
  });
  onCleanup(() => {
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
  });

  return (
    <Show when={placement()}>
      {(placed) => (
        <textarea
          ref={textarea}
          class="diagra-text-editor"
          classList={{ "diagra-text-editor-multiline": multiline() }}
          aria-label="Edit text"
          rows={1}
          spellcheck={false}
          wrap={multiline() ? "soft" : "off"}
          style={{
            left: `${placed().x}px`,
            top: `${placed().y}px`,
            width: `${placed().width}px`,
            height: `${placed().height}px`,
            "font-size": `${placed().fontSize}px`,
            "line-height": String(LINE_HEIGHT),
            "text-align": placed().align,
            "font-weight": placed().bold ? 700 : 400,
            padding: placed().padding,
            ...(placed().color === undefined ? {} : { color: placed().color }),
          }}
          on:keydown={onKeyDown}
          on:keyup={(event) => event.stopPropagation()}
          on:pointerdown={(event) => event.stopPropagation()}
          on:pointermove={(event) => event.stopPropagation()}
          on:pointerup={(event) => event.stopPropagation()}
          on:dblclick={(event) => event.stopPropagation()}
          on:contextmenu={(event) => event.stopPropagation()}
          on:blur={() => finish(true, false)}
        />
      )}
    </Show>
  );
}
