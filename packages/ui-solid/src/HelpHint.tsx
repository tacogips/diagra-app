import {
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { helpPosition } from "./help-position.ts";
import "./HelpHint.css";

/** Compact, focusable help for routine inspector guidance. */
export function HelpHint(props: { readonly text: string }): JSX.Element {
  const id = createUniqueId();
  let trigger: HTMLButtonElement | undefined;
  let tooltip: HTMLSpanElement | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const keepOpen = () => clearTimeout(closeTimer);
  const closeSoon = () => {
    keepOpen();
    closeTimer = setTimeout(() => setPosition(undefined), 150);
  };
  onCleanup(keepOpen);
  const [position, setPosition] = createSignal<{ left: number; top: number }>();
  const open = (target: HTMLButtonElement) => {
    keepOpen();
    setPosition(
      helpPosition(
        target.getBoundingClientRect(),
        tooltip?.getBoundingClientRect() ?? { width: 0, height: 0 },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  };
  onMount(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !position()) return;
      event.preventDefault();
      event.stopPropagation();
      keepOpen();
      setPosition(undefined);
    };
    const dismiss = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".diagra-help-tooltip")
      )
        return;
      keepOpen();
      setPosition(undefined);
    };
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    // Hover help can be open while keyboard focus remains elsewhere. Capture
    // before panel handlers so Escape dismisses help without closing its panel.
    document.addEventListener("keydown", dismissOnEscape, true);
    onCleanup(() => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
      document.removeEventListener("keydown", dismissOnEscape, true);
    });
  });
  return (
    <>
      <button
        ref={trigger}
        type="button"
        class="diagra-help-hint"
        aria-label={`Help: ${props.text}`}
        aria-describedby={position() ? id : undefined}
        onMouseEnter={(event) => open(event.currentTarget)}
        onMouseLeave={closeSoon}
        onFocus={(event) => open(event.currentTarget)}
        onBlur={() => setPosition(undefined)}
        onClick={(event) => open(event.currentTarget)}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="7" />
          <path d="M8.3 7.7a2 2 0 013.8.8c0 1.4-1.6 1.7-2.1 2.7M10 14h.01" />
        </svg>
      </button>
      <Show when={position()}>
        {(point) => (
          <Portal>
            <span
              onMouseEnter={keepOpen}
              onMouseLeave={closeSoon}
              ref={(element) => {
                tooltip = element;
                onCleanup(() => {
                  tooltip = undefined;
                });
                onMount(() => {
                  if (!trigger) return;
                  setPosition(
                    helpPosition(
                      trigger.getBoundingClientRect(),
                      element.getBoundingClientRect(),
                      {
                        width: window.innerWidth,
                        height: window.innerHeight,
                      },
                    ),
                  );
                });
              }}
              id={id}
              role="tooltip"
              class="diagra-help-tooltip"
              style={{ left: `${point().left}px`, top: `${point().top}px` }}
            >
              {props.text}
            </span>
          </Portal>
        )}
      </Show>
    </>
  );
}
