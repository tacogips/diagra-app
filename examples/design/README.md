# Editable UI design templates

Each screen is one **parent artboard shape**. Text, cards, charts, fields,
buttons, checkboxes and switches are separate editable shapes inside it.
These examples contain no flattened screenshot layers.

| Template | Screens | Artboard size |
| --- | --- | --- |
| [Web app](web-workspace/design.jsonl) | Overview, project board, workspace settings | 1280 × 900 |
| [iPhone app](iphone-planner/design.jsonl) | Today, task detail, inbox | 390 × 844 |

In Nodetto, choose **File > New from template** (also available in the macOS
File menu, Cmd+Alt+N), or open one of these `design.jsonl` files. The template
picker creates a new editable document and focuses its first screen. Starting
Nodetto normally still opens an empty document.

Select a parent artboard and choose **Export > HTML** to export that screen
as one HTML page and its CSS. Choose **All artboards** to export the three
screens as three HTML/CSS pairs, with an index. The `html/` directories contain
the corresponding output; `website.zip` contains the same files for sharing.
PNG and SVG previews are included for all six screens.

To regenerate the examples and exports:

```sh
bun apps/cli/scripts/generate-design-examples.ts
```

The design source is `packages/core/src/templates/design-templates.ts`.
These are static UI design examples; they do not implement application logic.
Their primary action has a prototype link to the second artboard in Nodetto.
