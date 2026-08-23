// Executes the manual canvas checklist in `apps/desktop/README.md`.
//
// The gestures it covers are the ones unit tests cannot reach: they need a
// browser to supply real hit areas, pointer capture, focus and layout. So
// this drives a real headless Chrome over the DevTools Protocol with real
// mouse and keyboard input, and reads the assertions back out of the
// rendered DOM rather than out of the editor's own state.
//
//   bun --cwd=apps/desktop run dev       # in another shell
//   bun --cwd=apps/desktop run checklist
//
// Set CHROME_BIN to point at a different browser binary, and pass a URL as
// the first argument to check a preview build instead of the dev server.
// Exits non-zero if any step fails.

const URL = process.argv[2] ?? "http://localhost:1420/";
const PORT = Number(process.env["CDP_PORT"] ?? 9222);
const CHROME_CANDIDATES = [
  process.env["CHROME_BIN"],
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const sleepFor = (ms) => new Promise((r) => setTimeout(r, ms));

async function reachable(url) {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

if (!(await reachable(URL))) {
  console.error(
    `Nothing is serving ${URL}. Start it first:\n  bun --cwd=apps/desktop run dev`,
  );
  process.exit(2);
}

let chrome;
if (!(await reachable(`http://localhost:${PORT}/json/version`))) {
  const binary = CHROME_CANDIDATES.find((path) => {
    try {
      return Bun.file(path).size >= 0;
    } catch {
      return false;
    }
  });
  if (!binary) {
    console.error(
      `No Chrome binary found. Set CHROME_BIN to one, or start Chrome with --remote-debugging-port=${PORT} yourself.`,
    );
    process.exit(2);
  }
  chrome = Bun.spawn(
    [
      binary,
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      `--user-data-dir=${process.env["TMPDIR"] ?? "/tmp"}/diagra-canvas-checklist`,
      "--window-size=1400,900",
      URL,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  for (let i = 0; i < 60; i += 1) {
    if (await reachable(`http://localhost:${PORT}/json/version`)) break;
    await sleepFor(250);
  }
}

let nextId = 1;
let ws;
const pending = new Map();

function send(method, params, sessionId) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

async function connect() {
  const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
  let page = list.find((t) => t.type === "page");
  if (!page) {
    page = await (
      await fetch(`http://localhost:${PORT}/json/new?about:blank`, {
        method: "PUT",
      })
    ).json();
  }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => {
    ws.onopen = r;
  });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error
        ? reject(new Error(JSON.stringify(msg.error)))
        : resolve(msg.result);
    }
  };
}

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(
      res.exceptionDetails.exception?.description ?? "eval failed",
    );
  }
  return res.result.value;
}

const sleep = sleepFor;

async function mouse(type, x, y, opts = {}) {
  await send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: opts.button ?? "left",
    buttons: opts.buttons ?? 0,
    clickCount: opts.clickCount ?? 0,
    modifiers: opts.modifiers ?? 0,
    pointerType: "mouse",
    deltaX: opts.deltaX,
    deltaY: opts.deltaY,
  });
  await sleep(12);
}

const BUTTONS = { left: 1, middle: 4 };

async function drag(from, to, opts = {}) {
  const button = opts.button ?? "left";
  const mask = BUTTONS[button];
  await mouse("mousePressed", from.x, from.y, {
    button,
    buttons: mask,
    clickCount: 1,
    modifiers: opts.modifiers,
  });
  const steps = opts.steps ?? 6;
  for (let i = 1; i <= steps; i += 1) {
    await mouse(
      "mouseMoved",
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
      {
        button,
        buttons: mask,
      },
    );
  }
  if (opts.beforeRelease) await opts.beforeRelease();
  await mouse("mouseReleased", to.x, to.y, {
    button,
    buttons: 0,
    clickCount: 1,
  });
  await sleep(30);
}

async function click(pt, opts = {}) {
  await mouse("mousePressed", pt.x, pt.y, {
    buttons: 1,
    clickCount: 1,
    modifiers: opts.modifiers ?? 0,
  });
  await mouse("mouseReleased", pt.x, pt.y, {
    buttons: 0,
    clickCount: 1,
    modifiers: opts.modifiers ?? 0,
  });
  await sleep(30);
}

async function key(k, opts = {}) {
  const common = {
    key: k,
    code: opts.code ?? `Key${k.toUpperCase()}`,
    modifiers: opts.modifiers ?? 0,
    windowsVirtualKeyCode: opts.vk,
    nativeVirtualKeyCode: opts.vk,
  };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...common });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
  await sleep(40);
}

async function wheel(pt, deltaY, deltaX = 0, modifiers = 0) {
  await mouse("mouseWheel", pt.x, pt.y, {
    deltaX,
    deltaY,
    modifiers,
    buttons: 0,
  });
  await sleep(20);
}

// --- helpers reading real rendered DOM ---
const shapesJs = `Array.from(document.querySelectorAll('.diagra-shape')).map(n => ({
  id: n.dataset.elementId, type: n.dataset.elementType,
  left: parseFloat(n.style.left), top: parseFloat(n.style.top),
  width: parseFloat(n.style.width), height: parseFloat(n.style.height) }))`;
const stateJs = `({
  shapes: ${shapesJs},
  connectors: document.querySelectorAll('.diagra-connector').length,
  outlines: document.querySelectorAll('.diagra-selection-outline').length,
  handles: document.querySelectorAll('.diagra-handle').length,
  transform: document.querySelector('.diagra-viewport').style.transform,
  undoDisabled: Array.from(document.querySelectorAll('.diagra-tool-button')).find(b=>b.title==='Undo').disabled,
  redoDisabled: Array.from(document.querySelectorAll('.diagra-tool-button')).find(b=>b.title==='Redo').disabled,
  pending: document.querySelectorAll('.diagra-pending-connection').length,
})`;
const state = () => evaluate(stateJs);
const cam = async () => {
  const t = (await state()).transform;
  const m = /scale\(([-\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(t);
  return { z: +m[1], x: +m[2], y: +m[3] };
};

let canvasRect;
const pageToScreen = async (p) => {
  const c = await cam();
  return {
    x: canvasRect.left + (p.x + c.x) * c.z,
    y: canvasRect.top + (p.y + c.y) * c.z,
  };
};
const centerOf = (s) => ({ x: s.left + s.width / 2, y: s.top + s.height / 2 });

const results = [];
async function step(n, name, fn) {
  try {
    const detail = await fn();
    results.push({ n, name, status: "PASS", detail: detail ?? "" });
  } catch (err) {
    results.push({
      n,
      name,
      status: "FAIL",
      detail: String(err.message ?? err),
    });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

async function reload() {
  await send("Page.navigate", { url: URL });
  await sleep(900);
  canvasRect = await evaluate(
    `(() => { const r = document.querySelector('.diagra-canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`,
  );
}
async function toolbar(label) {
  await evaluate(
    `Array.from(document.querySelectorAll('.diagra-tool-button')).find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`,
  );
  await sleep(30);
}

await connect();
await send("Page.enable");
await send("Runtime.enable");
await reload();

// 1 -------------------------------------------------------------------
await step(1, "Launch shows the seeded diagram", async () => {
  const s = await state();
  const byType = {};
  for (const sh of s.shapes) byType[sh.type] = (byType[sh.type] ?? 0) + 1;
  assert(byType["erd.table"] === 2, `erd.table=${byType["erd.table"]}`);
  assert(byType["uml.class"] === 2, `uml.class=${byType["uml.class"]}`);
  assert(byType["shape.geo"] === 3, `shape.geo=${byType["shape.geo"]}`);
  assert(
    byType["node.generic"] === 2,
    `node.generic=${byType["node.generic"]}`,
  );
  assert(s.connectors === 3, `connectors=${s.connectors}`);
  const unsupported = await evaluate(
    `document.querySelectorAll('.diagra-unknown').length`,
  );
  assert(unsupported === 0, "an element rendered as unsupported");
  return "9 shapes, 3 connectors, no unsupported placeholders";
});

// 2 -------------------------------------------------------------------
await step(2, "Drag empty canvas pans and the grid tracks it", async () => {
  const before = await cam();
  const bgBefore = await evaluate(
    `document.querySelector('.diagra-canvas').style.backgroundPosition`,
  );
  await drag(
    { x: canvasRect.left + 950, y: canvasRect.top + 120 },
    { x: canvasRect.left + 1010, y: canvasRect.top + 160 },
  );
  const after = await cam();
  const bgAfter = await evaluate(
    `document.querySelector('.diagra-canvas').style.backgroundPosition`,
  );
  assert(
    near(after.x - before.x, 60, 3) && near(after.y - before.y, 40, 3),
    `pan delta ${after.x - before.x},${after.y - before.y}`,
  );
  assert(bgBefore !== bgAfter, "grid background did not move");
  return `camera moved by ${(after.x - before.x).toFixed(0)},${(after.y - before.y).toFixed(0)}; grid ${bgBefore} -> ${bgAfter}`;
});

// 3 -------------------------------------------------------------------
await reload();
await step(
  3,
  "Ctrl + wheel zooms about the pointer and clamps at 0.1x/8x",
  async () => {
    const anchorScreen = { x: canvasRect.left + 400, y: canvasRect.top + 300 };
    const pageUnder = async () => {
      const c = await cam();
      return {
        x: (anchorScreen.x - canvasRect.left) / c.z - c.x,
        y: (anchorScreen.y - canvasRect.top) / c.z - c.y,
      };
    };
    const before = await pageUnder();
    await wheel(anchorScreen, -180, 0, 2);
    const zoomed = await cam();
    assert(zoomed.z > 1.05, `z=${zoomed.z}`);
    const after = await pageUnder();
    assert(
      near(after.x, before.x, 1.5) && near(after.y, before.y, 1.5),
      `anchor drifted ${(after.x - before.x).toFixed(2)},${(after.y - before.y).toFixed(2)}`,
    );
    for (let i = 0; i < 30; i += 1) await wheel(anchorScreen, -400, 0, 2);
    assert(near((await cam()).z, 8, 0.001), `max z=${(await cam()).z}`);
    for (let i = 0; i < 60; i += 1) await wheel(anchorScreen, 400, 0, 2);
    assert(near((await cam()).z, 0.1, 0.001), `min z=${(await cam()).z}`);
    return "zoom anchored to within 1.5px, clamped to [0.1, 8]";
  },
);

// 4 -------------------------------------------------------------------
await reload();
await step(4, "Wheel and shift-wheel pan without zooming", async () => {
  const before = await cam();
  await wheel({ x: canvasRect.left + 400, y: canvasRect.top + 300 }, 50, 0);
  const mid = await cam();
  assert(mid.z === before.z, `zoom changed to ${mid.z}`);
  assert(near(mid.y - before.y, -50, 3), `vertical pan ${mid.y - before.y}`);
  await wheel({ x: canvasRect.left + 400, y: canvasRect.top + 300 }, 0, 40);
  const end = await cam();
  assert(near(end.x - mid.x, -40, 3), `horizontal pan ${end.x - mid.x}`);
  return `wheel panned y by -50 and x by -40, zoom unchanged at ${end.z}`;
});

// 5 -------------------------------------------------------------------
await reload();
await step(
  5,
  "Middle-drag and the Hand tool pan whatever tool is active",
  async () => {
    const s0 = await state();
    const shape = s0.shapes.find((x) => x.type === "shape.geo");
    const at = await pageToScreen(centerOf(shape));
    const before = await cam();
    await drag(at, { x: at.x + 40, y: at.y + 10 }, { button: "middle" });
    const afterMiddle = await cam();
    assert(
      near(afterMiddle.x - before.x, 40, 3),
      `middle-drag pan ${afterMiddle.x - before.x}`,
    );
    const moved = (await state()).shapes.find((x) => x.id === shape.id);
    assert(
      moved.left === shape.left,
      "middle-drag moved the shape instead of panning",
    );

    await toolbar("Hand");
    const at2 = await pageToScreen(centerOf(shape));
    await drag(at2, { x: at2.x + 30, y: at2.y });
    const afterHand = await cam();
    assert(
      near(afterHand.x - afterMiddle.x, 30, 3),
      `hand pan ${afterHand.x - afterMiddle.x}`,
    );
    assert(
      (await state()).shapes.find((x) => x.id === shape.id).left === shape.left,
      "hand tool moved the shape",
    );
    return "middle-drag and Hand both panned; the shape under the cursor stayed put";
  },
);

// 6, 7 -----------------------------------------------------------------
await reload();
await step(
  6,
  "Click a shape: dashed outline and eight resize handles",
  async () => {
    const s0 = await state();
    const geo = s0.shapes.find((x) => x.type === "shape.geo");
    await click(await pageToScreen(centerOf(geo)));
    const s = await state();
    assert(s.outlines === 1, `outlines=${s.outlines}`);
    assert(s.handles === 8, `handles=${s.handles}`);
    return "1 outline, 8 handles";
  },
);
await step(
  7,
  "Shift-click a second shape: two outlines, no handles",
  async () => {
    const s0 = await state();
    const others = s0.shapes.filter((x) => x.type === "shape.geo");
    await click(await pageToScreen(centerOf(others[1])), { modifiers: 8 });
    const s = await state();
    assert(s.outlines === 2, `outlines=${s.outlines}`);
    assert(s.handles === 0, `handles=${s.handles}`);
    return "2 outlines, 0 handles";
  },
);

// 8 -------------------------------------------------------------------
await reload();
await step(8, "Drag a selected shape moves the whole selection", async () => {
  const s0 = await state();
  const a = s0.shapes.filter((x) => x.type === "shape.geo")[0];
  const b = s0.shapes.filter((x) => x.type === "shape.geo")[1];
  await click(await pageToScreen(centerOf(a)));
  await click(await pageToScreen(centerOf(b)), { modifiers: 8 });
  const from = await pageToScreen(centerOf(a));
  await drag(from, { x: from.x + 70, y: from.y - 40 });
  const s = await state();
  const a2 = s.shapes.find((x) => x.id === a.id);
  const b2 = s.shapes.find((x) => x.id === b.id);
  assert(
    near(a2.left - a.left, 70) && near(a2.top - a.top, -40),
    `a moved ${a2.left - a.left},${a2.top - a.top}`,
  );
  assert(
    near(b2.left - b.left, 70) && near(b2.top - b.top, -40),
    `b moved ${b2.left - b.left},${b2.top - b.top}`,
  );
  return "both selected shapes moved by 70,-40";
});

// 9 -------------------------------------------------------------------
await reload();
await step(
  9,
  "Corner handle resizes; flips past the opposite edge; min 8 units",
  async () => {
    const s0 = await state();
    const geo = s0.shapes.find((x) => x.type === "shape.geo");
    await click(await pageToScreen(centerOf(geo)));
    const se = await pageToScreen({
      x: geo.left + geo.width,
      y: geo.top + geo.height,
    });
    await drag(se, { x: se.x + 60, y: se.y + 30 });
    let now = (await state()).shapes.find((x) => x.id === geo.id);
    assert(
      near(now.width, geo.width + 60) && near(now.height, geo.height + 30),
      `resized to ${now.width}x${now.height}`,
    );

    const se2 = await pageToScreen({
      x: now.left + now.width,
      y: now.top + now.height,
    });
    await drag(se2, {
      x: se2.x - (now.width + 200),
      y: se2.y - (now.height + 200),
    });
    now = (await state()).shapes.find((x) => x.id === geo.id);
    assert(
      now.width >= 8 && now.height >= 8,
      `min size violated: ${now.width}x${now.height}`,
    );
    assert(
      now.left < geo.left,
      `did not flip: left ${now.left} vs ${geo.left}`,
    );
    return `grew by 60x30, flipped past the opposite edge, floor held at >= 8 (${now.width.toFixed(0)}x${now.height.toFixed(0)})`;
  },
);

// 10 ------------------------------------------------------------------
await reload();
await step(
  10,
  "Resizing an ERD table changes width; height stays derived",
  async () => {
    const s0 = await state();
    const table = s0.shapes.find((x) => x.type === "erd.table");
    await click(await pageToScreen(centerOf(table)));
    const e = await pageToScreen({
      x: table.left + table.width,
      y: table.top + table.height / 2,
    });
    await drag(e, { x: e.x + 80, y: e.y + 120 });
    const now = (await state()).shapes.find((x) => x.id === table.id);
    assert(
      near(now.width, table.width + 80),
      `width ${now.width} vs ${table.width + 80}`,
    );
    assert(
      now.height === table.height,
      `height changed ${table.height} -> ${now.height}`,
    );
    return `width ${table.width} -> ${now.width}, height stayed ${now.height} (derived from 3 columns)`;
  },
);

// 11, 12 ---------------------------------------------------------------
await reload();
await step(
  11,
  "A geo tool places the shape centred on the click and resets to Select",
  async () => {
    await toolbar("Ellipse");
    const at = { x: canvasRect.left + 900, y: canvasRect.top + 200 };
    await click(at);
    const s = await state();
    const placed = s.shapes.find(
      (x) =>
        x.type === "shape.geo" &&
        x.left > 500 &&
        x.top < 400 &&
        x.width === 160,
    );
    assert(placed, "no ellipse was placed");
    const screenCentre = await pageToScreen(centerOf(placed));
    assert(
      near(screenCentre.x, at.x, 2) && near(screenCentre.y, at.y, 2),
      `centre ${screenCentre.x},${screenCentre.y} vs click ${at.x},${at.y}`,
    );
    assert(
      s.outlines === 1 && s.handles === 8,
      "the new shape was not selected",
    );
    const active = await evaluate(
      `document.querySelector('.diagra-tool-button.diagra-active').textContent.trim()`,
    );
    assert(active === "Select", `active tool is ${active}`);
    return "ellipse centred on the click, selected, tool back to Select";
  },
);
await step(
  12,
  "Table/Class/Node tools place their registry default payload",
  async () => {
    await toolbar("Table");
    await click({ x: canvasRect.left + 900, y: canvasRect.top + 480 });
    const header = await evaluate(
      `(() => { const t = Array.from(document.querySelectorAll('[data-element-type="erd.table"]')).pop();
      return { name: t.querySelector('.diagra-erd-header').textContent.trim(), rows: t.querySelectorAll('.diagra-erd-row').length }; })()`,
    );
    assert(
      header.name === "table" && header.rows === 1,
      JSON.stringify(header),
    );
    await toolbar("Class");
    await click({ x: canvasRect.left + 1150, y: canvasRect.top + 480 });
    const cls = await evaluate(
      `(() => { const c = Array.from(document.querySelectorAll('[data-element-type="uml.class"]')).pop();
      return c.querySelector('.diagra-uml-title').textContent.trim(); })()`,
    );
    assert(cls === "Class", `class name ${cls}`);
    await toolbar("Node");
    await click({ x: canvasRect.left + 1150, y: canvasRect.top + 620 });
    const nodes = await evaluate(
      `document.querySelectorAll('[data-element-type="node.generic"]').length`,
    );
    assert(nodes === 3, `nodes=${nodes}`);
    return `table "table" with 1 column, class "Class", node placed`;
  },
);

// 13, 14 ---------------------------------------------------------------
await reload();
await step(
  13,
  "Edge tool: rubber band, then an arrow stopping at both borders",
  async () => {
    const s0 = await state();
    const geos = s0.shapes.filter((x) => x.type === "shape.geo");
    const before = (await state()).connectors;
    await toolbar("Edge");
    const from = await pageToScreen(centerOf(geos[0]));
    const to = await pageToScreen(centerOf(geos[1]));
    let sawPending = 0;
    await drag(from, to, {
      beforeRelease: async () => {
        sawPending = (await state()).pending;
      },
    });
    assert(sawPending === 1, "no rubber band during the drag");
    const s = await state();
    assert(
      s.connectors === before + 1,
      `connectors ${before} -> ${s.connectors}`,
    );
    const line = await evaluate(
      `(() => { const g = Array.from(document.querySelectorAll('.diagra-connector')).pop().querySelector('line');
      return { x1:+g.getAttribute('x1'), y1:+g.getAttribute('y1'), x2:+g.getAttribute('x2'), y2:+g.getAttribute('y2'), marker: g.getAttribute('marker-end') }; })()`,
    );
    const a = geos[0];
    const b = geos[1];
    assert(
      near(line.x1, a.left + a.width, 1),
      `start not on a's border: ${line.x1} vs ${a.left + a.width}`,
    );
    assert(
      near(line.x2, b.left, 1),
      `end not on b's border: ${line.x2} vs ${b.left}`,
    );
    assert(
      /diagra-arrow/.test(line.marker ?? ""),
      `no arrowhead: ${line.marker}`,
    );
    return "rubber band shown, arrow drawn border-to-border with an arrowhead";
  },
);
await step(
  14,
  "Edge tool over empty canvas or the source shape creates nothing",
  async () => {
    const before = (await state()).connectors;
    const geo = (await state()).shapes.find((x) => x.type === "shape.geo");
    await toolbar("Edge");
    const from = await pageToScreen(centerOf(geo));
    await drag(from, { x: canvasRect.left + 1200, y: canvasRect.top + 700 });
    assert(
      (await state()).connectors === before,
      "released over empty canvas created a connector",
    );
    await toolbar("Edge");
    await drag(from, { x: from.x + 5, y: from.y + 5 });
    assert(
      (await state()).connectors === before,
      "self-connection created a connector",
    );
    return "neither the empty-canvas drop nor the self-connection created anything";
  },
);

// 15 ------------------------------------------------------------------
await reload();
await step(
  15,
  "Moving a connected shape re-routes its connectors",
  async () => {
    const s0 = await state();
    const table = s0.shapes.find((x) => x.type === "erd.table");
    const lineBefore = await evaluate(
      `(() => { const l = document.querySelector('.diagra-connector line'); return { x1:+l.getAttribute('x1'), y1:+l.getAttribute('y1') }; })()`,
    );
    await click(await pageToScreen(centerOf(table)));
    const from = await pageToScreen(centerOf(table));
    await drag(from, { x: from.x, y: from.y + 120 });
    const lineAfter = await evaluate(
      `(() => { const l = document.querySelector('.diagra-connector line'); return { x1:+l.getAttribute('x1'), y1:+l.getAttribute('y1') }; })()`,
    );
    const moved = (await state()).shapes.find((x) => x.id === table.id);
    assert(
      near(moved.top - table.top, 120, 2),
      `the table did not move (${moved.top - table.top})`,
    );
    assert(lineAfter.y1 !== lineBefore.y1, "the connector did not re-route");
    // The exit point slides along the border as the angle changes, so what
    // matters is that it is still ON the border of the box it belongs to.
    const onBorder =
      near(lineAfter.x1, moved.left, 1) ||
      near(lineAfter.x1, moved.left + moved.width, 1) ||
      near(lineAfter.y1, moved.top, 1) ||
      near(lineAfter.y1, moved.top + moved.height, 1);
    const inside =
      lineAfter.x1 >= moved.left - 1 &&
      lineAfter.x1 <= moved.left + moved.width + 1 &&
      lineAfter.y1 >= moved.top - 1 &&
      lineAfter.y1 <= moved.top + moved.height + 1;
    assert(
      onBorder && inside,
      `endpoint ${lineAfter.x1},${lineAfter.y1} is not on the table border ${moved.left},${moved.top} ${moved.width}x${moved.height}`,
    );
    return "table moved 120px, connector re-routed and its endpoint stayed on the table border";
  },
);

// 16 ------------------------------------------------------------------
await reload();
await step(
  16,
  "Delete removes the shape and the connectors that referenced it",
  async () => {
    const s0 = await state();
    const table = s0.shapes.find((x) => x.type === "erd.table");
    const connectorsBefore = s0.connectors;
    await click(await pageToScreen(centerOf(table)));
    await key("Delete", { code: "Delete", vk: 46 });
    const s = await state();
    assert(!s.shapes.some((x) => x.id === table.id), "the table survived");
    assert(
      s.connectors === connectorsBefore - 1,
      `connectors ${connectorsBefore} -> ${s.connectors}`,
    );
    return `table and its relation both gone (${connectorsBefore} -> ${s.connectors} connectors)`;
  },
);

// 17, 18, 19 ------------------------------------------------------------
await reload();
await step(17, "Ctrl+Z undoes; a drag undoes in one step", async () => {
  const s0 = await state();
  const geo = s0.shapes.find((x) => x.type === "shape.geo");
  await click(await pageToScreen(centerOf(geo)));
  const from = await pageToScreen(centerOf(geo));
  await drag(from, { x: from.x + 120, y: from.y + 60 }, { steps: 12 });
  const dragged = (await state()).shapes.find((x) => x.id === geo.id);
  assert(
    near(dragged.left - geo.left, 120),
    `drag moved ${dragged.left - geo.left}`,
  );
  await key("z", { modifiers: 2, code: "KeyZ", vk: 90 });
  const undone = (await state()).shapes.find((x) => x.id === geo.id);
  assert(
    near(undone.left, geo.left) && near(undone.top, geo.top),
    `one undo left it at ${undone.left},${undone.top} (expected ${geo.left},${geo.top})`,
  );
  return "a 12-move drag undid in exactly one Ctrl+Z";
});
await step(18, "Ctrl+Shift+Z and Ctrl+Y redo", async () => {
  const s0 = await state();
  const geo = s0.shapes.find((x) => x.type === "shape.geo");
  await key("z", { modifiers: 10, code: "KeyZ", vk: 90 });
  const redone = (await state()).shapes.find((x) => x.id === geo.id);
  assert(
    near(redone.left - geo.left, 120),
    `shift-redo left it at ${redone.left}`,
  );
  await key("z", { modifiers: 2, code: "KeyZ", vk: 90 });
  await key("y", { modifiers: 2, code: "KeyY", vk: 89 });
  const again = (await state()).shapes.find((x) => x.id === geo.id);
  assert(near(again.left - geo.left, 120), `ctrl+y left it at ${again.left}`);
  return "both redo shortcuts replayed the drag";
});
await step(
  19,
  "Undo/Redo buttons enable exactly when the shortcuts would act",
  async () => {
    await reload();
    let s = await state();
    assert(
      s.undoDisabled === true && s.redoDisabled === true,
      `fresh: undo=${s.undoDisabled} redo=${s.redoDisabled} (the seed must not be undoable)`,
    );
    const geo = s.shapes.find((x) => x.type === "shape.geo");
    await click(await pageToScreen(centerOf(geo)));
    const from = await pageToScreen(centerOf(geo));
    await drag(from, { x: from.x + 40, y: from.y });
    s = await state();
    assert(
      s.undoDisabled === false && s.redoDisabled === true,
      `after edit: undo=${s.undoDisabled} redo=${s.redoDisabled}`,
    );
    await evaluate(
      `Array.from(document.querySelectorAll('.diagra-tool-button')).find(b=>b.title==='Undo').click()`,
    );
    await sleep(50);
    s = await state();
    assert(
      s.undoDisabled === true && s.redoDisabled === false,
      `after undo: undo=${s.undoDisabled} redo=${s.redoDisabled}`,
    );
    return "disabled on the seeded document, and tracked the stack through an edit and an undo";
  },
);

// 20 ------------------------------------------------------------------
await reload();
await step(
  20,
  "Escape mid-drag reverts the move and records no undo step",
  async () => {
    const s0 = await state();
    const geo = s0.shapes.find((x) => x.type === "shape.geo");
    await click(await pageToScreen(centerOf(geo)));
    const from = await pageToScreen(centerOf(geo));
    let midway = null;
    await drag(
      from,
      { x: from.x + 150, y: from.y + 90 },
      {
        beforeRelease: async () => {
          midway = (await state()).shapes.find((x) => x.id === geo.id);
          await key("Escape", { code: "Escape", vk: 27 });
        },
      },
    );
    assert(
      near(midway.left - geo.left, 150, 4),
      `the drag was not actually in progress (moved ${midway.left - geo.left})`,
    );
    const s = await state();
    const back = s.shapes.find((x) => x.id === geo.id);
    assert(
      near(back.left, geo.left) && near(back.top, geo.top),
      `not reverted: ${back.left},${back.top} vs ${geo.left},${geo.top}`,
    );
    assert(s.undoDisabled === true, "the abandoned gesture left an undo step");
    assert(s.outlines === 0, "the selection was not cleared");
    const active = await evaluate(
      `document.querySelector('.diagra-tool-button.diagra-active').textContent.trim()`,
    );
    assert(active === "Select", `active tool is ${active}`);
    return "shape snapped back from +150,+90, Undo stayed disabled, selection cleared, tool back to Select";
  },
);

// 21 ------------------------------------------------------------------
await reload();
await step(21, "A middle click mid-drag leaves undo working", async () => {
  const s0 = await state();
  const geo = s0.shapes.find((x) => x.type === "shape.geo");
  await click(await pageToScreen(centerOf(geo)));
  const from = await pageToScreen(centerOf(geo));
  await drag(
    from,
    { x: from.x + 100, y: from.y },
    {
      beforeRelease: async () => {
        await mouse("mousePressed", from.x + 50, from.y, {
          button: "middle",
          buttons: 5,
          clickCount: 1,
        });
        await mouse("mouseReleased", from.x + 50, from.y, {
          button: "middle",
          buttons: 1,
          clickCount: 1,
        });
      },
    },
  );
  // The stray contact must not have killed history: a later edit is undoable.
  await toolbar("Rect");
  await click({ x: canvasRect.left + 1150, y: canvasRect.top + 250 });
  const s = await state();
  assert(
    s.undoDisabled === false,
    "Undo went dead after the stray middle click",
  );
  const count = s.shapes.length;
  await key("z", { modifiers: 2, code: "KeyZ", vk: 90 });
  const after = await state();
  assert(
    after.shapes.length === count - 1,
    `undo did nothing (${count} -> ${after.shapes.length})`,
  );
  return "undo still live after the stray contact, and it removed the newly placed rect";
});

for (const { n, name, status, detail } of results) {
  console.log(
    `${status === "PASS" ? "ok  " : "FAIL"} ${n}. ${name}\n       ${detail}`,
  );
}
const failed = results.filter((r) => r.status === "FAIL");
console.log(
  `\n${results.length - failed.length}/${results.length} steps passed`,
);
ws.close();
chrome?.kill();
process.exit(failed.length === 0 ? 0 : 1);
