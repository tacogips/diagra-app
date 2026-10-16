import type { JSX } from "solid-js";

export function Icon(props: {
  readonly name:
    | "select"
    | "hand"
    | "undo"
    | "redo"
    | "preview"
    | "frame"
    | "rect"
    | "ellipse"
    | "diamond"
    | "cylinder"
    | "draw"
    | "text"
    | "image"
    | "more"
    | "chevron"
    | "file"
    | "settings"
    | "import"
    | "export"
    | "node"
    | "connector"
    | "table"
    | "class"
    | "actor"
    | "service"
    | "component"
    | "provided"
    | "required"
    | "port"
    | "dependency"
    | "realization"
    | "task"
    | "start"
    | "end"
    | "gateway"
    | "bpmn";
}): JSX.Element {
  const paths = {
    select: "M5 3l11 8-6 1 3 7-2 1-3-7-4 4z",
    hand: "M7 11V5a1 1 0 012 0v5V3a1 1 0 012 0v7V4a1 1 0 012 0v6V6a1 1 0 012 0v7c0 3-2 5-5 5-3 0-5-2-5-5v-3a1 1 0 012 0v1z",
    undo: "M8 6l-5 5 5 5v-3c5 0 7 2 8 5 0-6-3-9-8-9z",
    redo: "M12 6l5 5-5 5v-3c-5 0-7 2-8 5 0-6 3-9 8-9z",
    preview:
      "M2 11s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5zm8 3a3 3 0 100-6 3 3 0 000 6z",
    frame: "M3 3h14v14H3zM5 5v10h10V5z",
    rect: "M3 5h14v10H3z",
    ellipse: "M3 10a7 4 0 1014 0 7 4 0 10-14 0z",
    diamond: "M10 2l8 8-8 8-8-8z",
    cylinder: "M4 5a6 3 0 0012 0v10a6 3 0 01-12 0zm0 0a6 3 0 0012 0",
    draw: "M4 15l1-4 8-8 3 3-8 8zm8-12l3 3",
    text: "M4 4h12M10 4v12",
    image: "M3 4h14v12H3zm2 9l3-3 2 2 2-3 3 4M6 7h.01",
    more: "M4 10a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm4.5 0a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm4.5 0a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z",
    chevron: "M6 8l4 4 4-4z",

    file: "M2 6h6l2 2h8v9H2zM2 8V4h6l2 2h6v2",
    settings:
      "M8 2h4l1 3 3 1 2 3-2 3-1 3-3 1-1 2H8l-1-3-3-1-2-3 2-3 1-3 3-1zm2 5a3 3 0 100 6 3 3 0 000-6z",
    import: "M11 2h5v16H4v-5M1 7h10M8 4l3 3-3 3",
    export: "M11 2h5v16H4v-5M1 7h10M4 4L1 7l3 3",
    node: "M3 5h14v10H3zM1 10h2m14 0h2",
    connector: "M2 5h7v10h9m-3-3 3 3-3 3",
    table: "M2 3h16v14H2zM2 7h16M2 12h16M7 7v10",
    class: "M2 2h16v16H2zM2 7h16M2 12h16M5 5h5m-5 5h7m-7 5h7",
    actor: "M10 2a2 2 0 110 4 2 2 0 010-4zM10 6v6m-5-3h10m-5 3-4 6m4-6 4 6",
    service: "M3 3h14v6H3zm0 8h14v6H3zM6 6h.1M6 14h.1m3-8h5m-5 8h5",
    component: "M6 2h12v16H6v-3m0-5V7M2 4h7v4H2zm0 8h7v4H2z",
    provided: "M2 10h7m4-4a4 4 0 110 8 4 4 0 010-8z",
    required: "M2 10h8m6-5a5 5 0 100 10",
    port: "M3 3h14v14H3zM1 8h4v4H1z",
    dependency: "M2 10h3m2 0h3m2 0h6m-4-4 4 4-4 4",
    realization: "M2 10h3m2 0h3m0 0 8-5v10z",
    task: "M5 4h10a3 3 0 013 3v6a3 3 0 01-3 3H5a3 3 0 01-3-3V7a3 3 0 013-3z",
    start: "M10 2a8 8 0 110 16 8 8 0 010-16z",
    end: "M10 2a8 8 0 110 16 8 8 0 010-16zm0 2a6 6 0 110 12 6 6 0 010-12z",
    gateway: "M10 2l8 8-8 8-8-8zM7 7l6 6m0-6-6 6",
    bpmn: "M1 6h5v8H1zm13 0 5 4-5 4-5-4zM6 10h3",
  } as const;
  const outlined = new Set([
    "preview",
    "frame",
    "rect",
    "ellipse",
    "diamond",
    "cylinder",
    "text",
    "image",
    "file",
    "settings",
    "import",
    "export",
    "node",
    "connector",
    "table",
    "class",
    "actor",
    "service",
    "component",
    "provided",
    "required",
    "port",
    "dependency",
    "realization",
    "task",
    "start",
    "end",
    "gateway",
    "bpmn",
  ]);
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d={paths[props.name]}
        fill={outlined.has(props.name) ? "none" : "currentColor"}
        stroke={outlined.has(props.name) ? "currentColor" : undefined}
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width={outlined.has(props.name) ? "1.5" : undefined}
      />
    </svg>
  );
}
