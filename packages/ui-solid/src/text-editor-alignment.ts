import type { VisualStyle } from "@diagra/ir";

export function alignedTextPadding(
  height: number,
  contentHeight: number,
  alignment: VisualStyle["verticalAlign"],
  padding = 6,
): number {
  const free = Math.max(0, height - padding * 2 - contentHeight);
  return (
    padding +
    (alignment === "bottom" ? free : alignment === "middle" ? free / 2 : 0)
  );
}

/** Measure a hidden clone so live selection, scroll and composition stay intact. */
export function alignTextEditor(
  textarea: HTMLTextAreaElement,
  alignment: VisualStyle["verticalAlign"],
): void {
  if (!textarea.parentElement) return;
  if (!alignment || alignment === "top") {
    textarea.style.paddingTop = "6px";
    return;
  }
  const mirror = textarea.cloneNode(false) as HTMLTextAreaElement;
  mirror.removeAttribute("id");
  mirror.setAttribute("aria-hidden", "true");
  mirror.tabIndex = -1;
  mirror.value = textarea.value;
  Object.assign(mirror.style, {
    visibility: "hidden",
    pointerEvents: "none",
    height: "0px",
    minHeight: "0px",
    overflow: "hidden",
    paddingTop: "6px",
    paddingBottom: "6px",
    transform: "none",
  });
  try {
    textarea.parentElement.append(mirror);
    const contentHeight = Math.max(0, mirror.scrollHeight - 12);
    textarea.style.paddingTop = `${alignedTextPadding(textarea.clientHeight, contentHeight, alignment)}px`;
  } finally {
    mirror.remove();
  }
}
