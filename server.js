import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import cors from "cors";

const app = express();
app.use(cors()); // ✅ Enable CORS for all origins (safe for now)
app.use(bodyParser.json());

// ✅ Secure API Key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("❌ Missing GEMINI_API_KEY in environment!");
  process.exit(1);
}

// ✅ SQLite Database for conversation memory
let db;
(async () => {
  db = await open({
    filename: "./memory.db",
    driver: sqlite3.Database,
  });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      sessionId TEXT,
      role TEXT,
      message TEXT
    );
  `);
})();

// ✅ Function to call Gemini API
async function callGemini(messages) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

  const payload = {
    contents: messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.message }],
    })),
  };

  const response = await fetch(`${url}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Server error: ${response.statusText}`);
  }

  const data = await response.json();
  const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return aiText;
}

// ✅ Save message to DB
async function saveMessage(sessionId, role, message) {
  await db.run("INSERT INTO memory (sessionId, role, message) VALUES (?, ?, ?)", [
    sessionId,
    role,
    message,
  ]);
}

// ✅ Fetch conversation history
async function getHistory(sessionId) {
  const rows = await db.all(
    "SELECT role, message FROM memory WHERE sessionId = ? ORDER BY rowid ASC",
    [sessionId]
  );
  return rows;
}

// 🔹 POST /ask-ai — Send prompt, store response
app.post("/ask-ai", async (req, res) => {
  try {
    const { sessionId, prompt } = req.body;
    if (!sessionId || !prompt) {
      return res.status(400).json({ error: "Missing sessionId or prompt" });
    }

    // Store user message
    await saveMessage(sessionId, "user", prompt);

    // Get full history and send to Gemini
    const history = await getHistory(sessionId);
    const aiResponse = await callGemini(history);

    // Store AI response
    await saveMessage(sessionId, "model", aiResponse);

    res.json({ response: aiResponse });
  } catch (err) {
    console.error("❌ AI Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 🔹 GET /history — Fetch conversation
app.get("/history", async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }
    const history = await getHistory(sessionId);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 DELETE /clear — Clear a conversation
app.delete("/clear", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }
    await db.run("DELETE FROM memory WHERE sessionId = ?", [sessionId]);
    res.json({ success: true, message: "Conversation cleared" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
