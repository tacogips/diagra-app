import {
  type Editor,
  previewNoteTextReplacement,
  replaceSelectedNoteText,
} from "@nodetto/core";
import { createMemo, createSignal, For, type JSX } from "solid-js";
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
      class="nodetto-inspector-section"
      onToggle={(event) => {
        if (event.target === event.currentTarget)
          setOpen(event.currentTarget.open);
      }}
    >
      <summary>Replace selected note text</summary>
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
        {preview().rows.length} notes · {Math.min(preview().rows.length, 5)}{" "}
        shown
      </p>
      <For each={preview().rows.slice(0, 5)}>
        {(row) => (
          <details class="nodetto-note-replacement-preview">
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
