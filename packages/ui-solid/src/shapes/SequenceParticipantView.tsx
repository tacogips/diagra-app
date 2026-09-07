import type { Element, SequenceParticipantSemantic } from "@diagra/ir";
import type { JSX } from "solid-js";
import { fillPaintStyle, labelStyle, strokeBorderStyle } from "./visual.ts";

export function SequenceParticipantView(props: {
  readonly element: Element;
}): JSX.Element {
  const semantic = () =>
    props.element.semantic as Partial<SequenceParticipantSemantic>;
  return (
    <div
      class="diagra-sequence-participant"
      style={labelStyle(props.element.visual)}
    >
      <div
        class="diagra-sequence-participant-head"
        data-smart-paint="box"
        data-smart-text
        style={{
          ...fillPaintStyle(props.element.visual),
          ...strokeBorderStyle(props.element.visual),
        }}
      >
        <span aria-hidden="true">
          {semantic().kind === "actor"
            ? "Actor"
            : semantic().kind === "db"
              ? "Database"
              : "Service"}
        </span>
        <strong>{semantic().name ?? "Participant"}</strong>
      </div>
      <div class="diagra-sequence-lifeline" />
    </div>
  );
}
