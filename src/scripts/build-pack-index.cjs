// Build an index of available packs so the popup can populate the selector dynamically.
// Scans:  src/assets/packs/retro/*.json
// Writes: src/assets/packs/index.json  ->  { "retro": [ { id, name }, ... ] }

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKS_DIR = path.join(ROOT, "src", "assets", "packs");
const RETRO_DIR = path.join(PACKS_DIR, "retro");
const OUT_FILE  = path.join(PACKS_DIR, "index.json");

// Helpers
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function labelFromSlug(slug) {
  // slug like "009-blastoise" -> "009-Blastoise"
  const [num, name] = slug.split("-");
  return `${String(num || "").padStart(3, "0")}-${capitalize(name || slug)}`;
}
function dexFromSlug(slug) {
  const num = parseInt((slug.split("-")[0] || "").trim(), 10);
  return Number.isFinite(num) ? num : 9999;
}

function main() {
  if (!fs.existsSync(RETRO_DIR)) {
    console.error("Missing directory:", RETRO_DIR);
    process.exit(1);
  }

  const entries = fs.readdirSync(RETRO_DIR)
    .filter(f => f.endsWith(".json"))
    .map(file => {
      const slug = path.basename(file, ".json"); // e.g., "009-blastoise"
      return {
        id: `retro/${slug}`,
        name: labelFromSlug(slug),
        dex: dexFromSlug(slug),
      };
    })
    .sort((a, b) => a.dex - b.dex)
    .map(({ id, name }) => ({ id, name }));

  const out = { retro: entries };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT_FILE} with ${entries.length} entries.`);
}

main();