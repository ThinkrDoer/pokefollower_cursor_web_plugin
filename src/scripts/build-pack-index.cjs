// Build an index of available packs so the popup can populate the selector dynamically.
// Scans:  src/assets/packs/retro/**/*.json
// Writes: src/assets/packs/index.json  ->  { "retro": [ { id, name }, ... ] }

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKS_DIR = path.join(ROOT, "src", "assets", "packs");
const RETRO_DIR = path.join(PACKS_DIR, "retro");
const OUT_FILE  = path.join(PACKS_DIR, "index.json");

// Helpers
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function titleCaseSlug(name) {
  return String(name || "")
    .split("-")
    .filter(Boolean)
    .map(capitalize)
    .join("-");
}
function labelFromSlug(slug) {
  // slug like "009-blastoise" -> "009-Blastoise"
  const dash = slug.indexOf("-");
  const num = dash >= 0 ? slug.slice(0, dash) : slug;
  const name = dash >= 0 ? slug.slice(dash + 1) : slug;
  return `${String(num || "").padStart(3, "0")}-${titleCaseSlug(name || slug)}`;
}
function dexFromSlug(slug) {
  const num = parseInt((slug.split("-")[0] || "").trim(), 10);
  return Number.isFinite(num) ? num : 9999;
}

function collectPackFiles(dir, relSegments = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const packs = [];
  entries.forEach((entry) => {
    if (entry.name.startsWith(".")) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      packs.push(...collectPackFiles(full, relSegments.concat(entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      const slug = path.basename(entry.name, ".json");
      const id = ["retro"].concat(relSegments, slug).join("/");
      packs.push({ id, slug });
    }
  });
  return packs;
}

function main() {
  if (!fs.existsSync(RETRO_DIR)) {
    console.error("Missing directory:", RETRO_DIR);
    process.exit(1);
  }

  const rawEntries = collectPackFiles(RETRO_DIR);
  const entries = rawEntries
    .map(({ id, slug }) => ({
      id,
      name: labelFromSlug(slug),
      dex: dexFromSlug(slug)
    }))
    .sort((a, b) => a.dex - b.dex)
    .map(({ id, name }) => ({ id, name }));

  const out = { retro: entries };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT_FILE} with ${entries.length} entries.`);
}

main();
