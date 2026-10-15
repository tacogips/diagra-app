import { describe, expect, test } from "bun:test";
import { connectorBackdropIds, isConnectorBackdrop } from "./backdrops.ts";
import { element } from "./test-helpers.ts";

const ungrouped = () => false;

describe("isConnectorBackdrop", () => {
  test("recognizes ungrouped frame and BPMN surfaces", () => {
    for (const surface of [
      element({ id: "frame", type: "frame", semantic: { name: "Frame" } }),
      element({
        id: "pool",
        type: "bpmn.participant",
        semantic: { name: "Pool", collapsed: false },
      }),
      element({
        id: "black-box",
        type: "bpmn.participant",
        semantic: { name: "Black box", collapsed: true },
      }),
      element({ id: "lane", type: "bpmn.lane", semantic: { name: "Lane" } }),
      element({
        id: "sub-process",
        type: "bpmn.subProcess",
        semantic: { name: "Expanded", expanded: true },
      }),
      element({
        id: "bpmn-group",
        type: "bpmn.group",
        semantic: { name: "Category" },
      }),
    ]) {
      expect(isConnectorBackdrop(surface, ungrouped)).toBe(true);
    }
  });

  test("excludes grouped surfaces and non-surface BPMN elements", () => {
    const grouped = () => true;
    for (const surface of [
      element({ id: "frame", type: "frame", semantic: { name: "Frame" } }),
      element({ id: "lane", type: "bpmn.lane", semantic: { name: "Lane" } }),
    ]) {
      expect(isConnectorBackdrop(surface, grouped)).toBe(false);
    }
    for (const node of [
      element({
        id: "collapsed-sub-process",
        type: "bpmn.subProcess",
        semantic: { name: "Collapsed", expanded: false },
      }),
      element({
        id: "missing-expanded",
        type: "bpmn.subProcess",
        semantic: { name: "Missing" },
      }),
      element({ id: "task", type: "bpmn.task", semantic: {} }),
      element({ id: "event", type: "bpmn.event", semantic: {} }),
      element({ id: "gateway", type: "bpmn.gateway", semantic: {} }),
      element({ id: "data", type: "bpmn.dataObject", semantic: {} }),
      element({ id: "annotation", type: "bpmn.textAnnotation", semantic: {} }),
      element({ id: "call", type: "bpmn.callActivity", semantic: {} }),
      element({ id: "generic", type: "node.generic", semantic: {} }),
      element({ id: "group", type: "group", semantic: { memberIds: [] } }),
    ]) {
      expect(isConnectorBackdrop(node, ungrouped)).toBe(false);
    }
  });
});

test("connectorBackdropIds requires a connector and preserves qualifying IDs", () => {
  const pool = element({
    id: "pool",
    type: "bpmn.participant",
    semantic: { name: "Pool", collapsed: false },
  });
  const lane = element({
    id: "lane",
    type: "bpmn.lane",
    semantic: { name: "Lane", parent: pool.id },
  });
  const task = element({ id: "task", type: "bpmn.task", semantic: {} });
  const flow = element({
    id: "flow",
    type: "bpmn.sequenceFlow",
    semantic: { from: "task", to: "task" },
  });

  expect(connectorBackdropIds([pool, lane, task], ungrouped).size).toBe(0);
  expect(connectorBackdropIds([pool, lane, task, flow], ungrouped)).toEqual(
    new Set([pool.id, lane.id]),
  );
});
