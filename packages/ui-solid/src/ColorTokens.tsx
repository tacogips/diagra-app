import {
  colorTokens,
  bindSelectionColor,
  createColorToken,
  designTokenModes,
  type Editor,
  pageTokenMode,
  removeDesignTokenMode,
  renameDesignTokenMode,
  setColorTokenAlias,
  updateColorToken,
} from "@diagra/core";
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { createEditorSignals } from "./adapter.ts";

/** Shared palette with optional live color bindings. */
export function ColorTokens(props: { readonly editor: Editor }): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const [name, setName] = createSignal("");
  const [value, setValue] = createSignal("#2563eb");
  const [newMode, setNewMode] = createSignal("");
  const [linked, setLinked] = createSignal(true);
  const tokens = createMemo(() => {
    signals.rev();
    return colorTokens(props.editor);
  });
  const mode = createMemo(() => {
    signals.rev();
    return pageTokenMode(props.editor.store, props.editor.currentPageId) ?? "";
  });
  const modes = createMemo(() => {
    signals.rev();
    return designTokenModes(props.editor.store);
  });
  return (
    <section
      class="diagra-color-tokens"
      aria-label="Document color palette"
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <h2>Color palette</h2>
      <p>
        Linked colors follow palette edits. Direct style edits unlink that
        field.
      </p>
      <label>
        Page mode
        <select
          aria-label="Page token mode"
          value={mode()}
          onChange={(event) =>
            props.editor.setPageTokenMode(
              props.editor.currentPageId,
              event.currentTarget.value || null,
            )
          }
        >
          <option value="">Default</option>
          <For each={modes()}>
            {(entry) => <option value={entry}>{entry}</option>}
          </For>
        </select>
      </label>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const name = newMode().trim();
          if (!name || name.toLowerCase() === "default") return;
          const changed = mode()
            ? renameDesignTokenMode(props.editor, mode(), name)
            : props.editor.setPageTokenMode(props.editor.currentPageId, name);
          if (changed) setNewMode("");
        }}
      >
        <input
          aria-label="New token mode"
          placeholder={mode() ? `Rename ${mode()}` : "Dark or Android"}
          value={newMode()}
          onInput={(event) => setNewMode(event.currentTarget.value)}
        />
        <button type="submit" disabled={!newMode().trim()}>
          {mode() ? "Rename mode" : "Add mode"}
        </button>
        <Show when={mode()}>
          {(active) => (
            <button
              type="button"
              onClick={() => removeDesignTokenMode(props.editor, active())}
            >
              Remove mode
            </button>
          )}
        </Show>
      </form>
      <label>
        <input
          type="checkbox"
          checked={linked()}
          onChange={(event) => setLinked(event.currentTarget.checked)}
        />
        Link applied colors
      </label>
      <div class="diagra-color-entry">
        <For each={["fill", "stroke", "color"] as const}>
          {(field) => (
            <button
              type="button"
              disabled={signals.selection().size === 0}
              onClick={() => bindSelectionColor(props.editor, field, null)}
            >
              Unlink {field === "color" ? "text" : field}
            </button>
          )}
        </For>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (createColorToken(props.editor, name(), value())) setName("");
        }}
      >
        <input
          aria-label="New color name"
          placeholder="Primary"
          required
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <input
          type="color"
          aria-label="New color value"
          value={value()}
          onInput={(event) => setValue(event.currentTarget.value)}
        />
        <button type="submit" disabled={!name().trim()}>
          Add color
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
                    !updateColorToken(
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
                type="color"
                aria-label={`${token.name} color`}
                value={token.value}
                disabled={locked() || token.aliasId !== null}
                onChange={(event) =>
                  updateColorToken(
                    props.editor,
                    token.id,
                    token.name,
                    event.currentTarget.value,
                  )
                }
              />
              <select
                aria-label={`${token.name} alias`}
                value={token.aliasId ?? ""}
                disabled={locked()}
                onChange={(event) => {
                  if (
                    !setColorTokenAlias(
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
              <div>
                <For each={["fill", "stroke", "color"] as const}>
                  {(field) => (
                    <button
                      type="button"
                      disabled={signals.selection().size === 0}
                      title={`Apply ${token.name} as ${field === "color" ? "text color" : field} to selection (${linked() ? "linked" : "copy value"})`}
                      onClick={() =>
                        linked()
                          ? bindSelectionColor(props.editor, field, token.id)
                          : props.editor.setSelectionStyle({
                              [field]: token.value,
                            })
                      }
                    >
                      {field === "color"
                        ? "Text"
                        : field === "fill"
                          ? "Fill"
                          : "Stroke"}
                    </button>
                  )}
                </For>
                <button
                  type="button"
                  disabled={locked()}
                  title={`Remove ${token.name} from palette; applied colors stay unchanged`}
                  onClick={() => props.editor.deleteElements([token.id])}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        }}
      </For>
    </section>
  );
}
