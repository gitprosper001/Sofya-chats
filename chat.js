function fmt(ts) {
  return new Date(ts).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
}

function mediaHtml(media) {
  if (!media) return "";
  if (media.type === "video") {
    return `<video controls src="${media.url}"></video>`;
  }
  return `<img src="${media.url}" alt="${media.name || "image"}">`;
}

function renderMsg(el, msg, mine) {
  const div = document.createElement("div");
  div.className = "msg" + (mine ? " me" : "");
  const who = msg.from === "admin" ? "Admin" : (msg.username || "User");
  const label = msg.broadcast ? "Broadcast" : who;
  div.innerHTML = `
    <div class="who">${label}</div>
    <div>${(msg.text || "").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>
    ${mediaHtml(msg.media)}
    <div class="time">${fmt(msg.createdAt)}</div>
  `;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

async function uploadFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return data;
}

function bindComposer({ form, textEl, fileEl, previewEl, onSend }) {
  let pending = null;
  fileEl.addEventListener("change", async () => {
    const file = fileEl.files[0];
    if (!file) return;
    previewEl.innerHTML = `<span class="chip">Uploading ${file.name}…</span>`;
    try {
      pending = await uploadFile(file);
      previewEl.innerHTML = `<span class="chip">${pending.type}: ${file.name} <a href="#" id="clearMedia">remove</a></span>`;
      previewEl.querySelector("#clearMedia").onclick = (e) => {
        e.preventDefault();
        pending = null;
        fileEl.value = "";
        previewEl.innerHTML = "";
      };
    } catch (err) {
      previewEl.innerHTML = `<span class="chip">${err.message}</span>`;
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = textEl.value.trim();
    if (!text && !pending) return;
    onSend({ text, media: pending });
    textEl.value = "";
    pending = null;
    fileEl.value = "";
    previewEl.innerHTML = "";
  });
}

async function bootUser() {
  const raw = sessionStorage.getItem("pulselink_user");
  if (!raw) return (location.href = "/");
  const user = JSON.parse(raw);
  document.getElementById("who").textContent = user.username;

  const socket = io();
  socket.emit("join", { role: "user", userId: user.id, username: user.username });

  const feed = document.getElementById("feed");
  const [history, broadcasts] = await Promise.all([
    fetch(`/api/messages/${user.id}`).then((r) => r.json()),
    fetch("/api/broadcasts").then((r) => r.json()),
  ]);
  const merged = [
    ...broadcasts.map((b) => ({ ...b, from: "admin", broadcast: true, username: "Admin" })),
    ...history,
  ].sort((a, b) => a.createdAt - b.createdAt);
  merged.forEach((m) => renderMsg(feed, m, m.from === "user"));

  socket.on("user-message", (m) => {
    if (m.userId === user.id) renderMsg(feed, m, true);
  });
  socket.on("admin-reply", (m) => {
    if (m.toUserId === user.id) renderMsg(feed, m, false);
  });
  socket.on("broadcast", (m) => renderMsg(feed, { ...m, from: "admin", broadcast: true }, false));

  bindComposer({
    form: document.getElementById("form"),
    textEl: document.getElementById("text"),
    fileEl: document.getElementById("file"),
    previewEl: document.getElementById("preview"),
    onSend: ({ text, media }) => {
      socket.emit("user-message", { userId: user.id, username: user.username, text, media });
    },
  });
}

async function bootAdmin() {
  if (!sessionStorage.getItem("pulselink_admin")) return (location.href = "/");
  const socket = io();
  socket.emit("join", { role: "admin" });

  const users = await fetch("/api/users").then((r) => r.json());
  const presence = {};
  let currentUserId = null;
  const listEl = document.getElementById("userList");
  const feed = document.getElementById("feed");
  const bcastFeed = document.getElementById("bcastFeed");

  function drawUsers() {
    listEl.innerHTML = users.map((u) => `
      <div class="side-item ${u.id === currentUserId ? "active" : ""}" data-id="${u.id}">
        <span class="dot ${presence[u.id] ? "on" : ""}"></span>
        <div>
          <div>${u.username}</div>
          <div class="meta">${presence[u.id] ? "online" : "offline"}</div>
        </div>
      </div>
    `).join("") || `<div class="side-item"><div class="meta">No users yet</div></div>`;
    listEl.querySelectorAll(".side-item[data-id]").forEach((el) => {
      el.onclick = () => openThread(el.dataset.id);
    });
  }

  async function openThread(userId) {
    currentUserId = userId;
    const u = users.find((x) => x.id === userId);
    document.getElementById("threadTitle").textContent = u ? u.username : "User";
    drawUsers();
    const history = await fetch(`/api/messages/${userId}`).then((r) => r.json());
    feed.innerHTML = "";
    history.forEach((m) => renderMsg(feed, m, m.from === "admin"));
  }

  drawUsers();

  const broadcasts = await fetch("/api/broadcasts").then((r) => r.json());
  broadcasts.slice().reverse().forEach((m) => renderMsg(bcastFeed, { ...m, from: "admin", broadcast: true }, true));

  socket.on("presence", (p) => {
    presence[p.userId] = p.online;
    if (p.username && !users.find((u) => u.id === p.userId)) {
      users.push({ id: p.userId, username: p.username });
    }
    drawUsers();
  });

  socket.on("user-message", (m) => {
    if (!users.find((u) => u.id === m.userId)) {
      users.push({ id: m.userId, username: m.username });
      drawUsers();
    }
    if (m.userId === currentUserId) renderMsg(feed, m, false);
    if (!currentUserId) openThread(m.userId);
  });

  socket.on("admin-reply", (m) => {
    if (m.toUserId === currentUserId) renderMsg(feed, m, true);
  });

  socket.on("broadcast", (m) => renderMsg(bcastFeed, { ...m, from: "admin", broadcast: true }, true));

  bindComposer({
    form: document.getElementById("form"),
    textEl: document.getElementById("text"),
    fileEl: document.getElementById("file"),
    previewEl: document.getElementById("preview"),
    onSend: ({ text, media }) => {
      if (!currentUserId) return alert("Pick a user first");
      socket.emit("admin-reply", { toUserId: currentUserId, text, media });
    },
  });

  bindComposer({
    form: document.getElementById("bcastForm"),
    textEl: document.getElementById("bcastText"),
    fileEl: document.getElementById("bcastFile"),
    previewEl: document.getElementById("bcastPreview"),
    onSend: ({ text, media }) => {
      socket.emit("broadcast", { text, media });
    },
  });
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === tab));
  document.getElementById("inboxView").style.display = tab === "inbox" ? "grid" : "none";
  document.getElementById("broadcastView").style.display = tab === "broadcast" ? "grid" : "none";
}
