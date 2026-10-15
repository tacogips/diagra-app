import { describe, expect, test } from "bun:test";
import { createDefaultRegistry } from "./index.ts";
import { element } from "../test-helpers.ts";
import { readDirectEndpoints, resolveConnector } from "./connector.ts";

describe("BPMN shape utilities", () => {
  test("events and gateways hit their actual outlines", () => {
    const registry = createDefaultRegistry();
    const context = { zoom: 1, resolve: () => undefined, boundsOf: () => null };
    const event = element({
      id: "event",
      type: "bpmn.event",
      semantic: {},
      visual: { x: 0, y: 0, width: 36, height: 36 },
    });
    const gateway = element({
      id: "gateway",
      type: "bpmn.gateway",
      semantic: {},
      visual: { x: 0, y: 0, width: 50, height: 50 },
    });
    expect(
      registry
        .getOrFallback(event.type)
        .hitTest(event, { x: 0, y: 0 }, context),
    ).toBe(false);
    expect(
      registry
        .getOrFallback(event.type)
        .hitTest(event, { x: 18, y: 18 }, context),
    ).toBe(true);
    expect(
      registry
        .getOrFallback(gateway.type)
        .hitTest(gateway, { x: 0, y: 0 }, context),
    ).toBe(false);
    expect(registry.get("bpmn.sequenceFlow")).toBeDefined();
  });

  test("connectors dock at the BPMN event outline", () => {
    const registry = createDefaultRegistry();
    const event = element({
      id: "event",
      type: "bpmn.event",
      semantic: {},
      visual: { x: 0, y: 0, width: 36, height: 36 },
    });
    const task = element({
      id: "task",
      type: "bpmn.task",
      semantic: {},
      visual: { x: 100, y: -22, width: 100, height: 80 },
    });
    const flow = element({
      id: "flow",
      type: "bpmn.sequenceFlow",
      semantic: { from: "event", to: "task" },
    });
    const elements = new Map([
      [event.id, event],
      [task.id, task],
    ]);
    const context = {
      zoom: 1,
      resolve: (id: string) => elements.get(id),
      boundsOf: (id: string) => {
        const target = elements.get(id);
        return target
          ? registry.getOrFallback(target.type).getBounds(target, context)
          : null;
      },
    };
    const endpoints = resolveConnector(flow, context, readDirectEndpoints);
    expect(endpoints).not.toBeNull();
    const distance = Math.hypot(
      (endpoints?.start.x ?? 0) - 18,
      (endpoints?.start.y ?? 0) - 18,
    );
    expect(distance).toBeGreaterThanOrEqual(17);
    expect(distance).toBeLessThanOrEqual(19);
  });
});
