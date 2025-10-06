const enabledEl = document.getElementById("enabled");
const spriteEl = document.getElementById("sprite");

chrome.storage.sync.get(["vcp1_enabled", "vcp1_sprite"], (res) => {
  enabledEl.checked = Boolean(res.vcp1_enabled);
  spriteEl.value = res.vcp1_sprite || "dot";
});

enabledEl.addEventListener("change", () => {
  chrome.storage.sync.set({ vcp1_enabled: enabledEl.checked });
});
spriteEl.addEventListener("change", () => {
  chrome.storage.sync.set({ vcp1_sprite: spriteEl.value });
});