import {
  type Editor,
  previewLayerNames,
  renameSelectedLayers,
} from "@diagra/core";
import { createMemo, createSignal, For, type JSX } from "solid-js";
import { createEditorSignals } from "../adapter.ts";
import { Field, NumberInput } from "./controls.tsx";

export function BatchRenameSection(props: { editor: Editor }): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const [pattern, setPattern] = createSignal("{name}");
  const [start, setStart] = createSignal(1);
  const [digits, setDigits] = createSignal(1);
  const [find, setFind] = createSignal("");
  const [replace, setReplace] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const options = () => ({
    pattern: pattern(),
    start: start(),
    digits: digits(),
    find: find(),
    replace: replace(),
  });
  const preview = createMemo(() => {
    if (!open()) return { rows: [], error: "" };
    signals.rev();
    signals.selection();
    try {
      return { rows: previewLayerNames(props.editor, options()), error: "" };
    } catch (error) {
      return {
        rows: [],
        error:
          error instanceof Error ? error.message : "Invalid rename pattern.",
      };
    }
  });
  const count = () => preview().rows.filter((row) => row.changed).length;
  return (
    <details
      class="diagra-inspector-section"
      onToggle={(event) => {
        if (event.target === event.currentTarget)
          setOpen(event.currentTarget.open);
      }}
    >
      <summary>Rename selected layers</summary>
      <p>
        Use {"{name}"}, {"{type}"} and {"{n}"}. Numbering follows layer-panel
        order and skips locked layers. Clear the pattern to restore content
        labels.
      </p>
      <input
        type="text"
        aria-label="Batch layer name pattern"
        value={pattern()}
        maxLength={256}
        onInput={(event) => {
          setPattern(event.currentTarget.value);
          setStatus("");
        }}
      />
      <Field label="Find in name">
        <input
          type="text"
          aria-label="Find text in layer names"
          maxLength={256}
          value={find()}
          onInput={(event) => {
            setFind(event.currentTarget.value);
            setStatus("");
          }}
        />
      </Field>
      <Field label="Replace with">
        <input
          type="text"
          aria-label="Replacement text for layer names"
          maxLength={256}
          value={replace()}
          onInput={(event) => {
            setReplace(event.currentTarget.value);
            setStatus("");
          }}
        />
      </Field>
      <p>
        Find/replace is literal and case-sensitive, applied before {"{name}"}.
        Leave Find empty to skip replacement.
      </p>
      <Field label="Start">
        <NumberInput
          label="Layer numbering start"
          value={start()}
          min={0}
          max={999999}
          onCommit={(value) => setStart(Math.round(value))}
        />
      </Field>
      <Field label="Digits">
        <NumberInput
          label="Layer numbering digits"
          value={digits()}
          min={1}
          max={6}
          onCommit={(value) => setDigits(Math.round(value))}
        />
      </Field>
      <ul>
        <For each={preview().rows.slice(0, 8)}>
          {(row) => (
            <li>
              {row.previous} → {row.displayName}
            </li>
          )}
        </For>
      </ul>
      <p>
        {preview().rows.length} eligible layers; {count()} names will change.
        Preview shows up to eight.
      </p>
      <button
        type="button"
        disabled={!count() || Boolean(preview().error)}
        onClick={() => {
          try {
            setStatus(
              `Renamed ${renameSelectedLayers(props.editor, options())} layers.`,
            );
          } catch (error) {
            setStatus(
              error instanceof Error ? error.message : "Rename failed.",
            );
          }
        }}
      >
        Apply names
      </button>
      <p role="status">{preview().error || status()}</p>
    </details>
  );
}
