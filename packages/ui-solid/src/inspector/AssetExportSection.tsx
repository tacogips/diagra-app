import "./AssetExportSection.css";
import type { Editor } from "@nodetto/core";
import type { ElementId } from "@nodetto/ir";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";
import { createEditorSignals } from "../adapter.ts";
import {
  assetFileName,
  exportFileStem,
  rasterDimensions,
  rasterExportSnapshot,
  rasterizeSvg,
  RASTER_SCALES,
} from "../raster-export.ts";
import {
  PDF_PAGE_SIZES,
  pdfLayout,
  pngToPdf,
  type PdfPageSize,
  type PdfOrientation,
} from "../pdf-export.ts";
import { NumberInput } from "../NumberInput.tsx";

export type ExportFormat = "svg" | "png" | "pdf";
export type SaveArtwork = (
  name: string,
  blob: Blob,
  format: ExportFormat,
) => Promise<boolean>;

export function AssetExportSection(props: {
  editor: Editor;
  id?: ElementId;
  hasSelection: boolean;
  request?: number;
  save?: SaveArtwork;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const signals = createEditorSignals(props.editor);
  const [format, setFormat] = createSignal<ExportFormat>("svg");
  const [scale, setScale] = createSignal(2);
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
  const [padding, setPadding] = createSignal(16);
  const [transparent, setTransparent] = createSignal(true);
  const [background, setBackground] = createSignal("#ffffff");
  const [pageSize, setPageSize] = createSignal<PdfPageSize>("artwork");
  const [orientation, setOrientation] =
    createSignal<PdfOrientation>("portrait");
  const [margin, setMargin] = createSignal(10);
  const [busy, setBusy] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [status, setStatus] = createSignal("");
  let section: HTMLDetailsElement | undefined;
  let formatInput: HTMLSelectElement | undefined;
  let disposed = false;
  let pending: AbortController | undefined;
  createEffect(() => {
    if (props.request && section) {
      section.open = true;
      setExpanded(true);
      formatInput?.focus();
      section.scrollIntoView({ block: "nearest" });
    }
  });
  onCleanup(() => {
    disposed = true;
    pending?.abort();
  });
  const snapshot = () =>
    rasterExportSnapshot(props.editor, {
      artboardId: scope() === "artboard" ? props.id : undefined,
      wholePage: scope() === "page",
      padding: padding(),
      background:
        format() === "pdf" ? background() : transparent() ? null : background(),
    });
  const preview = createMemo(() => {
    if (!expanded()) return { label: "", error: "" };
    signals.rev();
    signals.selection();
    try {
      const data = snapshot();
      if (format() === "svg")
        return {
          label: `${Math.round(data.width)} × ${Math.round(data.height)} canvas units · vector`,
          error: "",
        };
      const pixels = rasterDimensions(data.width, data.height, scale());
      if (format() === "png")
        return {
          label: `${pixels.width} × ${pixels.height} pixels`,
          error: "",
        };
      const paper = pdfLayout(data.width, data.height, {
        pageSize: pageSize(),
        orientation: orientation(),
        marginMm: margin(),
      });
      return {
        label: `${((paper.pageWidth * 25.4) / 72).toFixed(1)} × ${((paper.pageHeight * 25.4) / 72).toFixed(1)} mm · 1 page · ${pixels.width} × ${pixels.height} image pixels`,
        error: "",
      };
    } catch (error) {
      return {
        label: "",
        error:
          error instanceof Error
            ? error.message
            : "Cannot export this artwork.",
      };
    }
  });
  const download = async () => {
    if (busy() || preview().error) return;
    setBusy(true);
    setStatus("");
    pending = new AbortController();
    const signal = pending.signal;
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
      const data = snapshot();
      const kind = format();
      const density = scale();
      const options = {
        pageSize: pageSize(),
        orientation: orientation(),
        marginMm: margin(),
      };
      let blob: Blob;
      if (kind === "svg")
        blob = new Blob([data.svg], { type: "image/svg+xml" });
      else {
        const png = await rasterizeSvg(data.svg, density, signal);
        blob =
          kind === "pdf"
            ? await pngToPdf(png, data.width, data.height, options, signal)
            : png;
      }
      if (signal.aborted) throw new Error("Export cancelled.");
      if (disposed) return;
      const name =
        kind === "png"
          ? assetFileName(data.name, density)
          : `${exportFileStem(data.name)}.${kind}`;
      if (props.save) {
        setSaving(true);
        const saved = await props.save(name, blob, kind);
        if (!disposed)
          setStatus(
            saved ? `${kind.toUpperCase()} saved.` : "Export cancelled.",
          );
      } else {
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
        setStatus(`${kind.toUpperCase()} download requested.`);
      }
    } catch (error) {
      if (!disposed)
        setStatus(
          signal.aborted
            ? "Export cancelled."
            : error instanceof Error
              ? error.message
              : "Export failed.",
        );
    } finally {
      unsubscribe();
      pending = undefined;
      if (!disposed) {
        setBusy(false);
        setSaving(false);
      }
    }
  };
  return (
    <details
      class="nodetto-inspector-section"
      ref={section}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary>Export artwork</summary>
      <fieldset
        class="nodetto-export-settings"
        disabled={busy()}
        style={{ border: "none", padding: 0, margin: 0, "min-width": 0 }}
      >
        <label>
          Format
          <select
            ref={formatInput}
            aria-label="Export format"
            value={format()}
            onChange={(e) => {
              const value = e.currentTarget.value;
              if (value === "svg" || value === "png" || value === "pdf") {
                setFormat(value);
                setStatus("");
              }
            }}
          >
            <option value="svg">SVG (vector)</option>
            <option value="png">PNG (image)</option>
            <option value="pdf">PDF (document)</option>
          </select>
        </label>
        <label>
          Scope
          <select
            aria-label="Export scope"
            value={scope()}
            onChange={(e) => setPreferredScope(e.currentTarget.value)}
          >
            <Show when={props.id}>
              <option value="artboard">Artboard envelope</option>
            </Show>
            <Show when={props.hasSelection}>
              <option value="selection">Selected artwork</option>
            </Show>
            <option value="page">Current page</option>
          </select>
        </label>
        <Show when={scope() !== "artboard"}>
          <div>
            Artwork padding (canvas units)
            <NumberInput
              label="Export padding"
              value={padding()}
              min={0}
              max={256}
              onCommit={setPadding}
            />
          </div>
        </Show>
        <Show when={format() !== "pdf"}>
          <label>
            <input
              type="checkbox"
              checked={transparent()}
              onChange={(e) => setTransparent(e.currentTarget.checked)}
            />
            Transparent background
          </label>
        </Show>
        <Show when={format() === "pdf" || !transparent()}>
          <label>
            Artwork background
            <input
              type="color"
              aria-label="Export background color"
              value={background()}
              onInput={(e) => setBackground(e.currentTarget.value)}
            />
          </label>
        </Show>
        <Show when={format() !== "svg"}>
          <label>
            {format() === "pdf" ? "Image quality" : "Resolution"}
            <select
              aria-label="Export scale"
              value={scale()}
              onChange={(e) => setScale(Number(e.currentTarget.value))}
            >
              <For each={RASTER_SCALES}>
                {(value) => <option value={value}>{value}×</option>}
              </For>
            </select>
          </label>
        </Show>
        <Show when={format() === "pdf"}>
          <label>
            Page size
            <select
              aria-label="PDF page size"
              value={pageSize()}
              onChange={(e) => {
                const value = e.currentTarget.value;
                if (value === "artwork" || value === "a4" || value === "letter")
                  setPageSize(value);
              }}
            >
              <For each={Object.entries(PDF_PAGE_SIZES)}>
                {([value, label]) => <option value={value}>{label}</option>}
              </For>
            </select>
          </label>
          <Show when={pageSize() !== "artwork"}>
            <label>
              Orientation
              <select
                aria-label="PDF orientation"
                value={orientation()}
                onChange={(e) =>
                  setOrientation(
                    e.currentTarget.value === "landscape"
                      ? "landscape"
                      : "portrait",
                  )
                }
              >
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
            </label>
            <div>
              Page margins (mm)
              <NumberInput
                label="PDF margins"
                value={margin()}
                min={0}
                max={50}
                onCommit={setMargin}
              />
            </div>
          </Show>
          <p>
            One page with a rendered image. Text is not selectable; use SVG for
            vector artwork.
          </p>
        </Show>
      </fieldset>
      <p>{preview().label}</p>
      <Show when={preview().error}>
        <p role="alert">{preview().error}</p>
      </Show>
      <button
        type="button"
        disabled={busy() || !!preview().error}
        onClick={() => void download()}
      >
        {busy() ? "Exporting…" : `Export ${format().toUpperCase()}`}
      </button>
      <Show when={busy() && !saving()}>
        <button type="button" onClick={() => pending?.abort()}>
          Cancel export
        </button>
      </Show>
      <p role="status">{status()}</p>
    </details>
  );
}
