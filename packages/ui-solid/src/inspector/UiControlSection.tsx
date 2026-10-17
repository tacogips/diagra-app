import type { Editor } from "@nodetto/core";
import {
  UI_CONTROL_KINDS,
  type Element,
  type UiControlKind,
  type UiControlSemantic,
} from "@nodetto/ir";
import { Show, type JSX } from "solid-js";
import { Switch } from "../Switch.tsx";
import {
  Field,
  Section,
  SelectInput,
  TextArea,
  TextInput,
} from "./controls.tsx";
import { writeSemantic } from "./write.ts";
export function UiControlSection(props: {
  editor: Editor;
  element: Element;
}): JSX.Element {
  const semantic = () => props.element.semantic as UiControlSemantic;
  const write = (patch: Partial<UiControlSemantic>) =>
    writeSemantic(props.editor, props.element.id, { ...semantic(), ...patch });
  return (
    <Section title="UI control">
      <Field label="Control">
        <SelectInput
          label="UI control kind"
          value={semantic().control}
          options={UI_CONTROL_KINDS.map((kind) => ({
            value: kind,
            label: kind,
          }))}
          onCommit={(control) => write({ control: control as UiControlKind })}
        />
      </Field>
      <Show when={semantic().control === "input"}>
        <Field label="Input type">
          <SelectInput
            label="Input type"
            value={semantic().inputType ?? "text"}
            options={[
              "text",
              "email",
              "password",
              "number",
              "search",
              "tel",
              "url",
              "date",
            ].map((value) => ({ value, label: value }))}
            onCommit={(inputType) =>
              write({ inputType: inputType as UiControlSemantic["inputType"] })
            }
          />
        </Field>
      </Show>
      <Field label="Label">
        <TextInput
          label="Control label"
          value={semantic().label}
          onCommit={(label) => write({ label })}
        />
      </Field>
      <Show when={["input", "textarea", "select"].includes(semantic().control)}>
        <Field label="Value">
          <TextInput
            label="Control value"
            value={semantic().value ?? ""}
            onCommit={(value) => write({ value })}
          />
        </Field>
      </Show>
      <Show
        when={
          semantic().control === "input" || semantic().control === "textarea"
        }
      >
        <Field label="Placeholder">
          <TextInput
            label="Control placeholder"
            value={semantic().placeholder ?? ""}
            onCommit={(placeholder) => write({ placeholder })}
          />
        </Field>
      </Show>
      <Show when={semantic().control === "select"}>
        <Field label="Options">
          <TextArea
            label="Select options, one per line"
            rows={5}
            value={(semantic().options ?? []).join("\n")}
            onCommit={(value) => write({ options: value.split("\n") })}
          />
        </Field>
      </Show>
      <Show
        when={
          semantic().control === "checkbox" || semantic().control === "switch"
        }
      >
        <Field label="Checked">
          <Switch
            aria-label="Control checked"
            checked={semantic().checked ?? false}
            onChange={(event) =>
              write({ checked: event.currentTarget.checked })
            }
          />
        </Field>
      </Show>
      <Field label="Disabled">
        <Switch
          aria-label="Control disabled"
          checked={semantic().disabled ?? false}
          onChange={(event) => write({ disabled: event.currentTarget.checked })}
        />
      </Field>
    </Section>
  );
}
