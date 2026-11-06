import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, "..");
const root = path.resolve(desktop, "..");
const vendor = path.join(desktop, "src", "vendor");
mkdirSync(vendor, { recursive: true });

const files = [
  ["engine/gummy-engine.js", "gummy-engine.js"],
  ["templates/gummy-atelier.html", "gummy-atelier.html"],
  ["characters/_presets/softcandy-chibi.toyspec.json", "softcandy-chibi.toyspec.json"],
];

for (const [from, to] of files) {
  copyFileSync(path.join(root, from), path.join(vendor, to));
  console.log(`sync ${from} → src/vendor/${to}`);
}
