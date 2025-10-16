// === VCP1 content script: load pack JSON + animate idle/walk with left/right flip ===
const STATE = {
  enabled: false,
  pack: "retro/009-blastoise",  // default
  facingLeft: false
};

let followerEl = null;
let rafId = null;

const RUNTIME = {
  meta: null,           // loaded JSON pack
  images: {},           // { idle: Image, walk: Image }
  anim: { name: "idle", frame: 0, accMs: 0 },
  lastMoveTs: 0,
  lastMouse: { x: 0, y: 0, t: 0 },
  speedPxPerSec: 0
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

function applyFrame() {
  const st = RUNTIME.meta.states[RUNTIME.anim.name];
  const { w, h } = st.frame;
  const frame = RUNTIME.anim.frame % st.frames;
  const bpx = -(frame * w);
  const bpy = -(st.row * h);

  followerEl.style.width  = `${w}px`;
  followerEl.style.height = `${h}px`;
  followerEl.style.backgroundImage = `url("${sheetUrlFor(RUNTIME.anim.name)}")`;
  followerEl.style.backgroundPosition = `${bpx}px ${bpy}px`;
  followerEl.style.transform =
    `translate(${Math.round(RUNTIME.lastMouse.x)}px, ${Math.round(RUNTIME.lastMouse.y)}px) ` +
    `${STATE.facingLeft ? "scaleX(-1)" : "scaleX(1)"} translate(-50%, -50%)`;
}

function pickStateBySpeed() {
  const now = performance.now();
  const idle = (now - RUNTIME.lastMoveTs) > 150 || RUNTIME.speedPxPerSec < 60;
  return idle ? "idle" : "walk";
}

function tick(dtMs) {
  const desired = pickStateBySpeed();
  if (desired !== RUNTIME.anim.name) {
    RUNTIME.anim.name = desired;
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
  const dt = Math.max(1, t - (RUNTIME.lastMouse.t || t));
  const dx = e.clientX - (RUNTIME.lastMouse.x || e.clientX);
  const dy = e.clientY - (RUNTIME.lastMouse.y || e.clientY);
  const dist = Math.hypot(dx, dy);
  RUNTIME.speedPxPerSec = (dist / dt) * 1000;

  STATE.facingLeft = dx < 0;
  RUNTIME.lastMouse = { x: e.clientX, y: e.clientY, t };
  RUNTIME.lastMoveTs = t;
}

function start() {
  createFollower();
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