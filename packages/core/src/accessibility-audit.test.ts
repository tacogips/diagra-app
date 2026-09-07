import { expect, test } from "bun:test";
import {
  auditAccessibility,
  colorContrastRatio,
} from "./accessibility-audit.ts";
import { makeEditor } from "./test-helpers.ts";

test("computes WCAG contrast for opaque portable hex colors", () => {
  expect(colorContrastRatio("#000", "#ffffff")).toBe(21);
  expect(colorContrastRatio("#777777", "#fff")).toBeCloseTo(4.478, 2);
  expect(colorContrastRatio("#00000080", "#ffffff")).toBeNull();
  expect(colorContrastRatio("currentColor", "#ffffff")).toBeNull();
});

test("finds structural, naming, target-size, and contrast problems", () => {
  const editor = makeEditor();
  const headingOne = editor.buildElement("text.note", {
    semantic: { text: "Checkout" },
    accessibility: { role: "heading", headingLevel: 1 },
    visual: {
      x: 10,
      y: 10,
      width: 140,
      height: 30,
      style: { color: "#999999", fontSize: 16 },
    },
  });
  const headingThree = editor.buildElement("text.note", {
    semantic: { text: "Payment" },
    accessibility: { role: "heading", headingLevel: 3 },
    visual: { x: 10, y: 50, width: 140, height: 30 },
  });
  const button = editor.buildElement("text.note", {
    semantic: { text: "" },
    accessibility: { role: "button" },
    visual: { x: 10, y: 90, width: 32, height: 32 },
  });
  const image = editor.buildElement("image.raster", {
    semantic: {
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      alt: "",
    },
    visual: { x: 10, y: 140, width: 80, height: 80 },
  });
  const secondMain = editor.buildElement("frame", {
    semantic: { name: "Content", memberIds: [] },
    accessibility: { role: "main" },
    visual: { x: 100, y: 140, width: 180, height: 100 },
  });
  const navOne = editor.buildElement("frame", {
    semantic: { name: "Primary", memberIds: [] },
    accessibility: { role: "navigation" },
    visual: { x: 10, y: 250, width: 120, height: 60 },
  });
  const navTwo = editor.buildElement("frame", {
    semantic: { name: "Secondary", memberIds: [] },
    accessibility: { role: "navigation" },
    visual: { x: 150, y: 250, width: 120, height: 60 },
  });
  const decorative = editor.buildElement("shape.geo", {
    semantic: { geo: "rect", label: "Sparkle" },
    accessibility: { decorative: true, label: "Sparkle" },
    visual: { x: 250, y: 10, width: 20, height: 20 },
  });
  const children = [
    headingOne,
    headingThree,
    button,
    image,
    secondMain,
    navOne,
    navTwo,
    decorative,
  ];
  const root = editor.buildElement("frame", {
    semantic: {
      name: "Checkout",
      platform: "ios",
      memberIds: children.map((element) => element.id),
    },
    accessibility: { role: "main" },
    visual: {
      x: 0,
      y: 0,
      width: 320,
      height: 640,
      style: { fill: "#ffffff" },
    },
  });
  const link = editor.buildElement("edge.generic", {
    semantic: {
      from: decorative.id,
      to: secondMain.id,
      label: "Open",
      prototype: true,
    },
  });
  editor.apply(
    [root, ...children, link].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );

  const report = auditAccessibility(editor, root.id);
  const codes = report?.issues.map((issue) => issue.code) ?? [];
  expect(codes).toEqual(
    expect.arrayContaining([
      "contrast.low",
      "heading.levelSkipped",
      "name.missing",
      "target.tooSmall",
      "image.nameMissing",
      "landmark.mainDuplicate",
      "landmark.navigationNameMissing",
      "decorative.conflict",
      "decorative.interactive",
    ]),
  );
  expect(report?.passed).toBe(false);
  expect(report?.errors).toBeGreaterThan(0);
  expect(report?.warnings).toBeGreaterThan(0);
});

test("passes a named, structured, sufficiently sized accessible artboard", () => {
  const editor = makeEditor();
  const heading = editor.buildElement("text.note", {
    semantic: { text: "Profile" },
    accessibility: { role: "heading", headingLevel: 1 },
    visual: {
      x: 20,
      y: 20,
      width: 160,
      height: 32,
      style: { color: "#000000", fontSize: 24 },
    },
  });
  const button = editor.buildElement("text.note", {
    semantic: { text: "Save" },
    accessibility: { role: "button" },
    visual: { x: 20, y: 80, width: 120, height: 48 },
  });
  const image = editor.buildElement("image.raster", {
    semantic: {
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      alt: "",
    },
    accessibility: { decorative: true },
    visual: { x: 20, y: 150, width: 100, height: 100 },
  });
  const root = editor.buildElement("frame", {
    semantic: {
      name: "Profile",
      platform: "android",
      memberIds: [heading.id, button.id, image.id],
    },
    accessibility: { role: "main" },
    visual: {
      x: 0,
      y: 0,
      width: 360,
      height: 720,
      style: { fill: "#ffffff" },
    },
  });
  editor.apply(
    [root, heading, button, image].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  expect(auditAccessibility(editor, root.id)).toMatchObject({
    auditedElements: 4,
    errors: 0,
    warnings: 0,
    passed: true,
    issues: [],
  });
});
