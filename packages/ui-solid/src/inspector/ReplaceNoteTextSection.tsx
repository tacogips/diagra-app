import {
  type Editor,
  previewNoteTextReplacement,
  replaceSelectedNoteText,
} from "@diagra/core";
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import { createEditorSignals } from "../adapter.ts";

export function ReplaceNoteTextSection(props: { editor: Editor }): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const [find, setFind] = createSignal("");
  const [replacement, setReplacement] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const preview = createMemo(() => {
    if (!open()) return { rows: [], error: "" };
    signals.rev();
    signals.selection();
    try {
      return {
        rows: previewNoteTextReplacement(props.editor, find(), replacement()),
        error: "",
      };
    } catch (error) {
      return {
        rows: [],
        error:
          error instanceof Error
            ? error.message
            : "Cannot preview replacement.",
      };
    }
  });
  return (
    <details
      class="diagra-inspector-section"
      onToggle={(event) => {
        if (event.target === event.currentTarget)
          setOpen(event.currentTarget.open);
      }}
    >
      <summary>Replace selected note text</summary>
      <p>
        Literal, case-sensitive replacement in selected text notes only. Locked
        notes are skipped; layer names and database fields are unchanged.
      </p>
      <input
        aria-label="Find in selected note text"
        placeholder="Find"
        maxLength={256}
        value={find()}
        onInput={(event) => {
          setFind(event.currentTarget.value);
          setStatus("");
        }}
      />
      <input
        aria-label="Replacement for selected note text"
        placeholder="Replace with"
        maxLength={256}
        value={replacement()}
        onInput={(event) => {
          setReplacement(event.currentTarget.value);
          setStatus("");
        }}
      />
      <p>
        {preview().rows.reduce((total, row) => total + row.matches, 0)}{" "}
        occurrences in {preview().rows.length} notes will change.
      </p>
      <For each={preview().rows.slice(0, 5)}>
        {(row) => (
          <details class="diagra-note-replacement-preview">
            <summary>
              {Array.from(row.name).slice(0, 80).join("")}
              {Array.from(row.name).length > 80 ? "..." : ""} ({row.matches}{" "}
              matches)
            </summary>
            <p>Before</p>
            <pre>{row.previous}</pre>
            <p>After{row.text === "" ? " (empty text)" : ""}</p>
            <pre>{row.text}</pre>
          </details>
        )}
      </For>
      <Show when={preview().rows.length > 5}>
        <p>
          Showing the first 5 of {preview().rows.length} affected notes. All
          counted notes will be updated.
        </p>
      </Show>
      <button
        type="button"
        disabled={!preview().rows.length || Boolean(preview().error)}
        onClick={() => {
          try {
            setStatus(
              `Updated ${replaceSelectedNoteText(props.editor, find(), replacement())} notes.`,
            );
          } catch (error) {
            setStatus(
              error instanceof Error ? error.message : "Replacement failed.",
            );
          }
        }}
      >
        Replace text
      </button>
      <p role="status">{preview().error || status()}</p>
    </details>
  );
}
