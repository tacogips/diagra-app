import {
  applyErdDefinition,
  formatErdDefinition,
  type DatabaseDialect,
  type Editor,
} from "@nodetto/core";
import type { Element, ErdTableSemantic } from "@nodetto/ir";
import { createEffect, createSignal, on, Show, type JSX } from "solid-js";
import { createEditorSignals } from "../adapter.ts";
import { HelpHint } from "../HelpHint.tsx";

interface Draft {
  text: string;
  baseline: string;
  dialect: DatabaseDialect;
}
const drafts = new WeakMap<Editor, Map<string, Draft>>();

export function ErdTextEditor(props: {
  editor: Editor;
  element: Element;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const draftMap = drafts.get(props.editor) ?? new Map<string, Draft>();
  drafts.set(props.editor, draftMap);
  const draftKey = () => {
    signals.rev();
    return JSON.stringify([props.editor.store.getMeta().id, props.element.id]);
  };
  const fresh = (): Draft => {
    const element = props.editor.store.get(props.element.id) ?? props.element;
    const dialect =
      props.editor.store.getPage(element.page)?.sqlDialect ?? "postgresql";
    return {
      text: formatErdDefinition(
        (element.semantic as ErdTableSemantic).columns,
        dialect,
      ),
      baseline: JSON.stringify(element.semantic),
      dialect,
    };
  };
  const [draft, setDraft] = createSignal(draftMap.get(draftKey()) ?? fresh());
  const [error, setError] = createSignal("");
  createEffect(
    on(draftKey, (id) => {
      setDraft(draftMap.get(id) ?? fresh());
      setError("");
    }),
  );
  const stale = () => {
    signals.rev();
    return (
      draft().baseline !==
        JSON.stringify(props.editor.store.get(props.element.id)?.semantic) ||
      draft().dialect !==
        (props.editor.store.getPage(props.element.page)?.sqlDialect ??
          "postgresql")
    );
  };
  const update = (value: Draft) => {
    draftMap.set(draftKey(), value);
    setDraft(value);
  };
  return (
    <div class="nodetto-erd-text">
      <HelpHint text="Comma-separated columns. Supports PK, NULL/NOT NULL, literal defaults and integer auto-increment. Apply commits once; Reload discards this draft. Indexes and relations remain in Columns mode." />
      <textarea
        aria-label="Table definition"
        rows={12}
        spellcheck={false}
        value={draft().text}
        onInput={(event) => {
          update({ ...draft(), text: event.currentTarget.value });
          setError("");
        }}
      />
      <div class="nodetto-inspector-actions">
        <button
          type="button"
          disabled={stale()}
          onClick={() => {
            const result = applyErdDefinition(
              props.editor,
              props.element.id,
              draft().text,
              draft().dialect,
              draft().baseline,
            );
            setError(result ?? "");
            if (!result) {
              draftMap.delete(draftKey());
              setDraft(fresh());
            }
          }}
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => {
            draftMap.delete(draftKey());
            setDraft(fresh());
            setError("");
          }}
        >
          Reload
        </button>
      </div>
      <Show when={stale()}>
        <p role="status">Table or dialect changed. Reload to continue.</p>
      </Show>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
    </div>
  );
}
