import type { SequenceActivationSemantic } from "@nodetto/ir";
import {
  sequenceMessageY,
  sequenceOrderY,
  sequenceParticipants,
} from "../sequence-layout.ts";
import { boxContains } from "../geometry.ts";
import type { ShapeUtil } from "../shape-util.ts";
import { createConnectorUtil, readDirectEndpoints } from "./connector.ts";
import { nodeShapeUtil } from "./node.ts";

export const sequenceParticipantShapeUtil: ShapeUtil = {
  ...nodeShapeUtil,
  type: "sequence.participant",
  getBounds(element, context) {
    const participants =
      element.visual.x === undefined
        ? sequenceParticipants(element, context)
        : [];
    const y = element.visual.y ?? 0;
    let height = element.visual.height;
    if (height === undefined) {
      const messages = (context.elementsOnPage?.(element.page) ?? []).filter(
        (candidate) => candidate.type === "sequence.message",
      );
      height = Math.max(
        220,
        ...messages.map(
          (message) => sequenceMessageY(message, context) + 60 - y,
        ),
      );
    }
    return {
      x:
        element.visual.x ??
        Math.max(
          0,
          participants.findIndex(
            (participant) => participant.id === element.id,
          ),
        ) * 240,
      y,
      width: element.visual.width ?? 160,
      height,
    };
  },
  hitTest(element, point, context) {
    const bounds = sequenceParticipantShapeUtil.getBounds(element, context);
    return bounds
      ? nodeShapeUtil.hitTest(
          { ...element, visual: { ...element.visual, ...bounds } },
          point,
          context,
        )
      : false;
  },
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
    const semantic = element.semantic as SequenceActivationSemantic;
    const participant = semantic.participant
      ? context.boundsOf(semantic.participant)
      : null;
    const { x, y, width, height } = element.visual;
    if (!participant && x === undefined) return null;
    const top = y ?? sequenceOrderY(element, semantic.fromOrder, context);
    const bottom = sequenceOrderY(element, semantic.toOrder, context);
    const resolvedWidth = width ?? 10;
    return {
      x: participant
        ? participant.x + participant.width / 2 - resolvedWidth / 2
        : (x as number),
      y: top,
      width: resolvedWidth,
      height: height ?? Math.max(24, bottom - top),
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
