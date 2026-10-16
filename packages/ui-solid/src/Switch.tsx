import type { JSX } from "solid-js";
import "./Switch.css";

/** Native checkbox behavior with a shared on/off switch presentation. */
export function Switch(
  props: Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "type" | "role">,
): JSX.Element {
  return (
    <input
      {...props}
      type="checkbox"
      role="switch"
      aria-checked={props.checked === true}
      class={`nodetto-switch ${props.class ?? ""}`}
    />
  );
}
