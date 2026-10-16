// Connectors: edge.generic, erd.relation and uml.association.
//
// Endpoints come from the core's boundary intersection, so the line always
// stops at the shapes' borders and follows them as they move. An unresolved
// endpoint renders nothing at all rather than a line to the origin.

import {
  angularGradientPatches,
  bpmnFlowDecoration,
  connectorDefaultDash,
  connectorDecoration,
  diamondGradientPatches,
  endpointReaderFor,
  erdForeignKeyWarning,
  linearGradientVector,
  type MarkerKind,
  resolveConnector,
  sampleGradient,
  strokeGradientId,
  type ShapeContext,
} from "@nodetto/core";
import type { Element } from "@nodetto/ir";
import { For, type JSX, Match, Show, Switch } from "solid-js";
import { BpmnNotationPrimitiveView } from "./BpmnShapeView.tsx";
import { svgStyle } from "./visual.ts";

export const MARKER_ARROW = "nodetto-arrow";
export const MARKER_TRIANGLE = "nodetto-triangle";
export const MARKER_DIAMOND_OPEN = "nodetto-diamond-open";
export const MARKER_DIAMOND_FILLED = "nodetto-diamond-filled";
export const MARKER_DOT = "nodetto-dot";

export interface ConnectorViewProps {
  readonly element: Element;
  readonly context: ShapeContext;
  readonly selected: boolean;
  readonly markerPrefix?: string;
}

/** The core's notation vocabulary, mapped onto this layer's marker ids. */
const MARKER_ELEMENTS: Record<MarkerKind, string> = {
  arrow: MARKER_ARROW,
  triangle: MARKER_TRIANGLE,
  diamondOpen: MARKER_DIAMOND_OPEN,
  diamondFilled: MARKER_DIAMOND_FILLED,
  dot: MARKER_DOT,
};

function markerUrl(kind: MarkerKind | null, prefix = ""): string | undefined {
  return kind === null ? undefined : `url(#${prefix}${MARKER_ELEMENTS[kind]})`;
}

export function ConnectorView(props: ConnectorViewProps): JSX.Element {
  const geometry = () =>
    resolveConnector(
      props.element,
      props.context,
      endpointReaderFor(props.element.type),
    );
  const decoration = () => connectorDecoration(props.element);
  const warning = () =>
    erdForeignKeyWarning(props.element, (id) => props.context.resolve(id));
  const warningStyle = (): JSX.CSSProperties | undefined =>
    warning() ? { stroke: "#b45309", "stroke-dasharray": "6 4" } : undefined;

  return (
    <Show when={geometry()}>
      {(resolved) => (
        <g
          class="nodetto-connector"
          classList={{ "nodetto-selected": props.selected }}
        >
          <Show when={props.element.visual.style?.strokeGradient}>
            {(gradient) => {
              const x = Math.min(resolved().start.x, resolved().end.x);
              const y = Math.min(resolved().start.y, resolved().end.y);
              const width = Math.abs(resolved().end.x - resolved().start.x);
              const height = Math.abs(resolved().end.y - resolved().start.y);
              const linear = () => {
                const current = gradient();
                return current.type === "linear" ? current : null;
              };
              const radial = () => {
                const current = gradient();
                return current.type === "radial" ? current : null;
              };
              const angular = () => {
                const current = gradient();
                return current.type === "angular" ? current : null;
              };
              const diamond = () => {
                const current = gradient();
                return current.type === "diamond" ? current : null;
              };
              const vector = () => {
                const current = linear();
                return current
                  ? linearGradientVector(current.angle, width, height)
                  : undefined;
              };
              return (
                <defs>
                  <Switch>
                    <Match when={gradient().type === "linear"}>
                      <linearGradient
                        id={strokeGradientId(props.element.id)}
                        gradientUnits="userSpaceOnUse"
                        x1={x + (vector()?.x1 ?? 0) * width}
                        y1={y + (vector()?.y1 ?? 0) * height}
                        x2={x + (vector()?.x2 ?? 1) * width}
                        y2={y + (vector()?.y2 ?? 1) * height}
                      >
                        <For each={gradient().stops}>
                          {(stop) => (
                            <stop
                              offset={stop.offset}
                              stop-color={stop.color}
                              stop-opacity={stop.opacity ?? 1}
                            />
                          )}
                        </For>
                      </linearGradient>
                    </Match>
                    <Match when={gradient().type === "radial"}>
                      <radialGradient
                        id={strokeGradientId(props.element.id)}
                        gradientUnits="userSpaceOnUse"
                        cx={x + (radial()?.centerX ?? 0.5) * width}
                        cy={y + (radial()?.centerY ?? 0.5) * height}
                        r={
                          (radial()?.radius ?? 0.5) * Math.max(width, height, 1)
                        }
                      >
                        <For each={gradient().stops}>
                          {(stop) => (
                            <stop
                              offset={stop.offset}
                              stop-color={stop.color}
                              stop-opacity={stop.opacity ?? 1}
                            />
                          )}
                        </For>
                      </radialGradient>
                    </Match>
                    <Match when={gradient().type === "angular"}>
                      <pattern
                        id={strokeGradientId(props.element.id)}
                        patternUnits="userSpaceOnUse"
                        x={x}
                        y={y}
                        width={Math.max(width, 1)}
                        height={Math.max(height, 1)}
                      >
                        <For
                          each={
                            angular()
                              ? angularGradientPatches(
                                  angular() as NonNullable<
                                    ReturnType<typeof angular>
                                  >,
                                  width,
                                  height,
                                  x,
                                  y,
                                )
                              : []
                          }
                        >
                          {(patch) => (
                            <polygon
                              points={patch.points}
                              fill={patch.color}
                              fill-opacity={patch.opacity}
                            />
                          )}
                        </For>
                      </pattern>
                    </Match>
                    <Match when={gradient().type === "diamond"}>
                      <pattern
                        id={strokeGradientId(props.element.id)}
                        patternUnits="userSpaceOnUse"
                        x={x}
                        y={y}
                        width={Math.max(width, 1)}
                        height={Math.max(height, 1)}
                      >
                        <rect
                          x={x}
                          y={y}
                          width={Math.max(width, 1)}
                          height={Math.max(height, 1)}
                          fill={sampleGradient(gradient().stops, 1).color}
                          fill-opacity={
                            sampleGradient(gradient().stops, 1).opacity
                          }
                        />
                        <For
                          each={
                            diamond()
                              ? diamondGradientPatches(
                                  diamond() as NonNullable<
                                    ReturnType<typeof diamond>
                                  >,
                                  width,
                                  height,
                                  x,
                                  y,
                                )
                              : []
                          }
                        >
                          {(patch) => (
                            <polygon
                              points={patch.points}
                              fill={patch.color}
                              fill-opacity={patch.opacity}
                            />
                          )}
                        </For>
                      </pattern>
                    </Match>
                  </Switch>
                </defs>
              );
            }}
          </Show>
          <Show
            when={resolved().points.length > 2}
            fallback={
              <line
                x1={resolved().start.x}
                y1={resolved().start.y}
                x2={resolved().end.x}
                y2={resolved().end.y}
                marker-start={markerUrl(decoration().start, props.markerPrefix)}
                marker-end={markerUrl(decoration().end, props.markerPrefix)}
                stroke-dasharray={connectorDefaultDash(props.element)}
                {...svgStyle(props.element.visual, props.element.id)}
                style={warningStyle()}
              />
            }
          >
            <polyline
              points={resolved()
                .points.map((point) => `${point.x},${point.y}`)
                .join(" ")}
              marker-start={markerUrl(decoration().start, props.markerPrefix)}
              marker-end={markerUrl(decoration().end, props.markerPrefix)}
              stroke-dasharray={connectorDefaultDash(props.element)}
              {...svgStyle(props.element.visual, props.element.id)}
              style={warningStyle()}
              fill="none"
            />
          </Show>
          <For
            each={bpmnFlowDecoration(props.element, resolved().points, (id) =>
              props.context.resolve(id),
            )}
          >
            {(primitive) => <BpmnNotationPrimitiveView primitive={primitive} />}
          </For>
          <Show when={warning()}>
            {(message) => (
              <g
                aria-label={message()}
                transform={`translate(${resolved().labelPoint.x - 65} ${resolved().labelPoint.y + 8})`}
              >
                <title>{message()}</title>
                <rect
                  width="130"
                  height="22"
                  rx="4"
                  fill="#fffbeb"
                  stroke="#b45309"
                />
                <path d="M12 3L21 18H3Z" fill="#fef3c7" stroke="#92400e" />
                <text
                  x="12"
                  y="16"
                  text-anchor="middle"
                  fill="#92400e"
                  font-size="12"
                  font-weight="700"
                >
                  !
                </text>
                <text x="28" y="15" fill="#92400e" font-size="12">
                  FK incomplete
                </text>
              </g>
            )}
          </Show>
          <Show when={decoration().label}>
            <text
              class="nodetto-connector-label"
              x={resolved().labelPoint.x}
              y={resolved().labelPoint.y - 6}
              text-anchor="middle"
            >
              {decoration().label}
            </text>
          </Show>
        </g>
      )}
    </Show>
  );
}

/** Marker definitions every connector layer needs exactly one copy of. */
export function ConnectorMarkers(props: { prefix?: string } = {}): JSX.Element {
  return (
    <defs>
      <marker
        id={`${props.prefix ?? ""}${MARKER_ARROW}`}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="8"
        markerHeight="8"
        markerUnits="userSpaceOnUse"
        orient="auto-start-reverse"
      >
        <path d="M 0 1 L 10 5 L 0 9 z" class="nodetto-marker-filled" />
      </marker>
      <marker
        id={`${props.prefix ?? ""}${MARKER_TRIANGLE}`}
        viewBox="0 0 12 12"
        refX="11"
        refY="6"
        markerWidth="14"
        markerHeight="14"
        markerUnits="userSpaceOnUse"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 12 6 L 0 12 z" class="nodetto-marker-hollow" />
      </marker>
      <marker
        id={`${props.prefix ?? ""}${MARKER_DIAMOND_OPEN}`}
        viewBox="0 0 16 10"
        refX="1"
        refY="5"
        markerWidth="16"
        markerHeight="10"
        markerUnits="userSpaceOnUse"
        orient="auto-start-reverse"
      >
        <path d="M 0 5 L 8 0 L 16 5 L 8 10 z" class="nodetto-marker-hollow" />
      </marker>
      <marker
        id={`${props.prefix ?? ""}${MARKER_DIAMOND_FILLED}`}
        viewBox="0 0 16 10"
        refX="1"
        refY="5"
        markerWidth="16"
        markerHeight="10"
        markerUnits="userSpaceOnUse"
        orient="auto-start-reverse"
      >
        <path d="M 0 5 L 8 0 L 16 5 L 8 10 z" class="nodetto-marker-filled" />
      </marker>
      <marker
        id={`${props.prefix ?? ""}${MARKER_DOT}`}
        viewBox="0 0 8 8"
        refX="4"
        refY="4"
        markerWidth="7"
        markerHeight="7"
        markerUnits="userSpaceOnUse"
        orient="auto-start-reverse"
      >
        <circle cx="4" cy="4" r="3" class="nodetto-marker-filled" />
      </marker>
    </defs>
  );
}
