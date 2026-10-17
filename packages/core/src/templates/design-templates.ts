import type {
  Document,
  ElementId,
  FrameSemantic,
  UiControlSemantic,
  VisualStyle,
} from "@nodetto/ir";
import { Editor } from "../editor.ts";

export const DESIGN_TEMPLATES = [
  {
    id: "web-workspace",
    name: "Web app",
    title: "Forma workspace",
    screens: 3,
    width: 1280,
    height: 900,
    platform: "web",
  },
  {
    id: "iphone-planner",
    name: "iPhone app",
    title: "Forma daily planner",
    screens: 3,
    width: 390,
    height: 844,
    platform: "ios",
  },
] as const;
export type DesignTemplateId = (typeof DESIGN_TEMPLATES)[number]["id"];
const C = {
  ink: "#172c28",
  muted: "#6c7973",
  green: "#285b49",
  pale: "#e7eee5",
  paper: "#f5f4ef",
  line: "#e1e5dc",
  white: "#ffffff",
  yellow: "#e9d384",
};

/** Screens are parent frame shapes; every part remains individually editable. */
export function createDesignTemplate(
  id: DesignTemplateId,
  idSource?: () => string,
): Document {
  const editor = new Editor({
    rng: () => 0.5,
    ...(idSource ? { idSource } : {}),
  });
  const template = DESIGN_TEMPLATES.find((t) => t.id === id);
  if (!template) throw new Error("Unknown design template");
  let origin = 0;
  let members: ElementId[] = [];
  const roots: ElementId[] = [];
  const add = (
    type: string,
    x: number,
    y: number,
    width: number,
    height: number,
    semantic: unknown,
    style: VisualStyle = {},
  ): ElementId => {
    const result = editor.createElement(type, {
      semantic,
      visual: {
        x: origin + x,
        y,
        width,
        height,
        style,
        ...(type === "text.note" ? { textPadding: 0 } : {}),
      },
    });
    members.push(result);
    return result;
  };
  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    fill = C.white,
    radius = 12,
    stroke = "none",
  ) =>
    add(
      "shape.geo",
      x,
      y,
      w,
      h,
      { geo: "rect", label: "" },
      {
        fill,
        stroke,
        strokeWidth: stroke === "none" ? 0 : 1,
        cornerRadius: radius,
      },
    );
  const text = (
    value: string,
    x: number,
    y: number,
    w: number,
    h = 24,
    size = 14,
    color = C.ink,
    weight = 400,
  ) =>
    add(
      "text.note",
      x,
      y,
      w,
      h,
      { text: value },
      {
        fontFamily: "Arial",
        fontSize: size,
        color,
        fontWeight: weight,
        fill: "transparent",
        stroke: "none",
        strokeWidth: 0,
      },
    );
  const button = (
    label: string,
    x: number,
    y: number,
    w = 144,
    fill = C.green,
    color = C.white,
  ) =>
    add(
      "ui.control",
      x,
      y,
      w,
      40,
      { control: "button", label },
      {
        fill,
        color,
        stroke: "none",
        strokeWidth: 0,
        fontFamily: "Arial",
        fontSize: 14,
        fontWeight: 600,
        cornerRadius: 9,
      },
    );
  const control = (
    semantic: UiControlSemantic,
    x: number,
    y: number,
    w: number,
    h = 44,
  ) =>
    add("ui.control", x, y, w, h, semantic, {
      fill: C.white,
      fontFamily: "Arial",
      color: C.ink,
      stroke: C.line,
      strokeWidth: 1,
      fontSize: 14,
      cornerRadius: 8,
    });
  const pill = (
    label: string,
    x: number,
    y: number,
    w = 100,
    fill = C.pale,
  ) => {
    rect(x, y, w, 26, fill, 13);
    text(label, x + 10, y + 5, w - 14, 18, 11, C.green, 600);
  };
  const avatar = (letters: string, x: number, y: number, fill = C.yellow) => {
    add(
      "shape.geo",
      x,
      y,
      32,
      32,
      { geo: "ellipse", label: "" },
      { fill, stroke: "none", strokeWidth: 0 },
    );
    text(letters, x + 8, y + 8, 24, 20, 11, C.ink, 600);
  };
  const start = (name: string, index: number): ElementId => {
    origin = index * (template.width + 100);
    members = [];
    const root = editor.createElement("frame", {
      semantic: {
        name,
        platform: template.platform,
        clipContent: true,
        showTitle: true,
        prototypeStart: index === 0,
        ...(template.platform === "ios"
          ? { safeArea: { top: 47, right: 0, bottom: 34, left: 0 } }
          : {}),
      },
      visual: {
        x: origin,
        y: 0,
        width: template.width,
        height: template.height,
        style: {
          fill: C.paper,
          stroke: "none",
          strokeWidth: 0,
          cornerRadius: template.platform === "ios" ? 32 : 0,
        },
      },
    });
    roots.push(root);
    return root;
  };
  const end = (root: ElementId) =>
    editor.apply([
      {
        type: "updateSemantic",
        id: root,
        semantic: {
          ...(editor.store.get(root)?.semantic as FrameSemantic),
          memberIds: [...members],
        },
      },
    ]);
  const nav = (active: number) => {
    rect(0, 0, 220, 900, C.ink, 0);
    text("forma", 28, 30, 160, 48, 32, C.white, 700);
    text("DESIGN WORKSPACE", 28, 85, 170, 20, 10, "#a4b5ad", 600);
    ["Overview", "Projects", "My tasks", "Team", "Settings"].forEach(
      (label, i) => {
        if (i === active) rect(16, 153 + i * 52, 188, 42, "#355047", 8);
        text(
          label,
          34,
          165 + i * 52,
          160,
          26,
          14,
          i === active ? C.white : "#aebeb5",
          i === active ? 600 : 400,
        );
      },
    );
    rect(20, 702, 180, 100, "#2b443b", 12);
    text("A little space to focus.", 34, 720, 150, 24, 12, C.white, 600);
    text("Your next idea starts here.", 34, 750, 150, 40, 11, "#b7c8be");
    avatar("ML", 26, 839);
    text("Maya Lee", 70, 842, 125, 22, 13, C.white, 600);
    text("Personal workspace", 70, 863, 138, 20, 10, "#b7c8be");
  };
  const webHeader = (title: string, subtitle: string, active: number) => {
    nav(active);
    text(
      `WORKSPACE  /  ${title.toUpperCase()}`,
      252,
      30,
      550,
      20,
      10,
      C.muted,
      600,
    );
    control(
      {
        control: "input",
        inputType: "search",
        label: "Search workspace",
        placeholder: "Search workspace",
      },
      916,
      20,
      268,
      38,
    );
    avatar("ML", 1210, 23);
    text(title, 252, 94, 720, 52, 34, C.ink, 700);
    text(subtitle, 254, 151, 800, 28, 14, C.muted);
  };
  let primary: ElementId | undefined;
  if (id === "web-workspace") {
    let root = start("Overview", 0);
    webHeader(
      "Good morning, Maya",
      "A clear view of what matters. Monday, October 19",
      0,
    );
    primary = button("Open project", 1092, 105, 148);
    [
      ["Active projects", "12", "+2 this month"],
      ["Tasks completed", "84", "18 ahead of last week"],
      ["Team capacity", "76%", "Room for good work"],
    ].forEach(([label, value, note], i) => {
      const x = 252 + i * 336;
      rect(x, 210, 316, 132);
      text(label ?? "", x + 22, 230, 270, 24, 13, C.muted);
      text(value ?? "", x + 22, 265, 135, 44, 32, C.ink, 600);
      text(note ?? "", x + 150, 281, 145, 34, 11, C.green);
    });
    rect(252, 366, 650, 248);
    text("Weekly momentum", 276, 389, 360, 28, 18, C.ink, 600);
    pill("This week", 770, 389, 105);
    [54, 88, 65, 114, 142, 97, 126].forEach((h, i) => {
      rect(290 + i * 80, 570 - h, 34, h, i === 4 ? C.green : "#c8d9c8", 5);
      text(
        ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i] ?? "",
        286 + i * 80,
        580,
        55,
        20,
        10,
        C.muted,
      );
    });
    rect(926, 366, 314, 248, C.yellow);
    text(
      "Make room for\nyour next big idea.",
      950,
      394,
      270,
      88,
      27,
      C.ink,
      600,
    );
    text("Brand refresh is ready for review.", 950, 502, 260, 40, 13);
    button("View brief", 950, 552, 156, C.ink);
    text("Your projects", 252, 648, 600, 30, 22, C.ink, 600);
    text("View all projects", 1116, 655, 124, 20, 12, C.green);
    ["Website refresh", "Mobile onboarding", "Design system"].forEach(
      (name, i) => {
        const x = 252 + i * 336;
        rect(x, 700, 316, 162);
        pill(
          ["In progress", "In review", "Planning"][i] ?? "",
          x + 18,
          718,
          112,
          i === 1 ? "#f3e7b6" : C.pale,
        );
        text(name, x + 18, 760, 280, 32, 18, C.ink, 600);
        rect(x + 18, 811, 240, 5, C.pale, 2);
        rect(x + 18, 811, [168, 210, 60][i] ?? 60, 5, C.green, 2);
        text(
          ["24 of 32 tasks", "18 of 20 tasks", "6 of 24 tasks"][i] ?? "",
          x + 18,
          831,
          245,
          18,
          10,
          C.muted,
        );
      },
    );
    end(root);
    root = start("Project board", 1);
    webHeader(
      "Website refresh",
      "A thoughtful new home for the Forma brand.",
      1,
    );
    button("Add task", 1092, 105, 148);
    pill("In progress", 254, 203, 110);
    text("Due Nov 12   /   6 members", 382, 209, 400, 22, 12, C.muted);
    ["To do", "In progress", "In review"].forEach((label, col) => {
      const x = 252 + col * 336;
      rect(x, 266, 316, 580, "#e9ece5");
      text(label, x + 18, 286, 220, 28, 16, C.ink, 600);
      text("3", x + 270, 289, 30, 22, 13, C.muted);
      const titles =
        [
          [
            "Explore navigation patterns",
            "Write homepage story",
            "Audit accessibility",
          ],
          [
            "Build the component library",
            "Design project overview",
            "Map mobile breakpoints",
          ],
          [
            "Review hero concepts",
            "Content hierarchy",
            "Validate color contrast",
          ],
        ][col] ?? [];
      titles.forEach((name, row) => {
        const y = 334 + row * 164;
        rect(x + 12, y, 292, 146);
        pill(row === 1 ? "Content" : "Design", x + 28, y + 16, 82);
        text(name, x + 28, y + 56, 246, 44, 15, C.ink, 600);
        avatar(
          ["ML", "JA", "SK"][row] ?? "",
          x + 28,
          y + 100,
          row === 1 ? "#d8e2f0" : C.yellow,
        );
        text(`Oct ${22 + row}`, x + 194, y + 108, 90, 20, 11, C.muted);
      });
    });
    end(root);
    root = start("Workspace settings", 2);
    webHeader(
      "Workspace settings",
      "A workspace that works the way you do.",
      4,
    );
    rect(252, 211, 988, 636);
    text("General", 280, 238, 700, 30, 20, C.ink, 600);
    text("Workspace name", 280, 304, 500, 24, 13, C.muted);
    control(
      { control: "input", label: "Workspace name", value: "Forma studio" },
      280,
      337,
      570,
    );
    text("Default view", 280, 416, 500, 24, 13, C.muted);
    control(
      {
        control: "select",
        label: "Default view",
        options: ["Overview", "Project board", "My tasks"],
        value: "Overview",
      },
      280,
      449,
      570,
    );
    text("Notifications", 280, 543, 650, 30, 20, C.ink, 600);
    control(
      { control: "switch", label: "Email digest", checked: true },
      280,
      595,
      630,
    );
    control(
      { control: "switch", label: "Project activity", checked: true },
      280,
      647,
      630,
    );
    control(
      { control: "switch", label: "Product updates", checked: false },
      280,
      699,
      630,
    );
    button("Save changes", 280, 779, 164);
    end(root);
  } else {
    const status = () => {
      text("9:41", 28, 17, 90, 22, 13, C.ink, 600);
      rect(284, 21, 4, 7, C.ink, 1);
      rect(291, 18, 4, 10, C.ink, 1);
      rect(298, 15, 4, 13, C.ink, 1);
      rect(320, 17, 28, 12, C.ink, 3);
    };
    const bottom = (active: number) => {
      rect(0, 750, 390, 94, C.white, 0);
      ["Today", "Projects", "Inbox"].forEach((label, i) => {
        rect(48 + i * 128, 769, 20, 18, active === i ? C.green : "#c1cbc4", 5);
        text(
          label,
          29 + i * 128,
          797,
          80,
          18,
          10,
          active === i ? C.green : C.muted,
          active === i ? 600 : 400,
        );
      });
      rect(131, 831, 128, 4, C.ink, 2);
    };
    let root = start("Today", 0);
    status();
    text("MONDAY, OCTOBER 19", 24, 71, 290, 22, 10, C.muted, 600);
    text("A little more focus.", 24, 104, 340, 42, 28, C.ink, 700);
    avatar("ML", 330, 65);
    text("3 priorities. One good day.", 24, 155, 340, 28, 14, C.muted);
    rect(24, 211, 342, 167, C.green, 20);
    text("YOUR WEEK", 44, 232, 270, 20, 10, "#cadbd0", 600);
    text(
      "You are making\nsteady progress.",
      44,
      263,
      290,
      62,
      23,
      C.white,
      600,
    );
    rect(44, 343, 256, 5, "#628673", 2);
    rect(44, 343, 184, 5, C.yellow, 2);
    text("18 of 24 tasks", 44, 357, 270, 18, 10, "#dae6dc");
    text("Today's priorities", 24, 413, 330, 30, 21, C.ink, 600);
    [
      "Review homepage concepts",
      "Sketch mobile navigation",
      "Share weekly update",
    ].forEach((name, i) => {
      const y = 451 + i * 78;
      rect(24, y, 342, 72);
      control(
        { control: "checkbox", label: "", checked: i === 2 },
        39,
        y + 18,
        26,
        32,
      );
      text(name, 80, y + 14, 258, 26, 14, C.ink, 600);
      text(
        [
          "Website refresh / 10:30",
          "Mobile onboarding / 14:00",
          "Team / Completed",
        ][i] ?? "",
        80,
        y + 43,
        260,
        19,
        11,
        C.muted,
      );
    });
    primary = button("View task", 24, 699, 342);
    bottom(0);
    end(root);
    root = start("Task detail", 1);
    status();
    text("< Today", 24, 70, 210, 30, 14, C.green, 600);
    pill("Design", 24, 126, 84);
    text("Review homepage\nconcepts", 24, 176, 342, 85, 31, C.ink, 700);
    text("Website refresh", 24, 275, 340, 24, 14, C.muted);
    rect(24, 325, 342, 112);
    avatar("ML", 42, 348);
    text("Maya Lee", 90, 349, 220, 25, 14, C.ink, 600);
    text("Assignee", 90, 379, 220, 22, 11, C.muted);
    pill("Today, 10:30", 42, 399, 132);
    text("The brief", 24, 474, 340, 30, 20, C.ink, 600);
    text(
      "Choose a direction that feels calm,\nconfident and easy to navigate.\nBring two options to the team review.",
      24,
      518,
      342,
      90,
      15,
      C.muted,
    );
    control(
      { control: "checkbox", label: "Check mobile contrast", checked: true },
      24,
      632,
      342,
    );
    control(
      { control: "checkbox", label: "Attach review notes", checked: false },
      24,
      679,
      342,
    );
    button("Mark complete", 24, 758, 342);
    rect(131, 831, 128, 4, C.ink, 2);
    end(root);
    root = start("Inbox", 2);
    status();
    text("Stay in the loop.", 24, 83, 342, 43, 29, C.ink, 700);
    text("Good work happens together.", 24, 138, 342, 28, 14, C.muted);
    pill("All updates", 24, 197, 118);
    pill("Mentions", 154, 197, 100, "#eeede7");
    [
      ["JA", "Jamie added a comment", "Website refresh", "12 min ago"],
      ["SK", "Sam shared a new concept", "Mobile onboarding", "38 min ago"],
      ["ML", "Your weekly digest is ready", "Forma workspace", "1 hour ago"],
      ["JA", "You were added to a project", "Design system", "Yesterday"],
    ].forEach(([letters, title, project, time], i) => {
      const y = 252 + i * 112;
      rect(24, y, 342, 98);
      avatar(letters ?? "", 40, y + 18, i % 2 ? "#d9e4ef" : C.yellow);
      text(title ?? "", 86, y + 15, 254, 38, 13, C.ink, 600);
      text(project ?? "", 86, y + 52, 254, 21, 11, C.green);
      text(time ?? "", 86, y + 74, 254, 18, 10, C.muted);
    });
    bottom(2);
    end(root);
  }
  if (primary && roots[1])
    editor.createElement("edge.generic", {
      semantic: { from: primary, to: roots[1], prototype: true },
      visual: {},
    });
  return { ...editor.getSnapshot(), title: template.title };
}
