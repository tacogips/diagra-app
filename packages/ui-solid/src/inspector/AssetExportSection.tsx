import type { Editor } from "@diagra/core";
import type { ElementId } from "@diagra/ir";
import { createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import {
  assetFileName,
  rasterExportSnapshot,
  rasterizeSvg,
  RASTER_SCALES,
} from "../raster-export.ts";
import { NumberInput } from "../NumberInput.tsx";

export function AssetExportSection(props: {
  editor: Editor;
  id?: ElementId;
  hasSelection: boolean;
}): JSX.Element {
  const [scale, setScale] = createSignal(1);
  const [preferredScope, setPreferredScope] = createSignal("auto");
  const scope = () =>
    preferredScope() === "page"
      ? "page"
      : preferredScope() === "selection" && props.hasSelection
        ? "selection"
        : props.id
          ? "artboard"
          : props.hasSelection
            ? "selection"
            : "page";
  const [padding, setPadding] = createSignal(0);
  const [transparent, setTransparent] = createSignal(true);
  const [background, setBackground] = createSignal("#ffffff");
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal("");
  let disposed = false;
  let pending: AbortController | undefined;
  onCleanup(() => {
    disposed = true;
    pending?.abort();
  });
  const download = async (): Promise<void> => {
    if (busy()) return;
    setBusy(true);
    setStatus("");
    pending = new AbortController();
    const pageId = props.editor.currentPageId;
    const meta = props.editor.store.getMeta();
    const unsubscribe = props.editor.subscribe(() => {
      if (
        props.editor.currentPageId !== pageId ||
        props.editor.store.getMeta() !== meta
      )
        pending?.abort();
    });
    try {
      // Capture one consistent asset before yielding to the browser renderer.
      const snapshot = rasterExportSnapshot(props.editor, {
        artboardId: scope() === "artboard" ? props.id : undefined,
        wholePage: scope() === "page",
        padding: padding(),
        background: transparent() ? null : background(),
      });
      const selectedScale = scale();
      const name = assetFileName(snapshot.name, selectedScale);
      const blob = await rasterizeSvg(
        snapshot.svg,
        selectedScale,
        pending.signal,
      );
      if (disposed) return;
      if (pending.signal.aborted) throw new Error("PNG export cancelled.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setStatus("PNG download requested.");
    } catch (error) {
      if (!disposed)
        setStatus(
          error instanceof Error
            ? error.message
            : "PNG export failed. Try SVG instead.",
        );
    } finally {
      unsubscribe();
      pending = undefined;
      if (!disposed) setBusy(false);
    }
  };
  return (
    <details class="diagra-inspector-section">
      <summary>Export PNG</summary>
      <p>
        Exports a snapshot through the browser. Fonts and image decoding may
        vary by platform. Maximum 8192 pixels per side, 32 megapixels.
      </p>
      <select
        aria-label="PNG export scope"
        value={scope()}
        disabled={busy()}
        onChange={(event) => setPreferredScope(event.currentTarget.value)}
      >
        <Show when={props.id}>
          <option value="artboard">Artboard envelope</option>
        </Show>
        <Show when={props.hasSelection}>
          <option value="selection">Selected artwork</option>
        </Show>
        <option value="page">Whole page</option>
      </select>
      <Show when={scope() !== "artboard"}>
        <div>
          Padding{" "}
          <NumberInput
            label="PNG padding"
            value={padding()}
            min={0}
            max={256}
            disabled={busy()}
            onCommit={setPadding}
          />
        </div>
      </Show>
      <label>
        <input
          type="checkbox"
          checked={transparent()}
          disabled={busy()}
          onChange={(event) => setTransparent(event.currentTarget.checked)}
        />
        Transparent background
      </label>
      <Show when={!transparent()}>
        <input
          type="color"
          aria-label="PNG background color"
          value={background()}
          disabled={busy()}
          onInput={(event) => setBackground(event.currentTarget.value)}
        />
      </Show>
      <select
        aria-label="PNG export scale"
        value={scale()}
        disabled={busy()}
        onChange={(event) => setScale(Number(event.currentTarget.value))}
      >
        <For each={RASTER_SCALES}>
          {(value) => <option value={value}>{value}×</option>}
        </For>
      </select>
      <button type="button" disabled={busy()} onClick={() => void download()}>
        {busy() ? "Rendering…" : "Download PNG"}
      </button>
      <p role="status">{status()}</p>
      <button type="button" disabled={!busy()} onClick={() => pending?.abort()}>
        Cancel PNG export
      </button>
    </details>
  );
}
