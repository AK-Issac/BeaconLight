/**
 * Copy dist/ to dist-firefox/ and strip Chromium-only manifest fields
 * that cause Firefox to reject the add-on.
 */
import { cp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const src = path.join(root, "dist");
const dest = path.join(root, "dist-firefox");

if (!existsSync(src)) {
  console.error("dist/ not found. Run `npm run build` first.");
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await cp(src, dest, { recursive: true });

const manifestPath = path.join(dest, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

manifest.permissions = (manifest.permissions || []).filter(
  (permission) => permission !== "sidePanel"
);
delete manifest.side_panel;
delete manifest.minimum_chrome_version;
delete manifest.key;

if (Array.isArray(manifest.web_accessible_resources)) {
  manifest.web_accessible_resources = manifest.web_accessible_resources.map(
    (entry) => {
      if (entry && typeof entry === "object") {
        const { use_dynamic_url: _ignored, ...rest } = entry;
        return rest;
      }
      return entry;
    }
  );
}

manifest.browser_specific_settings = {
  gecko: {
    id: "spotlight@spotlight.local",
    strict_min_version: "121.0",
  },
};

manifest.sidebar_action = {
  default_title: "SpotLight",
  default_panel: "index.html",
};

if (!manifest.action) {
  manifest.action = { default_title: "SpotLight" };
}
manifest.action.default_popup = "index.html";

await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log("Firefox build ready at dist-firefox/");
