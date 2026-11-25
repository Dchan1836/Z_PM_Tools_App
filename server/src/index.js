import "./loadEnv.js";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";
import { dispatch, initStore, present, resetDemo, userByEmail, userById, getDb } from "./store.js";
import { draftMeetingFromNotes } from "./meetingDraft.js";
import { answerProjectQuestion } from "./rag.js";
import { graphQuery } from "./graph.js";
import { can } from "./logic.js";
import { buildWorkbook } from "./workbook.js";
import { saveBackup } from "./backup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, "..", "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });
const app = express();
const sessions = new Map();

app.use(cors());
app.use(express.json({ limit: "4mb" }));

function tokenFrom(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function requireUser(req, res, next) {
  const user = userById(sessions.get(tokenFrom(req)));
  if (!user) {
    res.status(401).json({ error: "Sign in again." });
    return;
  }
  req.user = user;
  next();
}

app.post("/api/login", (req, res) => {
  const user = userByEmail(req.body.email);
  if (!user || user.password !== String(req.body.password || "")) {
    res.status(401).json({ error: "Email or password does not match a Z PM account." });
    return;
  }
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  sessions.set(token, user.id);
  res.json({ token, state: present(getDb(), user) });
});

app.post("/api/logout", requireUser, (req, res) => {
  sessions.delete(tokenFrom(req));
  res.json({ ok: true });
});

app.get("/api/state", requireUser, (req, res) => {
  res.json(present(getDb(), req.user));
});

app.post("/api/action", requireUser, async (req, res) => {
  try {
    const result = await dispatch(req.user, req.body || {});
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Something went wrong." });
  }
});

app.post("/api/reset", requireUser, async (req, res) => {
  try {
    res.json(await resetDemo(req.user));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post("/api/backup", requireUser, async (req, res) => {
  try {
    if (!can(req.user, "organization")) {
      res.status(403).json({ error: "Only a super admin can save a database backup." });
      return;
    }
    res.json(await saveBackup());
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "The database backup could not be saved." });
  }
});

app.get("/api/export", requireUser, async (req, res) => {
  try {
    if (!can(req.user, "organization")) {
      res.status(403).json({ error: "Only a super admin can download all project data." });
      return;
    }
    const buffer = await buildWorkbook(getDb(), req.user);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Z-PM-Tool-${stamp}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "The workbook could not be created." });
  }
});

app.get("/api/graph", requireUser, async (req, res) => {
  try {
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    const focus = String(req.query.focus || "");
    const view = String(req.query.view || "");
    if (from && to) res.json(await graphQuery("path", [from, to]));
    else if (focus) res.json(await graphQuery("focus", [focus]));
    else if (view === "diagram") res.json(await graphQuery("diagram"));
    else if (view === "analytics") res.json(await graphQuery("analytics"));
    else res.json(await graphQuery("summary"));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "The link graph failed." });
  }
});

app.post("/api/ai/chat", requireUser, async (req, res) => {
  try {
    res.json(await answerProjectQuestion({
      question: req.body.message,
      history: req.body.history,
      db: getDb(),
      user: req.user,
    }));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "The assistant could not answer." });
  }
});

app.post("/api/ai/meeting", requireUser, async (req, res) => {
  try {
    const draft = await draftMeetingFromNotes(req.body?.notes, getDb(), undefined, {
      defaultOwnerId: req.body?.defaultOwner ? req.user?.id : "",
    });
    res.json(draft);
  } catch (error) {
    const message = error.expose ? error.message : "OpenAI could not read those notes.";
    res.status(error.status || 500).json({ error: message });
  }
});

app.post("/api/upload", requireUser, upload.single("file"), async (req, res) => {
  try {
    const fileName = req.file?.originalname || req.body.fileName;
    const type = req.body.type || "file";
    let result;
    if (type === "meeting") {
      result = await dispatch(req.user, {
        type: "uploadMeeting",
        fileName,
        notes: req.body.notes || "",
        taskId: req.body.taskId || "",
      });
    } else if (type === "decision") {
      result = await dispatch(req.user, {
        type: "uploadDecision",
        fileName,
        notes: req.body.notes || "",
      });
    } else {
      result = await dispatch(req.user, {
        type: "uploadFile",
        folderId: req.body.folderId,
        fileName,
      });
    }
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

const clientDist = process.env.CLIENT_DIST
  || path.join(__dirname, "..", "..", "client", "dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const port = Number(process.env.PORT || 4000);
await initStore();
app.listen(port, "0.0.0.0", () => {
  console.log(`Z PM server listening on ${port}`);
});
