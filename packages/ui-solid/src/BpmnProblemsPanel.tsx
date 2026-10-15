import type { Editor, ViewportSize } from "@nodetto/core";
import type { BpmnImportWarning } from "@nodetto/io";
import {
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { bpmnProblemRows, focusBpmnProblem } from "./bpmn-problems.ts";
import "./BpmnProblemsPanel.css";

export interface BpmnProblemsPanelProps {
  readonly editor: Editor;
  readonly viewport: () => ViewportSize;
  readonly importWarnings?: readonly BpmnImportWarning[];
}

export function BpmnProblemsPanel(props: BpmnProblemsPanelProps): JSX.Element {
  const [rows, setRows] = createSignal<ReturnType<typeof bpmnProblemRows>>([]);
  const [rejection, setRejection] = createSignal("");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = (): void => {
    const snapshot = props.editor.store.getSnapshot();
    setRows(bpmnProblemRows(snapshot, props.editor.currentPageId));
  };
  const scheduleRefresh = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      refresh();
    }, 300);
  };

  onMount(() => {
    refresh();
    const unsubscribeEditor = props.editor.subscribe(scheduleRefresh);
    const unsubscribeStore = props.editor.store.subscribe(() =>
      setRejection(""),
    );
    const unsubscribeRejection = props.editor.onBpmnRejection((event) =>
      setRejection(event.message),
    );
    onCleanup(() => {
      if (timer !== undefined) clearTimeout(timer);
      unsubscribeEditor();
      unsubscribeStore();
      unsubscribeRejection();
    });
  });

  return (
    <Show
      when={
        props.editor.store.getPage(props.editor.currentPageId)?.kind === "bpmn"
      }
    >
      <section class="nodetto-bpmn-problems" aria-label="BPMN problems">
        <Show when={rejection()}>
          {(message) => (
            <p class="nodetto-bpmn-problems-status" role="status">
              {message()}
            </p>
          )}
        </Show>
        <p class="nodetto-bpmn-problems-summary">
          {rows().length === 0
            ? "No problems"
            : `${rows().length} problems (${rows().filter((row) => row.severity === "error").length} errors, ${rows().filter((row) => row.severity === "warning").length} warnings)`}
        </p>
        <ul class="nodetto-bpmn-problems-list">
          <For each={rows()}>
            {(row) => (
              <li>
                <button
                  class="nodetto-bpmn-problem"
                  type="button"
                  disabled={!row.selectable}
                  onClick={() =>
                    focusBpmnProblem(props.editor, row, props.viewport())
                  }
                >
                  <span class="nodetto-bpmn-problem-severity">
                    {row.severity}
                  </span>
                  <span class="nodetto-bpmn-problem-label">{row.label}</span>
                  <span>{row.message}</span>
                  <span class="nodetto-bpmn-problem-rule">{row.ruleId}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
        <Show when={(props.importWarnings?.length ?? 0) > 0}>
          <section
            class="nodetto-bpmn-import-warnings"
            aria-label="Import warnings"
          >
            <h3>Import warnings</h3>
            <ul>
              <For each={props.importWarnings ?? []}>
                {(warning) => (
                  <li>
                    <span>{warning.element}</span>
                    <Show when={warning.xmlId}>
                      {(xmlId) => <span> ({xmlId()})</span>}
                    </Show>
                    <span>: {warning.message}</span>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>
      </section>
    </Show>
  );
}
