import { describe, expect, test } from "bun:test";
import {
  type SequenceActivationSemantic,
  type SequenceMessageSemantic,
  type SequenceParticipantSemantic,
  validateDocument,
} from "@diagra/ir";
import { compareFractional } from "./fractional.ts";
import { makeEditor } from "./test-helpers.ts";

describe("sequence participant creation", () => {
  test("places ordered participant kinds with unique names and atomic undo", () => {
    const editor = makeEditor();
    const actor = editor.createSequenceParticipant("actor", { x: 100, y: 80 });
    const service = editor.createSequenceParticipant("service", {
      x: 340,
      y: 80,
    });
    const database = editor.createSequenceParticipant("db", {
      x: 580,
      y: 80,
    });
    const elements = [actor, service, database].map(
      (id) =>
        editor.store.get(id) as NonNullable<
          ReturnType<typeof editor.store.get>
        >,
    );

    expect(
      elements.map(
        (element) => element.semantic as SequenceParticipantSemantic,
      ),
    ).toEqual([
      { name: "Actor 1", kind: "actor", order: expect.any(String) },
      { name: "Service 1", kind: "service", order: expect.any(String) },
      { name: "Database 1", kind: "db", order: expect.any(String) },
    ]);
    const orders = elements.map(
      (element) => (element.semantic as SequenceParticipantSemantic).order,
    );
    expect(orders[0] < orders[1] && orders[1] < orders[2]).toBe(true);
    expect(elements.map((element) => element.visual.x)).toEqual([20, 260, 500]);
    expect(validateDocument(editor.getSnapshot())).toEqual([]);

    expect(editor.undo()).toBe(true);
    expect(editor.store.has(database)).toBe(false);
    expect(editor.store.has(actor)).toBe(true);
  });

  test("reorders participants semantically and visually in one undo step", () => {
    const editor = makeEditor();
    const actor = editor.createSequenceParticipant("actor", { x: 100, y: 80 });
    const service = editor.createSequenceParticipant("service", {
      x: 340,
      y: 80,
    });
    const database = editor.createSequenceParticipant("db", {
      x: 580,
      y: 80,
    });
    const before = editor.getSnapshot();

    expect(editor.moveSequenceElement(database, -1)).toBe(true);
    const ordered = editor.store
      .getPageElements(editor.currentPageId)
      .filter((element) => element.type === "sequence.participant")
      .sort((left, right) =>
        compareFractional(
          (left.semantic as SequenceParticipantSemantic).order,
          (right.semantic as SequenceParticipantSemantic).order,
        ),
      );
    expect(ordered.map((element) => element.id)).toEqual([
      actor,
      database,
      service,
    ]);
    expect(ordered.map((element) => element.visual.x)).toEqual([20, 260, 500]);
    expect(validateDocument(editor.getSnapshot())).toEqual([]);

    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()).toEqual(before);
    expect(editor.moveSequenceElement(actor, -1)).toBe(false);
  });
});

describe("sequence smart connect", () => {
  test("appends timeline messages and extends every lifeline atomically", () => {
    const editor = makeEditor();
    const actor = editor.createSequenceParticipant("actor", { x: 100, y: 80 });
    const service = editor.createSequenceParticipant("service", {
      x: 340,
      y: 80,
    });
    const observer = editor.createSequenceParticipant("service", {
      x: 580,
      y: 80,
    });
    const beforeHeights = [actor, service, observer].map(
      (id) => editor.store.get(id)?.visual.height,
    );

    const first = editor.connectSmart(actor, service) as string;
    const second = editor.connectSmart(service, actor) as string;
    const firstElement = editor.store.get(first);
    const secondElement = editor.store.get(second);
    expect(firstElement?.type).toBe("sequence.message");
    expect(firstElement?.semantic).toMatchObject({
      from: actor,
      to: service,
      kind: "sync",
      label: "Message",
    });
    expect(secondElement?.visual.y).toBe((firstElement?.visual.y ?? 0) + 52);
    expect(
      (firstElement?.semantic as SequenceMessageSemantic).order <
        (secondElement?.semantic as SequenceMessageSemantic).order,
    ).toBe(true);
    const extendedHeights = [actor, service, observer].map(
      (id) => editor.store.get(id)?.visual.height,
    );
    expect(extendedHeights.every((height) => (height ?? 0) > 220)).toBe(true);
    expect(validateDocument(editor.getSnapshot())).toEqual([]);

    expect(editor.undo()).toBe(true);
    expect(editor.store.has(second)).toBe(false);
    expect(
      [actor, service, observer].map(
        (id) => editor.store.get(id)?.visual.height,
      ),
    ).not.toEqual(beforeHeights);
    expect(editor.undo()).toBe(true);
    expect(editor.store.has(first)).toBe(false);
    expect(
      [actor, service, observer].map(
        (id) => editor.store.get(id)?.visual.height,
      ),
    ).toEqual(beforeHeights);
  });

  test("leaves existing ER, UML and generic specialization behavior intact", () => {
    const editor = makeEditor();
    const participant = editor.createSequenceParticipant("actor", {
      x: 100,
      y: 80,
    });
    const node = editor.createElement("node.generic", {
      semantic: { label: "Node" },
      visual: { x: 300, y: 50 },
    });
    const edge = editor.connectSmart(participant, node);
    expect(editor.store.get(edge as string)?.type).toBe("edge.generic");
    expect(editor.connectSmart(participant, participant)).toBeNull();
  });

  test("respects participant locks without partially extending lifelines", () => {
    const editor = makeEditor();
    const actor = editor.createSequenceParticipant("actor", { x: 100, y: 80 });
    const service = editor.createSequenceParticipant("service", {
      x: 340,
      y: 80,
    });
    editor.apply([
      { type: "updateVisual", id: service, visual: { locked: true } },
    ]);
    const before = editor.getSnapshot();
    expect(editor.connectSmart(actor, service)).toBeNull();
    expect(editor.createSequenceActivation(service)).toBeNull();
    expect(editor.getSnapshot()).toEqual(before);
  });

  test("reorders messages without changing endpoints or the orthogonal axis", () => {
    const editor = makeEditor();
    const actor = editor.createSequenceParticipant("actor", { x: 100, y: 80 });
    const service = editor.createSequenceParticipant("service", {
      x: 340,
      y: 80,
    });
    const first = editor.connectSmart(actor, service) as string;
    const second = editor.connectSmart(service, actor) as string;
    const firstBefore = editor.store.get(first);
    const secondBefore = editor.store.get(second);

    expect(editor.moveSequenceElement(second, -1)).toBe(true);
    expect(editor.store.get(second)?.visual.y).toBe(firstBefore?.visual.y);
    expect(editor.store.get(first)?.visual.y).toBe(secondBefore?.visual.y);
    expect(editor.store.get(second)?.semantic).toMatchObject({
      from: service,
      to: actor,
    });
    expect(
      (editor.store.get(second)?.semantic as SequenceMessageSemantic).order <
        (editor.store.get(first)?.semantic as SequenceMessageSemantic).order,
    ).toBe(true);
    expect(validateDocument(editor.getSnapshot())).toEqual([]);
  });

  test("does not reorder through a locked adjacent sequence layer", () => {
    const editor = makeEditor();
    const actor = editor.createSequenceParticipant("actor", { x: 100, y: 80 });
    const service = editor.createSequenceParticipant("service", {
      x: 340,
      y: 80,
    });
    editor.apply([
      { type: "updateVisual", id: service, visual: { locked: true } },
    ]);
    const before = editor.getSnapshot();
    expect(editor.moveSequenceElement(actor, 1)).toBe(false);
    expect(editor.getSnapshot()).toEqual(before);
  });

  test("refuses an unsplittable imported order tie without throwing", () => {
    const editor = makeEditor();
    const actor = editor.createSequenceParticipant("actor", { x: 100, y: 80 });
    const service = editor.createSequenceParticipant("service", {
      x: 340,
      y: 80,
    });
    const database = editor.createSequenceParticipant("db", {
      x: 580,
      y: 80,
    });
    const tiedOrder = (
      editor.store.get(service)?.semantic as SequenceParticipantSemantic
    ).order;
    editor.apply([
      {
        type: "updateSemantic",
        id: database,
        semantic: {
          ...(editor.store.get(database)
            ?.semantic as SequenceParticipantSemantic),
          order: tiedOrder,
        },
      },
    ]);
    const before = editor.getSnapshot();
    expect(editor.moveSequenceElement(actor, 1)).toBe(false);
    expect(editor.getSnapshot()).toEqual(before);
  });
});

describe("sequence activations", () => {
  test("spans participant messages, follows movement and undoes with height", () => {
    const editor = makeEditor();
    const actor = editor.createSequenceParticipant("actor", { x: 100, y: 80 });
    const service = editor.createSequenceParticipant("service", {
      x: 340,
      y: 80,
    });
    const first = editor.connectSmart(actor, service) as string;
    const second = editor.connectSmart(service, actor) as string;
    const beforeHeight = editor.store.get(service)?.visual.height;
    const activation = editor.createSequenceActivation(service) as string;
    const semantic = editor.store.get(activation)
      ?.semantic as SequenceActivationSemantic;
    expect(semantic).toEqual({
      participant: service,
      fromOrder: (editor.store.get(first)?.semantic as SequenceMessageSemantic)
        .order,
      toOrder: (editor.store.get(second)?.semantic as SequenceMessageSemantic)
        .order,
    });
    const before = editor.getBounds(activation);
    expect(before?.x).toBe(335);

    editor.moveElements([{ id: service, x: 460, y: 52 }]);
    expect(editor.getBounds(activation)?.x).toBe(535);
    expect(validateDocument(editor.getSnapshot())).toEqual([]);

    expect(editor.undo()).toBe(true);
    expect(editor.getBounds(activation)?.x).toBe(before?.x);
    expect(editor.undo()).toBe(true);
    expect(editor.store.has(activation)).toBe(false);
    expect(editor.store.get(service)?.visual.height).toBe(beforeHeight);
  });

  test("creates a valid initial interval before any message exists", () => {
    const editor = makeEditor();
    const actor = editor.createSequenceParticipant("actor", { x: 100, y: 80 });
    const activation = editor.createSequenceActivation(actor) as string;
    const semantic = editor.store.get(activation)
      ?.semantic as SequenceActivationSemantic;
    expect(semantic.fromOrder < semantic.toOrder).toBe(true);
    expect(editor.getBounds(activation)).toMatchObject({
      x: 95,
      y: 156,
      width: 10,
      height: 76,
    });
    expect(editor.createSequenceActivation("missing")).toBeNull();
    expect(validateDocument(editor.getSnapshot())).toEqual([]);
  });
});
