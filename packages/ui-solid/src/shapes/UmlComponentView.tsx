import {
  UmlComponentType,
  type Element,
  type UmlInterfaceSemantic,
} from "@nodetto/ir";
import type { Box } from "@nodetto/core";
import { Show, type JSX } from "solid-js";

export function UmlComponentView(props: {
  element: Element;
  box: Box;
}): JSX.Element {
  const component = () => props.element.type === UmlComponentType.Component;
  const port = () => props.element.type === UmlComponentType.Port;
  const name = () => (props.element.semantic as { name: string }).name;
  const style = () => props.element.visual.style;
  return (
    <svg
      width="100%"
      height="100%"
      style={{ overflow: "visible" }}
      role="img"
      aria-label={name()}
    >
      <g
        fill={style()?.fill ?? "var(--nodetto-surface, white)"}
        stroke={style()?.stroke ?? "var(--nodetto-ink, #334155)"}
        stroke-width={style()?.strokeWidth ?? 1.5}
      >
        <Show when={component() || port()}>
          <rect
            x="1"
            y="1"
            width={Math.max(0, props.box.width - 2)}
            height={Math.max(0, props.box.height - 2)}
          />
        </Show>
        <Show when={component()}>
          <path
            d={`M${props.box.width - 27} 10h16v20h-16zM${props.box.width - 31} 14h8v5h-8zM${props.box.width - 31} 23h8v5h-8z`}
          />
        </Show>
        <Show when={!component() && !port()}>
          <Show
            when={
              (props.element.semantic as UmlInterfaceSemantic).kind ===
              "required"
            }
            fallback={
              <ellipse
                cx={props.box.width / 2}
                cy={props.box.height / 2}
                rx={Math.max(1, props.box.width / 2 - 2)}
                ry={Math.max(1, props.box.height / 2 - 2)}
              />
            }
          >
            <path
              d={`M${props.box.width / 2} 2 A${Math.max(1, props.box.width / 2 - 2)} ${Math.max(1, props.box.height / 2 - 2)} 0 0 0 ${props.box.width / 2} ${props.box.height - 2}`}
              fill="none"
            />
          </Show>
        </Show>
      </g>
      <text
        x={props.box.width / 2}
        y={component() ? props.box.height / 2 + 5 : props.box.height + 17}
        text-anchor="middle"
        fill={style()?.color ?? "var(--nodetto-ink, #334155)"}
        font-size={String(style()?.fontSize ?? 13)}
        font-family={style()?.fontFamily ?? "system-ui, sans-serif"}
      >
        {name()}
      </text>
    </svg>
  );
}
