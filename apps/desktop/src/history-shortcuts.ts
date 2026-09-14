import { isEditableTarget } from "@diagra/ui-solid";

/** Shell fallback; native text undo and already-handled canvas keys keep ownership. */
export function handleHistoryShortcut(
  event: KeyboardEvent,
  history: { undo(): void; redo(): void },
): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    !(event.metaKey || event.ctrlKey) ||
    isEditableTarget(event.target)
  )
    return false;
  const key = event.key.toLowerCase();
  if (key !== "z" && key !== "y") return false;
  event.preventDefault();
  event.stopPropagation();
  if (key === "y" || event.shiftKey) history.redo();
  else history.undo();
  return true;
}
