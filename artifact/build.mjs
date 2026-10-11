// Bundles the single-page artifact version of the app into one HTML file (dist/life-in-uk-revision.html).
// React, ReactDOM and JSZip load from cdnjs as globals; everything else is inlined.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const result = await build({
  entryPoints: [path.join(here, "src/app.tsx")],
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  target: "es2020",
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  alias: {
    react: path.join(here, "src/shims/react.js"),
    "react-dom/client": path.join(here, "src/shims/react-dom.js"),
    jszip: path.join(here, "src/shims/jszip.js"),
  },
  legalComments: "none",
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = readFileSync(path.join(here, "src/template.html"), "utf8").replace("/*BUNDLE*/", () => js);
mkdirSync(path.join(here, "dist"), { recursive: true });
writeFileSync(path.join(here, "dist/life-in-uk-revision.html"), html);
console.log(`Built dist/life-in-uk-revision.html (${(html.length / 1024).toFixed(0)} KB)`);
