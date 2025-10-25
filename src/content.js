// === VCP1 content script: load pack JSON + animate idle/walk with left/right flip ===
const STATE = {
  enabled: false,
  pack: "retro/009-blastoise",  // default
  facingLeft: false
};

let followerEl = null;
let rafId = null;

const RUNTIME = {
  meta: null,                 // loaded JSON pack
  images: {},                 // { idle: Image, walk: Image }
  anim: { name: "idle", frame: 0, row: 0, accMs: 0 },
  lastMoveTs: 0,
  lastMouse: { x: 0, y: 0, t: 0 },

  // position/target and smoothed velocity
  pos:    { x: 0, y: 0 },
  target: { x: 0, y: 0 },
  velAvg: { x: 0, y: 0 },
  speedAvg: 0,

  // keep legacy field in sync for pickStateBySpeed()
  speedPxPerSec: 0
};

// --- behavior thresholds ---
const SLEEP_TIMEOUT_MS = 30000; // 30s of no movement -> sleep

function hasState(name) {
  return !!(RUNTIME.meta && RUNTIME.meta.states && RUNTIME.meta.states[name]);
}
// --- UI-configurable tuning (persisted in chrome.storage.sync) ---
const CONFIG = {
  scale: 1.25,   // visual scale multiplier
  offset: 30,    // px distance from cursor (trail/perch)
  lerp: 0.20     // follow smoothing (0..1), lower = floatier
};
function applyConfigPatch(obj = {}) {
  if (typeof obj.vcp1_scale  === "number" && !Number.isNaN(obj.vcp1_scale))  CONFIG.scale  = obj.vcp1_scale;
  if (typeof obj.vcp1_offset === "number" && !Number.isNaN(obj.vcp1_offset)) CONFIG.offset = obj.vcp1_offset;
  if (typeof obj.vcp1_lerp   === "number" && !Number.isNaN(obj.vcp1_lerp))   CONFIG.lerp   = obj.vcp1_lerp;
}

// --- Live poller for smooth slider updates during popup drag ---
let LIVE = { dragging: false, pollId: null };

function startLocalPoll() {
  if (LIVE.pollId) return; // already polling
  // Poll at ~30Hz to decouple rendering from popup focus/message cadence
  LIVE.pollId = setInterval(() => {
    chrome.storage.local.get(["vcp1_scale","vcp1_offset","vcp1_lerp"], (res) => {
      // Only apply present numeric values
      const patch = {};
      if (typeof res.vcp1_scale  === "number")  patch.vcp1_scale  = res.vcp1_scale;
      if (typeof res.vcp1_offset === "number")  patch.vcp1_offset = res.vcp1_offset;
      if (typeof res.vcp1_lerp   === "number")  patch.vcp1_lerp   = res.vcp1_lerp;
      if (Object.keys(patch).length) {
        applyConfigPatch(patch);
        if (followerEl && RUNTIME.meta) applyFrame();
      }
    });
  }, 33); // ~30fps
}

function stopLocalPoll() {
  if (LIVE.pollId) {
    clearInterval(LIVE.pollId);
    LIVE.pollId = null;
  }
}
// --- follow targeting: trail the cursor when moving; perch above when idle
function computeTarget() {
  // If we have motion, offset backwards along the velocity vector.
  // Otherwise, idle above the cursor.
  const speed = RUNTIME.speedAvg || 0;
  const hasDir = speed > (typeof SPEED_IDLE !== "undefined" ? SPEED_IDLE : 40);

  const OFFSET = CONFIG.offset;

  let ox = 0, oy = -OFFSET; // idle: sit above the cursor
  if (hasDir) {
    // Use direction *opposite* motion so the sprite "trails" the cursor
    const nx = RUNTIME.velAvg.x / (speed || 1);
    const ny = RUNTIME.velAvg.y / (speed || 1);
    ox = -nx * OFFSET;
    oy = -ny * OFFSET;
  }

  RUNTIME.target.x = (RUNTIME.lastMouse?.x || 0) + ox;
  RUNTIME.target.y = (RUNTIME.lastMouse?.y || 0) + oy;
}

// --- 8-way facing from smoothed velocity (octants) ---
function pickDir8FromVelocity(vx, vy) {
  const dead = 0.3; // small deadzone to reduce jitter
  if (Math.abs(vx) <= dead && Math.abs(vy) <= dead) return "front";
  // DOM coords: +y is downward => vy>0 means "front"
  const angle = Math.atan2(vy, vx);                  // -PI..PI, 0 = right
  const norm  = (angle + 2 * Math.PI) % (2 * Math.PI); // 0..2PI
  const idx   = Math.floor((norm + Math.PI / 8) / (Math.PI / 4)) % 8;
  // clockwise from right
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
  return keys8[idx];
}

// Map that direction to a row index using the pack's rows table for the given state
function pickRowForState(stateName) {
  const st = RUNTIME.meta?.states?.[stateName];
  if (!st) return 0;
  const rows = st.rows || { front: 0 };

  // Prefer 8-way if present, else fall back to nearest cardinal
  const dir8 = pickDir8FromVelocity(RUNTIME.velAvg.x, RUNTIME.velAvg.y);
  if (dir8 in rows) return rows[dir8];

  // Map diagonal to nearest cardinal if diagonal key missing
  const fallbackMap = {
    frontRight: "front",
    frontLeft:  "front",
    backRight:  "back",
    backLeft:   "back"
  };
  const fallback = fallbackMap[dir8] || dir8; // if already cardinal, keep it
  return (fallback in rows) ? rows[fallback] : (rows.front ?? 0);
}

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
    imageRendering: "pixelated", // crisp for retro sheets
    transition: "transform 120ms linear, width 120ms linear, height 120ms linear"
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
  const st = RUNTIME.meta && RUNTIME.meta.states ? RUNTIME.meta.states[stateName] : null;
  const sheetFilename = st && st.sheet ? st.sheet : "";
  const rawFolder = `assets/raw/${packSlug()}/`;
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
function resetAnimationForNewPack() {
  // Start from idle; row will be resolved in tick() via pickRowForState
  RUNTIME.anim = { name: "idle", frame: 0, row: 0, accMs: 0 };
}

function applyFrame() {
  const st = RUNTIME.meta && RUNTIME.meta.states && RUNTIME.meta.states[RUNTIME.anim.name];
  if (!st || !st.frame || typeof st.frames !== "number" || !Number.isFinite(st.frames)) {
    // Defensive: if pack schema is missing or wrong, skip this frame rather than crash
    return;
  }
  const { w, h } = st.frame;
  const frame = RUNTIME.anim.frame % st.frames;
  const rowIndex = RUNTIME.anim.row || 0;
  const bpx = -(frame * w);
  const bpy = -(rowIndex * h);

  followerEl.style.width  = `${w}px`;
  followerEl.style.height = `${h}px`;
  followerEl.style.backgroundImage = `url("${sheetUrlFor(RUNTIME.anim.name)}")`;
  // Keep sheet at natural size so backgroundPosition aligns to frame pixels
  const img = RUNTIME.images[RUNTIME.anim.name];
  if (img?.naturalWidth && img?.naturalHeight) {
    followerEl.style.backgroundSize = `${img.naturalWidth}px ${img.naturalHeight}px`;
  }
  followerEl.style.backgroundRepeat = "no-repeat";
  followerEl.style.imageRendering = "pixelated";
  followerEl.style.backgroundPosition = `${bpx}px ${bpy}px`;

  const SCALE_VAL = CONFIG.scale;
  followerEl.style.transform =
    `translate(${Math.round(RUNTIME.pos.x)}px, ${Math.round(RUNTIME.pos.y)}px) ` +
    `translate(-50%, -50%) ` +
    `scale(${SCALE_VAL})`;
  followerEl.style.transformOrigin = "center center";
}

function pickStateBySpeed() {
  const now = performance.now();
  // If the pack has a 'sleep' state and we've been inactive long enough, sleep.
  if (hasState("sleep") && (now - RUNTIME.lastMoveTs) > SLEEP_TIMEOUT_MS) {
    return "sleep";
  }
  // Otherwise choose idle vs walk by recent motion
  const idle = (now - RUNTIME.lastMoveTs) > 150 || RUNTIME.speedPxPerSec < 60;
  return idle ? "idle" : "walk";
}

function tick(dtMs) {
  const desired = pickStateBySpeed();
  const nextRow = pickRowForState(desired);
  if (desired !== RUNTIME.anim.name || nextRow !== RUNTIME.anim.row) {
    RUNTIME.anim.name  = desired;
    RUNTIME.anim.row   = nextRow;
    RUNTIME.anim.frame = 0;
    RUNTIME.anim.accMs = 0;
  }

  // follow feel: compute target and ease toward it
  computeTarget();
  const dx = RUNTIME.target.x - RUNTIME.pos.x;
  const dy = RUNTIME.target.y - RUNTIME.pos.y;

  const LERP = CONFIG.lerp;
  const MAX_STEP = (typeof MAX_STEP_PX !== "undefined" ? MAX_STEP_PX : 60);

  let stepX = dx * LERP;
  let stepY = dy * LERP;
  const stepMag = Math.hypot(stepX, stepY);
  if (stepMag > MAX_STEP) {
    const s = MAX_STEP / (stepMag || 1);
    stepX *= s; stepY *= s;
  }
  RUNTIME.pos.x += stepX;
  RUNTIME.pos.y += stepY;

  const st = RUNTIME.meta.states[RUNTIME.anim.name];
  const msPerFrame = 1000 / st.fps;
  RUNTIME.anim.accMs += dtMs;
  while (RUNTIME.anim.accMs >= msPerFrame) {
    RUNTIME.anim.accMs -= msPerFrame;
    RUNTIME.anim.frame = (RUNTIME.anim.frame + 1) % st.frames;
  }

  // Keep the row updated continuously for natural facing
  if (RUNTIME.meta && RUNTIME.meta.states) {
    RUNTIME.anim.row = pickRowForState(RUNTIME.anim.name);
  }
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
  const now = performance.now();

  // update last mouse and velocity estimate
  const dt = Math.max(1, now - (RUNTIME.lastMouse.t || now)); // ms
  const vx = (e.clientX - RUNTIME.lastMouse.x) * (1000 / dt); // px/s
  const vy = (e.clientY - RUNTIME.lastMouse.y) * (1000 / dt); // px/s

  // simple smoothing for direction and speed
  const SMOOTH = 0.2;
  RUNTIME.velAvg.x = RUNTIME.velAvg.x * (1 - SMOOTH) + vx * SMOOTH;
  RUNTIME.velAvg.y = RUNTIME.velAvg.y * (1 - SMOOTH) + vy * SMOOTH;
  RUNTIME.speedAvg = Math.hypot(RUNTIME.velAvg.x, RUNTIME.velAvg.y);
  RUNTIME.speedPxPerSec = RUNTIME.speedAvg;

  RUNTIME.lastMouse.x = e.clientX;
  RUNTIME.lastMouse.y = e.clientY;
  RUNTIME.lastMouse.t = now;
  RUNTIME.lastMoveTs = now;
}

function start() {
  createFollower();
  RUNTIME.lastMoveTs = performance.now();
  // initialize position/target around current mouse (in case no movement yet)
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
  const jsonPath = `assets/packs/${packKey}.json`;
  const meta = await fetch(extUrl(jsonPath)).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${jsonPath}`);
    return r.json();
  });
  // Minimal schema checks
  if (!meta || !meta.states || !meta.states.idle || !meta.states.walk) {
    throw new Error("Pack schema invalid: missing states.idle or states.walk");
  }
  RUNTIME.meta = meta;
  // reset animation state for the new pack
  resetAnimationForNewPack();
  await ensureImagesLoaded(meta);
  // Restart animation loop if switching packs
  if (rafId) cancelAnimationFrame(rafId);
  if (followerEl) removeFollower();
  createFollower();
  loop();
}

function applyState() {
  if (STATE.enabled) start(); else stop();
}

// boot
chrome.storage.sync.get(
  ["vcp1_enabled", "vcp1_pack", "vcp1_scale", "vcp1_offset", "vcp1_lerp"],
  async (res) => {
    STATE.enabled = !!res.vcp1_enabled;
    STATE.pack    = res.vcp1_pack || "retro/009-blastoise";
    applyConfigPatch(res);
    try {
      await loadPack(STATE.pack);
    } catch (e) {
      console.warn("pack load failed; reverting to default", e);
      STATE.pack = "retro/009-blastoise";
      try { await loadPack(STATE.pack); } catch (e2) { console.warn("default pack also failed", e2); }
    }
    applyState();
  }
);

// react to popup changes
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "sync") return;
  if (changes.vcp1_enabled) {
    STATE.enabled = !!changes.vcp1_enabled.newValue;
    applyState();
  }
  if (changes.vcp1_pack) {
    const prev = STATE.pack;
    STATE.pack = changes.vcp1_pack.newValue || "retro/009-blastoise";
    try {
      await loadPack(STATE.pack);
      // If follower exists, immediately apply a frame from the new sheet
      if (followerEl) applyFrame();
    } catch (e) {
      console.warn("pack switch failed; restoring previous pack", e);
      STATE.pack = prev;
      try { await loadPack(STATE.pack); } catch (e2) { console.warn("restore previous pack failed", e2); }
      if (followerEl) applyFrame();
    }
  }
  if (changes.vcp1_scale || changes.vcp1_offset || changes.vcp1_lerp) {
    const patch = {
      vcp1_scale:  changes.vcp1_scale  ? Number(changes.vcp1_scale.newValue)  : undefined,
      vcp1_offset: changes.vcp1_offset ? Number(changes.vcp1_offset.newValue) : undefined,
      vcp1_lerp:   changes.vcp1_lerp   ? Number(changes.vcp1_lerp.newValue)   : undefined,
    };
    applyConfigPatch(patch);
    // no restart needed; next frame uses updated CONFIG
  }
});

// listen for live slider updates and drag state from popup.js
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;

  if (msg.type === "vcp1_config" && msg.patch) {
    applyConfigPatch(msg.patch);
    if (followerEl && RUNTIME.meta) applyFrame();
    return;
  }

  if (msg.type === "vcp1_drag") {
    const on = !!msg.dragging;
    if (on && !LIVE.dragging) {
      LIVE.dragging = true;
      startLocalPoll();
    } else if (!on && LIVE.dragging) {
      LIVE.dragging = false;
      stopLocalPoll();
    }
  }
});

window.addEventListener("beforeunload", () => { stopLocalPoll(); stop(); });