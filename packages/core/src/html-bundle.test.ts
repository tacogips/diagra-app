import { expect, test } from "bun:test";
import { Editor } from "./editor.ts";
import { exportHtmlBundle, encodeHtmlBundleZip } from "./html-bundle.ts";
import { generateMobileInterfaceCode } from "./mobile-code.ts";
import { generateInterfaceCode } from "./interface-code.ts";
import { assertValidDocument, UI_CONTROL_KINDS } from "@nodetto/ir";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const text = (file: { contents: Uint8Array } | undefined): string =>
  new TextDecoder().decode(file?.contents);
test("website bundle exports separate pages, collision-safe CSS names and shared binary images", () => {
  const editor = new Editor();
  for (let i = 0; i < 2; i++) {
    const x = i * 600;
    const root = editor.createElement("frame", {
      semantic: { name: "Home", platform: "web" },
      visual: { x, y: 0, width: 500, height: 500 },
    });
    const image = editor.createElement("image.raster", {
      semantic: { src: "artifacts/photo.png", alt: 'A "photo"' },
      visual: { x: x + 10, y: 10, width: 20, height: 20 },
    });
    editor.apply([
      {
        type: "updateSemantic",
        id: root,
        semantic: {
          ...(editor.store.get(root)?.semantic as Record<string, unknown>),
          memberIds: [image],
        },
      },
    ]);
  }
  editor.assets.set("artifacts/photo.png", PNG);
  const before = editor.getSnapshot();
  const bundle = exportHtmlBundle(editor);
  expect(bundle.files.map((f) => f.path)).toEqual([
    "artifacts/image-1.png",
    "home.html",
    "home.css",
    "home-2.html",
    "home-2.css",
    "index.html",
    "README.txt",
  ]);
  for (const name of ["home", "home-2"]) {
    const html = text(bundle.files.find((f) => f.path === `${name}.html`));
    expect(html).toContain(`href="${name}.css"`);
    expect(html).toContain('src="artifacts/image-1.png"');
    expect(html).not.toContain("data:image");
  }
  expect(editor.getSnapshot()).toEqual(before);
  const zip = encodeHtmlBundleZip(bundle);
  expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x04034b50);
  expect(encodeHtmlBundleZip(bundle)).toEqual(zip);
});
test("missing attachments prevent incomplete HTML exports", () => {
  const editor = new Editor();
  editor.createElement("frame", {
    semantic: { name: "Page" },
    visual: { x: 0, y: 0, width: 500, height: 500 },
  });
  editor.createElement("image.raster", {
    semantic: { src: "artifacts/missing.png", alt: "Missing" },
    visual: { x: 10, y: 10, width: 20, height: 20 },
  });
  expect(() => exportHtmlBundle(editor)).toThrow("missing image");
});
test("all UI controls preserve state and escape text in HTML and SVG", () => {
  const editor = new Editor();
  const root = editor.createElement("frame", {
    semantic: { name: "Controls" },
    visual: { x: 0, y: 0, width: 500, height: 600 },
  });
  UI_CONTROL_KINDS.forEach((control, i) =>
    editor.createElement("ui.control", {
      semantic: {
        control,
        label: "<Label>",
        value: '"<&',
        options: ['"<&', "Two"],
        checked: true,
        disabled: true,
      },
      visual: { x: 10, y: i * 60 + 10, width: 200, height: 40 },
    }),
  );
  assertValidDocument(editor.getSnapshot());
  const code = generateInterfaceCode(editor, root);
  expect(code?.html).toContain('<button type="button"');
  expect(code?.html).toContain("<textarea");
  expect(code?.html).toContain("<select");
  expect(code?.html).toContain('role="switch"');
  expect(code?.html).toContain(" checked disabled");
  expect(code?.html).toContain("&lt;Label&gt;");
  expect(code?.html).not.toContain("<Label>");
  const mobile = generateMobileInterfaceCode(editor, root);
  expect(mobile?.swiftUi).toContain("Toggle(");
  expect(mobile?.jetpackCompose).toContain("OutlinedTextField(");
  const svg = editor.exportPageSvg();
  expect(svg).toContain("&lt;Label&gt;");
  expect(svg).not.toContain("Unsupported");
});

test("password inputs preserve their type and mask canvas exports", () => {
  const editor = new Editor();
  const root = editor.createElement("frame", {
    semantic: { name: "Login" },
    visual: { x: 0, y: 0, width: 500, height: 500 },
  });
  editor.createElement("ui.control", {
    semantic: {
      control: "input",
      inputType: "password",
      label: "Password",
      value: "example-password",
    },
    visual: { x: 20, y: 20, width: 180, height: 44 },
  });
  expect(generateInterfaceCode(editor, root)?.html).toContain(
    'type="password"',
  );
  expect(editor.exportPageSvg()).not.toContain("example-password");
  const native = generateMobileInterfaceCode(editor, root);
  expect(native?.swiftUi).toContain("SecureField(");
  expect(native?.jetpackCompose).toContain("PasswordVisualTransformation()");
});
