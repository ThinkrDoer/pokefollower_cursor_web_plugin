document.addEventListener("DOMContentLoaded", () => {
  const enabledEl = document.getElementById("enabled");
  const spriteEl  = document.getElementById("sprite");

  // Load saved settings
  chrome.storage.sync.get(["vcp1_enabled", "vcp1_sprite"], (res) => {
    enabledEl.checked = !!res.vcp1_enabled;
    spriteEl.value = res.vcp1_sprite || "dot";
  });

  // Helper: save then close popup (slight delay so Chrome applies update)
  const saveAndClose = (obj) => {
    chrome.storage.sync.set(obj, () => {
      if (chrome.runtime.lastError) return;
      setTimeout(() => window.close(), 75);
    });
  };

  // Close on toggle
  enabledEl.addEventListener("change", () => {
    saveAndClose({ vcp1_enabled: enabledEl.checked });
  });

  // Close on sprite select
  spriteEl.addEventListener("change", () => {
    saveAndClose({ vcp1_sprite: spriteEl.value });
  });

  // Quality of life: ESC closes popup
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.close();
  });
});