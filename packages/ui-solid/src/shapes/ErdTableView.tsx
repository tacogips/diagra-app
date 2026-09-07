// erd.table: a header row plus one fixed-height row per column, rendered
// straight from the semantic payload. Row height matches the core's bounds
// arithmetic (ERD_TABLE_ROW_HEIGHT), so what is drawn is what is picked.

import {
  erdColumnKey,
  ERD_TABLE_HEADER_HEIGHT,
  ERD_TABLE_ROW_HEIGHT,
} from "@diagra/core";
import type { Element, ErdColumn, ErdTableSemantic } from "@diagra/ir";
import { For, type JSX, Show } from "solid-js";
import { fillPaintStyle, strokeBorderStyle } from "./visual.ts";

export interface ErdTableViewProps {
  readonly element: Element;
}

function semanticOf(element: Element): ErdTableSemantic {
  const semantic = element.semantic as Partial<ErdTableSemantic> | null;
  return {
    tableName: semantic?.tableName ?? "",
    columns: Array.isArray(semantic?.columns) ? semantic.columns : [],
    indexes: Array.isArray(semantic?.indexes) ? semantic.indexes : [],
  };
}

export function ErdTableView(props: ErdTableViewProps): JSX.Element {
  const semantic = () => semanticOf(props.element);
  return (
    <div
      class="diagra-erd-table"
      data-smart-paint="box"
      style={{
        ...fillPaintStyle(props.element.visual),
        ...strokeBorderStyle(props.element.visual),
      }}
    >
      <div
        class="diagra-erd-header"
        style={{ height: `${ERD_TABLE_HEADER_HEIGHT}px` }}
      >
        {semantic().tableName}
      </div>
      <div class="diagra-erd-body">
        <For each={semantic().columns}>
          {(column: ErdColumn) => (
            <div
              class="diagra-erd-row"
              style={{ height: `${ERD_TABLE_ROW_HEIGHT}px` }}
            >
              <span class="diagra-erd-key">
                {erdColumnKey(semantic(), column)}
              </span>
              <span class="diagra-erd-name">{column.name}</span>
              <span
                class="diagra-erd-type"
                title={
                  column.generatedExpression
                    ? `Generated: ${column.generatedExpression}`
                    : column.defaultExpression
                      ? `Default: ${column.defaultExpression}`
                      : undefined
                }
              >
                {column.dataType}
                <Show when={column.nullable}>?</Show>
                <Show when={column.generatedExpression}> ƒ</Show>
              </span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
