import { expect, test } from "bun:test";
import { ACTION_MENUS, rememberedTool, TOOL_MENUS } from "./Toolbar.tsx";
test("toolbar menus retain every legacy creation and editing tool", () => {
  const items = TOOL_MENUS.flatMap((menu) =>
    menu.tools.map((tool) => tool.tool),
  );
  expect(items).toEqual([
    "draw.freehand",
    "text.note",
    "node.generic",
    "edge",
    "geo:rect",
    "geo:ellipse",
    "geo:diamond",
    "geo:cylinder",
    "erd.table",
    "uml.class",
    "sequence.actor",
    "sequence.service",
    "sequence.database",
    "frame:web",
    "frame:iphone",
    "frame:android",
    "frame:tablet",
    "frame:paper",
    "edit.points",
    "crop",
    "edit.paint",
    "edit.stroke-paint",
  ]);
});
test("toolbar action menus retain arrangement and export commands", () => {
  const items = ACTION_MENUS.flatMap((menu) =>
    menu.actions.map((action) => action.id),
  );
  expect(items).toEqual([
    "frameSelection",
    "group",
    "booleanUnion",
    "booleanSubtract",
    "booleanIntersect",
    "booleanExclude",
    "flattenBoolean",
    "ungroup",
    "alignLeft",
    "alignHCenter",
    "alignRight",
    "alignTop",
    "alignVCenter",
    "alignBottom",
    "exportSvg",
  ]);
});

test("split tool buttons prefer the active tool and otherwise remember it", () => {
  const frames = TOOL_MENUS.find((menu) => menu.id === "frames")?.tools ?? [];
  const shapes = TOOL_MENUS.find((menu) => menu.id === "shapes")?.tools ?? [];
  expect(
    rememberedTool(frames, "frame:android", "frame:web", "frame:web"),
  ).toBe("frame:android");
  expect(rememberedTool(frames, "select", "frame:android", "frame:web")).toBe(
    "frame:android",
  );
  expect(rememberedTool(shapes, "select", "select", "geo:rect")).toBe(
    "geo:rect",
  );
});
