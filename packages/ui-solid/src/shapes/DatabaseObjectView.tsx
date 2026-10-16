import { databaseObjectRows } from "@nodetto/core";
import {
  DATABASE_OBJECT_LABELS,
  type DatabaseObjectSemantic,
  type DatabaseObjectType,
  type Element,
} from "@nodetto/ir";
import { For, type JSX } from "solid-js";
import { fillPaintStyle, strokeBorderStyle } from "./visual.ts";
import "./DatabaseObjectView.css";
export function DatabaseObjectView(props: {
  readonly element: Element;
}): JSX.Element {
  const semantic = () => props.element.semantic as DatabaseObjectSemantic;
  const rows = () => databaseObjectRows(props.element);
  return (
    <div
      class="nodetto-erd-table nodetto-database-object"
      data-smart-paint="box"
      style={{
        ...fillPaintStyle(props.element.visual),
        ...strokeBorderStyle(props.element.visual),
      }}
    >
      <div class="nodetto-erd-header nodetto-database-object-header">
        <small>
          {DATABASE_OBJECT_LABELS[props.element.type as DatabaseObjectType]}
        </small>
        <strong>{semantic().name}</strong>
      </div>
      <For each={rows()}>
        {(row) => <div class="nodetto-database-object-row">{row}</div>}
      </For>
    </div>
  );
}
