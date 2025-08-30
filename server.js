import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import dotenv from "dotenv";

dotenv.config(); // Load .env if running locally

const app = express();
const PORT = process.env.PORT || 3000;
app.use(bodyParser.json());

// ✅ Securely load Gemini API key from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ Missing GEMINI_API_KEY in environment variables!");
  process.exit(1);
}

// ✅ Initialize SQLite database
let db;
(async () => {
  db = await open({
    filename: "./chat-history.db",
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      role TEXT,
      message TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("✅ SQLite database ready.");
})();

// 🔹 Save a chat message
async function saveMessage(sessionId, role, message) {
  await db.run(
    "INSERT INTO chat_history (session_id, role, message) VALUES (?, ?, ?)",
    [sessionId, role, message]
  );
}

// 🔹 Get chat history for a session
async function getHistory(sessionId) {
  return await db.all(
    "SELECT role, message, timestamp FROM chat_history WHERE session_id = ? ORDER BY id ASC",
    [sessionId]
  );
}

// 🔹 Ask Gemini API
async function askGemini(prompt, contextMessages = []) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" +
      GEMINI_API_KEY,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          ...contextMessages.map((msg) => ({
            role: msg.role,
            parts: [{ text: msg.message }],
          })),
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
      }),
    }
  );

  const data = await response.json();
  try {
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "⚠️ No response";
  } catch (e) {
    console.error("Gemini error:", data);
    return "⚠️ Gemini API error.";
  }
}

// 🔹 POST /ask-ai (Send message to Gemini)
app.post("/ask-ai", async (req, res) => {
  try {
    const { sessionId, prompt } = req.body;
    if (!sessionId || !prompt) {
      return res
        .status(400)
        .json({ error: "sessionId and prompt are required." });
    }

    // Fetch context (last 10 messages)
    const context = await getHistory(sessionId);
    const recentContext = context.slice(-10);

    // Save user message
    await saveMessage(sessionId, "user", prompt);

    // Get AI response
    const aiResponse = await askGemini(prompt, recentContext);

    // Save AI message
    await saveMessage(sessionId, "assistant", aiResponse);

    res.json({ reply: aiResponse });
  } catch (error) {
    console.error("Error in /ask-ai:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// 🔹 GET /history (Retrieve session chat)
app.get("/history", async (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required." });
    }

    const history = await getHistory(sessionId);
    res.json({ history });
  } catch (error) {
    console.error("Error in /history:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// 🔹 Root route
app.get("/", (req, res) => {
  res.send("✅ AI Memory API is running!");
});

// 🔹 Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
