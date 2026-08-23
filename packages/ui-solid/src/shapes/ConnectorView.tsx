// Connectors: edge.generic, erd.relation and uml.association.
//
// Endpoints come from the core's boundary intersection, so the line always
// stops at the shapes' borders and follows them as they move. An unresolved
// endpoint renders nothing at all rather than a line to the origin.

import {
  readDirectEndpoints,
  readTableEndpoints,
  resolveConnector,
  type ShapeContext,
} from "@diagra/core";
import type {
  Element,
  ErdRelationSemantic,
  GenericEdgeSemantic,
  UmlAssociationSemantic,
} from "@diagra/ir";
import { type JSX, Show } from "solid-js";
import { svgStyle } from "./visual.ts";

export const MARKER_ARROW = "diagra-arrow";
export const MARKER_TRIANGLE = "diagra-triangle";
export const MARKER_DIAMOND_OPEN = "diagra-diamond-open";
export const MARKER_DIAMOND_FILLED = "diagra-diamond-filled";
export const MARKER_DOT = "diagra-dot";

export interface ConnectorViewProps {
  readonly element: Element;
  readonly context: ShapeContext;
  readonly selected: boolean;
}

function markerUrl(id: string | null): string | undefined {
  return id === null ? undefined : `url(#${id})`;
}

function arrowheadMarker(head: string | undefined): string | null {
  switch (head) {
    case "arrow":
      return MARKER_ARROW;
    case "triangle":
      return MARKER_TRIANGLE;
    case "dot":
      return MARKER_DOT;
    default:
      return null;
  }
}

interface Decoration {
  readonly start: string | null;
  readonly end: string | null;
  readonly label: string;
  readonly dashed: boolean;
}

function decorate(element: Element): Decoration {
  const semantic = element.semantic as Record<string, unknown> | null;
  if (element.type === "erd.relation") {
    const relation = semantic as Partial<ErdRelationSemantic> | null;
    return {
      start: MARKER_DOT,
      end: MARKER_DOT,
      label: relation?.label ?? relation?.cardinality ?? "",
      dashed: false,
    };
  }
  if (element.type === "uml.association") {
    const association = semantic as Partial<UmlAssociationSemantic> | null;
    switch (association?.kind) {
      case "inherit":
        return { start: null, end: MARKER_TRIANGLE, label: "", dashed: false };
      case "aggregate":
        return {
          start: MARKER_DIAMOND_OPEN,
          end: null,
          label: association.label ?? "",
          dashed: false,
        };
      case "compose":
        return {
          start: MARKER_DIAMOND_FILLED,
          end: null,
          label: association.label ?? "",
          dashed: false,
        };
      default:
        return {
          start: null,
          end: null,
          label: association?.label ?? "",
          dashed: false,
        };
    }
  }
  const edge = semantic as Partial<GenericEdgeSemantic> | null;
  return {
    start: arrowheadMarker(edge?.arrowheads?.start),
    end: arrowheadMarker(edge?.arrowheads?.end ?? "arrow"),
    label: edge?.label ?? "",
    dashed: false,
  };
}

export function ConnectorView(props: ConnectorViewProps): JSX.Element {
  const geometry = () =>
    resolveConnector(
      props.element,
      props.context,
      props.element.type === "erd.relation"
        ? readTableEndpoints
        : readDirectEndpoints,
    );
  const decoration = () => decorate(props.element);

  return (
    <Show when={geometry()}>
      {(resolved) => (
        <g
          class="diagra-connector"
          classList={{ "diagra-selected": props.selected }}
        >
          <line
            x1={resolved().start.x}
            y1={resolved().start.y}
            x2={resolved().end.x}
            y2={resolved().end.y}
            marker-start={markerUrl(decoration().start)}
            marker-end={markerUrl(decoration().end)}
            {...svgStyle(props.element.visual)}
          />
          <Show when={decoration().label}>
            <text
              class="diagra-connector-label"
              x={(resolved().start.x + resolved().end.x) / 2}
              y={(resolved().start.y + resolved().end.y) / 2 - 6}
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
export function ConnectorMarkers(): JSX.Element {
  return (
    <defs>
      <marker
        id={MARKER_ARROW}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="8"
        markerHeight="8"
        markerUnits="userSpaceOnUse"
        orient="auto-start-reverse"
      >
        <path d="M 0 1 L 10 5 L 0 9 z" class="diagra-marker-filled" />
      </marker>
      <marker
        id={MARKER_TRIANGLE}
        viewBox="0 0 12 12"
        refX="11"
        refY="6"
        markerWidth="14"
        markerHeight="14"
        markerUnits="userSpaceOnUse"
        orient="auto-start-reverse"
      >
        <path d="M 0 0 L 12 6 L 0 12 z" class="diagra-marker-hollow" />
      </marker>
      <marker
        id={MARKER_DIAMOND_OPEN}
        viewBox="0 0 16 10"
        refX="1"
        refY="5"
        markerWidth="16"
        markerHeight="10"
        markerUnits="userSpaceOnUse"
        orient="auto-start-reverse"
      >
        <path d="M 0 5 L 8 0 L 16 5 L 8 10 z" class="diagra-marker-hollow" />
      </marker>
      <marker
        id={MARKER_DIAMOND_FILLED}
        viewBox="0 0 16 10"
        refX="1"
        refY="5"
        markerWidth="16"
        markerHeight="10"
        markerUnits="userSpaceOnUse"
        orient="auto-start-reverse"
      >
        <path d="M 0 5 L 8 0 L 16 5 L 8 10 z" class="diagra-marker-filled" />
      </marker>
      <marker
        id={MARKER_DOT}
        viewBox="0 0 8 8"
        refX="4"
        refY="4"
        markerWidth="7"
        markerHeight="7"
        markerUnits="userSpaceOnUse"
        orient="auto-start-reverse"
      >
        <circle cx="4" cy="4" r="3" class="diagra-marker-filled" />
      </marker>
    </defs>
  );
}
