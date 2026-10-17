import type {
  Document,
  ElementId,
  UiControlSemantic,
  VisualStyle,
  FrameSemantic,
  ImageSemantic,
} from "@nodetto/ir";
import type { Box } from "./geometry.ts";
import { Editor } from "./editor.ts";

/** Browser capture supplies inert, measured records; conversion has no DOM dependencies. */
export interface HtmlLayoutNode {
  readonly name: string;
  readonly box: Box;
  readonly style?: VisualStyle;
  readonly text?: string;
  readonly image?: ImageSemantic;
  readonly backgroundImage?: ImageSemantic;
  readonly control?: UiControlSemantic;
  readonly children?: readonly HtmlLayoutNode[];
  readonly clip?: boolean;
}
export function importHtmlLayout(
  nodes: readonly HtmlLayoutNode[],
  options: { title: string; width: number; height: number },
): Document {
  const editor = new Editor();
  const root = editor.createElement("frame", {
    semantic: { name: options.title, platform: "web", clipContent: true },
    visual: { x: 0, y: 0, width: options.width, height: options.height },
  });
  let count = 0;
  const visit = (node: HtmlLayoutNode, depth: number): ElementId => {
    if (++count > 3000 || depth > 100)
      throw new Error("HTML layout exceeds the layer or nesting limit.");
    if (node.backgroundImage && (node.control || node.image)) {
      const { backgroundImage, ...foreground } = node;
      return visit(
        {
          name: node.name,
          box: node.box,
          style: node.style,
          backgroundImage,
          children: [
            {
              ...foreground,
              style: {
                ...node.style,
                fill: "transparent",
                strokeWidth: 0,
                opacity: 1,
              },
            },
          ],
        },
        depth + 1,
      );
    }
    const visual = {
      ...node.box,
      ...(node.style ? { style: node.style } : {}),
    };
    if (node.image)
      return editor.createElement("image.raster", {
        visual,
        semantic: node.image,
      });
    if (node.control)
      return editor.createElement("ui.control", {
        visual,
        semantic: node.control,
      });
    if (!node.children?.length && !node.backgroundImage)
      return editor.createElement("text.note", {
        visual: { ...visual, textPadding: 0 },
        semantic: { text: node.text ?? "" },
      });
    const id = editor.createElement("frame", {
      visual,
      semantic: {
        name: node.name,
        showTitle: false,
        clipContent: node.clip ?? false,
      },
    });
    const members = (node.children ?? []).map((child) =>
      visit(child, depth + 1),
    );
    if (node.text)
      members.unshift(
        editor.createElement("text.note", {
          visual: {
            ...visual,
            textPadding: 0,
            style: { ...node.style, fill: "transparent", strokeWidth: 0 },
          },
          semantic: { text: node.text },
        }),
      );
    if (node.backgroundImage)
      members.unshift(
        editor.createElement("image.raster", {
          visual: { ...node.box },
          semantic: node.backgroundImage,
        }),
      );
    editor.apply([
      {
        type: "updateSemantic",
        id,
        semantic: {
          ...(editor.store.get(id)?.semantic as FrameSemantic),
          memberIds: members,
        },
      },
    ]);
    return id;
  };
  const members = nodes.map((node) => visit(node, 0));
  editor.apply([
    {
      type: "updateSemantic",
      id: root,
      semantic: {
        ...(editor.store.get(root)?.semantic as FrameSemantic),
        memberIds: members,
      },
    },
  ]);
  return { ...editor.getSnapshot(), title: options.title };
}
