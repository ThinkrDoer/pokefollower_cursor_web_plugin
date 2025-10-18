// === VCP1 content script: load pack JSON + animate idle/walk with left/right flip ===
const STATE = {
  enabled: false,
  pack: "retro/009-blastoise",  // default
  facingLeft: false
};

// --- tuning (state & facing) ---
const IDLE_TIMEOUT_MS = 180;   // time since last motion to be considered idle
const SPEED_IDLE = 40;         // px/sec threshold to be considered idle
const SPEED_WALK = 60;         // px/sec threshold to be walking
const FACING_EPSILON = 6;      // px/sec; ignore tiny shakes for facing
const VEL_SMOOTH_ALPHA = 0.25; // 0..1, smoothing for velocity (higher = snappier)

// --- tuning (follow feel) ---
const OFFSET_PX = 30;        // distance from cursor along motion direction
const LERP_ALPHA = 0.2;      // 0..1, how quickly follower moves toward target
const MAX_STEP_PX = 60;      // cap per-frame movement (prevents snapping)
const SCALE = 1.25;          // 1.0 = original size; bump for visibility
// --- tuning (idle bob) ---
const BOB_AMP_PX = 0;        // 1–3 px is subtle and nice
const BOB_PERIOD_MS = 900;   // ~0.9s per bob cycle
// --- orientation tags ---
const ORIENT = { FRONT: "front", BACK: "back", LEFT: "left", RIGHT: "right" };

let followerEl = null;
let rafId = null;

const RUNTIME = {
  meta: null,           // loaded JSON pack
  images: {},           // { idle: Image, walk: Image }
  anim: { name: "idle", frame: 0, row: 0, accMs: 0 },
  lastMoveTs: 0,
  lastMouse: { x: 0, y: 0, t: 0 },
  speedPxPerSec: 0,
  velAvg: { x: 0, y: 0 }, // smoothed velocity (px/sec)
  speedAvg: 0,            // smoothed speed (px/sec)
  pos: { x: 0, y: 0 },    // current follower position (screen px)
  target: { x: 0, y: 0 }, // target position (cursor minus offset)
  orient: "front",        // current facing for row selection
};

function extUrl(rel) { return chrome.runtime.getURL(rel); }

function createFollower() {
  if (followerEl) return;
  followerEl = document.createElement("div");
  followerEl.id = "__vcp1_follower";
  Object.assign(followerEl.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: "40px",
    height: "40px",
    pointerEvents: "none",
    zIndex: "2147483647",
    willChange: "transform, background-position, background-image",
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated" // crisp for retro sheets
  });
  document.documentElement.appendChild(followerEl);
}

function removeFollower() {
  if (followerEl?.parentNode) followerEl.parentNode.removeChild(followerEl);
  followerEl = null;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

function packSlug() {
  // STATE.pack like "retro/009-blastoise" -> "009-blastoise"
  const parts = STATE.pack.split("/");
  return parts[parts.length - 1];
}

function sheetUrlFor(stateName) {
  const st = RUNTIME.meta.states[stateName];
  const sheetFilename = st.sheet;                 // e.g. "Walk-Anim.webp"
  const rawFolder = `assets/raw/${packSlug()}/`;  // assets/raw/009-blastoise/
  return extUrl(rawFolder + sheetFilename);
}

function ensureImagesLoaded(meta) {
  const tasks = [];
  Object.keys(meta.states).forEach((k) => {
    const img = new Image();
    img.src = sheetUrlFor(k);
    RUNTIME.images[k] = img;
    tasks.push(new Promise((resolve) => {
      img.onload = resolve; img.onerror = resolve;
    }));
  });
  return Promise.all(tasks);
}
// --- Compute exact per-cell sizes from loaded sheets and cache on state as _cw/_ch ---
function normalizeFramesFromSheets() {
  if (!RUNTIME?.meta?.states) return;
  for (const [stateName, st] of Object.entries(RUNTIME.meta.states)) {
    const img = RUNTIME.images[stateName];
    if (!img || !img.naturalWidth || !img.naturalHeight) continue;

    // Frames per row (columns)
    const frames = st.frames || 1;

    // Row count comes from how many distinct row indices we use
    const rowsMap = st.rows || { 0: 0 };
    const rowCount = Math.max(1, new Set(Object.values(rowsMap)).size);

    // Exact cell sizes as floats
    const cw = img.naturalWidth / frames;
    const ch = img.naturalHeight / rowCount;

    // Cache the computed sizes; keep original st.frame as hints
    st._cw = cw;
    st._ch = ch;
  }
}

// --- 8-way direction selection based on smoothed velocity ---
function pickDirKeyFromVelocity(vx, vy, rows) {
  const dead = 0.3; // small deadzone to avoid jitter
  if (Math.abs(vx) <= dead && Math.abs(vy) <= dead) return "front";
  // DOM coordinates: +y is downward => "front" when vy>0
  const angle = Math.atan2(vy, vx);                 // -PI..PI, 0 = right
  const norm  = (angle + 2 * Math.PI) % (2 * Math.PI);  // 0..2PI
  const idx   = Math.floor((norm + Math.PI / 8) / (Math.PI / 4)) % 8;
  const keys8 = [
    "right",      // 0
    "frontRight", // 1
    "front",      // 2
    "frontLeft",  // 3
    "left",       // 4
    "backLeft",   // 5
    "back",       // 6
    "backRight"   // 7
  ];
  const cand = keys8[idx];
  if (cand in rows) return cand;
  const fallback = ["right", "front", "left", "back"][(Math.round(idx / 2)) % 4];
  return (fallback in rows) ? fallback : "front";
}

// Return the correct row index for the given state based on current velocity
function pickRowForState(stateName) {
  const st = RUNTIME.meta?.states?.[stateName];
  if (!st) return 0;
  const rows = st.rows || {};
  const key  = pickDirKeyFromVelocity(RUNTIME.velAvg.x, RUNTIME.velAvg.y, rows);
  return rows[key] ?? 0;
}

function computeTarget() {
  // If we have motion, offset backwards along the velocity vector. Otherwise, idle above the cursor.
  const speed = RUNTIME.speedAvg;
  const hasDir = speed > SPEED_IDLE; // small threshold: only steer when moving

  let ox = 0, oy = -OFFSET_PX; // idle: sit above the cursor
  if (hasDir) {
    // Use direction opposite motion so the sprite "trails" the cursor
    const nx = RUNTIME.velAvg.x / (speed || 1);
    const ny = RUNTIME.velAvg.y / (speed || 1);
    ox = -nx * OFFSET_PX;
    oy = -ny * OFFSET_PX;
  }

  RUNTIME.target.x = RUNTIME.lastMouse.x + ox;
  RUNTIME.target.y = RUNTIME.lastMouse.y + oy;
}

function pickOrientation() {
  // Face toward the cursor (target) rather than using mouse velocity.
  const dx = RUNTIME.lastMouse.x - RUNTIME.pos.x;
  const dy = RUNTIME.lastMouse.y - RUNTIME.pos.y;

  // If very close, keep last orientation to avoid jitter.
  const dist = Math.hypot(dx, dy);
  if (dist < 2) return;

  if (Math.abs(dx) >= Math.abs(dy)) {
    RUNTIME.orient = (dx >= 0) ? ORIENT.RIGHT : ORIENT.LEFT;
  } else {
    // In browser coords, +y is downward => "front" when cursor is below sprite.
    RUNTIME.orient = (dy >= 0) ? ORIENT.FRONT : ORIENT.BACK;
  }
}

function applyFrame() {
  const st = RUNTIME.meta.states[RUNTIME.anim.name];
  const { w, h } = st.frame;

  // Row index comes from animation state (selected in tick)
  const rowIndex = RUNTIME.anim.row || 0;
  const bpx = -(RUNTIME.anim.frame * w);
  const bpy = -(rowIndex * h);

  // Size element to one frame
  followerEl.style.width  = `${w}px`;
  followerEl.style.height = `${h}px`;

  // Use the correct sheet and ensure natural background size to avoid cropping artifacts
  followerEl.style.backgroundImage = `url("${sheetUrlFor(RUNTIME.anim.name)}")`;
  const img = RUNTIME.images[RUNTIME.anim.name];
  if (img?.naturalWidth && img?.naturalHeight) {
    followerEl.style.backgroundSize = `${img.naturalWidth}px ${img.naturalHeight}px`;
  }
  followerEl.style.backgroundRepeat = "no-repeat";
  followerEl.style.imageRendering = "pixelated";
  followerEl.style.backgroundPosition = `${bpx}px ${bpy}px`;

  const now = performance.now();
  const bobY = (RUNTIME.anim.name === "idle")
    ? Math.round(Math.sin((now / BOB_PERIOD_MS) * Math.PI * 2) * BOB_AMP_PX)
    : 0;

  // Visual scale only; no mirroring by default (rows handle left/right)
  followerEl.style.transform =
    `translate(${Math.round(RUNTIME.pos.x)}px, ${Math.round(RUNTIME.pos.y + bobY)}px) ` +
    `translate(-50%, -50%) ` +
    `scale(${SCALE})`;
  followerEl.style.transformOrigin = "center center";
}

function pickStateBySpeed() {
  const now = performance.now();
  const timeSinceMove = now - RUNTIME.lastMoveTs;

  const wantWalk = RUNTIME.speedAvg > SPEED_WALK;
  const wantIdle = (RUNTIME.speedAvg < SPEED_IDLE) || (timeSinceMove > IDLE_TIMEOUT_MS);

  if (RUNTIME.anim.name === "walk") {
    return wantIdle ? "idle" : "walk";
  } else {
    return wantWalk ? "walk" : "idle";
  }
}

function tick(dtMs) {
  const desired = pickStateBySpeed();
  const nextRow = pickRowForState(desired);

  if (desired !== RUNTIME.anim.name || nextRow !== RUNTIME.anim.row) {
    RUNTIME.anim.name = desired;
    RUNTIME.anim.row = nextRow;
    RUNTIME.anim.frame = 0;
    RUNTIME.anim.accMs = 0;
  }

  const st = RUNTIME.meta.states[RUNTIME.anim.name];
  const msPerFrame = 1000 / st.fps;
  RUNTIME.anim.accMs += dtMs;
  while (RUNTIME.anim.accMs >= msPerFrame) {
    RUNTIME.anim.accMs -= msPerFrame;
    RUNTIME.anim.frame = (RUNTIME.anim.frame + 1) % st.frames;
  }

  // follow feel: compute target and ease toward it
  computeTarget();
  const dx = RUNTIME.target.x - RUNTIME.pos.x;
  const dy = RUNTIME.target.y - RUNTIME.pos.y;
  // lerp with cap
  let stepX = dx * LERP_ALPHA;
  let stepY = dy * LERP_ALPHA;
  const stepMag = Math.hypot(stepX, stepY);
  if (stepMag > MAX_STEP_PX) {
    const s = MAX_STEP_PX / (stepMag || 1);
    stepX *= s; stepY *= s;
  }
  RUNTIME.pos.x += stepX;
  RUNTIME.pos.y += stepY;

  // Update row continuously as direction changes
  RUNTIME.anim.row = pickRowForState(RUNTIME.anim.name);
  applyFrame();
}

function loop() {
  let last = performance.now();
  const step = () => {
    const now = performance.now();
    const dt = now - last;
    last = now;
    if (followerEl && RUNTIME.meta) tick(dt);
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
}

function onMouseMove(e) {
  const t  = performance.now();
  const dt = Math.max(1, t - (RUNTIME.lastMouse.t || t)); // ms
  const dx = e.clientX - (RUNTIME.lastMouse.x || e.clientX);
  const dy = e.clientY - (RUNTIME.lastMouse.y || e.clientY);

  // instantaneous velocity (px/sec)
  const vx = (dx / dt) * 1000;
  const vy = (dy / dt) * 1000;

  // exponential moving average for velocity
  RUNTIME.velAvg.x = (1 - VEL_SMOOTH_ALPHA) * RUNTIME.velAvg.x + VEL_SMOOTH_ALPHA * vx;
  RUNTIME.velAvg.y = (1 - VEL_SMOOTH_ALPHA) * RUNTIME.velAvg.y + VEL_SMOOTH_ALPHA * vy;

  // smoothed speed
  const speed = Math.hypot(RUNTIME.velAvg.x, RUNTIME.velAvg.y);
  RUNTIME.speedPxPerSec = speed;
  RUNTIME.speedAvg = speed;

  // keep last faced if near-still; otherwise pick new orientation
  RUNTIME.lastMouse = { x: e.clientX, y: e.clientY, t };
  RUNTIME.lastMoveTs = t;
}

function start() {
  createFollower();
  RUNTIME.pos.x = RUNTIME.lastMouse.x;
  RUNTIME.pos.y = RUNTIME.lastMouse.y;
  RUNTIME.target.x = RUNTIME.lastMouse.x;
  RUNTIME.target.y = RUNTIME.lastMouse.y;
  window.addEventListener("mousemove", onMouseMove, { passive: true });
  loop();
}

function stop() {
  window.removeEventListener("mousemove", onMouseMove);
  removeFollower();
}

async function loadPack(packKey) {
  // JSON at assets/packs/retro/009-blastoise.json
  const jsonPath = `assets/packs/${packKey}.json`;
  const meta = await fetch(extUrl(jsonPath)).then(r => r.json());
  RUNTIME.meta = meta;
  await ensureImagesLoaded(meta);
    normalizeFramesFromSheets(); // normalize frame sizes from sheet dimensions
}

function applyState() {
  if (STATE.enabled) start(); else stop();
}

// boot
chrome.storage.sync.get(["vcp1_enabled", "vcp1_pack"], async (res) => {
  STATE.enabled = !!res.vcp1_enabled;
  STATE.pack    = res.vcp1_pack || "retro/009-blastoise";
  try { await loadPack(STATE.pack); } catch (e) { console.warn("pack load failed", e); }
  applyState();
});

// react to popup changes
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "sync") return;
  if (changes.vcp1_enabled) {
    STATE.enabled = !!changes.vcp1_enabled.newValue;
    applyState();
  }
  if (changes.vcp1_pack) {
    STATE.pack = changes.vcp1_pack.newValue || "retro/009-blastoise";
    try { await loadPack(STATE.pack); } catch (e) { console.warn("pack switch failed", e); }
  }
});

window.addEventListener("beforeunload", () => stop());