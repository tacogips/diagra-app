// ERD sections: the table's name and columns, and a relation's ends.
//
// The column editor is an `Index` rather than a `For`: rows keep their DOM
// nodes across a commit, so the caret does not jump when the payload is
// replaced, and the row a double-click asked for can be focused by index.

import { type Editor, newElementId } from "@diagra/core";
import { CARDINALITIES, type Element, type ErdTableSemantic } from "@diagra/ir";
import { createEffect, Index, type JSX, on } from "solid-js";
import { createEditorSignals } from "../adapter.ts";
import {
  Checkbox,
  Field,
  focusRowInput,
  RowTools,
  Section,
  SelectInput,
  type SelectOption,
  TextInput,
} from "./controls.tsx";
import {
  addErdColumn,
  moveErdColumn,
  readErdRelation,
  readErdTable,
  removeErdColumn,
  setErdEndpointColumn,
  updateErdColumn,
  withOptionalString,
} from "./edits.ts";
import { writeSemantic } from "./write.ts";

export interface ErdTableSectionProps {
  readonly editor: Editor;
  readonly element: Element;
  /** Row to scroll to and focus, when a double-click asked for one. */
  readonly focusRow?: number;
}

export function ErdTableSection(props: ErdTableSectionProps): JSX.Element {
  const semantic = (): ErdTableSemantic => readErdTable(props.element.semantic);
  const write = (next: ErdTableSemantic): void => {
    writeSemantic(props.editor, props.element.id, next);
  };
  const nameInputs: HTMLInputElement[] = [];

  createEffect(
    on(
      () => props.focusRow,
      (row) => {
        if (row === undefined) {
          return;
        }
        requestAnimationFrame(() => focusRowInput(nameInputs[row]));
      },
    ),
  );

  return (
    <Section title="Table">
      <Field label="Name">
        <TextInput
          label="Table name"
          value={semantic().tableName}
          onCommit={(tableName) => write({ ...semantic(), tableName })}
        />
      </Field>
      <div class="diagra-rows" role="table" aria-label="Columns">
        <div class="diagra-row diagra-row-head" role="row">
          <span>Name</span>
          <span>Type</span>
          <span title="Primary key">PK</span>
          <span title="Nullable">Null</span>
          <span />
        </div>
        <Index each={semantic().columns}>
          {(column, index) => (
            <div class="diagra-row" role="row">
              <TextInput
                ref={(element) => {
                  nameInputs[index] = element;
                }}
                label="Column name"
                value={column().name}
                onCommit={(name) =>
                  write(updateErdColumn(semantic(), column().id, { name }))
                }
              />
              <TextInput
                label="Data type"
                value={column().dataType}
                onCommit={(dataType) =>
                  write(updateErdColumn(semantic(), column().id, { dataType }))
                }
              />
              <Checkbox
                label=""
                title="Primary key"
                checked={column().pk === true}
                onCommit={(pk) =>
                  write(updateErdColumn(semantic(), column().id, { pk }))
                }
              />
              <Checkbox
                label=""
                title="Nullable"
                checked={column().nullable === true}
                onCommit={(nullable) =>
                  write(updateErdColumn(semantic(), column().id, { nullable }))
                }
              />
              <RowTools
                canMoveUp={index > 0}
                canMoveDown={index < semantic().columns.length - 1}
                onMove={(delta) =>
                  write(moveErdColumn(semantic(), column().id, delta))
                }
                onRemove={() => write(removeErdColumn(semantic(), column().id))}
              />
            </div>
          )}
        </Index>
      </div>
      <button
        type="button"
        class="diagra-inspector-button"
        onClick={() => write(addErdColumn(semantic(), newElementId()))}
      >
        Add column
      </button>
    </Section>
  );
}

const CARDINALITY_OPTIONS: readonly SelectOption[] = CARDINALITIES.map(
  (cardinality) => ({ value: cardinality, label: cardinality }),
);

const WHOLE_TABLE: SelectOption = { value: "", label: "(whole table)" };

export interface ErdRelationSectionProps {
  readonly editor: Editor;
  readonly element: Element;
}

export function ErdRelationSection(
  props: ErdRelationSectionProps,
): JSX.Element {
  // The referenced tables change independently of the relation, so the
  // column lists depend on the document revision, not just on the element.
  const signals = createEditorSignals(props.editor);
  const semantic = () => readErdRelation(props.element.semantic);
  const write = (next: unknown): void => {
    writeSemantic(props.editor, props.element.id, next);
  };
  const tableOf = (end: "from" | "to"): ErdTableSemantic | null => {
    signals.rev();
    const table = props.editor.store.get(semantic()[end].table);
    return table && table.type === "erd.table"
      ? readErdTable(table.semantic)
      : null;
  };
  const columnOptions = (end: "from" | "to"): readonly SelectOption[] => [
    WHOLE_TABLE,
    ...(tableOf(end)?.columns ?? []).map((column) => ({
      value: column.id,
      label: `${column.name}: ${column.dataType}`,
    })),
  ];
  const endpoint = (end: "from" | "to"): JSX.Element => (
    <Field label={end === "from" ? "From" : "To"}>
      <div class="diagra-endpoint">
        <span class="diagra-endpoint-table">
          {tableOf(end)?.tableName ?? "(missing table)"}
        </span>
        <SelectInput
          label={`${end === "from" ? "From" : "To"} column`}
          value={semantic()[end].column ?? ""}
          options={columnOptions(end)}
          disabled={tableOf(end) === null}
          onCommit={(column) =>
            write(setErdEndpointColumn(semantic(), end, column))
          }
        />
      </div>
    </Field>
  );

  return (
    <Section title="Relation">
      <Field label="Cardinality">
        <SelectInput
          label="Cardinality"
          value={semantic().cardinality}
          options={CARDINALITY_OPTIONS}
          onCommit={(cardinality) => write({ ...semantic(), cardinality })}
        />
      </Field>
      <Field label="Label">
        <TextInput
          label="Label"
          value={semantic().label ?? ""}
          onCommit={(label) =>
            write(withOptionalString(semantic(), "label", label))
          }
        />
      </Field>
      {endpoint("from")}
      {endpoint("to")}
    </Section>
  );
}
