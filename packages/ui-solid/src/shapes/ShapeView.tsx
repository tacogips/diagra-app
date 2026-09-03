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
import type { Element } from "@diagra/ir";
import { type JSX, Match, Show, Switch } from "solid-js";
import { ErdTableView } from "./ErdTableView.tsx";
import { GeoShapeView } from "./GeoShapeView.tsx";
import { NodeView } from "./NodeView.tsx";
import { TextNoteView } from "./TextNoteView.tsx";
import { UmlClassView } from "./UmlClassView.tsx";
import { rotationStyle } from "./visual.ts";

export interface ShapeViewProps {
  readonly element: Element;
  readonly box: Box;
  readonly selected: boolean;
}

export function ShapeView(props: ShapeViewProps): JSX.Element {
  return (
    <Show when={props.element.type !== "group"}>
      <div
        class="diagra-shape"
        classList={{ "diagra-selected": props.selected }}
        data-element-id={props.element.id}
        data-element-type={props.element.type}
        style={{
          left: `${props.box.x}px`,
          top: `${props.box.y}px`,
          width: `${props.box.width}px`,
          height: `${props.box.height}px`,
          ...rotationStyle(props.element.visual),
        }}
      >
        <Switch
          fallback={
            <div class="diagra-unknown">{`unsupported: ${props.element.type}`}</div>
          }
        >
          <Match when={props.element.type === "shape.geo"}>
            <GeoShapeView element={props.element} box={props.box} />
          </Match>
          <Match when={props.element.type === "node.generic"}>
            <NodeView element={props.element} />
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
