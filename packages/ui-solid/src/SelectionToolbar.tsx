// Floating toolbar above the selection (design editor-ux 3.7).
//
// Screen-anchored: the selection bounds are projected through the camera on
// every change and the toolbar is clamped to the canvas host, so it never
// zooms with the page and never leaves the visible area. It disappears while
// the primary button is held on the host — a drag, a marquee, a resize — and
// comes back on release.
//
// Colour swatches write through `setSelectionStyle`; every other button is
// an entry of the shared action table.

import type { Editor, Vec } from "@diagra/core";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";
import { createEditorSignals } from "./adapter.ts";
import {
  type ActionContext,
  type ActionId,
  actionTitle,
  type EditorAction,
  getAction,
  runAction,
} from "./shortcuts.ts";
import { STYLE_PALETTE } from "./inspector/palette.ts";

export interface SelectionToolbarProps {
  readonly context: ActionContext;
  /** The canvas host: the toolbar is clamped to it and hides while pressed. */
  readonly host: HTMLElement | undefined;
  /** "More": the shell focuses the Inspector on the selection. */
  readonly onMore: () => void;
}

export interface Swatch {
  /** `null` clears the field so the stylesheet default applies again. */
  readonly value: string | null;
  readonly label: string;
}

/** The shared preset palette (Inspector and toolbar agree), plus "none". */
export const FILL_PALETTE: readonly Swatch[] = [
  { value: null, label: "No fill" },
  ...STYLE_PALETTE.fills.map((entry) => ({
    value: entry.value,
    label: entry.name,
  })),
];

export const STROKE_PALETTE: readonly Swatch[] = [
  { value: null, label: "Default stroke" },
  ...STYLE_PALETTE.strokes.map((entry) => ({
    value: entry.value,
    label: entry.name,
  })),
];

/** Space between the selection's top edge and the toolbar. */
const GAP = 10;
const EDGE_MARGIN = 4;

interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * Where a toolbar of `size` goes for a selection whose screen-space top edge
 * runs from `left` to `right` at `top`, inside a host of `bounds`. Centred
 * above the selection, slid inside the host; when there is no room above it
 * sits at the top margin rather than covering the selection.
 */
export function placeAbove(
  left: number,
  right: number,
  top: number,
  size: Size,
  bounds: Size,
): Vec {
  const x = (left + right) / 2 - size.width / 2;
  const y = top - GAP - size.height;
  const maxX = Math.max(EDGE_MARGIN, bounds.width - size.width - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, bounds.height - size.height - EDGE_MARGIN);
  return {
    x: Math.min(Math.max(EDGE_MARGIN, x), maxX),
    y: Math.min(Math.max(EDGE_MARGIN, y), maxY),
  };
}

const ARRANGE_BUTTONS: readonly { id: ActionId; label: string }[] = [
  { id: "alignLeft", label: "L" },
  { id: "alignHCenter", label: "C" },
  { id: "alignRight", label: "R" },
  { id: "alignTop", label: "T" },
  { id: "alignVCenter", label: "M" },
  { id: "alignBottom", label: "B" },
];

export function SelectionToolbar(props: SelectionToolbarProps): JSX.Element {
  const editor = (): Editor => props.context.editor;
  const signals = createEditorSignals(props.context.editor);
  const [size, setSize] = createSignal<Size>({ width: 0, height: 0 });
  const [pressed, setPressed] = createSignal(false);
  let root: HTMLDivElement | undefined;

  const isEnabled = (action: EditorAction): boolean => {
    signals.rev();
    signals.selection();
    signals.camera();
    return action.enabled(props.context);
  };

  // Hidden while the primary button is down on the host: the toolbar would
  // otherwise chase a moving selection and sit under the pointer.
  createEffect(() => {
    const host = props.host;
    if (!host) {
      return;
    }
    const onDown = (event: PointerEvent): void => {
      if (
        event.button === 0 &&
        !(root?.contains(event.target as Node) ?? false)
      ) {
        setPressed(true);
      }
    };
    const onUp = (): void => {
      setPressed(false);
    };
    host.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    onCleanup(() => {
      host.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    });
  });

  const measure = (element: HTMLDivElement): void => {
    root = element;
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      setSize({ width: element.offsetWidth, height: element.offsetHeight });
    });
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  };

  const anchor = createMemo<Vec | null>(() => {
    signals.rev();
    signals.selection();
    const camera = signals.camera();
    const bounds = editor().getSelectionBounds();
    const host = props.host;
    if (!bounds || !host) {
      return null;
    }
    // screen = (page + camera) * zoom, the same equation the viewport uses.
    const left = (bounds.x + camera.x) * camera.z;
    const right = (bounds.x + bounds.width + camera.x) * camera.z;
    const top = (bounds.y + camera.y) * camera.z;
    return placeAbove(left, right, top, size(), {
      width: host.clientWidth,
      height: host.clientHeight,
    });
  });

  const visible = (): boolean =>
    signals.selection().size > 0 && !pressed() && anchor() !== null;

  const setStyle = (field: "fill" | "stroke", value: string | null): void => {
    editor().setSelectionStyle({ [field]: value });
  };

  const button = (id: ActionId, label: string): JSX.Element => {
    const action = getAction(id);
    return (
      <button
        type="button"
        class="diagra-float-button"
        title={actionTitle(action)}
        disabled={!isEnabled(action)}
        onClick={() => runAction(action, props.context)}
      >
        {label}
      </button>
    );
  };

  const swatches = (
    field: "fill" | "stroke",
    palette: readonly Swatch[],
  ): JSX.Element => (
    <div class="diagra-swatch-row" role="group" aria-label={`${field} colour`}>
      <For each={palette}>
        {(swatch) => (
          <button
            type="button"
            class="diagra-swatch"
            classList={{
              "diagra-swatch-none": swatch.value === null,
              "diagra-swatch-stroke": field === "stroke",
            }}
            title={`${field === "fill" ? "Fill" : "Stroke"}: ${swatch.label}`}
            style={
              swatch.value === null
                ? undefined
                : field === "fill"
                  ? { background: swatch.value }
                  : { "border-color": swatch.value }
            }
            onClick={() => setStyle(field, swatch.value)}
          />
        )}
      </For>
    </div>
  );

  return (
    <Show when={visible()}>
      <div
        class="diagra-selection-toolbar"
        role="toolbar"
        aria-label="Selection"
        ref={measure}
        style={{
          transform: `translate(${anchor()?.x ?? 0}px, ${anchor()?.y ?? 0}px)`,
          visibility: size().width === 0 ? "hidden" : "visible",
        }}
        // A press on the toolbar must not reach the canvas host's gesture
        // handlers, and must not count as "pressed on the canvas" either.
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div class="diagra-float-group diagra-float-colours">
          {swatches("fill", FILL_PALETTE)}
          {swatches("stroke", STROKE_PALETTE)}
        </div>
        <div class="diagra-float-group">
          {button("duplicate", "Dup")}
          {button("delete", "Del")}
        </div>
        <div class="diagra-float-group">
          {button("bringToFront", "Front")}
          {button("sendToBack", "Back")}
        </div>
        <div class="diagra-float-group">
          {button("frameSelection", "Frame")}
          {button("group", "Group")}
          {button("booleanUnion", "Union")}
          {button("booleanSubtract", "Subtract")}
          {button("booleanIntersect", "Intersect")}
          {button("booleanExclude", "Exclude")}
          {button("flattenBoolean", "Flatten")}
          {button("ungroup", "Ungroup")}
        </div>
        <Show when={isEnabled(getAction("alignLeft"))}>
          <div class="diagra-float-group">
            <For each={ARRANGE_BUTTONS}>
              {(entry) => button(entry.id, entry.label)}
            </For>
          </div>
        </Show>
        <div class="diagra-float-group">
          <button
            type="button"
            class="diagra-float-button"
            title="More options in the Inspector"
            onClick={() => props.onMore()}
          >
            More
          </button>
        </div>
      </div>
    </Show>
  );
}
