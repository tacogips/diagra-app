import {
  backdropEffectsCss,
  booleanGeometry,
  booleanMaskCss,
  clipCss,
  Editor,
  groupOf,
  layerClipPolygons,
  memberIdsOf,
  polygonBounds,
  prototypeDelayedLink,
  prototypeFitScale,
  prototypeScreen,
  prototypeSmartPlan,
  prototypeSmartPlanBetween,
  rotatedBox,
  type ShapeContext,
  effectsCss,
} from "@diagra/core";
import {
  type Element,
  type FrameSemantic,
  getElementTypeDefinition,
  type GroupSemantic,
  type PrototypeOverflow,
  type PrototypeTransition,
} from "@diagra/ir";
import {
  createMemo,
  createEffect,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onMount,
  onCleanup,
  Show,
} from "solid-js";
import { createEditorSignals } from "./adapter.ts";
import { ShapeView } from "./shapes/ShapeView.tsx";
import { ConnectorMarkers, ConnectorView } from "./shapes/ConnectorView.tsx";
import { PrototypeAnimation } from "./prototype-transition.ts";
import { prototypeEventMatches } from "./prototype-trigger.ts";
import { PrototypeSurfaceFocus } from "./prototype-surface-focus.ts";
import {
  dismissPrototypeOverlay,
  popPrototypeOverlay,
  prototypeOverlayPlacement,
  pushPrototypeOverlay,
  type PrototypeOverlayEntry,
} from "./prototype-overlays.ts";
import {
  advancePrototypeScroll,
  prototypeDragDelta,
  prototypeKeyboardDelta,
  prototypeScrollRange,
  type PrototypeScrollPoint,
} from "./prototype-scroll.ts";
import {
  PrototypeVariantState,
  type PrototypeVariantMode,
} from "./prototype-variant-state.ts";

type PrototypeView = NonNullable<ReturnType<typeof prototypeScreen>>;

function PrototypeLayer(props: {
  readonly editor: Editor;
  readonly element: Element;
  readonly elements: ReadonlyMap<string, Element>;
  readonly markerPrefix: string;
  readonly context?: ShapeContext;
  readonly ancestors?: ReadonlySet<string>;
}): JSX.Element {
  const context = props.context ?? props.editor.createShapeContext();
  if (props.element.type === "group") {
    if (props.ancestors?.has(props.element.id)) return null;
    const nextAncestors = new Set(props.ancestors).add(props.element.id);
    const style = props.element.visual.style;
    const semantic = props.element.semantic as GroupSemantic;
    const boolean = booleanGeometry(props.element, context);
    const children = memberIdsOf(props.element).flatMap((id) => {
      const element = props.elements.get(id);
      return element ? [element] : [];
    });
    const contents = (
      <For each={children}>
        {(element) => (
          <PrototypeLayer
            editor={props.editor}
            element={element}
            elements={props.elements}
            markerPrefix={props.markerPrefix}
            context={context}
            ancestors={nextAncestors}
          />
        )}
      </For>
    );
    return boolean ? (
      <div
        data-diagra-group={props.element.id}
        data-boolean-operation={boolean.operation}
        style={{
          position: "absolute",
          left: `${boolean.bounds.x}px`,
          top: `${boolean.bounds.y}px`,
          width: `${boolean.bounds.width}px`,
          height: `${boolean.bounds.height}px`,
          overflow: "visible",
          "pointer-events": "none",
          opacity: style?.opacity ?? 1,
          filter: effectsCss(style),
          "backdrop-filter": backdropEffectsCss(style),
          "mix-blend-mode": style?.blendMode ?? "normal",
          isolation: semantic.isolate ? "isolate" : undefined,
          "mask-image": booleanMaskCss(boolean),
          "mask-repeat": "no-repeat",
          "mask-size": "100% 100%",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: `${-boolean.bounds.x}px`,
            top: `${-boolean.bounds.y}px`,
            width: "1px",
            height: "1px",
            overflow: "visible",
          }}
        >
          {contents}
        </div>
      </div>
    ) : (
      <div
        data-diagra-group={props.element.id}
        style={{
          position: "absolute",
          inset: 0,
          "pointer-events": "none",
          opacity: style?.opacity ?? 1,
          filter: effectsCss(style),
          "backdrop-filter": backdropEffectsCss(style),
          "mix-blend-mode": style?.blendMode ?? "normal",
          isolation: semantic.isolate ? "isolate" : undefined,
        }}
      >
        {contents}
      </div>
    );
  }
  if (getElementTypeDefinition(props.element.type)?.category === "edge") {
    const connectorPrefix = `${props.markerPrefix}${createUniqueId()}-`;
    return (
      <svg
        width="1"
        height="1"
        style={{
          position: "absolute",
          overflow: "visible",
          "pointer-events": "none",
        }}
      >
        <title>Diagram connector</title>
        <ConnectorMarkers prefix={connectorPrefix} />
        <g
          style={{
            "clip-path": clipCss(
              context.clipPolygonOf?.(props.element.id) ??
                context.clipOf?.(props.element.id),
            ),
            opacity: props.element.visual.style?.opacity ?? 1,
            filter: effectsCss(props.element.visual.style),
            "backdrop-filter": backdropEffectsCss(props.element.visual.style),
            "mix-blend-mode": props.element.visual.style?.blendMode ?? "normal",
          }}
        >
          <ConnectorView
            element={props.element}
            context={context}
            selected={false}
            markerPrefix={connectorPrefix}
          />
        </g>
      </svg>
    );
  }
  const box = props.editor.getBounds(props.element.id);
  return box ? (
    <div
      style={{
        position: "absolute",
        inset: 0,
        "clip-path": clipCss(
          context.clipPolygonOf?.(props.element.id) ??
            context.clipOf?.(props.element.id),
        ),
      }}
    >
      <ShapeView
        element={props.element}
        box={box}
        selected={false}
        exposeAccessibility
      />
    </div>
  ) : null;
}

export function PrototypePreview(props: {
  editor: Editor;
  onClose: () => void;
}): JSX.Element {
  let dialog: HTMLDialogElement | undefined;
  let stage: HTMLDivElement | undefined;
  let outgoingLayer: HTMLDivElement | undefined;
  let outgoingTimer: number | undefined;
  let navigationVersion = 0;
  let overlayVersion = 0;
  let scrollGesture:
    | {
        readonly pointerId: number;
        readonly frameId: string;
        readonly start: PrototypeScrollPoint;
        readonly origin: PrototypeScrollPoint;
        moved: boolean;
      }
    | undefined;
  let suppressedClickFrame = "";
  let suppressedClickTimer: number | undefined;
  const animation = new PrototypeAnimation();
  const surfaceFocus = new PrototypeSurfaceFocus();
  const runtime = new Editor({
    document: props.editor.getSnapshot(),
    registry: props.editor.registry,
  });
  const variantState = new PrototypeVariantState();
  const delayedFired = new Set<string>();
  const pressCleanups = new Set<() => void>();
  const markerPrefix = `prototype-${createUniqueId()}-`;
  const previousFocus = document.activeElement;
  onMount(() => dialog?.showModal());
  onCleanup(() => {
    navigationVersion += 1;
    if (outgoingTimer !== undefined) window.clearTimeout(outgoingTimer);
    if (suppressedClickTimer !== undefined)
      window.clearTimeout(suppressedClickTimer);
    animation.cancel();
    surfaceFocus.dispose();
    for (const cleanup of pressCleanups) cleanup();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
      previousFocus.focus();
  });
  const sourceSignals = createEditorSignals(props.editor);
  const signals = createEditorSignals(runtime);
  const frames = () => {
    signals.rev();
    return runtime
      .getSnapshot()
      .elements.filter(
        (item) =>
          item.type === "frame" &&
          !runtime.createShapeContext().isHidden?.(item.id),
      );
  };
  const start = frames().find(
    (item) => (item.semantic as FrameSemantic).prototypeStart,
  );
  const selected =
    start ??
    frames().find((item) => props.editor.selection.has(item.id)) ??
    frames()[0];
  const [current, setCurrent] = createSignal(selected?.id ?? "");
  const [outgoing, setOutgoing] = createSignal<{
    readonly view: PrototypeView;
    readonly ids: ReadonlySet<string>;
  }>();
  const [history, setHistory] = createSignal<string[]>([]);
  const [overlays, setOverlays] = createSignal<
    readonly PrototypeOverlayEntry[]
  >([]);
  const [surfaceScroll, setSurfaceScroll] = createSignal<
    Readonly<Record<string, PrototypeScrollPoint>>
  >({});
  const [zoom, setZoom] = createSignal("fit");
  const [scroll, setScroll] = createSignal<HTMLDivElement>();
  const [viewport, setViewport] = createSignal({ width: 0, height: 0 });
  createEffect(() => {
    sourceSignals.rev();
    runtime.loadDocument(props.editor.getSnapshot());
    variantState.clear();
    delayedFired.clear();
    setOverlays([]);
    setSurfaceScroll({});
    scrollGesture = undefined;
    if (!runtime.store.get(current())) {
      const fallback = frames()[0];
      setCurrent(fallback?.id ?? "");
      setHistory([]);
    }
  });
  createEffect(() => {
    const element = scroll();
    if (!element) return;
    const measure = (): void => {
      setViewport({ width: element.clientWidth, height: element.clientHeight });
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    }
  });
  const screen = createMemo(() => {
    signals.rev();
    return prototypeScreen(runtime, current());
  });
  const overlayViews = createMemo(() => {
    signals.rev();
    return overlays().flatMap((entry) => {
      const view = prototypeScreen(runtime, entry.frameId);
      return view ? [{ entry, view }] : [];
    });
  });
  const activeFrame = (): string => overlays().at(-1)?.frameId ?? current();
  createEffect(() => {
    surfaceFocus.update(
      overlayViews().at(-1)?.entry.key ?? null,
      () =>
        dialog?.querySelector<HTMLElement>(
          '[data-prototype-active-surface="true"]',
        ) ?? null,
    );
  });
  const activeView = (): PrototypeView | undefined =>
    overlayViews().at(-1)?.view ?? screen() ?? undefined;
  const elementsById = (view: PrototypeView): ReadonlyMap<string, Element> =>
    new Map(view.elements.map((element) => [element.id, element]));
  const visualRoots = (view: PrototypeView): readonly Element[] => {
    const available = new Set(view.elements.map((element) => element.id));
    return view.elements.filter(
      (element) =>
        element.id !== view.frame.id &&
        !available.has(groupOf(runtime.store, element.id)?.id ?? ""),
    );
  };
  const visualRoot = (view: PrototypeView, id: string): Element | undefined => {
    const available = new Set(view.elements.map((element) => element.id));
    let element = runtime.store.get(id);
    const visited = new Set<string>();
    while (element && !visited.has(element.id)) {
      visited.add(element.id);
      const group = groupOf(runtime.store, element.id);
      if (!group || !available.has(group.id)) return element;
      element = group;
    }
    return element;
  };
  const isFixed = (view: PrototypeView, id: string): boolean => {
    const root = visualRoot(view, id);
    return (
      root?.visual.prototypeFixed === true &&
      getElementTypeDefinition(root.type)?.category !== "edge"
    );
  };
  const scrollAt = (id: string): PrototypeScrollPoint =>
    surfaceScroll()[id] ?? { x: 0, y: 0 };
  const scrollMode = (view: PrototypeView): PrototypeOverflow =>
    (view.frame.semantic as FrameSemantic).prototypeOverflow ?? "none";
  const surfaceContext = (view: PrototypeView): ShapeContext => {
    const base = runtime.createShapeContext();
    if (scrollMode(view) === "none") return base;
    const polygons = layerClipPolygons(
      runtime.store,
      base,
      new Set([view.frame.id]),
    );
    return {
      ...base,
      clipPolygonOf: polygons,
      clipOf: (id) => {
        const polygon = polygons(id);
        return polygon ? polygonBounds(polygon) : null;
      },
    };
  };
  const scrollRange = (view: PrototypeView): PrototypeScrollPoint =>
    prototypeScrollRange(
      view.bounds,
      view.elements.flatMap((element) => {
        if (element.id === view.frame.id || isFixed(view, element.id))
          return [];
        const box = runtime.getBounds(element.id);
        return box
          ? [
              rotatedBox(
                box,
                getElementTypeDefinition(element.type)?.category === "edge"
                  ? 0
                  : (element.visual.rotation ?? 0),
              ),
            ]
          : [];
      }),
    );
  const advanceSurface = (
    view: PrototypeView,
    delta: PrototypeScrollPoint,
  ): boolean => {
    const id = view.frame.id;
    const currentOffset = scrollAt(id);
    const next = advancePrototypeScroll(
      scrollMode(view),
      currentOffset,
      delta,
      scrollRange(view),
    );
    if (next.x === currentOffset.x && next.y === currentOffset.y) return false;
    setSurfaceScroll({ ...surfaceScroll(), [id]: next });
    return true;
  };
  const scrollSurface = (event: WheelEvent, view: PrototypeView): void => {
    if (!advanceSurface(view, { x: event.deltaX, y: event.deltaY })) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const keyboardScrollSurface = (
    event: KeyboardEvent,
    view: PrototypeView,
  ): void => {
    const delta = prototypeKeyboardDelta(event.key, view.bounds);
    if (!delta || !advanceSurface(view, delta)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const beginScrollGesture = (
    event: PointerEvent,
    view: PrototypeView,
  ): void => {
    if (!event.isPrimary || event.button !== 0 || scrollMode(view) === "none")
      return;
    scrollGesture = {
      pointerId: event.pointerId,
      frameId: view.frame.id,
      start: { x: event.clientX, y: event.clientY },
      origin: scrollAt(view.frame.id),
      moved: false,
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };
  const moveScrollGesture = (
    event: PointerEvent,
    view: PrototypeView,
  ): void => {
    const gesture = scrollGesture;
    if (
      !gesture ||
      gesture.pointerId !== event.pointerId ||
      gesture.frameId !== view.frame.id
    )
      return;
    const distance = Math.hypot(
      event.clientX - gesture.start.x,
      event.clientY - gesture.start.y,
    );
    if (distance >= 5) gesture.moved = true;
    if (!gesture.moved) return;
    const next = advancePrototypeScroll(
      scrollMode(view),
      gesture.origin,
      prototypeDragDelta(
        gesture.start,
        { x: event.clientX, y: event.clientY },
        scale(),
      ),
      scrollRange(view),
    );
    event.preventDefault();
    event.stopPropagation();
    setSurfaceScroll({ ...surfaceScroll(), [gesture.frameId]: next });
  };
  const finishScrollGesture = (event: PointerEvent): void => {
    const gesture = scrollGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    scrollGesture = undefined;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture?.(event.pointerId))
      target.releasePointerCapture(event.pointerId);
    if (!gesture.moved) return;
    suppressedClickFrame = gesture.frameId;
    if (suppressedClickTimer !== undefined)
      window.clearTimeout(suppressedClickTimer);
    suppressedClickTimer = window.setTimeout(() => {
      suppressedClickTimer = undefined;
      suppressedClickFrame = "";
    }, 0);
  };
  const consumeSuppressedClick = (frameId: string): boolean => {
    if (suppressedClickFrame !== frameId) return false;
    suppressedClickFrame = "";
    return true;
  };
  const showScreen = (
    id: string,
    transition: PrototypeTransition = "instant",
    duration = 250,
  ): void => {
    animation.cancel();
    if (outgoingTimer !== undefined) {
      window.clearTimeout(outgoingTimer);
      outgoingTimer = undefined;
    }
    outgoingLayer = undefined;
    setOutgoing(undefined);
    setOverlays([]);
    setSurfaceScroll({});
    scrollGesture = undefined;
    delayedFired.clear();
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const hasMotion =
      !reducedMotion && Number.isFinite(duration) && duration > 0;
    const smartPlan =
      transition === "smart"
        ? prototypeSmartPlan(runtime, current(), id)
        : { steps: [], outgoing: [] };
    const source = screen();
    if (hasMotion && source && smartPlan.outgoing.length) {
      setOutgoing({ view: source, ids: new Set(smartPlan.outgoing) });
    }
    const version = ++navigationVersion;
    setCurrent(id);
    queueMicrotask(() => {
      if (version !== navigationVersion) return;
      const viewport = scroll();
      if (viewport) {
        viewport.scrollTop = 0;
        viewport.scrollLeft = 0;
      }
      if (transition === "smart") {
        const targets = new Map<string, HTMLElement>();
        for (const element of stage?.querySelectorAll<HTMLElement>(
          "[data-element-id]",
        ) ?? []) {
          const id = element.dataset.elementId;
          if (id) targets.set(id, element);
        }
        animation.playSmart(
          targets,
          smartPlan.steps,
          duration,
          reducedMotion,
          outgoingLayer,
        );
        if (outgoingLayer && hasMotion) {
          outgoingTimer = window.setTimeout(
            () => {
              if (version !== navigationVersion) return;
              outgoingTimer = undefined;
              outgoingLayer = undefined;
              setOutgoing(undefined);
            },
            Math.min(5000, duration),
          );
        }
      } else animation.play(stage, transition, duration, reducedMotion);
    });
  };
  const navigate = (
    id: string,
    transition: PrototypeTransition = "instant",
    duration = 250,
  ): void => {
    if (id === current()) return;
    setHistory([...history(), current()]);
    showScreen(id, transition, duration);
  };
  type PreviewLink = PrototypeView["links"][number];
  const animateVariant = (before: Editor, link: PreviewLink): void => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    queueMicrotask(() => {
      const targets = new Map<string, HTMLElement>();
      for (const element of stage?.querySelectorAll<HTMLElement>(
        "[data-element-id]",
      ) ?? []) {
        const id = element.dataset.elementId;
        if (id) targets.set(id, element);
      }
      if (link.transition === "smart")
        animation.playSmart(
          targets,
          prototypeSmartPlanBetween(before, runtime, activeFrame()).steps,
          link.duration,
          reducedMotion,
        );
      else
        animation.play(
          targets.get(link.from),
          link.transition,
          link.duration,
          reducedMotion,
        );
    });
  };
  const changeVariant = (
    link: PreviewLink,
    mode: PrototypeVariantMode,
  ): void => {
    const instance = runtime.store.get(link.from);
    const currentSource =
      instance?.type === "frame"
        ? (instance.semantic as FrameSemantic).instanceOf
        : undefined;
    if (!currentSource) return;
    const target = variantState.next(link.id, currentSource, link.to, mode);
    if (!target) return;
    const before = new Editor({
      document: runtime.getSnapshot(),
      registry: runtime.registry,
    });
    if (runtime.switchComponentVariant(link.from, target))
      animateVariant(before, link);
  };
  const activate = (link: PreviewLink, transient = false): void => {
    if (link.disabled) return;
    if (link.action === "change-to") {
      changeVariant(link, transient ? "activate" : "toggle");
      return;
    }
    if (link.action === "close-overlay") {
      setOverlays(popPrototypeOverlay(overlays()));
      return;
    }
    if (link.action === "open-overlay") {
      const entry: PrototypeOverlayEntry = {
        key: `${link.id}-${++overlayVersion}`,
        frameId: link.to,
        position: link.overlayPosition,
        x: link.overlayX,
        y: link.overlayY,
        backdrop: link.overlayBackdrop,
        dismiss: link.overlayDismiss,
        transition: link.transition,
        duration: link.duration,
      };
      const next = pushPrototypeOverlay(overlays(), entry);
      if (next === overlays()) return;
      setOverlays(next);
      queueMicrotask(() => {
        const target = [
          ...(stage?.querySelectorAll<HTMLElement>(
            "[data-prototype-overlay]",
          ) ?? []),
        ].find((element) => element.dataset.prototypeOverlay === entry.key);
        if (!target) return;
        animation.play(
          target,
          entry.transition === "smart" ? "fade" : entry.transition,
          entry.duration,
          window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        );
      });
      return;
    }
    navigate(link.to, link.transition, link.duration);
  };
  const beginPress = (link: PreviewLink, pointerId: number): void => {
    activate(link, true);
    const finish = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      cleanup();
      changeVariant(link, "restore");
    };
    const cleanup = (): void => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      pressCleanups.delete(cleanup);
    };
    pressCleanups.add(cleanup);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };
  createEffect(() => {
    const delayed = prototypeDelayedLink(activeView()?.links ?? []);
    const surfaceKey = `${current()}:${overlays()
      .map((entry) => entry.key)
      .join(":")}:${delayed?.id ?? ""}`;
    if (!delayed || delayedFired.has(surfaceKey)) return;
    const timer = window.setTimeout(() => {
      delayedFired.add(surfaceKey);
      activate(delayed);
    }, delayed.delay);
    onCleanup(() => window.clearTimeout(timer));
  });
  const scale = (): number =>
    zoom() === "fit"
      ? prototypeFitScale(
          screen()?.bounds ?? { width: 1, height: 1 },
          viewport(),
        )
      : Number(zoom());
  const PrototypeHotspots = (hotspotProps: {
    readonly view: PrototypeView;
    readonly fixed: boolean;
  }): JSX.Element => {
    const context = surfaceContext(hotspotProps.view);
    return (
      <For
        each={hotspotProps.view.links.filter(
          (link) =>
            isFixed(hotspotProps.view, link.from) === hotspotProps.fixed,
        )}
      >
        {(link) => (
          <Show when={link.trigger !== "after-delay"}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                "pointer-events": "none",
                "clip-path": clipCss(
                  context.clipPolygonOf?.(link.from) ??
                    context.clipOf?.(link.from),
                ),
              }}
            >
              <button
                type="button"
                class="diagra-prototype-hotspot"
                aria-label={link.label}
                role={link.role}
                disabled={link.disabled}
                title={`${link.label} (${link.trigger})`}
                style={{
                  "pointer-events": "auto",
                  transform: link.rotation
                    ? `rotate(${link.rotation}deg)`
                    : undefined,
                  "transform-origin": "center",
                  left: `${link.box.x}px`,
                  top: `${link.box.y}px`,
                  width: `${link.box.width}px`,
                  height: `${link.box.height}px`,
                  "clip-path": clipCss(link.hitPolygon),
                  "mask-image": link.hitMask ?? undefined,
                  "mask-repeat": link.hitMask ? "no-repeat" : undefined,
                  "mask-size": link.hitMask ? "100% 100%" : undefined,
                }}
                onClick={(event) => {
                  if (consumeSuppressedClick(hotspotProps.view.frame.id)) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                  }
                  if (
                    prototypeEventMatches(
                      link.trigger,
                      event.detail === 0 ? "keyboard-activate" : "click",
                    )
                  )
                    activate(link);
                }}
                onPointerEnter={() => {
                  if (prototypeEventMatches(link.trigger, "pointer-enter"))
                    activate(link, link.action === "change-to");
                }}
                onPointerLeave={() => {
                  if (link.action === "change-to" && link.trigger === "hover")
                    changeVariant(link, "restore");
                }}
                onPointerDown={(event) => {
                  if (
                    event.isPrimary &&
                    event.button === 0 &&
                    prototypeEventMatches(link.trigger, "pointer-down")
                  )
                    link.action === "change-to"
                      ? beginPress(link, event.pointerId)
                      : activate(link);
                }}
              />
            </div>
          </Show>
        )}
      </For>
    );
  };
  return (
    <dialog
      ref={(element) => {
        dialog = element;
      }}
      class="diagra-prototype-overlay"
      aria-label="Prototype preview"
      on:keydown={(event) => event.stopPropagation()}
      on:keyup={(event) => event.stopPropagation()}
      on:cancel={(event) => {
        event.preventDefault();
        if (overlays().length) setOverlays(popPrototypeOverlay(overlays()));
        else props.onClose();
      }}
    >
      <header>
        <button type="button" onClick={props.onClose}>
          Close preview
        </button>
        <button
          type="button"
          disabled={!overlays().length && !history().length}
          onClick={() => {
            if (overlays().length) {
              setOverlays(popPrototypeOverlay(overlays()));
              return;
            }
            const previous = history().at(-1);
            setHistory(history().slice(0, -1));
            if (previous) showScreen(previous);
          }}
        >
          Back
        </button>
        <select
          aria-label="Preview screen"
          value={current()}
          onChange={(event) => navigate(event.currentTarget.value)}
        >
          <For each={frames()}>
            {(item) => (
              <option value={item.id}>
                {(item.semantic as FrameSemantic).name || "Artboard"}
              </option>
            )}
          </For>
        </select>
        <select
          aria-label="Preview zoom"
          value={zoom()}
          onChange={(event) => setZoom(event.currentTarget.value)}
        >
          <option value="fit">Fit screen</option>
          <option value="0.5">50%</option>
          <option value="1">100%</option>
          <option value="2">200%</option>
        </select>
      </header>
      <Show
        when={screen()}
        fallback={<p>Create or select a visible artboard to preview.</p>}
      >
        {(view) => (
          <div class="diagra-prototype-scroll" ref={setScroll}>
            <div
              ref={(element) => {
                stage = element;
              }}
              style={{
                position: "relative",
                width: `${view().bounds.width * scale()}px`,
                height: `${view().bounds.height * scale()}px`,
                overflow: "hidden",
                margin: "24px auto",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: `${view().bounds.width}px`,
                  height: `${view().bounds.height}px`,
                  overflow: "hidden",
                  background: "white",
                  "transform-origin": "0 0",
                  transform: `scale(${scale()})`,
                }}
              >
                <div
                  tabIndex={overlays().length ? -1 : 0}
                  data-prototype-active-surface={
                    !overlays().length ? "true" : undefined
                  }
                  aria-label={`${(view().frame.semantic as FrameSemantic).name || "Screen"} prototype viewport`}
                  style={{
                    position: "absolute",
                    inset: 0,
                    overflow: "hidden",
                    "touch-action":
                      scrollMode(view()) === "none" ? "auto" : "none",
                  }}
                  onWheel={(event) => scrollSurface(event, view())}
                  onKeyDown={(event) => keyboardScrollSurface(event, view())}
                  onPointerDown={(event) => beginScrollGesture(event, view())}
                  onPointerMove={(event) => moveScrollGesture(event, view())}
                  onPointerUp={finishScrollGesture}
                  onPointerCancel={finishScrollGesture}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: `${-view().bounds.x}px`,
                      top: `${-view().bounds.y}px`,
                    }}
                  >
                    <For
                      each={view().elements.filter(
                        (element) => element.id === view().frame.id,
                      )}
                    >
                      {(element) => (
                        <PrototypeLayer
                          editor={runtime}
                          element={element}
                          elements={elementsById(view())}
                          markerPrefix={markerPrefix}
                          context={surfaceContext(view())}
                        />
                      )}
                    </For>
                  </div>
                  <Show when={outgoing()}>
                    {(exit) => (
                      <div
                        ref={(element) => {
                          outgoingLayer = element;
                        }}
                        aria-hidden="true"
                        style={{
                          position: "absolute",
                          inset: 0,
                          overflow: "hidden",
                          "pointer-events": "none",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            left: `${-exit().view.bounds.x}px`,
                            top: `${-exit().view.bounds.y}px`,
                          }}
                        >
                          <For
                            each={exit().view.elements.filter((element) =>
                              exit().ids.has(element.id),
                            )}
                          >
                            {(element) => (
                              <PrototypeLayer
                                editor={runtime}
                                element={element}
                                elements={elementsById(exit().view)}
                                markerPrefix={`${markerPrefix}outgoing-`}
                                context={surfaceContext(exit().view)}
                              />
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </Show>
                  <div
                    style={{
                      position: "absolute",
                      left: `${-view().bounds.x - scrollAt(view().frame.id).x}px`,
                      top: `${-view().bounds.y - scrollAt(view().frame.id).y}px`,
                    }}
                  >
                    <For
                      each={visualRoots(view()).filter(
                        (element) => !isFixed(view(), element.id),
                      )}
                    >
                      {(element) => (
                        <PrototypeLayer
                          editor={runtime}
                          element={element}
                          elements={elementsById(view())}
                          markerPrefix={markerPrefix}
                          context={surfaceContext(view())}
                        />
                      )}
                    </For>
                    <Show when={!overlays().length}>
                      <PrototypeHotspots view={view()} fixed={false} />
                    </Show>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      left: `${-view().bounds.x}px`,
                      top: `${-view().bounds.y}px`,
                    }}
                  >
                    <For
                      each={visualRoots(view()).filter((element) =>
                        isFixed(view(), element.id),
                      )}
                    >
                      {(element) => (
                        <PrototypeLayer
                          editor={runtime}
                          element={element}
                          elements={elementsById(view())}
                          markerPrefix={markerPrefix}
                          context={surfaceContext(view())}
                        />
                      )}
                    </For>
                    <Show when={!overlays().length}>
                      <PrototypeHotspots view={view()} fixed={true} />
                    </Show>
                  </div>
                </div>
                <For each={overlayViews()}>
                  {(overlay, index) => {
                    const placement = () =>
                      prototypeOverlayPlacement(
                        view().bounds,
                        overlay.view.bounds,
                        overlay.entry,
                      );
                    const top = () => index() === overlays().length - 1;
                    return (
                      <div
                        data-prototype-overlay={overlay.entry.key}
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: overlay.entry.backdrop
                            ? "rgba(0, 0, 0, 0.35)"
                            : "transparent",
                          "pointer-events": top() ? "auto" : "none",
                        }}
                        onClick={() => {
                          if (top())
                            setOverlays(dismissPrototypeOverlay(overlays()));
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <div
                          role="dialog"
                          tabIndex={top() ? 0 : -1}
                          data-prototype-active-surface={
                            top() ? "true" : undefined
                          }
                          aria-label={
                            (overlay.view.frame.semantic as FrameSemantic)
                              .name || "Prototype overlay"
                          }
                          style={{
                            position: "absolute",
                            left: `${placement().x - view().bounds.x}px`,
                            top: `${placement().y - view().bounds.y}px`,
                            width: `${overlay.view.bounds.width}px`,
                            height: `${overlay.view.bounds.height}px`,
                            overflow: "hidden",
                            background: "white",
                            "touch-action":
                              scrollMode(overlay.view) === "none"
                                ? "auto"
                                : "none",
                          }}
                          onPointerDown={(event) => {
                            beginScrollGesture(event, overlay.view);
                            event.stopPropagation();
                          }}
                          onPointerMove={(event) =>
                            moveScrollGesture(event, overlay.view)
                          }
                          onPointerUp={finishScrollGesture}
                          onPointerCancel={finishScrollGesture}
                          onClick={(event) => event.stopPropagation()}
                          onWheel={(event) => {
                            if (top()) scrollSurface(event, overlay.view);
                          }}
                          onKeyDown={(event) => {
                            if (top())
                              keyboardScrollSurface(event, overlay.view);
                          }}
                        >
                          <div
                            style={{
                              position: "absolute",
                              left: `${-overlay.view.bounds.x}px`,
                              top: `${-overlay.view.bounds.y}px`,
                            }}
                          >
                            <For
                              each={overlay.view.elements.filter(
                                (element) =>
                                  element.id === overlay.view.frame.id,
                              )}
                            >
                              {(element) => (
                                <PrototypeLayer
                                  editor={runtime}
                                  element={element}
                                  elements={elementsById(overlay.view)}
                                  markerPrefix={`${markerPrefix}overlay-`}
                                  context={surfaceContext(overlay.view)}
                                />
                              )}
                            </For>
                          </div>
                          <div
                            style={{
                              position: "absolute",
                              left: `${-overlay.view.bounds.x - scrollAt(overlay.view.frame.id).x}px`,
                              top: `${-overlay.view.bounds.y - scrollAt(overlay.view.frame.id).y}px`,
                            }}
                          >
                            <For
                              each={visualRoots(overlay.view).filter(
                                (element) => !isFixed(overlay.view, element.id),
                              )}
                            >
                              {(element) => (
                                <PrototypeLayer
                                  editor={runtime}
                                  element={element}
                                  elements={elementsById(overlay.view)}
                                  markerPrefix={`${markerPrefix}overlay-`}
                                  context={surfaceContext(overlay.view)}
                                />
                              )}
                            </For>
                            <Show when={top()}>
                              <PrototypeHotspots
                                view={overlay.view}
                                fixed={false}
                              />
                            </Show>
                          </div>
                          <div
                            style={{
                              position: "absolute",
                              left: `${-overlay.view.bounds.x}px`,
                              top: `${-overlay.view.bounds.y}px`,
                            }}
                          >
                            <For
                              each={visualRoots(overlay.view).filter(
                                (element) => isFixed(overlay.view, element.id),
                              )}
                            >
                              {(element) => (
                                <PrototypeLayer
                                  editor={runtime}
                                  element={element}
                                  elements={elementsById(overlay.view)}
                                  markerPrefix={`${markerPrefix}overlay-fixed-`}
                                  context={surfaceContext(overlay.view)}
                                />
                              )}
                            </For>
                            <Show when={top()}>
                              <PrototypeHotspots
                                view={overlay.view}
                                fixed={true}
                              />
                            </Show>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>
          </div>
        )}
      </Show>
    </dialog>
  );
}
