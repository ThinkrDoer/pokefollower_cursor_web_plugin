document.addEventListener("DOMContentLoaded", () => {
  const enabledEl = document.getElementById("enabled");
  const packEl    = document.getElementById("pack");

  // Load saved settings
  chrome.storage.sync.get(["vcp1_enabled", "vcp1_pack"], (res) => {
    enabledEl.checked = !!res.vcp1_enabled;
    packEl.value = res.vcp1_pack || "retro/009-blastoise";
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

// Keep popup open on Pokémon select
packEl.addEventListener("change", () => {
  chrome.storage.sync.set({ vcp1_pack: packEl.value });
});

  // Quality of life: ESC closes popup
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.close();
  });
});