import {
  type Editor,
  createSelectionResizeSnapshot,
  resizeSelection,
} from "@diagra/core";
import { createMemo, createSignal, type JSX, Show } from "solid-js";
import { createEditorSignals } from "../adapter.ts";
import { Field, NumberInput, Section } from "./controls.tsx";

/** Exact editing of the collective bounds uses the same commands as canvas gestures. */
export function SelectionGeometrySection(props: {
  editor: Editor;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const [proportional, setProportional] = createSignal(false);
  const snapshot = createMemo(() => {
    signals.rev();
    signals.selection();
    return createSelectionResizeSnapshot(props.editor);
  });
  const bounds = createMemo(() => {
    signals.rev();
    signals.selection();
    return snapshot()?.bounds ?? props.editor.getSelectionBounds();
  });
  const move = (axis: "x" | "y", value: number): void => {
    const current = bounds();
    if (!current) return;
    props.editor.nudgeSelection(
      axis === "x" ? value - current.x : 0,
      axis === "y" ? value - current.y : 0,
    );
  };
  const resize = (axis: "width" | "height", value: number): void => {
    const current = createSelectionResizeSnapshot(props.editor);
    if (!current) return;
    const target = { ...current.bounds, [axis]: value };
    if (proportional()) {
      const scale = value / current.bounds[axis];
      target.width = current.bounds.width * scale;
      target.height = current.bounds.height * scale;
    }
    resizeSelection(props.editor, current, target);
  };
  return (
    <Section title="Selection geometry">
      <div class="diagra-field-grid">
        <Field label="X">
          <NumberInput
            label="Selection X"
            value={bounds()?.x ?? null}
            disabled={!bounds()}
            onCommit={(value) => move("x", value)}
          />
        </Field>
        <Field label="Y">
          <NumberInput
            label="Selection Y"
            value={bounds()?.y ?? null}
            disabled={!bounds()}
            onCommit={(value) => move("y", value)}
          />
        </Field>
        <Field label="Width">
          <NumberInput
            label="Selection width"
            value={bounds()?.width ?? null}
            min={1}
            disabled={!snapshot()}
            onCommit={(value) => resize("width", value)}
          />
        </Field>
        <Field label="Height">
          <NumberInput
            label="Selection height"
            value={bounds()?.height ?? null}
            min={1}
            disabled={!snapshot()}
            onCommit={(value) => resize("height", value)}
          />
        </Field>
      </div>
      <label>
        <input
          type="checkbox"
          checked={proportional()}
          disabled={!snapshot()}
          onChange={(event) => setProportional(event.currentTarget.checked)}
        />
        Preserve selection proportions
      </label>
      <p class="diagra-muted">
        Dimensions scale the whole selection, including spacing. Artboard
        contents follow constraints and auto layout.
      </p>
      <Show when={!snapshot()}>
        <p class="diagra-muted">
          This selection cannot be resized together. Select unlocked, visible
          resizable layers; connectors cannot be independent resize targets.
        </p>
      </Show>
    </Section>
  );
}
