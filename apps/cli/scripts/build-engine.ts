// Only the shared editor engine is bundled. Native CLI releases embed this
// portable JS as data and interpret it without JIT or external JS runtimes.
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const output =
  process.env.NODETTO_ENGINE_OUT_DIR ?? resolve(root, "native/engine");
mkdirSync(output, { recursive: true });
const build = await Bun.build({
  entrypoints: [resolve(root, "src/native-engine.ts")],
  target: "browser",
  format: "iife",
  minify: true,
  outdir: output,
  naming: "diagram.js",
  plugins: [
    {
      name: "native-raster",
      setup(builder) {
        // Native exports always provide their renderer. Make accidental calls to
        // the source-only fallback fail rather than bundle Node modules.
        builder.onResolve({ filter: /raster-backend\.ts$/ }, () => ({
          path: "raster-backend",
          namespace: "native",
        }));
        builder.onLoad({ filter: /.*/, namespace: "native" }, () => ({
          contents:
            'export function rasterize() { throw new Error("Native renderer required"); } export const pngToPdf = rasterize;',
          loader: "js",
        }));
      },
    },
  ],
});
if (!build.success)
  throw new AggregateError(build.logs, "Cannot bundle native diagram engine");
