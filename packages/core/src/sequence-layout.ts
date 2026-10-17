// Resolve omitted geometry without rewriting semantic-only imported documents.
import type {
  Element,
  SequenceActivationSemantic,
  SequenceMessageSemantic,
  SequenceParticipantSemantic,
} from "@nodetto/ir";
import type { ShapeContext } from "./shape-util.ts";
import { compareFractional } from "./fractional.ts";

export function sequenceParticipants(
  element: Element,
  context: ShapeContext,
): readonly Element[] {
  return (context.elementsOnPage?.(element.page) ?? [element])
    .filter((candidate) => candidate.type === "sequence.participant")
    .sort(
      (a, b) =>
        compareFractional(
          (a.semantic as SequenceParticipantSemantic).order,
          (b.semantic as SequenceParticipantSemantic).order,
        ) || compareFractional(a.id, b.id),
    );
}

export function sequenceOrderY(
  element: Element,
  order: string,
  context: ShapeContext,
): number {
  const elements = context.elementsOnPage?.(element.page) ?? [element];
  const messages = elements.filter(
    (candidate) => candidate.type === "sequence.message",
  );
  const explicit = messages.find(
    (candidate) =>
      (candidate.semantic as SequenceMessageSemantic).order === order &&
      candidate.visual.y !== undefined,
  );
  if (explicit?.visual.y !== undefined) return explicit.visual.y;
  const orders = new Set<string>([order]);
  for (const candidate of elements) {
    if (candidate.type === "sequence.message")
      orders.add((candidate.semantic as SequenceMessageSemantic).order);
    if (candidate.type === "sequence.activation") {
      const semantic = candidate.semantic as SequenceActivationSemantic;
      orders.add(semantic.fromOrder);
      orders.add(semantic.toOrder);
    }
  }
  const slot = [...orders].sort(compareFractional).indexOf(order);
  const headerY = Math.max(
    0,
    ...sequenceParticipants(element, context).map(
      (participant) => participant.visual.y ?? 0,
    ),
  );
  return headerY + 164 + slot * 52;
}

export function sequenceMessageY(
  element: Element,
  context: ShapeContext,
): number {
  return (
    element.visual.y ??
    sequenceOrderY(
      element,
      (element.semantic as SequenceMessageSemantic).order,
      context,
    )
  );
}
