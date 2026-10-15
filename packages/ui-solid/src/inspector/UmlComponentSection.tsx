import {
  UmlComponentType,
  UmlComponentRelationship,
  UML_INTERFACE_KINDS,
  UML_PORT_SIDES,
} from "@nodetto/ir";
import { Show, type JSX } from "solid-js";
import type { ElementSectionProps } from "./SimpleSections.tsx";
import {
  Field,
  Section,
  SelectInput,
  TextInput,
  NumberInput,
} from "./controls.tsx";
import ConnectorRoutingFields from "./ConnectorRoutingFields.tsx";

export function UmlComponentSection(props: ElementSectionProps): JSX.Element {
  const data = () => props.element.semantic as Record<string, unknown>;
  const write = (patch: Record<string, unknown>) =>
    props.editor.apply([
      {
        type: "updateSemantic",
        id: props.element.id,
        semantic: { ...data(), ...patch },
      },
    ]);
  const relationship = () =>
    props.element.type === UmlComponentType.Relationship;
  return (
    <Section
      title={relationship() ? "Component relationship" : "UML component"}
    >
      <Field label={relationship() ? "Label" : "Name"}>
        <TextInput
          label={relationship() ? "Relationship label" : "Name"}
          value={String(data()[relationship() ? "label" : "name"] ?? "")}
          onCommit={(value) =>
            write({ [relationship() ? "label" : "name"]: value })
          }
        />
      </Field>
      <Show when={props.element.type === UmlComponentType.Interface}>
        <Field label="Interface">
          <SelectInput
            label="Interface kind"
            value={String(data()["kind"])}
            options={UML_INTERFACE_KINDS.map((value) => ({
              value,
              label:
                value === "provided" ? "Provided (ball)" : "Required (socket)",
            }))}
            onCommit={(kind) => write({ kind })}
          />
        </Field>
      </Show>
      <Show when={props.element.type === UmlComponentType.Port}>
        <Field label="Boundary">
          <SelectInput
            label="Port side"
            value={String(data()["side"])}
            options={UML_PORT_SIDES.map((value) => ({ value, label: value }))}
            onCommit={(side) => write({ side })}
          />
        </Field>
        <Field label="Position (%)">
          <NumberInput
            label="Port position"
            min={0}
            value={Number(data()["offset"]) * 100}
            onCommit={(value) =>
              write({ offset: Math.max(0, Math.min(1, value / 100)) })
            }
          />
        </Field>
        <p>
          Attached to its component. Drag the port along the boundary to
          reposition it.
        </p>
      </Show>
      <Show when={relationship()}>
        <Field label="Kind">
          <SelectInput
            label="Component relationship kind"
            value={String(data()["kind"])}
            options={Object.values(UmlComponentRelationship).map((value) => ({
              value,
              label: value,
            }))}
            onCommit={(kind) => write({ kind })}
          />
        </Field>
        <ConnectorRoutingFields
          semantic={data()}
          write={(next) => write(next)}
        />
      </Show>
    </Section>
  );
}
