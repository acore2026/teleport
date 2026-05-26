const loginPanel = document.querySelector("#loginPanel");
const loginForm = document.querySelector("#loginForm");
const loginError = document.querySelector("#loginError");
const usernameInput = document.querySelector("#usernameInput");
const pasteApp = document.querySelector("#pasteApp");
const pasteCapture = document.querySelector("#pasteCapture");
const captureState = document.querySelector("#captureState");
const logoutButton = document.querySelector("#logoutButton");
const connectionDot = document.querySelector("#connectionDot");
const connectionLabel = document.querySelector("#connectionLabel");
const activeUser = document.querySelector("#activeUser");
const pasteCount = document.querySelector("#pasteCount");
const pasteList = document.querySelector("#pasteList");
const itemTemplate = document.querySelector("#pasteItemTemplate");

const usernameKey = "paste-list-username";
const encoder = new TextEncoder();
let username = "";
let events = null;
let countdownTimer = null;

function normalizeUsername(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9_.-]{1,40}$/.test(normalized)) {
    throw new Error("Use 1-40 characters: letters, numbers, dot, dash, or underscore.");
  }
  return normalized;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(ms) {
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatRemaining(expiresAt) {
  const remaining = Math.max(0, expiresAt - Date.now());
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${Math.max(0, minutes)}m left`;
}

function setConnection(isOnline) {
  connectionDot.classList.toggle("online", isOnline);
  connectionLabel.textContent = isOnline ? "synced" : "offline";
}

function setCaptureState(message) {
  captureState.textContent = message;
}

function showLogin(message = "") {
  if (events) {
    events.close();
    events = null;
  }
  username = "";
  localStorage.removeItem(usernameKey);
  loginPanel.hidden = false;
  pasteApp.hidden = true;
  activeUser.textContent = "no user";
  loginError.textContent = message;
  setConnection(false);
  usernameInput.focus();
}

function showApp(nextUsername) {
  username = nextUsername;
  localStorage.setItem(usernameKey, username);
  loginPanel.hidden = true;
  pasteApp.hidden = false;
  activeUser.textContent = `@${username}`;
  pasteCapture.value = "";
  pasteCapture.focus();
}

function emptyItem(message) {
  const li = document.createElement("li");
  li.className = "empty-item";
  li.textContent = message;
  return li;
}

function renderPastes(pastes) {
  pasteCount.textContent = String(pastes.length);
  pasteList.textContent = "";

  if (!pastes.length) {
    pasteList.append(emptyItem("Paste from your clipboard to create the first item."));
    return;
  }

  for (const paste of pastes) {
    const node = itemTemplate.content.firstElementChild.cloneNode(true);
    const title = node.querySelector(".paste-title");
    const meta = node.querySelector(".paste-meta");
    const content = node.querySelector(".paste-content");
    const copyButton = node.querySelector(".copy-button");
    const deleteButton = node.querySelector(".delete-button");

    title.textContent = `${formatBytes(paste.bytes)} · ${paste.hash}`;
    meta.textContent = `${formatTime(paste.createdAt)} · ${formatRemaining(paste.expiresAt)}`;
    content.textContent = paste.content;
    copyButton.addEventListener("click", async () => {
      await copyText(paste.content);
      copyButton.textContent = "Copied";
      setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1100);
    });
    deleteButton.addEventListener("click", () => deletePaste(paste.id));
    pasteList.append(node);
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Plain HTTP can block the Clipboard API; fall through to selection copy.
    }
  }

  const shim = document.createElement("textarea");
  shim.value = text;
  shim.setAttribute("readonly", "");
  shim.className = "copy-shim";
  document.body.append(shim);
  shim.select();
  document.execCommand("copy");
  shim.remove();
}

async function loadPastes() {
  const response = await fetch(`/api/pastes?username=${encodeURIComponent(username)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Unable to load pastes.");
  renderPastes(payload.pastes);
}

function connectEvents() {
  if (events) events.close();
  events = new EventSource(`/api/events?username=${encodeURIComponent(username)}`);
  events.addEventListener("open", () => setConnection(true));
  events.addEventListener("error", () => setConnection(false));
  events.addEventListener("pastes", (event) => {
    const payload = JSON.parse(event.data);
    renderPastes(payload.pastes);
  });
}

async function createPaste(content) {
  setCaptureState("Saving paste...");
  const response = await fetch("/api/pastes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, content })
  });
  const payload = await response.json();

  if (!response.ok) {
    setCaptureState(payload.error || "Paste failed.");
    return;
  }

  renderPastes(payload.pastes);
  setCaptureState("Added to list");
  pasteCapture.value = "";
  setTimeout(() => setCaptureState("Waiting for paste"), 1200);
}

async function deletePaste(id) {
  const response = await fetch(`/api/pastes/${encodeURIComponent(id)}?username=${encodeURIComponent(username)}`, {
    method: "DELETE"
  });
  const payload = await response.json();
  if (response.ok) renderPastes(payload.pastes);
}

async function enterUsername(value) {
  try {
    const nextUsername = normalizeUsername(value);
    showApp(nextUsername);
    await loadPastes();
    connectEvents();
  } catch (error) {
    showLogin(error.message);
  }
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  enterUsername(usernameInput.value);
});

pasteCapture.addEventListener("paste", (event) => {
  const text = event.clipboardData?.getData("text/plain") || "";
  if (!text.trim()) return;
  event.preventDefault();
  createPaste(text);
});

pasteCapture.addEventListener("input", () => {
  const bytes = encoder.encode(pasteCapture.value).length;
  setCaptureState(bytes ? `${formatBytes(bytes)} ready. Paste from clipboard to save.` : "Waiting for paste");
});

logoutButton.addEventListener("click", () => showLogin());

countdownTimer = setInterval(() => {
  const current = [...pasteList.querySelectorAll(".paste-item")];
  if (!current.length && !username) clearInterval(countdownTimer);
  if (username) loadPastes().catch(() => setConnection(false));
}, 30000);

const savedUsername = localStorage.getItem(usernameKey);
if (savedUsername) {
  enterUsername(savedUsername);
} else {
  showLogin();
}
