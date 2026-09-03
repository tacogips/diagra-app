// Right-click menu over the canvas (design editor-ux 3.6).
//
// Items come from the shared action table; the menu only decides which
// subset to show. On empty canvas it is the short list (paste, select all,
// zoom to fit); on a selection it is the full arrangement vocabulary, with
// align, distribute and match size folded into a submenu. Items that would
// be no-ops are disabled rather than hidden, so the menu keeps its shape.
//
// The menu is positioned inside the canvas host at the screen point of the
// click and clamped to the host after it has been measured. It closes on an
// item, an outside press, Escape, or a wheel: a menu that scrolls away from
// its anchor is worse than no menu.

import type { Vec } from "@diagra/core";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
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

export interface ContextMenuProps {
  readonly context: ActionContext;
  /** Screen point of the click, relative to the host's top-left corner. */
  readonly at: Vec;
  /** The canvas host the menu is clamped to. */
  readonly host: HTMLElement | undefined;
  readonly onClose: () => void;
}

type MenuEntry =
  | { readonly kind: "action"; readonly action: EditorAction }
  | {
      readonly kind: "submenu";
      readonly label: string;
      readonly items: readonly EditorAction[];
    }
  | { readonly kind: "separator" };

const EMPTY_CANVAS_ITEMS: readonly ActionId[] = [
  "paste",
  "selectAll",
  "zoomFit",
];

const ARRANGE_ITEMS: readonly ActionId[] = [
  "alignLeft",
  "alignHCenter",
  "alignRight",
  "alignTop",
  "alignVCenter",
  "alignBottom",
  "distributeHorizontal",
  "distributeVertical",
  "matchWidth",
  "matchHeight",
  "matchBoth",
];

function actions(ids: readonly ActionId[]): MenuEntry[] {
  return ids.map((id) => ({ kind: "action", action: getAction(id) }));
}

const SEPARATOR: MenuEntry = { kind: "separator" };

function selectionEntries(): readonly MenuEntry[] {
  return [
    ...actions(["cut", "copy", "paste", "duplicate", "delete"]),
    SEPARATOR,
    ...actions(["bringToFront", "bringForward", "sendBackward", "sendToBack"]),
    SEPARATOR,
    ...actions(["group", "ungroup"]),
    {
      kind: "submenu",
      label: "Align and distribute",
      items: ARRANGE_ITEMS.map(getAction),
    },
    SEPARATOR,
    ...actions(["editText"]),
  ];
}

const EDGE_MARGIN = 4;

/** Keep a `size` box at `at` inside a `bounds` box, sliding it if needed. */
export function clampToHost(
  at: Vec,
  size: { readonly width: number; readonly height: number },
  bounds: { readonly width: number; readonly height: number },
): Vec {
  const maxX = Math.max(EDGE_MARGIN, bounds.width - size.width - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, bounds.height - size.height - EDGE_MARGIN);
  return {
    x: Math.min(Math.max(EDGE_MARGIN, at.x), maxX),
    y: Math.min(Math.max(EDGE_MARGIN, at.y), maxY),
  };
}

export function ContextMenu(props: ContextMenuProps): JSX.Element {
  const signals = createEditorSignals(props.context.editor);
  let menu: HTMLDivElement | undefined;
  let submenu: HTMLDivElement | undefined;

  const entries = createMemo<readonly MenuEntry[]>(() =>
    signals.selection().size > 0
      ? selectionEntries()
      : actions(EMPTY_CANVAS_ITEMS),
  );

  const isEnabled = (action: EditorAction): boolean => {
    signals.rev();
    signals.selection();
    signals.camera();
    return action.enabled(props.context);
  };

  const submenuEnabled = (items: readonly EditorAction[]): boolean =>
    items.some(isEnabled);

  /** Indices of entries the arrow keys can land on. */
  const navigable = createMemo<readonly number[]>(() => {
    const out: number[] = [];
    entries().forEach((entry, index) => {
      if (entry.kind === "action" && isEnabled(entry.action)) {
        out.push(index);
      } else if (entry.kind === "submenu" && submenuEnabled(entry.items)) {
        out.push(index);
      }
    });
    return out;
  });

  const [active, setActive] = createSignal<number | null>(null);
  const [openSubmenu, setOpenSubmenu] = createSignal<number | null>(null);
  const [activeSub, setActiveSub] = createSignal<number | null>(null);
  const [position, setPosition] = createSignal<Vec>(props.at);
  const [submenuLeft, setSubmenuLeft] = createSignal(true);

  const run = (action: EditorAction): void => {
    runAction(action, props.context);
    props.onClose();
  };

  const submenuItems = (): readonly EditorAction[] => {
    const index = openSubmenu();
    const entry = index === null ? undefined : entries()[index];
    return entry?.kind === "submenu" ? entry.items : [];
  };

  const enabledSubIndices = (): number[] => {
    const out: number[] = [];
    submenuItems().forEach((action, index) => {
      if (isEnabled(action)) {
        out.push(index);
      }
    });
    return out;
  };

  const step = (
    order: readonly number[],
    current: number | null,
    delta: 1 | -1,
  ): number | null => {
    if (order.length === 0) {
      return null;
    }
    const at = current === null ? -1 : order.indexOf(current);
    if (at === -1) {
      return delta === 1 ? (order[0] ?? null) : (order.at(-1) ?? null);
    }
    const next = (at + delta + order.length) % order.length;
    return order[next] ?? null;
  };

  const openSubmenuAt = (index: number, focusFirst: boolean): void => {
    setOpenSubmenu(index);
    setActiveSub(focusFirst ? (enabledSubIndices()[0] ?? null) : null);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    // Nothing typed into the menu may reach the canvas's shortcuts.
    event.stopPropagation();
    const inSubmenu = openSubmenu() !== null && activeSub() !== null;
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        if (openSubmenu() !== null) {
          setOpenSubmenu(null);
          setActiveSub(null);
        } else {
          props.onClose();
        }
        return;
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        if (inSubmenu) {
          setActiveSub(step(enabledSubIndices(), activeSub(), delta));
        } else {
          setOpenSubmenu(null);
          setActive(step(navigable(), active(), delta));
        }
        return;
      }
      case "Home":
      case "End": {
        event.preventDefault();
        const order = inSubmenu ? enabledSubIndices() : navigable();
        const target =
          event.key === "Home" ? (order[0] ?? null) : (order.at(-1) ?? null);
        if (inSubmenu) {
          setActiveSub(target);
        } else {
          setActive(target);
        }
        return;
      }
      case "ArrowRight": {
        const index = active();
        const entry = index === null ? undefined : entries()[index];
        if (entry?.kind === "submenu" && index !== null) {
          event.preventDefault();
          openSubmenuAt(index, true);
        }
        return;
      }
      case "ArrowLeft":
        if (openSubmenu() !== null) {
          event.preventDefault();
          setOpenSubmenu(null);
          setActiveSub(null);
        }
        return;
      case "Enter":
      case " ": {
        event.preventDefault();
        if (inSubmenu) {
          const action = submenuItems()[activeSub() as number];
          if (action) {
            run(action);
          }
          return;
        }
        const index = active();
        const entry = index === null ? undefined : entries()[index];
        if (entry?.kind === "action" && index !== null) {
          run(entry.action);
        } else if (entry?.kind === "submenu" && index !== null) {
          openSubmenuAt(index, true);
        }
        return;
      }
      default:
        return;
    }
  };

  onMount(() => {
    menu?.focus();
    // Clamp once the menu has a size. Reading layout here is fine: the menu
    // is small and opens on a discrete event.
    if (menu && props.host) {
      setPosition(
        clampToHost(
          props.at,
          { width: menu.offsetWidth, height: menu.offsetHeight },
          {
            width: props.host.clientWidth,
            height: props.host.clientHeight,
          },
        ),
      );
    }

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && menu?.contains(target)) {
        return;
      }
      props.onClose();
    };
    const onWheel = (): void => props.onClose();
    const onWindowKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        props.onClose();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    window.addEventListener("keydown", onWindowKeyDown, true);
    window.addEventListener("resize", onWheel);
    onCleanup(() => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("wheel", onWheel, true);
      window.removeEventListener("keydown", onWindowKeyDown, true);
      window.removeEventListener("resize", onWheel);
    });
  });

  // Flip the submenu to the left when it would leave the host.
  createEffect(() => {
    if (openSubmenu() === null || !submenu || !menu || !props.host) {
      return;
    }
    const hostRect = props.host.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    setSubmenuLeft(menuRect.right + submenu.offsetWidth > hostRect.right);
  });

  return (
    <div
      class="diagra-context-menu"
      role="menu"
      tabIndex={-1}
      ref={menu}
      style={{
        left: `${position().x}px`,
        top: `${position().y}px`,
      }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <For each={entries()}>
        {(entry, index) => {
          if (entry.kind === "separator") {
            return <div class="diagra-menu-separator" role="separator" />;
          }
          if (entry.kind === "action") {
            return (
              <button
                type="button"
                role="menuitem"
                class="diagra-menu-item"
                classList={{ "diagra-menu-active": active() === index() }}
                disabled={!isEnabled(entry.action)}
                title={actionTitle(entry.action)}
                onPointerEnter={() => {
                  setActive(index());
                  setOpenSubmenu(null);
                }}
                onClick={() => run(entry.action)}
              >
                <span class="diagra-menu-label">{entry.action.label}</span>
                <Show when={entry.action.shortcut}>
                  {(shortcut) => (
                    <span class="diagra-menu-shortcut">{shortcut()}</span>
                  )}
                </Show>
              </button>
            );
          }
          return (
            <div class="diagra-menu-submenu-host">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openSubmenu() === index()}
                class="diagra-menu-item"
                classList={{ "diagra-menu-active": active() === index() }}
                disabled={!submenuEnabled(entry.items)}
                onPointerEnter={() => {
                  setActive(index());
                  openSubmenuAt(index(), false);
                }}
                onClick={() => openSubmenuAt(index(), true)}
              >
                <span class="diagra-menu-label">{entry.label}</span>
                <span class="diagra-menu-shortcut">&gt;</span>
              </button>
              <Show when={openSubmenu() === index()}>
                <div
                  class="diagra-context-menu diagra-submenu"
                  classList={{ "diagra-submenu-left": submenuLeft() }}
                  role="menu"
                  ref={submenu}
                >
                  <For each={entry.items}>
                    {(action, subIndex) => (
                      <button
                        type="button"
                        role="menuitem"
                        class="diagra-menu-item"
                        classList={{
                          "diagra-menu-active": activeSub() === subIndex(),
                        }}
                        disabled={!isEnabled(action)}
                        title={actionTitle(action)}
                        onPointerEnter={() => setActiveSub(subIndex())}
                        onClick={() => run(action)}
                      >
                        <span class="diagra-menu-label">{action.label}</span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}
