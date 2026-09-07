import type { FrameSemantic } from "@diagra/ir";
import { applyCommands, type Command } from "./commands.ts";
import { planComponentRefresh } from "./component-refresh.ts";
import { componentStructureMatches } from "./component-structure.ts";
import { Editor } from "./editor.ts";
import { expandContainers } from "./frame-tree.ts";
import type { ShapeUtilRegistry } from "./shape-util.ts";
import type { Store } from "./store.ts";

/** Dependency-ordered derived edits, never a second history transaction. */
export function planAutoComponentRefresh(
  store: Store,
  registry: ShapeUtilRegistry,
): Command[] {
  const instances = store
    .getSnapshot()
    .elements.filter(
      (element) =>
        element.type === "frame" &&
        (element.semantic as FrameSemantic).autoRefresh &&
        (element.semantic as FrameSemantic).instanceOf,
    );
  if (!instances.length) return [];
  const editor = new Editor({ document: store.getSnapshot(), registry });
  const context = editor.createShapeContext();
  const dependencies = new Map<string, string[]>();
  for (const instance of instances) {
    const source = (instance.semantic as FrameSemantic).instanceOf;
    const descendants = new Set(
      source ? expandContainers(store, [source], context) : [],
    );
    dependencies.set(
      instance.id,
      instances
        .filter((candidate) => descendants.has(candidate.id))
        .map((candidate) => candidate.id),
    );
  }
  const visiting = new Set<string>();
  const done = new Map<string, boolean>();
  const commands: Command[] = [];
  const visit = (id: string): boolean => {
    if (done.has(id)) return done.get(id) ?? false;
    if (visiting.has(id)) return false;
    visiting.add(id);
    const ready = (dependencies.get(id) ?? []).every(visit);
    visiting.delete(id);
    const matches = ready ? componentStructureMatches(editor, id) : null;
    const planned =
      matches === true
        ? planComponentRefresh(editor, id)
        : matches === false
          ? editor.planComponentStructureUpdate(id)
          : null;
    done.set(id, planned !== null);
    if (planned) {
      applyCommands(editor.store, planned);
      commands.push(...planned);
    }
    return planned !== null;
  };
  for (const instance of instances) visit(instance.id);
  if (commands.length) applyCommands(store, commands);
  return commands;
}
