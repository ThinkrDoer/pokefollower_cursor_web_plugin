#!/usr/bin/env node
/**
 * Usage:
 * node scripts/parse-anim.js \
 *   --xml src/assets/raw/gen-1/009-blastoise/Blastoise_AnimData.xml \
 *   --dir src/assets/raw/gen-1/009-blastoise \
 *   --name 009-blastoise \
 *   --generation gen-1 \
 *   --out src/assets/packs/retro/gen-1/009-blastoise.json \
 *   --idle Idle-Anim.webp --walk Walk-Anim.webp \
 *   --idleRow 0 --walkRow 0 \
 *   --fpsIdle 6 --fpsWalk 9
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { XMLParser } from 'fast-xml-parser';
import imageSize from 'image-size';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function arg(name, def = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx > -1 ? process.argv[idx + 1] : def;
}

const xmlPath   = arg('xml');
const baseDir   = arg('dir', path.dirname(xmlPath || ''));
const name      = arg('name', 'unknown');
const outPath   = arg('out', `./${name}.json`);
const idleFile   = arg('idle', 'Idle-Anim.webp');   // relative to baseDir
const walkFile   = arg('walk', 'Walk-Anim.webp');
const sleepFile  = arg('sleep', 'Sleep-Anim.webp');
const idleRow    = parseInt(arg('idleRow', '0'), 10);
const walkRow    = parseInt(arg('walkRow', '0'), 10);
const sleepRow   = parseInt(arg('sleepRow', '0'), 10);
const fpsIdleArg  = arg('fpsIdle');
const fpsWalkArg  = arg('fpsWalk');
const fpsSleepArg = arg('fpsSleep');
const flipX      = /^false$/i.test(arg('flipX', 'true')) ? false : true;
const generation = arg('generation', 'gen-1');
const rawPathArg = arg('rawPath');

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

function durationsFor(anim) {
  const raw = anim?.Durations?.Duration;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(d => Number(d)).filter(n => Number.isFinite(n) && n > 0);
}

function framesFrom(anim, grid) {
  const durs = durationsFor(anim);
  if (durs.length) return durs.length;
  return grid.columns || 1;
}

function fpsFrom(anim, fpsArg, fallback) {
  if (fpsArg !== undefined) {
    const num = Number(fpsArg);
    if (Number.isFinite(num) && num > 0) return num;
  }
  const durs = durationsFor(anim);
  if (durs.length) {
    const avg = durs.reduce((a, b) => a + b, 0) / durs.length;
    // XML durations are typically in 60 FPS ticks
    if (avg > 0) return +(60 / avg).toFixed(2);
  }
  return fallback;
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
  if (!columns || !rows) {
    throw new Error(`Sheet ${fileRel} has invalid grid for frame ${frame.w}x${frame.h}`);
  }
  return { columns, rows, width, height };
}

const BASE_ROW_MAP = {
  front: 0,
  frontRight: 1,
  right: 2,
  backRight: 3,
  back: 4,
  backLeft: 5,
  left: 6,
  frontLeft: 7
};

function buildRows(base, maxRows) {
  const rows = {};
  Object.entries(BASE_ROW_MAP).forEach(([key, idx]) => {
    const value = base + idx;
    rows[key] = Math.min(value, maxRows - 1);
  });
  return rows;
}

function createState({ anim, fileRel, rowBase, fpsArg, fallbackFps }) {
  if (!anim) return null;
  const frame = frameSize(anim);
  const grid = sheetInfo(fileRel, frame);
  const frames = framesFrom(anim, grid);
  const fps = fpsFrom(anim, fpsArg, fallbackFps);
  return {
    sheet: path.basename(fileRel),
    frame,
    fps,
    frames,
    rows: buildRows(rowBase, grid.rows)
  };
}

// Build states
const out = {
  name,
  generation,
  rawPath: (() => {
    if (rawPathArg) return rawPathArg.replace(/^\/+|\/+$/g, '');
    const prefix = typeof generation === 'string' && generation.length ? generation.replace(/^\/+|\/+$/g, '') : '';
    const slug = String(name || '').replace(/^\/+|\/+$/g, '');
    return prefix ? `${prefix}/${slug}` : slug;
  })(),
  flipX,
  states: {}
};

// IDLE
const idleAnim = pickAnim(['idle', 'stand', 'breath']) || pickAnim(['rotate']) || anims[0];
if (idleAnim) {
  out.states.idle = createState({
    anim: idleAnim,
    fileRel: idleFile,
    rowBase: idleRow,
    fpsArg: fpsIdleArg,
    fallbackFps: 6
  });
} else {
  console.warn('No idle-like anim found in XML; skipping idle.');
}

// WALK
const walkAnim = pickAnim(['walk', 'run', 'move']) || anims[0];
if (walkAnim) {
  out.states.walk = createState({
    anim: walkAnim,
    fileRel: walkFile,
    rowBase: walkRow,
    fpsArg: fpsWalkArg,
    fallbackFps: 9
  });
} else {
  console.warn('No walk-like anim found in XML; skipping walk.');
}

// SLEEP
const sleepAnim = pickAnim(['sleep', 'rest', 'nap']);
if (sleepAnim && fs.existsSync(path.resolve(baseDir, sleepFile))) {
  try {
    const state = createState({
      anim: sleepAnim,
      fileRel: sleepFile,
      rowBase: sleepRow,
      fpsArg: fpsSleepArg,
      fallbackFps: 1
    });
    if (state) out.states.sleep = state;
  } catch (err) {
    console.warn('Sleep state skipped:', err.message);
  }
} else if (sleepAnim) {
  console.warn('Sleep animation found but sheet missing:', sleepFile);
} else {
  console.warn('No sleep-like anim found in XML; skipping sleep.');
}

// Ensure output dir exists
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('Wrote', outPath);
