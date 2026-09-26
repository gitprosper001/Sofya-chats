const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(__dirname, "public", "uploads");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const BROADCASTS_FILE = path.join(DATA_DIR, "broadcasts.json");

[DATA_DIR, UPLOADS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let users = readJson(USERS_FILE, []);
let messages = readJson(MESSAGES_FILE, []);
let broadcasts = readJson(BROADCASTS_FILE, []);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^(image|video)\//.test(file.mimetype);
    cb(ok ? null : new Error("Only images and videos are allowed"), ok);
  },
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/register", (req, res) => {
  const { username } = req.body;
  if (!username || typeof username !== "string") {
    return res.status(400).json({ error: "Username is required" });
  }
  const name = username.trim().slice(0, 24);
  if (name.length < 2) {
    return res.status(400).json({ error: "Username must be at least 2 characters" });
  }
  if (name.toLowerCase() === "admin") {
    return res.status(400).json({ error: "That name is reserved" });
  }
  let user = users.find((u) => u.username.toLowerCase() === name.toLowerCase());
  if (!user) {
    user = { id: uuidv4(), username: name, createdAt: Date.now() };
    users.push(user);
    writeJson(USERS_FILE, users);
  }
  res.json({ user });
});

app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Wrong password" });
  }
  res.json({ ok: true, token: "admin" });
});

app.get("/api/broadcasts", (_req, res) => {
  res.json(broadcasts.slice().reverse().slice(0, 50));
});

app.get("/api/users", (_req, res) => {
  res.json(users);
});

app.get("/api/messages/:userId", (req, res) => {
  const list = messages.filter(
    (m) => m.userId === req.params.userId || m.toUserId === req.params.userId
  );
  res.json(list);
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const type = req.file.mimetype.startsWith("video") ? "video" : "image";
  res.json({
    url: `/uploads/${req.file.filename}`,
    type,
    name: req.file.originalname,
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const online = new Map();

io.on("connection", (socket) => {
  socket.on("join", (payload) => {
    if (!payload) return;
    if (payload.role === "admin") {
      socket.join("admins");
      socket.data.role = "admin";
      io.emit("admin-status", { online: true });
    } else if (payload.userId) {
      socket.join(`user:${payload.userId}`);
      socket.data.role = "user";
      socket.data.userId = payload.userId;
      socket.data.username = payload.username;
      online.set(payload.userId, { username: payload.username, socketId: socket.id });
      io.to("admins").emit("presence", { userId: payload.userId, online: true, username: payload.username });
    }
  });

  socket.on("user-message", (payload) => {
    if (!payload || !payload.userId || !payload.username) return;
    const msg = {
      id: uuidv4(),
      from: "user",
      userId: payload.userId,
      username: payload.username,
      text: (payload.text || "").slice(0, 4000),
      media: payload.media || null,
      createdAt: Date.now(),
    };
    messages.push(msg);
    writeJson(MESSAGES_FILE, messages);
    io.to("admins").emit("user-message", msg);
    socket.emit("user-message", msg);
  });

  socket.on("admin-reply", (payload) => {
    if (socket.data.role !== "admin") return;
    if (!payload || !payload.toUserId) return;
    const msg = {
      id: uuidv4(),
      from: "admin",
      toUserId: payload.toUserId,
      userId: payload.toUserId,
      username: "Admin",
      text: (payload.text || "").slice(0, 4000),
      media: payload.media || null,
      createdAt: Date.now(),
    };
    messages.push(msg);
    writeJson(MESSAGES_FILE, messages);
    io.to(`user:${payload.toUserId}`).emit("admin-reply", msg);
    io.to("admins").emit("admin-reply", msg);
  });

  socket.on("broadcast", (payload) => {
    if (socket.data.role !== "admin") return;
    const item = {
      id: uuidv4(),
      text: (payload.text || "").slice(0, 4000),
      media: payload.media || null,
      createdAt: Date.now(),
    };
    broadcasts.push(item);
    writeJson(BROADCASTS_FILE, broadcasts);
    io.emit("broadcast", item);
  });

  socket.on("disconnect", () => {
    if (socket.data.userId) {
      online.delete(socket.data.userId);
      io.to("admins").emit("presence", {
        userId: socket.data.userId,
        online: false,
        username: socket.data.username,
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`PulseLink running at http://localhost:${PORT}`);
  console.log(`Admin password: ${ADMIN_PASSWORD}`);
});
