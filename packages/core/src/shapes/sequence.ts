import { boxContains } from "../geometry.ts";
import type { ShapeUtil } from "../shape-util.ts";
import { createConnectorUtil, readDirectEndpoints } from "./connector.ts";
import { nodeShapeUtil } from "./node.ts";

export const sequenceParticipantShapeUtil: ShapeUtil = {
  ...nodeShapeUtil,
  type: "sequence.participant",
  defaultSemantic: () => ({
    name: "Participant",
    kind: "service",
    order: "a1",
  }),
  defaultVisual: () => ({ x: 0, y: 0, width: 160, height: 220 }),
};

export const sequenceMessageShapeUtil = createConnectorUtil({
  type: "sequence.message",
  readEndpoints: readDirectEndpoints,
  defaultSemantic: () => ({
    from: "participant-a",
    to: "participant-b",
    order: "a1",
    kind: "sync",
  }),
});

export const sequenceActivationShapeUtil: ShapeUtil = {
  type: "sequence.activation",
  canResize: false,
  getBounds(element, context) {
    const semantic = element.semantic as { participant?: string };
    const participant = semantic.participant
      ? context.boundsOf(semantic.participant)
      : null;
    const { x, y, width, height } = element.visual;
    if (y === undefined || (!participant && x === undefined)) return null;
    const resolvedWidth = width ?? 10;
    return {
      x: participant
        ? participant.x + participant.width / 2 - resolvedWidth / 2
        : (x as number),
      y,
      width: resolvedWidth,
      height: height ?? 24,
    };
  },
  hitTest(element, point, context) {
    const box = sequenceActivationShapeUtil.getBounds(element, context);
    return box ? boxContains(box, point) : false;
  },
  defaultSemantic: () => ({
    participant: "participant",
    fromOrder: "a1",
    toOrder: "a2",
  }),
  defaultVisual: () => ({}),
};
