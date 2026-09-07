import {
  addPageGuide,
  type Editor,
  type PageGuide,
  pageGuides,
  updatePageGuide,
  type ViewportSize,
} from "@diagra/core";
import {
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { createEditorSignals } from "./adapter.ts";

export const RULER_SIZE = 18;

export interface RulerTick {
  readonly screen: number;
  readonly value: number;
  readonly major: boolean;
}

function tickStep(zoom: number): {
  readonly major: number;
  readonly minor: number;
} {
  const wanted = 48 / Math.max(zoom, 0.0001);
  const magnitude = 10 ** Math.floor(Math.log10(wanted));
  const major =
    [1, 2, 5, 10]
      .map((factor) => factor * magnitude)
      .find((step) => step >= wanted) ?? 10 * magnitude;
  return { major, minor: major / 5 };
}

export function rulerTicks(
  cameraOffset: number,
  zoom: number,
  screenLength: number,
): readonly RulerTick[] {
  if (!(zoom > 0) || !(screenLength > 0)) return [];
  const { major, minor } = tickStep(zoom);
  const first = Math.ceil(-cameraOffset / minor) * minor;
  const last = screenLength / zoom - cameraOffset;
  const ticks: RulerTick[] = [];
  for (let value = first; value <= last + minor / 100; value += minor) {
    const normalized = Math.abs(value) < minor / 100 ? 0 : value;
    const ratio = normalized / major;
    ticks.push({
      screen: (normalized + cameraOffset) * zoom,
      value: normalized,
      major: Math.abs(ratio - Math.round(ratio)) < 1e-7,
    });
    if (ticks.length >= 500) break;
  }
  return ticks;
}

interface DraftGuide {
  readonly axis: "x" | "y";
  readonly pointerId: number;
  readonly screen: number;
  readonly position: number;
}

interface MovingGuide {
  readonly id: string;
  readonly pointerId: number;
  readonly position: number;
}

export function CanvasRulers(props: {
  readonly editor: Editor;
  readonly viewport: ViewportSize;
  readonly container: () => HTMLElement | undefined;
}): JSX.Element {
  const signals = createEditorSignals(props.editor);
  const readOnly = () => {
    signals.rev();
    return props.editor.readOnly;
  };
  const [draft, setDraft] = createSignal<DraftGuide | null>(null);
  const [moving, setMoving] = createSignal<MovingGuide | null>(null);
  onMount(() => {
    const cancel = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || (!draft() && !moving())) return;
      event.preventDefault();
      setDraft(null);
      setMoving(null);
    };
    window.addEventListener("keydown", cancel);
    onCleanup(() => window.removeEventListener("keydown", cancel));
  });
  const xTicks = createMemo(() => {
    const camera = signals.camera();
    return rulerTicks(camera.x, camera.z, props.viewport.width);
  });
  const yTicks = createMemo(() => {
    const camera = signals.camera();
    return rulerTicks(camera.y, camera.z, props.viewport.height);
  });
  const guides = createMemo(() => {
    signals.rev();
    return pageGuides(props.editor, props.editor.currentPageId).filter(
      (guide) => !guide.hidden,
    );
  });
  const pointer = (
    event: Pick<PointerEvent, "clientX" | "clientY">,
    axis: "x" | "y",
  ): { readonly screen: number; readonly position: number } => {
    const rect = props.container()?.getBoundingClientRect();
    const screenPoint = {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
    const page = props.editor.camera.screenToPage(screenPoint);
    return {
      screen: axis === "x" ? screenPoint.x : screenPoint.y,
      position: axis === "x" ? page.x : page.y,
    };
  };
  const start = (
    axis: "x" | "y",
    event: PointerEvent & { currentTarget: SVGRectElement },
  ): void => {
    if (props.editor.readOnly || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ axis, pointerId: event.pointerId, ...pointer(event, axis) });
  };
  const move = (event: PointerEvent): void => {
    const current = draft();
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setDraft({ ...current, ...pointer(event, current.axis) });
  };
  const finish = (event: PointerEvent, commit: boolean): void => {
    const current = draft();
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setDraft(null);
    const rect = props.container()?.getBoundingClientRect();
    const x = event.clientX - (rect?.left ?? 0);
    const y = event.clientY - (rect?.top ?? 0);
    if (
      commit &&
      x >= RULER_SIZE &&
      y >= RULER_SIZE &&
      x <= props.viewport.width &&
      y <= props.viewport.height
    )
      addPageGuide(
        props.editor,
        props.editor.currentPageId,
        current.axis,
        current.position,
      );
  };
  const guideScreen = (guide: PageGuide): number => {
    const camera = signals.camera();
    const active = moving();
    const position = active?.id === guide.id ? active.position : guide.position;
    return (position + (guide.axis === "x" ? camera.x : camera.y)) * camera.z;
  };
  const startMoving = (
    guide: PageGuide,
    event: PointerEvent & { currentTarget: SVGLineElement },
  ): void => {
    if (props.editor.readOnly || guide.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setMoving({
      id: guide.id,
      pointerId: event.pointerId,
      position: guide.position,
    });
  };
  const moveExisting = (guide: PageGuide, event: PointerEvent): void => {
    const current = moving();
    if (
      !current ||
      current.id !== guide.id ||
      current.pointerId !== event.pointerId
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    setMoving({
      ...current,
      position: pointer(event, guide.axis).position,
    });
  };
  const finishExisting = (
    guide: PageGuide,
    event: PointerEvent,
    commit: boolean,
  ): void => {
    const current = moving();
    if (
      !current ||
      current.id !== guide.id ||
      current.pointerId !== event.pointerId
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    setMoving(null);
    if (commit)
      updatePageGuide(props.editor, guide.id, { position: current.position });
  };

  return (
    <svg
      class="diagra-rulers"
      aria-label="Canvas rulers"
      width={props.viewport.width}
      height={props.viewport.height}
    >
      <title>Canvas rulers</title>
      <For each={guides()}>
        {(guide) => {
          const active = () => moving()?.id === guide.id;
          const shownPosition = () =>
            active() ? (moving()?.position ?? guide.position) : guide.position;
          return (
            <g
              class="diagra-persistent-guide"
              classList={{
                "diagra-persistent-guide-active": active(),
                "diagra-persistent-guide-locked": guide.locked,
              }}
            >
              <line
                x1={guide.axis === "x" ? guideScreen(guide) : RULER_SIZE}
                y1={guide.axis === "x" ? RULER_SIZE : guideScreen(guide)}
                x2={
                  guide.axis === "x" ? guideScreen(guide) : props.viewport.width
                }
                y2={
                  guide.axis === "x"
                    ? props.viewport.height
                    : guideScreen(guide)
                }
                stroke={guide.color}
              />
              <line
                class="diagra-persistent-guide-hit"
                style={{ "pointer-events": readOnly() ? "none" : undefined }}
                x1={guide.axis === "x" ? guideScreen(guide) : RULER_SIZE}
                y1={guide.axis === "x" ? RULER_SIZE : guideScreen(guide)}
                x2={
                  guide.axis === "x" ? guideScreen(guide) : props.viewport.width
                }
                y2={
                  guide.axis === "x"
                    ? props.viewport.height
                    : guideScreen(guide)
                }
                onPointerDown={(event) => startMoving(guide, event)}
                onPointerMove={(event) => moveExisting(guide, event)}
                onPointerUp={(event) => finishExisting(guide, event, true)}
                onPointerCancel={(event) => finishExisting(guide, event, false)}
              />
              <Show when={active()}>
                <text
                  class="diagra-persistent-guide-label"
                  x={guide.axis === "x" ? guideScreen(guide) + 4 : RULER_SIZE}
                  y={
                    guide.axis === "x"
                      ? RULER_SIZE + 12
                      : guideScreen(guide) - 4
                  }
                >
                  {shownPosition().toFixed(2)}
                </text>
              </Show>
            </g>
          );
        }}
      </For>
      <g class="diagra-ruler diagra-ruler-x">
        <rect
          x={RULER_SIZE}
          y={0}
          width={Math.max(0, props.viewport.width - RULER_SIZE)}
          height={RULER_SIZE}
          onPointerDown={(event) => start("x", event)}
          style={{ "pointer-events": readOnly() ? "none" : undefined }}
          onPointerMove={move}
          onPointerUp={(event) => finish(event, true)}
          onPointerCancel={(event) => finish(event, false)}
        />
        <For each={xTicks()}>
          {(tick) => (
            <g>
              <line
                x1={tick.screen}
                y1={tick.major ? 8 : 12}
                x2={tick.screen}
                y2={RULER_SIZE}
              />
              <Show when={tick.major}>
                <text x={tick.screen + 2} y={7}>
                  {Math.round(tick.value)}
                </text>
              </Show>
            </g>
          )}
        </For>
      </g>
      <g class="diagra-ruler diagra-ruler-y">
        <rect
          x={0}
          y={RULER_SIZE}
          width={RULER_SIZE}
          height={Math.max(0, props.viewport.height - RULER_SIZE)}
          onPointerDown={(event) => start("y", event)}
          style={{ "pointer-events": readOnly() ? "none" : undefined }}
          onPointerMove={move}
          onPointerUp={(event) => finish(event, true)}
          onPointerCancel={(event) => finish(event, false)}
        />
        <For each={yTicks()}>
          {(tick) => (
            <g>
              <line
                x1={tick.major ? 8 : 12}
                y1={tick.screen}
                x2={RULER_SIZE}
                y2={tick.screen}
              />
              <Show when={tick.major}>
                <text
                  x={7}
                  y={tick.screen - 2}
                  transform={`rotate(-90 7 ${tick.screen - 2})`}
                >
                  {Math.round(tick.value)}
                </text>
              </Show>
            </g>
          )}
        </For>
      </g>
      <rect
        class="diagra-ruler-corner"
        x={0}
        y={0}
        width={RULER_SIZE}
        height={RULER_SIZE}
      />
      <Show when={draft()} keyed>
        {(guide) => (
          <line
            class="diagra-ruler-draft"
            x1={guide.axis === "x" ? guide.screen : RULER_SIZE}
            y1={guide.axis === "x" ? RULER_SIZE : guide.screen}
            x2={guide.axis === "x" ? guide.screen : props.viewport.width}
            y2={guide.axis === "x" ? props.viewport.height : guide.screen}
          />
        )}
      </Show>
    </svg>
  );
}

export default CanvasRulers;
