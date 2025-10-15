#!/usr/bin/env node
/**
 * Usage:
 * node scripts/parse-anim.js \
 *   --xml src/assets/raw/blastoise/Blastoise_AnimData.xml \
 *   --dir src/assets/raw/blastoise \
 *   --name blastoise \
 *   --out src/assets/packs/retro/blastoise.json \
 *   --idle Idle-Anim.webp --walk Walk-Anim.webp \
 *   --idleRow 0 --walkRow 0 \
 *   --fpsIdle 6 --fpsWalk 9
 */

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const imageSize = require('image-size');

function arg(name, def = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx > -1 ? process.argv[idx + 1] : def;
}

const xmlPath   = arg('xml');
const baseDir   = arg('dir', path.dirname(xmlPath || ''));
const name      = arg('name', 'unknown');
const outPath   = arg('out', `./${name}.json`);
const idleFile  = arg('idle', 'Idle-Anim.webp');   // relative to baseDir
const walkFile  = arg('walk', 'Walk-Anim.webp');
const idleRow   = parseInt(arg('idleRow', '0'), 10);
const walkRow   = parseInt(arg('walkRow', '0'), 10);
const fpsIdle   = parseFloat(arg('fpsIdle', '6'));
const fpsWalk   = parseFloat(arg('fpsWalk', '9'));

if (!xmlPath) {
  console.error('Missing --xml path to AnimData.xml');
  process.exit(1);
}
if (!fs.existsSync(xmlPath)) {
  console.error('XML not found:', xmlPath);
  process.exit(1);
}

const xml = fs.readFileSync(xmlPath, 'utf8');
const parser = new XMLParser({ ignoreAttributes: false });
const data = parser.parse(xml);

// Helper: dig to Anims/Anim array regardless of singular/plural shape
const anims = (() => {
  try {
    const a = data.AnimData.Anims.Anim;
    if (Array.isArray(a)) return a;
    if (a) return [a];
  } catch {}
  return [];
})();

// find an animation by name (case-insensitive contains)
function pickAnim(keywords) {
  const needle = keywords.map(s => s.toLowerCase());
  return anims.find(a => {
    const n = String(a.Name || '').toLowerCase();
    return needle.some(k => n.includes(k));
  });
}

// pull frame size (fallback if not present)
function frameSize(anim) {
  const w = parseInt(anim.FrameWidth  ?? anim.FrameW  ?? anim.Width  ?? 0, 10);
  const h = parseInt(anim.FrameHeight ?? anim.FrameH  ?? anim.Height ?? 0, 10);
  if (!w || !h) throw new Error('Missing FrameWidth/FrameHeight in XML for ' + (anim.Name || '?'));
  return { w, h };
}

// compute sheet grid from image dimensions
function sheetInfo(fileRel, frame) {
  const full = path.resolve(baseDir, fileRel);
  if (!fs.existsSync(full)) {
    throw new Error('Sheet image not found: ' + full);
  }
  const { width, height } = imageSize(full);
  const columns = Math.floor(width / frame.w);
  const rows    = Math.floor(height / frame.h);
  return { columns, rows, width, height };
}

// Build states
const out = {
  name,
  flipX: true,
  states: {}
};

// IDLE
const idleAnim = pickAnim(['idle', 'stand', 'breath']) || pickAnim(['rotate']) || anims[0];
if (idleAnim) {
  const frame = frameSize(idleAnim);
  const grid = sheetInfo(idleFile, frame);
  out.states.idle = {
    sheet: path.basename(idleFile),
    frame,
    fps: fpsIdle,
    row: Math.min(idleRow, grid.rows - 1),
    columns: grid.columns,
    rows: grid.rows,
    frames: grid.columns // default 1 row playback
  };
} else {
  console.warn('No idle-like anim found in XML; skipping idle.');
}

// WALK
const walkAnim = pickAnim(['walk', 'run', 'move']) || anims[0];
if (walkAnim) {
  const frame = frameSize(walkAnim);
  const grid = sheetInfo(walkFile, frame);
  out.states.walk = {
    sheet: path.basename(walkFile),
    frame,
    fps: fpsWalk,
    row: Math.min(walkRow, grid.rows - 1),
    columns: grid.columns,
    rows: grid.rows,
    frames: grid.columns // default 1 row playback
  };
} else {
  console.warn('No walk-like anim found in XML; skipping walk.');
}

// Ensure output dir exists
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('Wrote', outPath);
