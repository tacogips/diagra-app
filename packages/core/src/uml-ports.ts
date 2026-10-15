import { UmlComponentType, type UmlPortSemantic } from "@nodetto/ir";
import { applyCommands, type Command } from "./commands.ts";
import type { Store } from "./store.ts";
import { nearestUmlPortAnchor, umlPortAnchor } from "./shapes/umlComponent.ts";

/** Keep port attachment in the same undo transaction as owner transforms. */
export function planUmlPorts(before: Store, after: Store): Command[] {
  const commands: Command[] = [];
  for (const page of after.listPages())
    for (const port of after.getPageElements(page.id)) {
      if (port.type !== UmlComponentType.Port) continue;
      const semantic = port.semantic as UmlPortSemantic;
      const owner = after.get(semantic.owner);
      if (
        !owner ||
        owner.type !== UmlComponentType.Component ||
        owner.page !== port.page
      )
        continue;
      const old = before.get(port.id);
      const moved =
        old &&
        (old.visual.x !== port.visual.x || old.visual.y !== port.visual.y);
      const anchor = moved
        ? nearestUmlPortAnchor(owner, {
            x: (port.visual.x ?? 0) + 7,
            y: (port.visual.y ?? 0) + 7,
          })
        : semantic;
      const point = umlPortAnchor(owner, anchor.side, anchor.offset);
      if (anchor.side !== semantic.side || anchor.offset !== semantic.offset)
        commands.push({
          type: "updateSemantic",
          id: port.id,
          semantic: { ...semantic, side: anchor.side, offset: anchor.offset },
        });
      if (port.visual.x !== point.x - 7 || port.visual.y !== point.y - 7)
        commands.push({
          type: "updateVisual",
          id: port.id,
          visual: { x: point.x - 7, y: point.y - 7 },
        });
    }
  applyCommands(after, commands);
  return commands;
}
