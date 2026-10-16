import { type Editor, newElementId } from "@nodetto/core";
import {
  DATABASE_OBJECT_LABELS,
  type DatabaseObjectType,
  type DatabaseObjectSemantic,
  type DatabaseParameter,
  type Element,
  isDatabaseObjectType,
} from "@nodetto/ir";
import { For, Index, type JSX, Show } from "solid-js";
import { createEditorSignals } from "../adapter.ts";
import {
  Field,
  Section,
  SelectInput,
  TextInput,
  TextArea,
} from "./controls.tsx";
import { writeSemantic } from "./write.ts";
export function DatabaseObjectSection(props: {
  readonly editor: Editor;
  readonly element: Element;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const semantic = () => props.element.semantic as DatabaseObjectSemantic;
  const routine = () =>
    props.element.type === "erd.function" ||
    props.element.type === "erd.procedure";
  const rows = () =>
    routine() ? (semantic().parameters ?? []) : (semantic().columns ?? []);
  const write = (patch: Partial<DatabaseObjectSemantic>) =>
    writeSemantic(props.editor, props.element.id, { ...semantic(), ...patch });
  const updateRows = (next: readonly DatabaseParameter[]) =>
    write(routine() ? { parameters: next } : { columns: next });
  const updateRow = (index: number, patch: Partial<DatabaseParameter>) =>
    updateRows(
      rows().map((row, at) => (at === index ? { ...row, ...patch } : row)),
    );
  const dependencies = () => {
    signals.rev();
    return props.editor.store
      .getPageElements(props.element.page)
      .filter(
        (element) =>
          element.id !== props.element.id &&
          (element.type === "erd.table" || isDatabaseObjectType(element.type)),
      );
  };
  return (
    <Section
      title={DATABASE_OBJECT_LABELS[props.element.type as DatabaseObjectType]}
    >
      <Field label="Name">
        <TextInput
          label="Database object name"
          value={semantic().name}
          onCommit={(name) => write({ name })}
        />
      </Field>
      <Show when={routine()}>
        <Field label="Language">
          <SelectInput
            label="Routine language"
            value={semantic().language ?? "sql"}
            options={[
              { value: "sql", label: "SQL" },
              { value: "plpgsql", label: "PL/pgSQL (PostgreSQL)" },
            ]}
            onCommit={(language) =>
              write({ language: language === "plpgsql" ? "plpgsql" : "sql" })
            }
          />
        </Field>
      </Show>
      <Show when={props.element.type === "erd.function"}>
        <Field label="Returns">
          <TextInput
            label="Function return type"
            value={semantic().returnType ?? ""}
            onCommit={(returnType) => write({ returnType })}
          />
        </Field>
      </Show>
      <Field label={routine() ? "Body" : "SQL query"}>
        <TextArea
          label={routine() ? "Routine body" : "View query"}
          value={semantic().definition}
          rows={8}
          onCommit={(definition) => write({ definition })}
        />
      </Field>
      <h4>{routine() ? "Parameters" : "Result columns"}</h4>
      <div class="nodetto-database-members">
        <Index each={rows()}>
          {(row, index) => (
            <div>
              <div class="nodetto-database-member">
                <TextInput
                  label={`${routine() ? "Parameter" : "Column"} name ${index + 1}`}
                  value={row().name}
                  onCommit={(name) => updateRow(index, { name })}
                />
                <TextInput
                  label={`Data type ${index + 1}`}
                  value={row().dataType}
                  onCommit={(dataType) => updateRow(index, { dataType })}
                />
                <button
                  type="button"
                  aria-label={`Remove ${routine() ? "parameter" : "column"} ${index + 1}`}
                  onClick={() =>
                    updateRows(rows().filter((_, at) => at !== index))
                  }
                >
                  ×
                </button>
              </div>
              <Show when={props.element.type === "erd.procedure"}>
                <SelectInput
                  label={`Parameter mode ${index + 1}`}
                  value={(row() as DatabaseParameter).mode ?? "in"}
                  options={[
                    { value: "in", label: "IN" },
                    { value: "out", label: "OUT" },
                    { value: "inout", label: "INOUT" },
                  ]}
                  onCommit={(mode) =>
                    updateRow(index, {
                      mode: mode as DatabaseParameter["mode"],
                    })
                  }
                />
              </Show>
            </div>
          )}
        </Index>
      </div>
      <button
        type="button"
        onClick={() =>
          updateRows([
            ...rows(),
            {
              id: newElementId(),
              name: `${routine() ? "arg" : "column"}_${rows().length + 1}`,
              dataType: "integer",
            },
          ])
        }
      >
        Add {routine() ? "parameter" : "column"}
      </button>
      <h4>Dependencies</h4>
      <For each={semantic().dependsOn ?? []}>
        {(id) => (
          <div class="nodetto-endpoint">
            <span>
              {(() => {
                signals.rev();
                const element = props.editor.store.get(id);
                const data = element?.semantic as
                  | { name?: string; tableName?: string }
                  | undefined;
                return data?.name ?? data?.tableName ?? "Missing object";
              })()}
            </span>
            <button
              type="button"
              aria-label="Remove dependency"
              onClick={() =>
                write({
                  dependsOn: semantic().dependsOn?.filter(
                    (candidate) => candidate !== id,
                  ),
                })
              }
            >
              ×
            </button>
          </div>
        )}
      </For>
      <select
        aria-label="Add database dependency"
        value=""
        onChange={(event) => {
          const id = event.currentTarget.value;
          event.currentTarget.value = "";
          if (id) write({ dependsOn: [...(semantic().dependsOn ?? []), id] });
        }}
      >
        <option value="">Add dependency…</option>
        <For
          each={dependencies().filter(
            (element) => !semantic().dependsOn?.includes(element.id),
          )}
        >
          {(element) => (
            <option value={element.id}>
              {(element.semantic as { name?: string; tableName?: string })
                .name ?? (element.semantic as { tableName?: string }).tableName}
            </option>
          )}
        </For>
      </select>
    </Section>
  );
}
