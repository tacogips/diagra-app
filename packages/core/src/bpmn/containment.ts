import type {
  Document,
  Element,
  ElementId,
  FractionalIndex,
} from "@nodetto/ir";
import { applyCommands, type Command } from "../commands.ts";
import { buildBpmnModel } from "./model.ts";
import type { Store } from "../store.ts";

const semantic = (element: Element): Record<string, unknown> =>
  element.semantic as Record<string, unknown>;
const box = (element: Element) => ({
  x: element.visual.x ?? 0,
  y: element.visual.y ?? 0,
  width: element.visual.width ?? 0,
  height: element.visual.height ?? 0,
});
const sameBox = (a: Element, b: Element): boolean => {
  const left = box(a);
  const right = box(b);
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
};
const bpmnElements = (store: Store): Element[] =>
  store.listElements().filter((element) => element.type.startsWith("bpmn."));
const updateVisual = (
  store: Store,
  id: ElementId,
  visual: Record<string, number>,
): Command | null => {
  const element = store.get(id);
  if (
    !element ||
    Object.entries(visual).every(
      ([key, value]) =>
        element.visual[key as keyof typeof element.visual] === value,
    )
  )
    return null;
  return { type: "updateVisual", id, visual };
};
const depth = (
  model: ReturnType<typeof buildBpmnModel>,
  element: Element,
): number => {
  let count = 0;
  let parent = model.parentOf(element.id);
  const seen = new Set<ElementId>();
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    count += 1;
    parent = model.parentOf(parent);
  }
  return count;
};

export function planBpmnLaneLayout(before: Store, after: Store): Command[] {
  const commands: Command[] = [];
  const oldDoc = before.getSnapshot();
  const oldModelFor = (page: string) => buildBpmnModel(oldDoc, page);
  const nextModelFor = (page: string) =>
    buildBpmnModel(after.getSnapshot(), page);
  const deltas = new Map<ElementId, number>();
  for (const oldLane of bpmnElements(before).filter(
    (e) => e.type === "bpmn.lane",
  )) {
    const lane = after.get(oldLane.id);
    if (!lane || lane.type !== "bpmn.lane") continue;
    const parentId = oldModelFor(oldLane.page).parentOf(oldLane.id);
    const oldParent = parentId ? before.get(parentId) : undefined;
    const nextParent = parentId ? after.get(parentId) : undefined;
    if (!oldParent || !nextParent || !sameBox(oldParent, nextParent)) continue;
    const nextHeight = Math.max(30, lane.visual.height ?? 120);
    const delta = nextHeight - (oldLane.visual.height ?? 120);
    if (nextHeight !== (lane.visual.height ?? 120)) {
      const clamp = updateVisual(after, lane.id, { height: nextHeight });
      if (clamp) {
        applyCommands(after, [clamp]);
        commands.push(clamp);
      }
    }
    if (delta)
      deltas.set(
        parentId as ElementId,
        (deltas.get(parentId as ElementId) ?? 0) + delta,
      );
  }
  for (const [parentId, delta] of deltas) {
    let current: Element | undefined = after.get(parentId);
    const seen = new Set<ElementId>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      const command = updateVisual(after, current.id, {
        height: (current.visual.height ?? 0) + delta,
      });
      if (command) {
        applyCommands(after, [command]);
        commands.push(command);
      }
      const model = nextModelFor(current.page);
      const ancestor = model.parentOf(current.id);
      current = ancestor ? after.get(ancestor) : undefined;
      if (current?.type !== "bpmn.lane" && current?.type !== "bpmn.participant")
        break;
    }
  }
  const models = new Map<string, ReturnType<typeof buildBpmnModel>>();
  for (const page of after.listPages())
    models.set(page.id, buildBpmnModel(after.getSnapshot(), page.id));
  const containers = bpmnElements(after)
    .filter(
      (element) =>
        element.type === "bpmn.participant" || element.type === "bpmn.lane",
    )
    .sort(
      (a, b) =>
        depth(models.get(a.page) as ReturnType<typeof buildBpmnModel>, a) -
        depth(models.get(b.page) as ReturnType<typeof buildBpmnModel>, b),
    );
  for (const parent of containers) {
    const oldParent = before.get(parent.id);
    if (oldParent && sameBox(oldParent, parent)) continue;
    const parentModel = models.get(parent.page);
    const children = bpmnElements(after)
      .filter(
        (element) =>
          element.type === "bpmn.lane" &&
          parentModel?.parentOf(element.id) === parent.id,
      )
      .sort(
        (a, b) =>
          (parentModel?.order.indexOf(a.id) ?? 0) -
          (parentModel?.order.indexOf(b.id) ?? 0),
      );
    if (!children.length) continue;
    const parentBox = box(parent);
    let y = parentBox.y;
    const total = children.reduce(
      (sum, child) => sum + (child.visual.height ?? 120),
      0,
    );
    children.forEach((child, index) => {
      const remaining =
        parentBox.height -
        (y - parentBox.y) -
        children
          .slice(index + 1)
          .reduce((sum, later) => sum + (later.visual.height ?? 120), 0);
      const height =
        index === children.length - 1
          ? Math.max(30, remaining)
          : (child.visual.height ?? 120);
      const change = updateVisual(after, child.id, {
        x: parentBox.x + 30,
        y,
        width: Math.max(0, parentBox.width - 30),
        height,
      });
      if (change) {
        applyCommands(after, [change]);
        commands.push(change);
      }
      y += height;
    });
    void total;
  }
  return commands;
}

export function planBpmnTranslations(before: Store, after: Store): Command[] {
  const commands: Command[] = [];
  const beforeDoc = before.getSnapshot();
  const containers = bpmnElements(before).filter((element) =>
    ["bpmn.participant", "bpmn.lane", "bpmn.subProcess"].includes(element.type),
  );
  const moved = containers
    .filter((element) => {
      const next = after.get(element.id);
      return (
        next &&
        ((next.visual.x ?? 0) !== (element.visual.x ?? 0) ||
          (next.visual.y ?? 0) !== (element.visual.y ?? 0))
      );
    })
    .sort(
      (a, b) =>
        depth(buildBpmnModel(beforeDoc, a.page), a) -
        depth(buildBpmnModel(beforeDoc, b.page), b),
    );
  const shifted = new Set<ElementId>();
  for (const container of moved) {
    const model = buildBpmnModel(beforeDoc, container.page);
    const prior = before.get(container.id);
    const nextContainer = after.get(container.id);
    if (!prior || !nextContainer) continue;
    const dx = (nextContainer.visual.x ?? 0) - (prior.visual.x ?? 0);
    const dy = (nextContainer.visual.y ?? 0) - (prior.visual.y ?? 0);
    for (const id of model.descendantsOf(container.id)) {
      if (shifted.has(id)) continue;
      const old = before.get(id);
      const next = after.get(id);
      if (
        !old ||
        !next ||
        next.visual.x !== old.visual.x ||
        next.visual.y !== old.visual.y
      )
        continue;
      const visual: Record<string, number> = {};
      if (dx && next.visual.x === old.visual.x && old.visual.x !== undefined)
        visual.x = old.visual.x + dx;
      if (dy && next.visual.y === old.visual.y && old.visual.y !== undefined)
        visual.y = old.visual.y + dy;
      const command = updateVisual(after, id, visual);
      if (command) {
        applyCommands(after, [command]);
        commands.push(command);
        shifted.add(id);
      }
    }
  }
  return commands;
}

export function planBpmnMembership(before: Store, after: Store): Command[] {
  const commands: Command[] = [];
  const bpmnPageIds = new Set(
    after
      .listPages()
      .filter((page) => page.kind === "bpmn")
      .map((page) => page.id),
  );
  const elements = bpmnElements(after).filter(
    (element) =>
      bpmnPageIds.has(element.page) &&
      ![
        "bpmn.participant",
        "bpmn.lane",
        "bpmn.sequenceFlow",
        "bpmn.messageFlow",
        "bpmn.association",
        "bpmn.dataAssociation",
        "bpmn.group",
      ].includes(element.type),
  );
  for (const element of elements) {
    if (element.type === "bpmn.boundaryEvent") {
      const host = after.get(String(semantic(element).attachedTo));
      if (!host) continue;
      const b = box(host);
      const w = element.visual.width ?? 36;
      const h = element.visual.height ?? 36;
      const cx = (element.visual.x ?? 0) + w / 2;
      const cy = (element.visual.y ?? 0) + h / 2;
      const points = [
        { x: Math.max(b.x, Math.min(b.x + b.width, cx)), y: b.y },
        { x: b.x + b.width, y: Math.max(b.y, Math.min(b.y + b.height, cy)) },
        { x: Math.max(b.x, Math.min(b.x + b.width, cx)), y: b.y + b.height },
        { x: b.x, y: Math.max(b.y, Math.min(b.y + b.height, cy)) },
      ];
      const nearest = points.sort(
        (a, c) =>
          Math.hypot(a.x - cx, a.y - cy) - Math.hypot(c.x - cx, c.y - cy),
      )[0];
      const command = updateVisual(after, element.id, {
        x: nearest.x - w / 2,
        y: nearest.y - h / 2,
      });
      if (command) {
        applyCommands(after, [command]);
        commands.push(command);
      }
      continue;
    }
    const old = before.get(element.id);
    if (
      old &&
      old.visual.x === element.visual.x &&
      old.visual.y === element.visual.y
    )
      continue;
    const cx = (element.visual.x ?? 0) + (element.visual.width ?? 0) / 2;
    const cy = (element.visual.y ?? 0) + (element.visual.height ?? 0) / 2;
    const model = buildBpmnModel(after.getSnapshot(), element.page);
    const descendants = new Set(model.descendantsOf(element.id));
    const candidates = bpmnElements(after)
      .filter((container) => {
        if (
          container.page !== element.page ||
          !["bpmn.subProcess", "bpmn.lane", "bpmn.participant"].includes(
            container.type,
          ) ||
          container.id === element.id ||
          descendants.has(container.id)
        )
          return false;
        const b = box(container);
        return (
          cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height
        );
      })
      .sort((a, b) => {
        const rank = (item: Element) =>
          item.type === "bpmn.subProcess"
            ? 0
            : item.type === "bpmn.lane"
              ? 1
              : 2;
        return rank(a) - rank(b) || depth(model, b) - depth(model, a);
      });
    const parent = candidates[0]?.id;
    const payload: Record<string, unknown> = Object.fromEntries(
      Object.entries(semantic(element)).filter(([key]) => key !== "parent"),
    );
    if (parent !== undefined) payload.parent = parent;
    if (semantic(element).parent === parent) continue;
    const command: Command = {
      type: "updateSemantic",
      id: element.id,
      semantic: payload,
    };
    applyCommands(after, [command]);
    commands.push(command);
  }
  return commands;
}

export function addBpmnLaneCommands(
  document: Document,
  parentId: ElementId,
  newId: ElementId,
  index: FractionalIndex,
): Command[] {
  const parent = document.elements.find((element) => element.id === parentId);
  if (
    !parent ||
    (parent.type !== "bpmn.participant" && parent.type !== "bpmn.lane")
  )
    return [];
  const model = buildBpmnModel(document, parent.page);
  const children = model.order
    .map((id) => model.get(id))
    .filter(
      (element): element is Element =>
        element?.type === "bpmn.lane" &&
        model.parentOf(element.id) === parentId,
    );
  const pb = box(parent);
  const first = children.length === 0;
  const y = first
    ? pb.y
    : Math.max(
        ...children.map(
          (lane) => (lane.visual.y ?? 0) + (lane.visual.height ?? 120),
        ),
      );
  const height = first ? pb.height : 120;
  const lane: Element = {
    id: newId,
    page: parent.page,
    type: "bpmn.lane",
    index,
    semantic: { name: "Lane", parent: parentId },
    visual: { x: pb.x + 30, y, width: Math.max(0, pb.width - 30), height },
  };
  const commands: Command[] = [{ type: "createElement", element: lane }];
  if (!first) {
    let ancestor: Element | undefined = parent;
    while (
      ancestor &&
      ["bpmn.lane", "bpmn.participant"].includes(ancestor.type)
    ) {
      commands.push({
        type: "updateVisual",
        id: ancestor.id,
        visual: { height: (ancestor.visual.height ?? 0) + 120 },
      });
      const parentOfAncestor = model.parentOf(ancestor.id);
      ancestor = parentOfAncestor ? model.get(parentOfAncestor) : undefined;
    }
  } else {
    for (const member of document.elements) {
      if (
        semantic(member).parent === parentId &&
        member.page === parent.page &&
        member.id !== parentId
      ) {
        commands.push({
          type: "updateSemantic",
          id: member.id,
          semantic: { ...semantic(member), parent: newId },
        });
      }
    }
  }
  return commands;
}
