import {
  createNumberToken,
  type Editor,
  numberTokens,
  setNumberTokenAlias,
  updateNumberToken,
} from "@diagra/core";
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { createEditorSignals } from "./adapter.ts";

/** Document-wide measurements used by sizing, spacing, radii and typography. */
export function NumberTokens(props: { readonly editor: Editor }): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const [name, setName] = createSignal("");
  const [value, setValue] = createSignal(8);
  const tokens = createMemo(() => {
    signals.rev();
    return numberTokens(props.editor);
  });
  return (
    <section
      class="diagra-number-tokens"
      aria-label="Document measurement tokens"
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <h2>Measurements</h2>
      <p>
        Reusable pixels for spacing, sizing, corners and typography. Values use
        the current page mode from Color palette.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (createNumberToken(props.editor, name(), value())) setName("");
        }}
      >
        <input
          aria-label="New measurement name"
          placeholder="Space medium"
          required
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <input
          type="number"
          aria-label="New measurement value"
          min="0"
          step="any"
          required
          value={value()}
          onInput={(event) => setValue(event.currentTarget.valueAsNumber)}
        />
        <button
          type="submit"
          disabled={!name().trim() || !Number.isFinite(value())}
        >
          Add measurement
        </button>
      </form>
      <For each={tokens()}>
        {(token) => {
          const locked = () => {
            signals.rev();
            return (
              props.editor.createShapeContext().isLocked?.(token.id) === true
            );
          };
          return (
            <div class="diagra-color-entry">
              <input
                aria-label={`Rename ${token.name}`}
                value={token.name}
                disabled={locked()}
                onChange={(event) => {
                  if (
                    !updateNumberToken(
                      props.editor,
                      token.id,
                      event.currentTarget.value,
                      token.value,
                    )
                  )
                    event.currentTarget.value = token.name;
                }}
              />
              <input
                type="number"
                aria-label={`${token.name} value`}
                min="0"
                step="any"
                value={token.value}
                disabled={locked() || token.aliasId !== null}
                onChange={(event) => {
                  if (
                    !updateNumberToken(
                      props.editor,
                      token.id,
                      token.name,
                      event.currentTarget.valueAsNumber,
                    )
                  )
                    event.currentTarget.value = String(token.value);
                }}
              />
              <select
                aria-label={`${token.name} alias`}
                value={token.aliasId ?? ""}
                disabled={locked()}
                onChange={(event) => {
                  if (
                    !setNumberTokenAlias(
                      props.editor,
                      token.id,
                      event.currentTarget.value || null,
                    )
                  )
                    event.currentTarget.value = token.aliasId ?? "";
                }}
              >
                <option value="">Direct value</option>
                <For each={tokens().filter((entry) => entry.id !== token.id)}>
                  {(entry) => (
                    <option value={entry.id}>Alias {entry.name}</option>
                  )}
                </For>
              </select>
              <Show when={token.broken}>
                <span role="status">Broken alias; using fallback</span>
              </Show>
              <button
                type="button"
                disabled={locked()}
                title={`Remove ${token.name}; linked measurements retain their current value`}
                onClick={() => props.editor.deleteElements([token.id])}
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
