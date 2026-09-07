import {
  auditAccessibility,
  updateElementAccessibility,
  type Editor,
} from "@diagra/core";
import {
  ACCESSIBILITY_ROLES,
  type AccessibilityRole,
  type Element,
} from "@diagra/ir";
import { For, type JSX, Show } from "solid-js";
import {
  Checkbox,
  Field,
  NumberInput,
  Section,
  SelectInput,
  TextInput,
} from "./controls.tsx";

export interface AccessibilitySectionProps {
  readonly editor: Editor;
  readonly element: Element;
}

const ROLE_OPTIONS = [
  { value: "", label: "Not specified" },
  ...ACCESSIBILITY_ROLES.map((role) => ({ value: role, label: role })),
];

export function AccessibilitySection(
  props: AccessibilitySectionProps,
): JSX.Element {
  const metadata = () => props.element.accessibility ?? {};
  const update = (
    patch: Parameters<typeof updateElementAccessibility>[2],
  ): void => updateElementAccessibility(props.editor, props.element.id, patch);
  const audit = () => auditAccessibility(props.editor, props.element.id);
  return (
    <Section title="Accessibility">
      <Field label="Role">
        <SelectInput
          label="Accessibility role"
          value={metadata().role ?? ""}
          options={ROLE_OPTIONS}
          onCommit={(role) =>
            update({ role: (role || null) as AccessibilityRole | null })
          }
        />
      </Field>
      <Field label="Label">
        <TextInput
          label="Accessibility label"
          value={metadata().label ?? ""}
          placeholder="Name announced to assistive technology"
          onCommit={(label) => update({ label })}
        />
      </Field>
      <Field label="Hint">
        <TextInput
          label="Accessibility hint"
          value={metadata().hint ?? ""}
          placeholder="What happens when activated"
          onCommit={(hint) => update({ hint })}
        />
      </Field>
      <Field label="Value">
        <TextInput
          label="Accessibility value"
          value={metadata().value ?? ""}
          placeholder="Current state or value"
          onCommit={(value) => update({ value })}
        />
      </Field>
      {metadata().role === "heading" ? (
        <Field label="Level">
          <NumberInput
            label="Heading level"
            value={metadata().headingLevel ?? null}
            min={1}
            max={6}
            onCommit={(headingLevel) => update({ headingLevel })}
          />
        </Field>
      ) : null}
      <Checkbox
        label="Decorative"
        checked={metadata().decorative ?? false}
        onCommit={(decorative) => update({ decorative })}
      />
      <Checkbox
        label="Disabled"
        checked={metadata().disabled ?? false}
        onCommit={(disabled) => update({ disabled })}
      />
      <p>
        Exported to HTML ARIA, SwiftUI accessibility modifiers, and Jetpack
        Compose semantics. Decorative layers are hidden from assistive
        technology.
      </p>
      <Show when={audit()}>
        {(report) => (
          <>
            <p role="status">
              {report().passed
                ? `Audit passed for ${report().auditedElements} visible layer${report().auditedElements === 1 ? "" : "s"}.`
                : `${report().errors} error${report().errors === 1 ? "" : "s"}, ${report().warnings} warning${report().warnings === 1 ? "" : "s"}.`}
            </p>
            <Show when={report().issues.length}>
              <ul>
                <For each={report().issues.slice(0, 6)}>
                  {(issue) => (
                    <li>
                      <button
                        type="button"
                        onClick={() =>
                          props.editor.selection.set([issue.elementId])
                        }
                      >
                        {`${issue.severity}: ${issue.message}`}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </>
        )}
      </Show>
    </Section>
  );
}
