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

      // UI shows speed as 0.5–5.0 (×10 of internal lerp 0.05–0.50)
      const lerpUI = lerp * 10;
      lerpEl.value = String(lerpUI.toFixed(1));

      scaleVal.textContent  = scale.toFixed(2) + "×";
      offsetVal.textContent = offset + " px";
      lerpVal.textContent   = lerpUI.toFixed(1);
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
    const ui = clampFrom(lerpEl);           // UI 0.5–5.0
    const uiFixed = Number(ui.toFixed(1));
    lerpEl.value = String(uiFixed);
    lerpVal.textContent = uiFixed.toFixed(1);
    const lerp = uiFixed / 10;              // internal 0.05–0.50
    setLocal({ vcp1_lerp: lerp });
    pushConfig({ vcp1_lerp: lerp });
  }
  lerpEl.addEventListener("input", onLerpInput);
  lerpEl.addEventListener("change", () => {
    const ui = clampFrom(lerpEl);
    pushConfig({ vcp1_lerp: ui / 10 }, { flush: true });
  });

  // Removed dragging pointer event listeners for sliders since number inputs do not need them

  // Safety: end dragging if mouse released outside
  // document.addEventListener("pointerup", () => setDragging(false));

  // ===== TRIANGLES (▲/▼) — JS-only wiring, no HTML changes required =====

  // Find the number input associated with a triangle within the same .triple block
  function inputForTriangle(el) {
    const triple = el.closest(".triple");
    if (!triple) return null;
    // Prefer an explicit number input inside the triple
    return triple.querySelector('input[type="number"]');
  }

  // Use native stepUp/stepDown so min/max/step are respected
  function nudgeInput(input, dir /* 'up' | 'down' */) {
    if (!input) return;
    if (dir === "down") input.stepDown();
    else input.stepUp();
    // Live update and persist via existing handlers
    input.dispatchEvent(new Event("input",  { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Press-and-hold repeat
  let holdT = null, rptT = null, holdInput = null, holdDir = "up";

  function stopHold() {
    if (holdT) { clearTimeout(holdT); holdT = null; }
    if (rptT)  { clearInterval(rptT); rptT = null; }
    holdInput = null;
  }

  document.addEventListener("mousedown", (e) => {
    const caret = e.target.closest(".arrowStack .caret");
    if (!caret) return;

    const input = inputForTriangle(caret);
    if (!input) return;

    holdInput = input;
    holdDir = caret.classList.contains("down") ? "down" : "up";

    // First tick immediately
    nudgeInput(holdInput, holdDir);

    // Then start repeating
    stopHold();
    holdT = setTimeout(() => {
      rptT = setInterval(() => nudgeInput(holdInput, holdDir), 90);
    }, 250);
  }, true);

  // Keyboard support for triangles: Space/Enter nudges once
  document.addEventListener("keydown", (e) => {
    const caret = e.target.closest(".arrowStack .caret");
    if (!caret) return;
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    const input = inputForTriangle(caret);
    const dir = caret.classList.contains("down") ? "down" : "up";
    nudgeInput(input, dir);
  }, true);

  window.addEventListener("mouseup", stopHold, true);
  window.addEventListener("mouseleave", stopHold, true);
  window.addEventListener("blur", stopHold, true);

  // ===== CHEVRONS (◀/▶) — cycle the <select id="pack"> and trigger existing change flow =====
  document.addEventListener("click", (e) => {
    const left  = e.target.closest(".preview .chev.left");
    const right = e.target.closest(".preview .chev.right");
    if (!left && !right) return;

    const dir = right ? +1 : -1;
    const total = packEl.options.length;
    let idx = packEl.selectedIndex;
    if (idx < 0) idx = 0;
    idx = (idx + dir + total) % total;

    packEl.selectedIndex = idx;
    packEl.dispatchEvent(new Event("change", { bubbles: true }));
  });

  // ESC to close (QoL)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.close();
  });
});