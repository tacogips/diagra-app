import { buildBpmnModel, CommandError } from "@nodetto/core";
import {
  BPMN_ASSOCIATION_DIRECTIONS,
  BPMN_DATA_OBJECT_ROLES,
  BPMN_EVENT_DEFINITION_KINDS,
  BPMN_EVENT_POSITIONS,
  BPMN_GATEWAY_TYPES,
  BPMN_LOOP_TYPES,
  BPMN_TASK_TYPES,
  type BpmnEventDefinitionKind,
  type BpmnEventPosition,
  type Element,
} from "@nodetto/ir";
import { For, type JSX } from "solid-js";
import { Checkbox, Field, Section, TextInput } from "./controls.tsx";
import {
  disabledEventPositions,
  withDefinitionKinds,
  withField,
} from "./bpmn-edits.ts";
import type { ElementSectionProps } from "./SimpleSections.tsx";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(semantic: unknown, key: string): string {
  const value = record(semantic)[key];
  return typeof value === "string" ? value : "";
}

function selectedDefinitions(semantic: unknown): BpmnEventDefinitionKind[] {
  const definitions = record(semantic)["definitions"];
  return Array.isArray(definitions)
    ? definitions.map(
        (item) => (item as { kind: BpmnEventDefinitionKind }).kind,
      )
    : [];
}

const options = (values: readonly string[]) =>
  values.map((value) => ({
    value,
    label: value
      .replace(/[A-Z]/g, (letter) => ` ${letter}`)
      .replace(/^./, (letter) => letter.toUpperCase()),
  }));

export function BpmnSection(props: ElementSectionProps): JSX.Element {
  const element = (): Element =>
    props.editor.store.get(props.element.id) ?? props.element;
  const semantic = (): Record<string, unknown> => record(element().semantic);
  const write = (next: Record<string, unknown>): void => {
    const current = element();
    if (!current.type.startsWith("bpmn.")) return;
    try {
      const result = props.editor.updateBpmnSemantic(current.id, next);
      if (!result.ok) return;
    } catch (error) {
      if (error instanceof CommandError) return;
      throw error;
    }
  };
  const set = (key: string, value: unknown): void =>
    write(withField(semantic(), key, value));
  const textField = (key: string, label = key): JSX.Element => (
    <Field label={label}>
      <TextInput
        label={label}
        value={stringField(semantic(), key)}
        onCommit={(value) => set(key, value === "" ? undefined : value)}
      />
    </Field>
  );
  const selectField = (
    key: string,
    label: string,
    values: readonly string[],
    disabledValues: () => ReadonlySet<string> = () => new Set(),
  ): JSX.Element => (
    <Field label={label}>
      <select
        class="nodetto-select"
        aria-label={label}
        value={stringField(semantic(), key)}
        on:change={(event) => {
          const value = event.currentTarget.value;
          if (!disabledValues().has(value)) set(key, value);
          event.currentTarget.value = stringField(semantic(), key);
        }}
      >
        <For each={options(values)}>
          {(option) => (
            <option
              value={option.value}
              selected={option.value === stringField(semantic(), key)}
              disabled={disabledValues().has(option.value)}
            >
              {option.label}
            </option>
          )}
        </For>
      </select>
    </Field>
  );
  const booleanField = (
    key: string,
    label: string,
    optional = false,
  ): JSX.Element => (
    <Field label={label}>
      <Checkbox
        label={label}
        checked={semantic()[key] === true}
        onCommit={(checked) =>
          set(key, checked || !optional ? checked : undefined)
        }
      />
    </Field>
  );
  const definitionsField = (): JSX.Element => (
    <Field label="Event definitions">
      <div role="group" aria-label="Event definitions">
        <For each={BPMN_EVENT_DEFINITION_KINDS}>
          {(kind) => (
            <Checkbox
              label={kind}
              checked={selectedDefinitions(semantic()).includes(kind)}
              onCommit={(checked) => {
                const selected = new Set(selectedDefinitions(semantic()));
                if (checked) selected.add(kind);
                else selected.delete(kind);
                write(
                  withDefinitionKinds(semantic(), [...selected], element().id),
                );
              }}
            />
          )}
        </For>
      </div>
    </Field>
  );
  const type = (): string => element().type;
  const eventPositionDisabled = (): ReadonlySet<BpmnEventPosition> =>
    type() === "bpmn.event"
      ? disabledEventPositions(
          buildBpmnModel(props.editor.store.getSnapshot(), element().page),
          element().id,
        )
      : new Set<BpmnEventPosition>();

  return (
    <Section title="BPMN">
      {type() === "bpmn.textAnnotation"
        ? textField("text", "Text")
        : type() !== "bpmn.association" &&
          type() !== "bpmn.dataAssociation" &&
          textField("name", "Name")}
      {type() === "bpmn.task" && (
        <>
          {selectField("taskType", "Task type", BPMN_TASK_TYPES)}
          {selectField("loop", "Loop", BPMN_LOOP_TYPES)}
          {booleanField("forCompensation", "For compensation", true)}
        </>
      )}
      {type() === "bpmn.subProcess" && (
        <>
          {booleanField("expanded", "Expanded")}
          {booleanField("triggeredByEvent", "Triggered by event")}
          {booleanField("adHoc", "Ad hoc")}
          {selectField("loop", "Loop", BPMN_LOOP_TYPES)}
          {booleanField("forCompensation", "For compensation", true)}
        </>
      )}
      {type() === "bpmn.callActivity" && (
        <>
          {textField("calledElement", "Called element")}
          {selectField("loop", "Loop", BPMN_LOOP_TYPES)}
          {booleanField("forCompensation", "For compensation", true)}
        </>
      )}
      {type() === "bpmn.event" && (
        <>
          {selectField(
            "position",
            "Position",
            BPMN_EVENT_POSITIONS,
            eventPositionDisabled,
          )}
          {definitionsField()}
          {booleanField("interrupting", "Interrupting", true)}
          {booleanField("parallelMultiple", "Parallel multiple", true)}
        </>
      )}
      {type() === "bpmn.boundaryEvent" && (
        <>
          {booleanField("cancelActivity", "Cancel activity")}
          {definitionsField()}
        </>
      )}
      {type() === "bpmn.gateway" && (
        <>
          {selectField("gatewayType", "Gateway type", BPMN_GATEWAY_TYPES)}
          {booleanField("markerVisible", "Marker visible", true)}
        </>
      )}
      {type() === "bpmn.dataObject" && (
        <>
          {selectField("role", "Role", BPMN_DATA_OBJECT_ROLES)}
          {booleanField("collection", "Collection")}
        </>
      )}
      {type() === "bpmn.sequenceFlow" && (
        <>
          {textField("condition", "Condition")}
          {booleanField("isDefault", "Default flow", true)}
        </>
      )}
      {type() === "bpmn.association" &&
        selectField("direction", "Direction", BPMN_ASSOCIATION_DIRECTIONS)}
      {type() === "bpmn.participant" &&
        booleanField("collapsed", "Collapsed pool")}
    </Section>
  );
}
