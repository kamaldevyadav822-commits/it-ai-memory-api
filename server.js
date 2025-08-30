import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const app = express();
app.use(bodyParser.json());

// 🚨 Your API key is hardcoded here (NOT safe for production)
const GEMINI_API_KEY = "AIzaSyCi_13LJlwK0DAviYERyqTKg47GngBSeb8";

// Setup SQLite DB
let db;
(async () => {
  db = await open({
    filename: "./chat_history.db",
    driver: sqlite3.Database
  });
  await db.exec(
    "CREATE TABLE IF NOT EXISTS chats (id INTEGER PRIMARY KEY, sessionId TEXT, role TEXT, message TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)"
  );
})();

// Save message to DB
async function saveMessage(sessionId, role, message) {
  await db.run(
    "INSERT INTO chats (sessionId, role, message) VALUES (?, ?, ?)",
    [sessionId, role, message]
  );
}

// Get conversation history
async function getHistory(sessionId) {
  return db.all("SELECT role, message FROM chats WHERE sessionId = ?", [
    sessionId
  ]);
}

// AI endpoint
app.post("/ask-ai", async (req, res) => {
  const { sessionId, prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt required" });

  // Save user prompt
  await saveMessage(sessionId, "user", prompt);

  // Get history
  const history = await getHistory(sessionId);
  const context = history
    .map(h => `${h.role.toUpperCase()}: ${h.message}`)
    .join("\\n");

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Conversation so far:\\n${context}\\n\\nUser: ${prompt}`
                }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();
    const aiMessage =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sorry, I couldn't generate a response.";

    await saveMessage(sessionId, "assistant", aiMessage);
    res.json({ reply: aiMessage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI request failed" });
  }
});

// Get chat history
app.get("/history", async (req, res) => {
  const { sessionId } = req.query;
  const history = await getHistory(sessionId);
  res.json(history);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
