import { createDesignTemplate, DESIGN_TEMPLATES, Editor } from "@nodetto/core";
import type { DesignTemplateId } from "@nodetto/core";
import { For, onMount, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import "./TemplateDialog.css";
export function TemplateDialog(props: {
  onChoose: (id: DesignTemplateId) => void;
  onClose: () => void;
}): JSX.Element {
  let dialog: HTMLDialogElement | undefined;
  const cards = DESIGN_TEMPLATES.map((template) => {
    const editor = new Editor({ document: createDesignTemplate(template.id) });
    const first = editor
      .getSnapshot()
      .elements.filter((e) => e.type === "frame")
      .sort((a, b) => (a.visual.x ?? 0) - (b.visual.x ?? 0))[0];
    const svg = first ? editor.exportArtboardSvg(first.id) : null;
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg ?? "")}`;
    return { ...template, url };
  });
  onMount(() => {
    const previous = document.activeElement;
    dialog?.showModal();
    dialog?.querySelector<HTMLButtonElement>("[data-template]")?.focus();
    onCleanup(() => {
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    });
  });
  return (
    <dialog
      ref={dialog}
      class="app-template-dialog"
      aria-labelledby="template-title"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <header>
        <h2 id="template-title">Templates</h2>
        <button
          type="button"
          aria-label="Close templates"
          onClick={props.onClose}
        >
          Close
        </button>
      </header>
      <div class="app-template-grid">
        <For each={cards}>
          {(card) => (
            <button
              data-template={card.id}
              type="button"
              onClick={() => props.onChoose(card.id)}
            >
              <img src={card.url} alt={`${card.name} preview`} />
              <strong>{card.name}</strong>
              <span>
                {card.screens} screens · {card.width} × {card.height}
              </span>
            </button>
          )}
        </For>
      </div>
    </dialog>
  );
}
