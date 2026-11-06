(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const loginPanel = $("loginPanel");
  const dashboard = $("dashboard");
  const loginStatus = $("loginStatus");
  const assetStatus = $("assetStatus");
  const keyStatus = $("keyStatus");

  function status(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle("error", isError);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || `Request failed (${response.status}).`);
    return data;
  }

  function showDashboard() {
    loginPanel.hidden = true;
    dashboard.hidden = false;
    loadAssets().catch((error) => status(assetStatus, error.message, true));
  }

  async function loadAssets() {
    const result = await api("/api/admin/assets");
    $("adminOpacity").value = result.game_over_opacity ?? 65;
    $("adminOpacityValue").textContent = `${$("adminOpacity").value}%`;
    for (const card of document.querySelectorAll(".asset-card")) {
      const kind = card.dataset.kind;
      const asset = result.assets[kind];
      const current = card.querySelector("[data-current]");
      current.replaceChildren();
      if (!asset) {
        current.textContent = kind.includes("sound") ? "No sound selected." : "No image selected.";
        continue;
      }
      if (kind.includes("sound")) {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "none";
        audio.src = asset.url;
        current.append(audio);
      } else {
        const image = document.createElement("img");
        image.src = asset.url;
        image.alt = asset.name || "Current default image";
        current.append(image);
      }
      const name = document.createElement("span");
      name.textContent = asset.name || "Uploaded asset";
      current.append(name);
    }
  }

  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    status(loginStatus, "Signing in…");
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await api("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: $("username").value, password: $("password").value })
      });
      $("password").value = "";
      showDashboard();
    } catch (error) {
      status(loginStatus, error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelectorAll(".asset-card").forEach((card) => {
    const kind = card.dataset.kind;
    const picker = card.querySelector("input[type=file]");
    const uploadButton = card.querySelector(".upload-button");
    const removeButton = card.querySelector(".remove-button");
    uploadButton.addEventListener("click", async () => {
      const file = picker.files?.[0];
      if (!file) {
        status(assetStatus, "Choose a file first.", true);
        return;
      }
      uploadButton.disabled = true;
      status(assetStatus, `Uploading ${file.name}…`);
      try {
        const form = new FormData();
        form.append("file", file);
        await api(`/api/admin/assets/${kind}`, { method: "POST", body: form });
        picker.value = "";
        await loadAssets();
        status(assetStatus, "Asset saved. Visitors will now receive this default.");
      } catch (error) {
        status(assetStatus, error.message, true);
      } finally {
        uploadButton.disabled = false;
      }
    });
    removeButton.addEventListener("click", async () => {
      if (!confirm("Remove this default asset?")) return;
      removeButton.disabled = true;
      try {
        await api(`/api/admin/assets/${kind}`, { method: "DELETE" });
        await loadAssets();
        status(assetStatus, "Default asset removed.");
      } catch (error) {
        status(assetStatus, error.message, true);
      } finally {
        removeButton.disabled = false;
      }
    });
  });

  $("adminOpacity").addEventListener("input", () => {
    $("adminOpacityValue").textContent = `${$("adminOpacity").value}%`;
  });

  $("saveOpacityButton").addEventListener("click", async () => {
    try {
      await api("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game_over_opacity: Number($("adminOpacity").value) })
      });
      status(assetStatus, "Image opacity saved.");
    } catch (error) {
      status(assetStatus, error.message, true);
    }
  });

  $("generateKeyButton").addEventListener("click", async () => {
    if (!confirm("Generate a new key? The previous visitor key will stop working.")) return;
    try {
      const result = await api("/api/admin/access-key", { method: "POST" });
      $("generatedKey").textContent = result.key;
      $("keyOutput").classList.add("visible");
      status(keyStatus, "New key generated. Copy it now; it cannot be shown again.");
    } catch (error) {
      status(keyStatus, error.message, true);
    }
  });

  $("revokeKeyButton").addEventListener("click", async () => {
    if (!confirm("Revoke the visitor customisation key? All visitors will need a new key.")) return;
    try {
      await api("/api/admin/access-key", { method: "DELETE" });
      $("keyOutput").classList.remove("visible");
      status(keyStatus, "Visitor key revoked.");
    } catch (error) {
      status(keyStatus, error.message, true);
    }
  });

  $("copyKeyButton").addEventListener("click", async () => {
    const key = $("generatedKey").textContent;
    try {
      await navigator.clipboard.writeText(key);
      status(keyStatus, "Key copied to clipboard.");
    } catch {
      status(keyStatus, "Select and copy the key above.", true);
    }
  });

  $("logoutButton").addEventListener("click", async () => {
    try { await api("/api/admin/logout", { method: "POST" }); } catch { /* Session may already have expired. */ }
    dashboard.hidden = true;
    loginPanel.hidden = false;
    status(loginStatus, "You have signed out.");
  });

  api("/api/admin/me").then(showDashboard).catch(() => { loginPanel.hidden = false; });
})();
