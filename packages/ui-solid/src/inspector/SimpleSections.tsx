// The small semantic sections: one or two fields per type, plus the group
// and page sections. Each control commits one whole-payload `updateSemantic`.

import type { Editor } from "@diagra/core";
import { memberIdsOf } from "@diagra/core";
import {
  ARROWHEADS,
  type Element,
  GEO_KINDS,
  PAGE_KINDS,
  type Page,
  type PageKind,
  UML_ASSOCIATION_KINDS,
} from "@diagra/ir";
import type { JSX } from "solid-js";
import {
  Field,
  Section,
  SelectInput,
  type SelectOption,
  TextArea,
  TextInput,
} from "./controls.tsx";
import { withOptionalString } from "./edits.ts";
import { writeSemantic } from "./write.ts";

export interface ElementSectionProps {
  readonly editor: Editor;
  readonly element: Element;
}

function record(semantic: unknown): Record<string, unknown> {
  return typeof semantic === "object" && semantic !== null
    ? (semantic as Record<string, unknown>)
    : {};
}

function stringOf(semantic: unknown, field: string): string {
  const value = record(semantic)[field];
  return typeof value === "string" ? value : "";
}

const GEO_OPTIONS: readonly SelectOption[] = GEO_KINDS.map((kind) => ({
  value: kind,
  label: kind.charAt(0).toUpperCase() + kind.slice(1),
}));

const ARROWHEAD_OPTIONS: readonly SelectOption[] = ARROWHEADS.map((head) => ({
  value: head,
  label: head.charAt(0).toUpperCase() + head.slice(1),
}));

const ASSOCIATION_OPTIONS: readonly SelectOption[] = UML_ASSOCIATION_KINDS.map(
  (kind) => ({
    value: kind,
    label:
      kind === "assoc"
        ? "Association"
        : kind === "aggregate"
          ? "Aggregation"
          : kind === "compose"
            ? "Composition"
            : "Inheritance",
  }),
);

const PAGE_KIND_OPTIONS: readonly SelectOption[] = PAGE_KINDS.map((kind) => ({
  value: kind,
  label: kind.charAt(0).toUpperCase() + kind.slice(1),
}));

export function GeoSection(props: ElementSectionProps): JSX.Element {
  const semantic = () => record(props.element.semantic);
  return (
    <Section title="Shape">
      <Field label="Kind">
        <SelectInput
          label="Shape kind"
          value={stringOf(semantic(), "geo") || "rect"}
          options={GEO_OPTIONS}
          onCommit={(geo) =>
            writeSemantic(props.editor, props.element.id, {
              ...semantic(),
              geo,
            })
          }
        />
      </Field>
      <Field label="Label">
        <TextInput
          label="Label"
          value={stringOf(semantic(), "label")}
          onCommit={(label) =>
            writeSemantic(
              props.editor,
              props.element.id,
              withOptionalString(semantic(), "label", label),
            )
          }
        />
      </Field>
    </Section>
  );
}

export function NodeSection(props: ElementSectionProps): JSX.Element {
  const semantic = () => record(props.element.semantic);
  return (
    <Section title="Node">
      <Field label="Label">
        <TextInput
          label="Label"
          value={stringOf(semantic(), "label")}
          onCommit={(label) =>
            writeSemantic(props.editor, props.element.id, {
              ...semantic(),
              label,
            })
          }
        />
      </Field>
    </Section>
  );
}

export function TextNoteSection(props: ElementSectionProps): JSX.Element {
  const semantic = () => record(props.element.semantic);
  return (
    <Section title="Text">
      <TextArea
        label="Text"
        rows={5}
        value={stringOf(semantic(), "text")}
        onCommit={(text) =>
          writeSemantic(props.editor, props.element.id, {
            ...semantic(),
            text,
          })
        }
      />
    </Section>
  );
}

export function EdgeSection(props: ElementSectionProps): JSX.Element {
  const semantic = () => record(props.element.semantic);
  const arrowheads = () => record(semantic()["arrowheads"]);
  const setArrowhead = (end: "start" | "end", value: string): void => {
    writeSemantic(props.editor, props.element.id, {
      ...semantic(),
      arrowheads: { ...arrowheads(), [end]: value },
    });
  };
  return (
    <Section title="Edge">
      <Field label="Label">
        <TextInput
          label="Label"
          value={stringOf(semantic(), "label")}
          onCommit={(label) =>
            writeSemantic(
              props.editor,
              props.element.id,
              withOptionalString(semantic(), "label", label),
            )
          }
        />
      </Field>
      <Field label="Start">
        <SelectInput
          label="Start arrowhead"
          value={stringOf(arrowheads(), "start") || "none"}
          options={ARROWHEAD_OPTIONS}
          onCommit={(value) => setArrowhead("start", value)}
        />
      </Field>
      <Field label="End">
        <SelectInput
          label="End arrowhead"
          value={stringOf(arrowheads(), "end") || "arrow"}
          options={ARROWHEAD_OPTIONS}
          onCommit={(value) => setArrowhead("end", value)}
        />
      </Field>
    </Section>
  );
}

export function AssociationSection(props: ElementSectionProps): JSX.Element {
  const semantic = () => record(props.element.semantic);
  const cardinalities = () => record(semantic()["cardinalities"]);
  const setCardinality = (end: "from" | "to", value: string): void => {
    const next = withOptionalString(cardinalities(), end, value);
    const { cardinalities: _dropped, ...rest } = semantic();
    writeSemantic(
      props.editor,
      props.element.id,
      Object.keys(next).length === 0 ? rest : { ...rest, cardinalities: next },
    );
  };
  return (
    <Section title="Association">
      <Field label="Kind">
        <SelectInput
          label="Association kind"
          value={stringOf(semantic(), "kind") || "assoc"}
          options={ASSOCIATION_OPTIONS}
          onCommit={(kind) =>
            writeSemantic(props.editor, props.element.id, {
              ...semantic(),
              kind,
            })
          }
        />
      </Field>
      <Field label="Label">
        <TextInput
          label="Label"
          value={stringOf(semantic(), "label")}
          onCommit={(label) =>
            writeSemantic(
              props.editor,
              props.element.id,
              withOptionalString(semantic(), "label", label),
            )
          }
        />
      </Field>
      <Field label="From">
        <TextInput
          label="From cardinality"
          placeholder="e.g. 1"
          value={stringOf(cardinalities(), "from")}
          onCommit={(value) => setCardinality("from", value)}
        />
      </Field>
      <Field label="To">
        <TextInput
          label="To cardinality"
          placeholder="e.g. 0..*"
          value={stringOf(cardinalities(), "to")}
          onCommit={(value) => setCardinality("to", value)}
        />
      </Field>
    </Section>
  );
}

export function GroupSection(props: ElementSectionProps): JSX.Element {
  const count = () => memberIdsOf(props.element).length;
  return (
    <Section title="Group">
      <p class="diagra-inspector-note">
        {count() === 1 ? "1 member" : `${count()} members`}
      </p>
      <button
        type="button"
        class="diagra-inspector-button"
        title="Ungroup (Cmd+Shift+G)"
        onClick={() => props.editor.ungroupSelection()}
      >
        Ungroup
      </button>
    </Section>
  );
}

export interface PageSectionProps {
  readonly editor: Editor;
  readonly page: Page;
}

export function PageSection(props: PageSectionProps): JSX.Element {
  return (
    <Section title="Page">
      <Field label="Name">
        <TextInput
          label="Page name"
          value={props.page.name}
          onCommit={(name) => props.editor.renamePage(props.page.id, name)}
        />
      </Field>
      <Field label="Kind">
        <SelectInput
          label="Page kind"
          value={props.page.kind}
          options={PAGE_KIND_OPTIONS}
          onCommit={(kind) =>
            props.editor.setPageKind(props.page.id, kind as PageKind)
          }
        />
      </Field>
      <p class="diagra-inspector-note">
        Select an element to edit its content and style.
      </p>
    </Section>
  );
}
