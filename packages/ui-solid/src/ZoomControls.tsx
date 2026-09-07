// Zoom widget in the canvas corner (design editor-ux 3.5).
//
// Zoom out, an editable percentage, reset, zoom in and fit come
// from the action table; the grid and snap toggles are shell state passed
// in and handed back, because the canvas reads them too.

import type { JSX } from "solid-js";
import { MIN_ZOOM, MAX_ZOOM } from "@diagra/core";
import { NumberInput } from "./NumberInput.tsx";
import { createEditorSignals } from "./adapter.ts";
import type { SnapSettings } from "./interaction.ts";
import {
  type ActionContext,
  type ActionId,
  actionTitle,
  getAction,
  runAction,
  viewportCenter,
} from "./shortcuts.ts";

export interface ZoomControlsProps {
  /** Carries the editor and the viewport size the zoom commands anchor on. */
  readonly context: ActionContext;
  readonly snap: SnapSettings;
  readonly showGrid: boolean;
  readonly onSnapChange: (snap: SnapSettings) => void;
  readonly onShowGridChange: (show: boolean) => void;
}

export function formatZoom(z: number): string {
  return `${Math.round(z * 100)} %`;
}

export function ZoomControls(props: ZoomControlsProps): JSX.Element {
  const signals = createEditorSignals(props.context.editor);

  const isEnabled = (id: ActionId): boolean => {
    signals.rev();
    signals.selection();
    signals.camera();
    return getAction(id).enabled(props.context);
  };

  const button = (id: ActionId, label: string): JSX.Element => (
    <button
      type="button"
      class="diagra-zoom-button"
      title={actionTitle(getAction(id))}
      disabled={!isEnabled(id)}
      onClick={() => runAction(getAction(id), props.context)}
    >
      {label}
    </button>
  );

  const toggle = (
    label: string,
    title: string,
    on: () => boolean,
    flip: () => void,
  ): JSX.Element => (
    <button
      type="button"
      class="diagra-zoom-button diagra-zoom-toggle"
      classList={{ "diagra-active": on() }}
      aria-pressed={on()}
      title={title}
      onClick={flip}
    >
      {label}
    </button>
  );

  return (
    <div class="diagra-zoom-controls" role="toolbar" aria-label="Zoom">
      <div class="diagra-zoom-group">
        {button("zoomOut", "-")}
        <div class="diagra-zoom-level">
          <NumberInput
            label="Zoom percent"
            value={Math.round(signals.camera().z * 10000) / 100}
            min={MIN_ZOOM * 100}
            max={MAX_ZOOM * 100}
            step={10}
            onCommit={(percent) =>
              props.context.editor.camera.zoomTo(
                percent / 100,
                viewportCenter(props.context.viewport),
              )
            }
          />
          <span aria-hidden="true">%</span>
        </div>
        {button("zoomIn", "+")}
        {button("zoomReset", "100%")}
        {button("zoomFit", "Fit")}
        {button("zoomSelection", "Selection")}
      </div>
      <div class="diagra-zoom-group">
        {toggle(
          "Grid",
          "Show grid",
          () => props.showGrid,
          () => props.onShowGridChange(!props.showGrid),
        )}
        {toggle(
          "Snap",
          "Snap to other objects (hold Cmd/Ctrl to bypass)",
          () => props.snap.objects,
          () =>
            props.onSnapChange({
              ...props.snap,
              objects: !props.snap.objects,
            }),
        )}
        {toggle(
          "Grid snap",
          "Snap to the grid (hold Cmd/Ctrl to bypass)",
          () => props.snap.grid,
          () => props.onSnapChange({ ...props.snap, grid: !props.snap.grid }),
        )}
        {toggle(
          "Guides",
          "Snap to persistent page guides (hold Cmd/Ctrl to bypass)",
          () => props.snap.guides !== false,
          () =>
            props.onSnapChange({
              ...props.snap,
              guides: props.snap.guides === false,
            }),
        )}
      </div>
    </div>
  );
}
