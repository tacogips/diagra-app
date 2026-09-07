// ERD sections: the table's name and columns, and a relation's ends.
//
// The column editor is an `Index` rather than a `For`: rows keep their DOM
// nodes across a commit, so the caret does not jump when the payload is
// replaced, and the row a double-click asked for can be focused by index.

import { type Editor, newElementId } from "@diagra/core";
import {
  CARDINALITIES,
  type Element,
  type ErdTableSemantic,
  FOREIGN_KEY_DEFERRABILITIES,
  type ForeignKeyDeferrability,
  REFERENTIAL_ACTIONS,
  type ReferentialAction,
} from "@diagra/ir";
import { createEffect, For, Index, type JSX, on } from "solid-js";
import { createEditorSignals } from "../adapter.ts";
import { ConnectorRoutingFields } from "./ConnectorRoutingFields.tsx";
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
  addErdColumnPair,
  addErdColumn,
  addErdCheck,
  addErdIndex,
  moveItem,
  moveErdColumn,
  moveErdColumnPair,
  readErdColumnPairs,
  readErdRelation,
  readErdTable,
  removeErdColumn,
  removeErdColumnPair,
  removeErdCheck,
  removeErdIndex,
  setErdDeferrability,
  setErdColumnPair,
  setErdReferentialAction,
  updateErdColumn,
  updateErdCheck,
  updateErdIndex,
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
        <div class="diagra-row diagra-row-erd diagra-row-head" role="row">
          <span>Name</span>
          <span>Type</span>
          <span title="Primary key">PK</span>
          <span title="Nullable">Null</span>
          <span>Default</span>
          <span>Generated</span>
          <span />
        </div>
        <Index each={semantic().columns}>
          {(column, index) => (
            <div class="diagra-row diagra-row-erd" role="row">
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
              <TextInput
                label="Default SQL expression"
                placeholder="CURRENT_TIMESTAMP"
                value={column().defaultExpression ?? ""}
                onCommit={(defaultExpression) =>
                  write(
                    updateErdColumn(semantic(), column().id, {
                      defaultExpression,
                    }),
                  )
                }
              />
              <TextInput
                label="Generated SQL expression"
                placeholder="quantity * unit_price"
                value={column().generatedExpression ?? ""}
                onCommit={(generatedExpression) =>
                  write(
                    updateErdColumn(semantic(), column().id, {
                      generatedExpression,
                    }),
                  )
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
      <div class="diagra-rows" aria-label="Indexes">
        <Index each={semantic().indexes ?? []}>
          {(index, position) => (
            <div>
              <div class="diagra-field">
                <strong>{`Index ${position + 1}`}</strong>
                <button
                  type="button"
                  class="diagra-row-button diagra-row-remove"
                  aria-label={`Remove index ${position + 1}`}
                  onClick={() => write(removeErdIndex(semantic(), index().id))}
                >
                  ×
                </button>
              </div>
              <Field label="Name">
                <TextInput
                  label={`Index ${position + 1} name`}
                  placeholder="Generated from table and columns"
                  value={index().name ?? ""}
                  onCommit={(name) =>
                    write(updateErdIndex(semantic(), index().id, { name }))
                  }
                />
              </Field>
              <Field label="Columns">
                <div class="diagra-rows">
                  <Index each={index().columns}>
                    {(columnId, columnPosition) => (
                      <div class="diagra-field">
                        <span>
                          {semantic().columns.find(
                            (column) => column.id === columnId(),
                          )?.name ?? columnId()}
                        </span>
                        <RowTools
                          canMoveUp={columnPosition > 0}
                          canMoveDown={
                            columnPosition < index().columns.length - 1
                          }
                          onMove={(delta) =>
                            write(
                              updateErdIndex(semantic(), index().id, {
                                columns: moveItem(
                                  index().columns,
                                  columnPosition,
                                  columnPosition + delta,
                                ),
                              }),
                            )
                          }
                          onRemove={() =>
                            write(
                              updateErdIndex(semantic(), index().id, {
                                columns: index().columns.filter(
                                  (id) => id !== columnId(),
                                ),
                              }),
                            )
                          }
                        />
                      </div>
                    )}
                  </Index>
                  <select
                    class="diagra-select"
                    aria-label={`Add a column to index ${position + 1}`}
                    value=""
                    disabled={
                      index().columns.length >= semantic().columns.length
                    }
                    on:change={(event) => {
                      const columnId = event.currentTarget.value;
                      if (columnId)
                        write(
                          updateErdIndex(semantic(), index().id, {
                            columns: [...index().columns, columnId],
                          }),
                        );
                      event.currentTarget.value = "";
                    }}
                  >
                    <option value="">Add column…</option>
                    <For
                      each={semantic().columns.filter(
                        (column) => !index().columns.includes(column.id),
                      )}
                    >
                      {(column) => (
                        <option value={column.id}>{column.name}</option>
                      )}
                    </For>
                  </select>
                </div>
              </Field>
              <Checkbox
                label="Unique index"
                checked={index().unique === true}
                onCommit={(unique) =>
                  write(updateErdIndex(semantic(), index().id, { unique }))
                }
              />
            </div>
          )}
        </Index>
      </div>
      <button
        type="button"
        class="diagra-inspector-button"
        disabled={semantic().columns.length === 0}
        onClick={() => write(addErdIndex(semantic(), newElementId()))}
      >
        Add index
      </button>
      <div class="diagra-rows" aria-label="Check constraints">
        <Index each={semantic().checks ?? []}>
          {(check, position) => (
            <div>
              <div class="diagra-field">
                <strong>{`Check ${position + 1}`}</strong>
                <button
                  type="button"
                  class="diagra-row-button diagra-row-remove"
                  aria-label={`Remove check ${position + 1}`}
                  onClick={() => write(removeErdCheck(semantic(), check().id))}
                >
                  ×
                </button>
              </div>
              <Field label="Name">
                <TextInput
                  label={`Check ${position + 1} name`}
                  placeholder="Generated from table and check"
                  value={check().name ?? ""}
                  onCommit={(name) =>
                    write(updateErdCheck(semantic(), check().id, { name }))
                  }
                />
              </Field>
              <Field label="Expression">
                <TextInput
                  label={`Check ${position + 1} SQL expression`}
                  placeholder="price >= 0"
                  value={check().expression}
                  onCommit={(expression) =>
                    write(
                      updateErdCheck(semantic(), check().id, { expression }),
                    )
                  }
                />
              </Field>
            </div>
          )}
        </Index>
      </div>
      <button
        type="button"
        class="diagra-inspector-button"
        onClick={() => write(addErdCheck(semantic(), newElementId()))}
      >
        Add check
      </button>
    </Section>
  );
}

const CARDINALITY_OPTIONS: readonly SelectOption[] = CARDINALITIES.map(
  (cardinality) => ({ value: cardinality, label: cardinality }),
);

const REFERENTIAL_ACTION_OPTIONS: readonly SelectOption[] =
  REFERENTIAL_ACTIONS.map((action) => ({
    value: action,
    label: action
      .split("-")
      .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
      .join(" "),
  }));

const DEFERRABILITY_OPTIONS: readonly SelectOption[] =
  FOREIGN_KEY_DEFERRABILITIES.map((value) => ({
    value,
    label:
      value === "not-deferrable"
        ? "Not deferrable"
        : value === "initially-immediate"
          ? "Initially immediate"
          : "Initially deferred",
  }));

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
  const pairs = () => readErdColumnPairs(semantic());
  const columnOptions = (
    end: "from" | "to",
    pairIndex: number,
  ): readonly SelectOption[] =>
    (tableOf(end)?.columns ?? [])
      .filter(
        (column) =>
          !pairs().some(
            (pair, index) => index !== pairIndex && pair[end] === column.id,
          ),
      )
      .map((column) => ({
        value: column.id,
        label: `${column.name}: ${column.dataType}`,
      }));
  const endpoint = (end: "from" | "to"): JSX.Element => (
    <Field label={end === "from" ? "From" : "To"}>
      <div class="diagra-endpoint">
        <span class="diagra-endpoint-table">
          {tableOf(end)?.tableName ?? "(missing table)"}
        </span>
      </div>
    </Field>
  );
  const addPair = (): void => {
    const used = pairs();
    const from = tableOf("from")?.columns.find(
      (column) => !used.some((pair) => pair.from === column.id),
    );
    const to = tableOf("to")?.columns.find(
      (column) => !used.some((pair) => pair.to === column.id),
    );
    if (from && to)
      write(addErdColumnPair(semantic(), { from: from.id, to: to.id }));
  };
  const canAddPair = (): boolean =>
    columnOptions("from", -1).length > 0 && columnOptions("to", -1).length > 0;

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
      <Field label="On delete">
        <SelectInput
          label="On delete"
          value={semantic().onDelete ?? "no-action"}
          options={REFERENTIAL_ACTION_OPTIONS}
          onCommit={(action) =>
            write(
              setErdReferentialAction(
                semantic(),
                "onDelete",
                action as ReferentialAction,
              ),
            )
          }
        />
      </Field>
      <Field label="On update">
        <SelectInput
          label="On update"
          value={semantic().onUpdate ?? "no-action"}
          options={REFERENTIAL_ACTION_OPTIONS}
          onCommit={(action) =>
            write(
              setErdReferentialAction(
                semantic(),
                "onUpdate",
                action as ReferentialAction,
              ),
            )
          }
        />
      </Field>
      <Field label="Constraint timing">
        <SelectInput
          label="Constraint timing"
          value={semantic().deferrability ?? "not-deferrable"}
          options={DEFERRABILITY_OPTIONS}
          onCommit={(value) =>
            write(
              setErdDeferrability(semantic(), value as ForeignKeyDeferrability),
            )
          }
        />
      </Field>
      <ConnectorRoutingFields
        semantic={semantic() as unknown as Record<string, unknown>}
        write={(next) => write(next as unknown as ReturnType<typeof semantic>)}
      />
      {endpoint("from")}
      {endpoint("to")}
      <div class="diagra-rows" role="table" aria-label="Foreign key columns">
        <div
          class="diagra-row diagra-row-erd-relation diagra-row-head"
          role="row"
        >
          <span>From column</span>
          <span>To column</span>
          <span />
        </div>
        <Index each={pairs()}>
          {(pair, index) => (
            <div class="diagra-row diagra-row-erd-relation" role="row">
              <SelectInput
                label={`Foreign key source column ${index + 1}`}
                value={pair().from}
                options={columnOptions("from", index)}
                onCommit={(column) =>
                  write(setErdColumnPair(semantic(), index, "from", column))
                }
              />
              <SelectInput
                label={`Foreign key target column ${index + 1}`}
                value={pair().to}
                options={columnOptions("to", index)}
                onCommit={(column) =>
                  write(setErdColumnPair(semantic(), index, "to", column))
                }
              />
              <RowTools
                canMoveUp={index > 0}
                canMoveDown={index < pairs().length - 1}
                onMove={(delta) =>
                  write(moveErdColumnPair(semantic(), index, delta))
                }
                onRemove={() => write(removeErdColumnPair(semantic(), index))}
              />
            </div>
          )}
        </Index>
      </div>
      <button
        type="button"
        class="diagra-inspector-button"
        disabled={!canAddPair()}
        onClick={addPair}
      >
        Add column pair
      </button>
    </Section>
  );
}
