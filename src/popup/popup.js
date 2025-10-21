/* src/popup/popup.js */
import { getLocal, setLocal, pushConfig } from "../common.js";

// Elements
const enabledEl = document.getElementById("enabled");
const packEl = document.getElementById("pack");
const previewSpriteEl = document.getElementById("previewSprite");

const scaleEl = document.getElementById("scale");
const offsetEl = document.getElementById("offset");
const lerpEl = document.getElementById("lerp");

// Helper: clamp a numeric string to an input's min/max
const asNum = (v) => Number(v);
const clampToInput = (input, raw) => {
  const min = Number(input.min);
  const max = Number(input.max);
  let v = Number(raw);
  if (!Number.isFinite(v)) v = Number(input.value) || min || 0;
  if (Number.isFinite(min) && v < min) v = min;
  if (Number.isFinite(max) && v > max) v = max;
  return v;
};

// Small throttle to avoid spamming storage
const throttle = (fn, ms = 60) => {
  let t = 0, lastArgs = null, pending = false;
  return (...args) => {
    const now = performance.now();
    lastArgs = args;
    if (!pending && now - t >= ms) {
      t = now;
      fn(...lastArgs);
    } else if (!pending) {
      pending = true;
      setTimeout(() => {
        pending = false;
        t = performance.now();
        fn(...lastArgs);
      }, ms);
    }
  };
};

// Live UI preview (no storage writes)
function updatePreviewCard() {
  // Size preview roughly by scale (keep it simple: 42px base * scale * 2)
  const scale = Number(scaleEl.value) || 1;
  const px = Math.round(42 * scale * 2);
  previewSpriteEl.style.width = px + "px";
  previewSpriteEl.style.height = px + "px";
}

// Commit settings -> storage -> content script
const commitConfigThrottled = throttle((cfg) => pushConfig(cfg), 80);

function commitAll(from) {
  const scale = clampToInput(scaleEl, scaleEl.value);
  const offset = clampToInput(offsetEl, offsetEl.value);
  const lerp = clampToInput(lerpEl, lerpEl.value);

  // normalize inputs to their canonical strings
  scaleEl.value = scale.toFixed(2);
  offsetEl.value = String(offset);
  lerpEl.value = lerp.toFixed(2);

  // Preview update
  updatePreviewCard();

  // Persist + notify content
  setLocal({
    vcp1_scale: scale,
    vcp1_offset: offset,
    vcp1_lerp: lerp,
  });
  commitConfigThrottled({
    vcp1_scale: scale,
    vcp1_offset: offset,
    vcp1_lerp: lerp,
  });
}

// Init
(async function main() {
  const cfg = await getLocal();

  // Enabled
  enabledEl.checked = !!cfg.vcp1_enabled;
  enabledEl.addEventListener("change", () => {
    setLocal({ vcp1_enabled: enabledEl.checked });
    pushConfig({ vcp1_enabled: enabledEl.checked });
  });

  // Pack select
  if (cfg.vcp1_pack) {
    const idx = Array.from(packEl.options).findIndex(o => o.value === cfg.vcp1_pack);
    if (idx >= 0) packEl.selectedIndex = idx;
  }
  packEl.addEventListener("change", () => {
    const val = packEl.value;
    setLocal({ vcp1_pack: val });
    // Update the preview PNG (static UI sprite)
    previewSpriteEl.src = `../assets/ui/${val.endsWith("blastoise") ? "blastoise" : "blastoise"}.png`;
    // notify content
    pushConfig({ vcp1_pack: val });
  });

  // Numbers: load with sane defaults
  scaleEl.value  = Number.isFinite(cfg.vcp1_scale)  ? Number(cfg.vcp1_scale).toFixed(2) : "1.00";
  offsetEl.value = Number.isFinite(cfg.vcp1_offset) ? String(cfg.vcp1_offset) : "24";
  lerpEl.value   = Number.isFinite(cfg.vcp1_lerp)   ? Number(cfg.vcp1_lerp).toFixed(2) : "0.15";

  updatePreviewCard();

  // Live feedback while typing (no clamping yet)
  const onInput = () => updatePreviewCard();
  scaleEl.addEventListener("input", onInput);
  offsetEl.addEventListener("input", onInput);
  lerpEl.addEventListener("input", onInput);

  // Commit on blur or Enter (clamps, persists, pushes)
  const onCommit = (e) => commitAll("blur");
  const onEnterCommit = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitAll("enter");
      e.currentTarget.blur(); // feels snappier
    }
  };
  [scaleEl, offsetEl, lerpEl].forEach((el) => {
    el.addEventListener("blur", onCommit);
    el.addEventListener("keydown", onEnterCommit);
  });

  // Nudge buttons ▲ ▼
  document.querySelectorAll(".nudge").forEach(btn => {
    const which = btn.getAttribute("data-step"); // scale | offset | lerp
    const dir = btn.getAttribute("data-dir");    // up | down
    const target = which === "scale" ? scaleEl : which === "offset" ? offsetEl : lerpEl;
    btn.addEventListener("click", () => {
      const step = Number(target.step) || 1;
      const cur = Number(target.value) || 0;
      const next = dir === "up" ? cur + step : cur - step;
      target.value = String(next);
      commitAll("nudge");
    });
  });
})();