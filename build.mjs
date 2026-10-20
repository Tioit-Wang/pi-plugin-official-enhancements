/**
 * Build the plugin's two distributable surfaces.
 *
 * PI-Desktop installs plugins without compiling anything, so both artifacts
 * are committed-ready output of this script:
 *
 * - `views/index.html` + `views/assets/index.js`: the configuration view, a
 *   React page bundled with Tailwind's compiled CSS inlined (the sandboxed page
 *   may not load a stylesheet from a CDN).
 * - `renderer/index.mjs`: the slot components. React stays external here,
 *   because the host answers the bare `react` specifier through the import map
 *   of its own window — a bundled copy would break hooks.
 *
 * Run from this directory: `node build.mjs`.
 */

import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

async function buildView() {
  const result = await build({
    entryPoints: [join(here, "src/view/App.jsx")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    jsx: "transform",
    minify: true,
    legalComments: "none",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const js = result.outputFiles[0].text;
  // The view is a sandboxed page with no CDN reach, so the compiled stylesheet
  // is inlined next to the script.
  const css = readFileSync(join(here, "dist/view.css"), "utf8");
  const html = readFileSync(join(here, "src/view/index.html"), "utf8")
    .replace("<!--VIEW_STYLE-->", css)
    .replace("<!--VIEW_SCRIPT-->", js);
  mkdirSync(join(here, "views"), { recursive: true });
  writeFileSync(join(here, "views/index.html"), html, "utf8");
  return { bytes: html.length, file: "views/index.html" };
}

async function buildRenderer() {
  const result = await build({
    entryPoints: [join(here, "src/renderer/index.js")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    jsx: "transform",
    external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
    legalComments: "none",
  });
  mkdirSync(join(here, "renderer"), { recursive: true });
  const text = result.outputFiles[0].text;
  writeFileSync(join(here, "renderer/index.mjs"), text, "utf8");
  return { bytes: text.length, file: "renderer/index.mjs" };
}

const outputs = [await buildView(), await buildRenderer()];
for (const output of outputs) {
  console.log(`${output.file}  ${(output.bytes / 1024).toFixed(1)} KB`);
}
