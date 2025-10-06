// VCP1 — content script: draws/removes follower and tracks cursor
const STATE = { enabled: false, sprite: "dot" };
let followerEl = null, rafId = null;
let latestPos = { x: 0, y: 0 };

function createFollower() {
  if (followerEl) return;
  followerEl = document.createElement("div");
  followerEl.id = "__vcp1_follower";
  Object.assign(followerEl.style, {
    position: "fixed", left: "0px", top: "0px", width: "24px", height: "24px",
    pointerEvents: "none", zIndex: "2147483647", willChange: "transform",
    borderRadius: "50%",
    background: "radial-gradient(circle, #ffd166 10%, #ef476f 70%)",
    boxShadow: "0 1px 4px rgba(0,0,0,0.3)"
  });
  document.documentElement.appendChild(followerEl);
}
function removeFollower() {
  if (followerEl?.parentNode) followerEl.parentNode.removeChild(followerEl);
  followerEl = null;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}
function startTracking() {
  if (!followerEl) createFollower();
  const speed = 0.25; // easing (0..1)
  let curr = { x: latestPos.x, y: latestPos.y };
  function loop() {
    curr.x += (latestPos.x - curr.x) * speed;
    curr.y += (latestPos.y - curr.y) * speed;
    if (followerEl) followerEl.style.transform =
      `translate(${Math.round(curr.x)}px, ${Math.round(curr.y)}px)`;
    rafId = requestAnimationFrame(loop);
  }
  loop();
}
function stopTracking() { removeFollower(); }
function onMouseMove(e) { latestPos = { x: e.clientX + 8, y: e.clientY + 8 }; }

function applyState() {
  if (STATE.enabled) {
    createFollower(); startTracking();
    window.addEventListener("mousemove", onMouseMove, { passive: true });
  } else {
    window.removeEventListener("mousemove", onMouseMove);
    stopTracking();
  }
}

chrome.storage.sync.get(["vcp1_enabled", "vcp1_sprite"], (res) => {
  STATE.enabled = Boolean(res.vcp1_enabled);
  STATE.sprite = res.vcp1_sprite || "dot";
  applyState();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.vcp1_enabled) { STATE.enabled = Boolean(changes.vcp1_enabled.newValue); applyState(); }
  if (changes.vcp1_sprite) { STATE.sprite = changes.vcp1_sprite.newValue || "dot"; /* TODO: swap sprite */ }
});

window.addEventListener("beforeunload", () => {
  window.removeEventListener("mousemove", onMouseMove);
  stopTracking();
});