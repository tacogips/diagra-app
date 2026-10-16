// ERD sections: the table's name and columns, and a relation's ends.
//
// The column editor is an `Index` rather than a `For`: rows keep their DOM
// nodes across a commit, so the caret does not jump when the payload is
// replaced, and the row a double-click asked for can be focused by index.

import { type Editor, newElementId } from "@nodetto/core";
import {
  CARDINALITIES,
  type Element,
  type ErdTableSemantic,
  FOREIGN_KEY_DEFERRABILITIES,
  type ForeignKeyDeferrability,
  REFERENTIAL_ACTIONS,
  type ReferentialAction,
} from "@nodetto/ir";
import {
  createEffect,
  createSignal,
  For,
  Index,
  type JSX,
  on,
  Show,
} from "solid-js";
import { ErdTextEditor } from "./ErdTextEditor.tsx";
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
  setErdLogical,
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
  const [mode, setMode] = createSignal<"columns" | "text">("columns");
  const [expandedSqlId, setExpandedSqlId] = createSignal<string | null>(null);

  createEffect(
    on(
      () => props.focusRow,
      (row) => {
        if (row === undefined) {
          return;
        }
        setMode("columns");
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
      <div
        class="nodetto-inspector-actions"
        role="group"
        aria-label="Table editing mode"
      >
        <button
          type="button"
          aria-pressed={mode() === "columns"}
          onClick={() => setMode("columns")}
        >
          Columns
        </button>
        <button
          type="button"
          aria-pressed={mode() === "text"}
          onClick={() => setMode("text")}
        >
          Text
        </button>
      </div>
      <Show when={mode() === "text"}>
        <ErdTextEditor editor={props.editor} element={props.element} />
      </Show>
      <Show when={mode() === "columns"}>
        <div class="nodetto-erd-columns" aria-label="Columns">
          <Index each={semantic().columns}>
            {(column, index) => (
              <section
                class="nodetto-erd-column"
                aria-label={`Column ${index + 1}`}
              >
                <div class="nodetto-erd-column-main">
                  <div class="nodetto-erd-column-field">
                    <span>Name</span>
                    <TextInput
                      ref={(element) => {
                        nameInputs[index] = element;
                      }}
                      label="Column name"
                      value={column().name}
                      onCommit={(name) =>
                        write(
                          updateErdColumn(semantic(), column().id, { name }),
                        )
                      }
                    />
                  </div>
                  <div class="nodetto-erd-column-field">
                    <span>Type</span>
                    <TextInput
                      label="Data type"
                      value={column().dataType}
                      onCommit={(dataType) =>
                        write(
                          updateErdColumn(semantic(), column().id, {
                            dataType,
                          }),
                        )
                      }
                    />
                  </div>
                  <RowTools
                    canMoveUp={index > 0}
                    canMoveDown={index < semantic().columns.length - 1}
                    onMove={(delta) =>
                      write(moveErdColumn(semantic(), column().id, delta))
                    }
                    onRemove={() =>
                      write(removeErdColumn(semantic(), column().id))
                    }
                  />
                </div>
                <div class="nodetto-erd-column-flags">
                  <Checkbox
                    label="Auto-increment"
                    checked={column().autoIncrement === true}
                    title="Requires a single integer primary key without a default or generated expression."
                    disabled={
                      !column().autoIncrement &&
                      (!column().pk ||
                        !/^(int|integer|smallint|bigint)$/i.test(
                          column().dataType,
                        ) ||
                        semantic().columns.filter((item) => item.pk).length !==
                          1 ||
                        !!column().defaultExpression ||
                        !!column().generatedExpression ||
                        column().nullable === true)
                    }
                    onCommit={(autoIncrement) =>
                      write(
                        updateErdColumn(semantic(), column().id, {
                          autoIncrement,
                        }),
                      )
                    }
                  />
                  <Checkbox
                    label="Primary key"
                    checked={column().pk === true}
                    onCommit={(pk) =>
                      write(updateErdColumn(semantic(), column().id, { pk }))
                    }
                  />
                  <Checkbox
                    label="Nullable"
                    checked={column().nullable === true}
                    onCommit={(nullable) =>
                      write(
                        updateErdColumn(semantic(), column().id, { nullable }),
                      )
                    }
                  />
                </div>
                <details
                  class="nodetto-erd-column-sql"
                  open={expandedSqlId() === column().id}
                >
                  <summary
                    onClick={(event) => {
                      event.preventDefault();
                      setExpandedSqlId((current) =>
                        current === column().id ? null : column().id,
                      );
                    }}
                  >
                    SQL
                  </summary>
                  <div class="nodetto-erd-column-sql-fields">
                    <Field label="Default">
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
                    </Field>
                    <Field label="Generated">
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
                    </Field>
                  </div>
                </details>
              </section>
            )}
          </Index>
        </div>
        <button
          type="button"
          class="nodetto-inspector-button"
          onClick={() => write(addErdColumn(semantic(), newElementId()))}
        >
          Add column
        </button>
      </Show>
      <div class="nodetto-rows" aria-label="Indexes">
        <Index each={semantic().indexes ?? []}>
          {(index, position) => (
            <div>
              <div class="nodetto-field">
                <strong>{`Index ${position + 1}`}</strong>
                <button
                  type="button"
                  class="nodetto-row-button nodetto-row-remove"
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
                <div class="nodetto-rows">
                  <Index each={index().columns}>
                    {(columnId, columnPosition) => (
                      <div class="nodetto-field">
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
                    class="nodetto-select"
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
        class="nodetto-inspector-button"
        disabled={semantic().columns.length === 0}
        onClick={() => write(addErdIndex(semantic(), newElementId()))}
      >
        Add index
      </button>
      <div class="nodetto-rows" aria-label="Check constraints">
        <Index each={semantic().checks ?? []}>
          {(check, position) => (
            <div>
              <div class="nodetto-field">
                <strong>{`Check ${position + 1}`}</strong>
                <button
                  type="button"
                  class="nodetto-row-button nodetto-row-remove"
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
        class="nodetto-inspector-button"
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
      <div class="nodetto-endpoint">
        <span class="nodetto-endpoint-table">
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
    <Section title="Foreign key">
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
      <Field label="Constraint">
        <Checkbox
          label="Logical reference (no foreign key)"
          title="Draw and document the join path without emitting a database constraint"
          checked={semantic().logical === true}
          onCommit={(logical) => write(setErdLogical(semantic(), logical))}
        />
      </Field>
      <Show when={semantic().logical !== true}>
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
                setErdDeferrability(
                  semantic(),
                  value as ForeignKeyDeferrability,
                ),
              )
            }
          />
        </Field>
      </Show>
      <ConnectorRoutingFields
        semantic={semantic() as unknown as Record<string, unknown>}
        write={(next) => write(next as unknown as ReturnType<typeof semantic>)}
      />
      {endpoint("from")}
      {endpoint("to")}
      <div
        class="nodetto-rows"
        role="table"
        aria-label={
          semantic().logical === true
            ? "Referenced columns"
            : "Foreign key columns"
        }
      >
        <div
          class="nodetto-row nodetto-row-erd-relation nodetto-row-head"
          role="row"
        >
          <span>From column</span>
          <span>To column</span>
          <span />
        </div>
        <Index each={pairs()}>
          {(pair, index) => (
            <div class="nodetto-row nodetto-row-erd-relation" role="row">
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
        class="nodetto-inspector-button"
        disabled={!canAddPair()}
        onClick={addPair}
      >
        Add column pair
      </button>
    </Section>
  );
}
