document.addEventListener("DOMContentLoaded", () => {
  const enabledEl = document.getElementById("enabled");
  const packEl    = document.getElementById("pack");

  // Sliders + readouts
  const scaleEl   = document.getElementById("scale");
  const offsetEl  = document.getElementById("offset");
  const lerpEl    = document.getElementById("lerp");

  const scaleVal  = document.getElementById("scaleVal");
  const offsetVal = document.getElementById("offsetVal");
  const lerpVal   = document.getElementById("lerpVal");

  // Defaults align with current content.js constants
  const DEFAULTS = {
    vcp1_scale: 1.25,   // SCALE
    vcp1_offset: 30,    // OFFSET_PX
    vcp1_lerp: 0.20     // LERP_ALPHA (lower = floatier/slower follow)
  };

  // --- Hot-path local writes + dragging signal for smooth live updates ---
  const setLocal = (patch) => chrome.storage.local.set(patch);
  // let dragging = false;
  // function setDragging(on) {
  //   if (dragging === on) return;
  //   dragging = on;
  //   try { chrome.runtime.sendMessage({ type: "vcp1_drag", dragging }); } catch (_) {}
  // }

  // Debounced persist + live-apply to content scripts
  let pending = {};
  let saveTimer = null;

  function pushConfig(patch, { flush = false } = {}) {
    // 1) Live-apply immediately in active tabs without hitting sync limits
    try { chrome.runtime.sendMessage({ type: "vcp1_config", patch }); } catch (_) {}

    // 2) Batch+debounce writes to chrome.storage.sync to avoid rate limiting
    Object.assign(pending, patch);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const toSave = { ...pending };
      pending = {};
      chrome.storage.sync.set(toSave, () => {});
    }, 250);

    if (flush) {
      clearTimeout(saveTimer);
      if (Object.keys(pending).length) {
        const toSaveNow = { ...pending };
        pending = {};
        chrome.storage.sync.set(toSaveNow, () => {});
      }
    }
  }

  const asNum = (v) => Number(v);

  // Load saved settings
  chrome.storage.sync.get(
    ["vcp1_enabled", "vcp1_pack", "vcp1_scale", "vcp1_offset", "vcp1_lerp"],
    (res) => {
      enabledEl.checked = !!res.vcp1_enabled;
      packEl.value      = res.vcp1_pack || "retro/009-blastoise";

      const scale  = (typeof res.vcp1_scale  === "number") ? res.vcp1_scale  : DEFAULTS.vcp1_scale;
      const offset = (typeof res.vcp1_offset === "number") ? res.vcp1_offset : DEFAULTS.vcp1_offset;
      const lerp   = (typeof res.vcp1_lerp   === "number") ? res.vcp1_lerp   : DEFAULTS.vcp1_lerp;

      scaleEl.value  = String(scale);
      offsetEl.value = String(offset);
      lerpEl.value   = String(lerp);

      scaleVal.textContent  = scale.toFixed(2) + "×";
      offsetVal.textContent = offset + " px";
      lerpVal.textContent   = lerp.toFixed(2);
    }
  );

  // Helper: save but do NOT auto-close (except when toggling enable)
  const save = (obj) => chrome.storage.sync.set(obj);

  // Toggle enable — close popup (people expect immediate feedback here)
  enabledEl.addEventListener("change", () => {
    save({ vcp1_enabled: enabledEl.checked });
    window.close();
  });

  // Pack select — save but keep popup open
  packEl.addEventListener("change", () => {
    save({ vcp1_pack: packEl.value });
  });

  // function clampFrom helper
  function clampFrom(el) {
    const v = Number(el.value);
    const min = Number(el.min);
    const max = Number(el.max);
    if (Number.isFinite(min) && v < min) return min;
    if (Number.isFinite(max) && v > max) return max;
    return v;
  }

  // Scale
  function onScaleInput() {
    const v = clampFrom(scaleEl);
    scaleEl.value = String(v);
    scaleVal.textContent = v.toFixed(2) + "×";
    setLocal({ vcp1_scale: v });
    pushConfig({ vcp1_scale: v });
  }
  scaleEl.addEventListener("input", onScaleInput);
  scaleEl.addEventListener("change", () => {
    const v = clampFrom(scaleEl);
    pushConfig({ vcp1_scale: v }, { flush: true });
  });

  // Offset
  function onOffsetInput() {
    const v = clampFrom(offsetEl);
    offsetEl.value = String(v);
    offsetVal.textContent = v + " px";
    setLocal({ vcp1_offset: v });
    pushConfig({ vcp1_offset: v });
  }
  offsetEl.addEventListener("input", onOffsetInput);
  offsetEl.addEventListener("change", () => {
    const v = clampFrom(offsetEl);
    pushConfig({ vcp1_offset: v }, { flush: true });
  });

  // Lerp
  function onLerpInput() {
    const v = clampFrom(lerpEl);
    lerpEl.value = String(v);
    lerpVal.textContent = v.toFixed(2);
    setLocal({ vcp1_lerp: v });
    pushConfig({ vcp1_lerp: v });
  }
  lerpEl.addEventListener("input", onLerpInput);
  lerpEl.addEventListener("change", () => {
    const v = clampFrom(lerpEl);
    pushConfig({ vcp1_lerp: v }, { flush: true });
  });

  // Removed dragging pointer event listeners for sliders since number inputs do not need them

  // Safety: end dragging if mouse released outside
  // document.addEventListener("pointerup", () => setDragging(false));

  // ESC to close (QoL)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.close();
  });
});