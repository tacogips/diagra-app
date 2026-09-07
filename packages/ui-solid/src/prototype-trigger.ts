import type { PrototypeTrigger } from "@diagra/ir";

export type PrototypeInput =
  | "click"
  | "keyboard-activate"
  | "pointer-enter"
  | "pointer-down";

/** Keep every pointer trigger keyboard-operable without double navigation. */
export function prototypeEventMatches(
  trigger: PrototypeTrigger,
  input: PrototypeInput,
): boolean {
  if (input === "keyboard-activate") return trigger !== "after-delay";
  if (trigger === "click") return input === "click";
  if (trigger === "hover") return input === "pointer-enter";
  if (trigger === "press") return input === "pointer-down";
  return false;
}
