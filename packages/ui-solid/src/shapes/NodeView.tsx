// node.generic: a labelled box. Plain DOM, because a rounded rectangle with
// centred text is something CSS already does well.

import type { Element, GenericNodeSemantic } from "@diagra/ir";
import type { JSX } from "solid-js";
import { labelStyle } from "./visual.ts";

export interface NodeViewProps {
  readonly element: Element;
}

export function NodeView(props: NodeViewProps): JSX.Element {
  const label = () =>
    (props.element.semantic as Partial<GenericNodeSemantic> | null)?.label ??
    "";
  return (
    <div class="diagra-node" style={labelStyle(props.element.visual)}>
      <span class="diagra-node-label">{label()}</span>
    </div>
  );
}
