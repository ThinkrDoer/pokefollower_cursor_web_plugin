// Propagate package.json's "version" (the single source of truth) into:
//  - src/manifest.json        ("version" field — the actual extension version)
//  - src/popup/index.html     (the "PokeFollower vX.Y" brand label)
//
// Run after bumping package.json's version: `npm run sync-version`

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PKG_FILE      = path.join(ROOT, "package.json");
const MANIFEST_FILE = path.join(ROOT, "src", "manifest.json");
const POPUP_HTML    = path.join(ROOT, "src", "popup", "index.html");

const pkg = JSON.parse(fs.readFileSync(PKG_FILE, "utf8"));
const version = pkg.version;
if (!version) {
  console.error('package.json has no "version" field.');
  process.exit(1);
}

// manifest.json: replace just the version value, preserving existing formatting.
// Chrome accepts up to 4 dot-separated integers, so a full semver like "4.0.0" is valid.
const manifestRaw = fs.readFileSync(MANIFEST_FILE, "utf8");
const manifestUpdated = manifestRaw.replace(
  /"version":\s*"[^"]*"/,
  `"version": "${version}"`
);
fs.writeFileSync(MANIFEST_FILE, manifestUpdated);

// popup brand label: trim a trailing ".0" patch for a clean "vX.Y" look on round
// releases (e.g. "4.0.0" -> "v4.0", but "4.1.2" -> "v4.1.2" if a patch is needed).
const displayVersion = version.replace(/\.0$/, "");
const htmlRaw = fs.readFileSync(POPUP_HTML, "utf8");
const htmlUpdated = htmlRaw.replace(
  /PokeFollower v[\d.]+/,
  `PokeFollower v${displayVersion}`
);
fs.writeFileSync(POPUP_HTML, htmlUpdated);

console.log(`Synced version ${version} -> manifest.json, popup brand label "v${displayVersion}"`);
