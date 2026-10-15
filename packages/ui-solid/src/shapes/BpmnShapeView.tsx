import { bpmnNotation, type NotationPrimitive } from "@nodetto/core";
import type { Box } from "@nodetto/core";
import type { Element } from "@nodetto/ir";
import { For, type JSX, Match, Switch } from "solid-js";
import { primitiveAttributes } from "./bpmn-primitive.ts";

export interface BpmnShapeViewProps {
  readonly element: Element;
  readonly box: Box;
}

export function BpmnNotationPrimitiveView(props: {
  readonly primitive: NotationPrimitive;
}): JSX.Element {
  const mapped = () => primitiveAttributes(props.primitive);
  return (
    <Switch>
      <Match when={props.primitive.kind === "rect"}>
        <rect {...mapped().attrs} />
      </Match>
      <Match when={props.primitive.kind === "circle"}>
        <circle {...mapped().attrs} />
      </Match>
      <Match when={props.primitive.kind === "path"}>
        <path {...mapped().attrs} />
      </Match>
      <Match when={props.primitive.kind === "polygon"}>
        <polygon {...mapped().attrs} />
      </Match>
      <Match when={props.primitive.kind === "text"}>
        <text {...mapped().attrs}>
          <For
            each={props.primitive.kind === "text" ? props.primitive.lines : []}
          >
            {(line, index) => (
              <tspan
                x={props.primitive.kind === "text" ? props.primitive.x : 0}
                dy={
                  index() === 0 || props.primitive.kind !== "text"
                    ? 0
                    : props.primitive.lineHeight
                }
              >
                {line}
              </tspan>
            )}
          </For>
        </text>
      </Match>
    </Switch>
  );
}

export function BpmnShapeView(props: BpmnShapeViewProps): JSX.Element {
  const primitives = () => bpmnNotation(props.element, props.box);
  return (
    <svg
      class="nodetto-bpmn"
      width={props.box.width}
      height={props.box.height}
      viewBox={`0 0 ${props.box.width} ${props.box.height}`}
      preserveAspectRatio="none"
      style={{
        overflow: "visible",
        position: "absolute",
        left: 0,
        top: 0,
        "pointer-events": "none",
      }}
    >
      <title>{props.element.type}</title>
      <For each={primitives()}>
        {(primitive) => <BpmnNotationPrimitiveView primitive={primitive} />}
      </For>
    </svg>
  );
}
