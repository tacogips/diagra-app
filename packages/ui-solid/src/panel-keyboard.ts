import { isEditableTarget } from "./interaction.ts";

/** Isolate panel keys while letting shell history own non-editable focus. */
export function stopPanelKeyDown(event: KeyboardEvent): void {
  const key = event.key.toLowerCase();
  if (
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.altKey &&
    (event.metaKey || event.ctrlKey) &&
    (key === "z" || key === "y") &&
    !isEditableTarget(event.target)
  )
    return;
  event.stopPropagation();
}
