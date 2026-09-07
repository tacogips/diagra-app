// Dispatch from element type to view, plus the positioned wrapper every
// box-shaped element shares.
//
// The wrapper is `pointer-events: none`: picking is the core's job, so a
// click on the transparent corner of an ellipse must miss it. Letting the
// DOM decide would silently disagree with `hitTestPoint`.
//
// A group gets no DOM at all (design editor-ux.md section 7): it exists for
// selection and transformation only, and its members draw themselves.

import type { Box } from "@diagra/core";
import type { AccessibilityRole, Element } from "@diagra/ir";
import { type JSX, Match, Show, Switch } from "solid-js";
import { ErdTableView } from "./ErdTableView.tsx";
import { FrameView } from "./FrameView.tsx";
import { FreehandView } from "./FreehandView.tsx";
import { CompoundPathView } from "./CompoundPathView.tsx";
import { ImageView } from "./ImageView.tsx";
import { GeoShapeView } from "./GeoShapeView.tsx";
import { NodeView } from "./NodeView.tsx";
import { SequenceParticipantView } from "./SequenceParticipantView.tsx";
import { TextNoteView } from "./TextNoteView.tsx";
import { UmlClassView } from "./UmlClassView.tsx";
import { layerAppearanceStyle } from "./visual.ts";

export interface ShapeViewProps {
  readonly element: Element;
  readonly box: Box;
  readonly selected: boolean;
  /** Construction guides are canvas-only and excluded from preview/export. */
  readonly showLayoutGrids?: boolean;
  /** Expose authored semantics in interactive prototype DOM, not editor chrome. */
  readonly exposeAccessibility?: boolean;
}

const HTML_ROLES: Partial<
  Record<AccessibilityRole, JSX.AriaAttributes["role"]>
> = {
  button: "button",
  link: "link",
  image: "img",
  heading: "heading",
  textbox: "textbox",
  checkbox: "checkbox",
  switch: "switch",
  navigation: "navigation",
  main: "main",
  region: "region",
  group: "group",
  list: "list",
  "list-item": "listitem",
};

function htmlRole(element: Element): JSX.AriaAttributes["role"] {
  const role = element.accessibility?.role;
  if (!role) return undefined;
  return HTML_ROLES[role];
}

function descriptionId(element: Element): string {
  return `diagra-a11y-${Array.from(element.id, (character) =>
    character.codePointAt(0)?.toString(16),
  ).join("-")}`;
}

function accessibilityDescription(element: Element): string | undefined {
  const description = [
    element.accessibility?.hint,
    element.accessibility?.value
      ? `Current value: ${element.accessibility.value}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return description || undefined;
}

export function ShapeView(props: ShapeViewProps): JSX.Element {
  return (
    <Show when={props.element.type !== "group"}>
      <div
        class="diagra-shape"
        classList={{ "diagra-selected": props.selected }}
        data-element-id={props.element.id}
        data-element-type={props.element.type}
        role={props.exposeAccessibility ? htmlRole(props.element) : undefined}
        aria-hidden={
          props.exposeAccessibility && props.element.accessibility?.decorative
            ? "true"
            : undefined
        }
        aria-label={
          props.exposeAccessibility && !props.element.accessibility?.decorative
            ? props.element.accessibility?.label
            : undefined
        }
        aria-describedby={
          props.exposeAccessibility &&
          !props.element.accessibility?.decorative &&
          accessibilityDescription(props.element)
            ? descriptionId(props.element)
            : undefined
        }
        aria-disabled={
          props.exposeAccessibility && props.element.accessibility?.disabled
            ? "true"
            : undefined
        }
        aria-level={
          props.exposeAccessibility
            ? props.element.accessibility?.headingLevel
            : undefined
        }
        style={{
          left: `${props.box.x}px`,
          top: `${props.box.y}px`,
          width: `${props.box.width}px`,
          height: `${props.box.height}px`,
          ...layerAppearanceStyle(props.element.visual),
        }}
      >
        <Show
          when={
            props.exposeAccessibility &&
            !props.element.accessibility?.decorative
              ? accessibilityDescription(props.element)
              : undefined
          }
        >
          {(hint) => (
            <span
              id={descriptionId(props.element)}
              style={{
                position: "absolute",
                width: "1px",
                height: "1px",
                padding: 0,
                margin: "-1px",
                overflow: "hidden",
                clip: "rect(0, 0, 0, 0)",
                "white-space": "nowrap",
                border: 0,
              }}
            >
              {hint()}
            </span>
          )}
        </Show>
        <Switch
          fallback={
            <div class="diagra-unknown">{`unsupported: ${props.element.type}`}</div>
          }
        >
          <Match when={props.element.type === "shape.geo"}>
            <GeoShapeView element={props.element} box={props.box} />
          </Match>
          <Match when={props.element.type === "frame"}>
            <FrameView
              element={props.element}
              showLayoutGrids={props.showLayoutGrids}
            />
          </Match>
          <Match when={props.element.type === "draw.freehand"}>
            <FreehandView element={props.element} />
          </Match>
          <Match when={props.element.type === "draw.path"}>
            <CompoundPathView element={props.element} />
          </Match>
          <Match when={props.element.type === "image.raster"}>
            <ImageView element={props.element} />
          </Match>
          <Match when={props.element.type === "node.generic"}>
            <NodeView element={props.element} />
          </Match>
          <Match when={props.element.type === "sequence.participant"}>
            <SequenceParticipantView element={props.element} />
          </Match>
          <Match when={props.element.type === "sequence.activation"}>
            <div class="diagra-sequence-activation" />
          </Match>
          <Match when={props.element.type === "text.note"}>
            <TextNoteView element={props.element} />
          </Match>
          <Match when={props.element.type === "erd.table"}>
            <ErdTableView element={props.element} />
          </Match>
          <Match when={props.element.type === "uml.class"}>
            <UmlClassView element={props.element} />
          </Match>
        </Switch>
      </div>
    </Show>
  );
}
