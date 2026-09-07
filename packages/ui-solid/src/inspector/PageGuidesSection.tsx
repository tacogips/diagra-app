import {
  addPageGuide,
  type Editor,
  pageGuides,
  removePageGuide,
  updatePageGuide,
} from "@diagra/core";
import type { GuideAxis, Page } from "@diagra/ir";
import { For, type JSX } from "solid-js";
import { createEditorSignals } from "../adapter.ts";
import {
  Checkbox,
  Field,
  NumberInput,
  SelectInput,
  type SelectOption,
  TextInput,
} from "./controls.tsx";

const GUIDE_AXIS_OPTIONS: readonly SelectOption[] = [
  { value: "x", label: "Vertical (X)" },
  { value: "y", label: "Horizontal (Y)" },
];

export function PageGuidesSection(props: {
  readonly editor: Editor;
  readonly page: Page;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const guides = () => {
    signals.rev();
    return pageGuides(props.editor, props.page.id);
  };

  return (
    <details>
      <summary>{`Guides (${guides().length})`}</summary>
      <For each={guides()}>
        {(guide, index) => (
          <div class="diagra-inspector-subsection">
            <Field label="Axis">
              <SelectInput
                label={`Guide ${index() + 1} axis`}
                value={guide.axis}
                options={GUIDE_AXIS_OPTIONS}
                disabled={guide.locked}
                onCommit={(axis) =>
                  updatePageGuide(props.editor, guide.id, {
                    axis: axis as GuideAxis,
                  })
                }
              />
            </Field>
            <Field label="Position">
              <NumberInput
                label={`Guide ${index() + 1} position`}
                value={guide.position}
                disabled={guide.locked}
                onCommit={(position) =>
                  updatePageGuide(props.editor, guide.id, { position })
                }
              />
            </Field>
            <Field label="Color">
              <TextInput
                label={`Guide ${index() + 1} color`}
                value={guide.color}
                disabled={guide.locked}
                onCommit={(color) =>
                  updatePageGuide(props.editor, guide.id, { color })
                }
              />
            </Field>
            <Checkbox
              label="Hidden"
              checked={guide.hidden}
              disabled={guide.locked}
              onCommit={(hidden) =>
                updatePageGuide(props.editor, guide.id, { hidden })
              }
            />
            <Checkbox
              label="Locked"
              checked={guide.locked}
              onCommit={(locked) =>
                updatePageGuide(props.editor, guide.id, { locked })
              }
            />
            <button
              type="button"
              class="diagra-inspector-button"
              disabled={guide.locked}
              onClick={() => removePageGuide(props.editor, guide.id)}
            >
              Remove guide
            </button>
          </div>
        )}
      </For>
      <button
        type="button"
        class="diagra-inspector-button"
        onClick={() => addPageGuide(props.editor, props.page.id, "x", 0)}
      >
        Add vertical guide
      </button>
      <button
        type="button"
        class="diagra-inspector-button"
        onClick={() => addPageGuide(props.editor, props.page.id, "y", 0)}
      >
        Add horizontal guide
      </button>
    </details>
  );
}

export default PageGuidesSection;
