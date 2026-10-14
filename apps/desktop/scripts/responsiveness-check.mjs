// Start Vite, then: bun scripts/responsiveness-check.mjs http://localhost:1420
// Isolated headless Chrome, with no additional browser-test dependencies.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const origin = process.argv[2] ?? "http://localhost:1420";
const port = Number(process.env.CDP_PORT ?? 9339);
const binary =
  process.env.CHROME_BIN ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let portInUse = false;
try {
  await fetch(`http://localhost:${port}/json/version`);
  portInUse = true;
} catch {
  /* A free debug port is required for this isolated test browser. */
}
if (portInUse)
  throw new Error(
    `CDP port ${port} is already in use; choose another CDP_PORT`,
  );
const profile = await mkdtemp(join(tmpdir(), "nodetto-responsiveness-"));
const chrome = Bun.spawn(
  [
    binary,
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1600,1000",
    "about:blank",
  ],
  { stdout: "ignore", stderr: "ignore" },
);
let ws;
try {
  let pages;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      pages = await (await fetch(`http://localhost:${port}/json/list`)).json();
      break;
    } catch {
      await Bun.sleep(100);
    }
  }
  const page = pages?.find((page) => page.type === "page");
  if (!page) throw new Error("Chrome did not expose a page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const pending = new Map();
  let nextId = 1;
  const errors = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.text);
    const entry = pending.get(message.id);
    if (entry) {
      pending.delete(message.id);
      message.error
        ? entry.reject(new Error(JSON.stringify(message.error)))
        : entry.resolve(message.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ??
          "browser evaluation failed",
      );
    return result.result.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.navigate", {
    url: new URL("/scripts/fixtures/responsiveness.html", origin).href,
  });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate("Boolean(window.responsiveness)")) {
      ready = true;
      break;
    }
    await Bun.sleep(100);
  }
  if (!ready) throw new Error("fixture did not load");
  const results = await evaluate("window.responsiveness.run()");
  const handle =
    await evaluate(`Array.from(document.querySelectorAll('.nodetto-handle')).map(node=>{
    const box=node.getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2};
  }).sort((a,b)=>(b.x+b.y)-(a.x+a.y))[0]`);
  if (!handle) throw new Error("missing resize handle");
  const mouse = (type, x, y, buttons) =>
    send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      buttons,
      clickCount: 1,
      pointerType: "mouse",
    });
  await mouse("mousePressed", handle.x, handle.y, 1);
  for (let i = 1; i <= 15; i++) {
    await mouse(
      "mouseMoved",
      handle.x + (70 * i) / 15,
      handle.y + (30 * i) / 15,
      1,
    );
    await Bun.sleep(12);
  }
  await Bun.sleep(60);
  const held = await evaluate("window.responsiveness.heldSize()");
  if (held.width !== "170px" || held.height !== "100px" || !held.batching)
    throw new Error(`held resize failed: ${JSON.stringify(held)}`);
  await mouse("mouseReleased", handle.x + 70, handle.y + 30, 0);
  await evaluate("window.responsiveness.undo()");
  await Bun.sleep(60);
  const undo = await evaluate("window.responsiveness.heldSize()");
  if (undo.width !== "100px" || undo.height !== "70px" || undo.batching)
    throw new Error(`resize undo failed: ${JSON.stringify(undo)}`);
  if (errors.length)
    throw new Error(`uncaught browser errors: ${errors.join(", ")}`);
  console.log(JSON.stringify({ passed: true, ...results, held, undo }));
} finally {
  ws?.close();
  chrome.kill();
  await chrome.exited;
  await rm(profile, { recursive: true, force: true });
}
