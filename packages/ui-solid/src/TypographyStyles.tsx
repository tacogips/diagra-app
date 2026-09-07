import {
  bindSelectionTextStyle,
  createTextStyle,
  type Editor,
  selectionTextStyleBinding,
  selectionTypography,
  textStyles,
  updateTextStyle,
} from "@diagra/core";
import { createMemo, createSignal, For, type JSX } from "solid-js";
import { createEditorSignals } from "./adapter.ts";

export function TypographyStyles(props: {
  readonly editor: Editor;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const [name, setName] = createSignal("");
  const styles = createMemo(() => {
    signals.rev();
    return textStyles(props.editor);
  });
  const selected = createMemo(() => {
    signals.rev();
    signals.selection();
    return selectionTypography(props.editor);
  });
  const binding = createMemo(() => {
    signals.rev();
    signals.selection();
    return selectionTextStyleBinding(props.editor);
  });
  return (
    <section
      class="diagra-typography-styles"
      aria-label="Document typography styles"
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <h2>Typography</h2>
      <p>
        Create from formatted text, then reuse and update it across screens.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (createTextStyle(props.editor, name())) setName("");
        }}
      >
        <input
          aria-label="New typography style name"
          placeholder="Heading large"
          required
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <button type="submit" disabled={!name().trim()}>
          {selected() ? "Create from selection" : "Create default"}
        </button>
      </form>
      <For each={styles()}>
        {(style) => {
          const locked = () => {
            signals.rev();
            return (
              props.editor.createShapeContext().isLocked?.(style.id) === true
            );
          };
          const linked = () => !binding().mixed && binding().id === style.id;
          return (
            <div class="diagra-typography-entry">
              <input
                aria-label={`Rename ${style.name}`}
                value={style.name}
                disabled={locked()}
                onChange={(event) => {
                  if (
                    !updateTextStyle(
                      props.editor,
                      style.id,
                      event.currentTarget.value,
                      style.value,
                    )
                  )
                    event.currentTarget.value = style.name;
                }}
              />
              <span title={style.value.fontFamily}>
                {style.value.fontSize}px / {style.value.fontWeight}
              </span>
              <button
                type="button"
                disabled={binding().editable === 0}
                aria-pressed={linked()}
                onClick={() => bindSelectionTextStyle(props.editor, style.id)}
              >
                {linked() ? "Applied" : "Apply"}
              </button>
              <button
                type="button"
                disabled={locked() || !selected()}
                onClick={() => {
                  const value = selected();
                  if (value)
                    updateTextStyle(props.editor, style.id, style.name, value);
                }}
              >
                Update
              </button>
              <button
                type="button"
                disabled={locked()}
                title={`Remove ${style.name}; linked text retains its current appearance`}
                onClick={() => props.editor.deleteElements([style.id])}
              >
                Remove
              </button>
            </div>
          );
        }}
      </For>
    </section>
  );
}
