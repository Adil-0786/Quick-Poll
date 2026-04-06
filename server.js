const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { WebSocketServer } = require("ws");
const fetch = global.fetch || require("node-fetch");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const polls = new Map();

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname)));

app.get("/poll/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const api = express.Router();
app.use("/api", api);

api.get("/polls", (req, res) => {
  const list = Array.from(polls.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((poll) => ({
      id: poll.id,
      question: poll.question,
      optionsCount: poll.options.length,
      totalVotes: getTotalVotes(poll),
      createdAt: poll.createdAt,
      expiresAt: poll.expiresAt || null,
      createdBy: poll.createdBy || "Guest"
    }));

  res.json({ polls: list });
});

api.get("/poll/:id", (req, res) => {
  const poll = polls.get(String(req.params.id));
  if (!poll) {
    return res.status(404).send("Poll not found.");
  }

  const payload = {
    pollId: poll.id,
    poll: serializePoll(poll),
    results: getResults(poll),
    comments: poll.comments || []
  };

  res.json(payload);
});

api.get("/poll/:id/export", (req, res) => {
  const poll = polls.get(String(req.params.id));
  if (!poll) {
    return res.status(404).send("Poll not found.");
  }

  const results = getResults(poll);
  const lines = ["Option,Votes,Percent"];
  const total = getTotalVotes(poll);

  results.forEach((row) => {
    const percent = total > 0 ? ((row.votes / total) * 100).toFixed(1) : "0.0";
    lines.push(`${escapeCsv(row.text)},${row.votes},${percent}`);
  });

  const csv = lines.join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="poll-${poll.id}-results.csv"`
  );
  res.send(csv);
});

api.post("/ai/generate-poll", async (req, res) => {
  const body = req.body || {};
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const maxOptions = Math.min(6, Math.max(2, Number(body.maxOptions) || 4));
  const isQuiz = body.isQuiz === true || body.isQuiz === "true";

  if (!prompt) {
    return res.status(400).send("Prompt is required.");
  }

  const prefer = String(process.env.AI_PROVIDER || "").toLowerCase();
  const attempts =
    prefer === "gemini"
      ? ["gemini", "openai"]
      : prefer === "openai"
      ? ["openai", "gemini"]
      : ["openai", "gemini"];

  let lastReason = "fallback";

  for (const provider of attempts) {
    if (provider === "openai") {
      const result = await tryOpenAI(prompt, maxOptions, isQuiz);
      if (result.ok) return res.json(result.data);
      lastReason = result.reason || lastReason;
    }
    if (provider === "gemini") {
      const result = await tryGemini(prompt, maxOptions, isQuiz);
      if (result.ok) return res.json(result.data);
      lastReason = result.reason || lastReason;
    }
  }

  return res.json(generateFallbackPoll(prompt, maxOptions, isQuiz, lastReason));
});

api.post("/poll", (req, res) => {
  const body = req.body || {};
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const options = Array.isArray(body.options) ? body.options : [];
  const createdBy = typeof body.createdBy === "string" ? body.createdBy.trim() : "Guest";
  const expiresAt = body.expiresAt ? Number(body.expiresAt) : null;
  const isQuiz = body.isQuiz === true || body.isQuiz === "true";
  const correctOptionId = body.correctOptionId ? String(body.correctOptionId) : "";

  if (!question || options.length < 2) {
    return res.status(400).send("Question and at least two options are required.");
  }

  const pollId = crypto.randomUUID().slice(0, 8);
  const normalizedOptions = options
    .map((opt) => String(opt || "").trim())
    .filter((opt) => opt.length > 0)
    .map((opt, idx) => ({ id: String(idx + 1), text: opt }));

  if (normalizedOptions.length < 2) {
    return res.status(400).send("Question and at least two options are required.");
  }

  if (isQuiz) {
    const isValid = normalizedOptions.some((opt) => opt.id === correctOptionId);
    if (!isValid) {
      return res.status(400).send("Select a valid correct answer.");
    }
  }

  const poll = {
    id: pollId,
    question,
    options: normalizedOptions,
    votes: {},
    comments: [],
    createdAt: Date.now(),
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
    createdBy,
    isQuiz,
    correctOptionId: isQuiz ? correctOptionId : null
  };

  polls.set(pollId, poll);

  const payload = {
    pollId,
    poll: serializePoll(poll),
    results: getResults(poll),
    comments: poll.comments
  };

  broadcastPoll(pollId, payload);
  res.json(payload);
});

api.post("/vote", (req, res) => {
  const body = req.body || {};
  const pollId = body.pollId ? String(body.pollId) : "";
  const optionId = body.optionId ? String(body.optionId) : "";

  const poll = polls.get(pollId);
  if (!poll) {
    return res.status(404).send("Poll not found.");
  }

  if (isExpired(poll)) {
    return res.status(400).send("This poll has expired.");
  }

  const optionExists = poll.options.some((opt) => opt.id === optionId);
  if (!optionExists) {
    return res.status(400).send("Invalid option.");
  }

  poll.votes[optionId] = (poll.votes[optionId] || 0) + 1;

  const results = getResults(poll);
  const payload = {
    pollId,
    results,
    correct: poll.correctOptionId ? optionId === poll.correctOptionId : null,
    correctOptionId: poll.correctOptionId || null
  };
  broadcastResults(pollId, results);

  res.json(payload);
});

api.post("/comment", (req, res) => {
  const body = req.body || {};
  const pollId = body.pollId ? String(body.pollId) : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const author = typeof body.author === "string" ? body.author.trim() : "Anonymous";

  const poll = polls.get(pollId);
  if (!poll) {
    return res.status(404).send("Poll not found.");
  }

  if (!text) {
    return res.status(400).send("Comment cannot be empty.");
  }

  const comment = {
    id: crypto.randomUUID().slice(0, 8),
    author,
    text,
    createdAt: Date.now()
  };

  poll.comments.push(comment);
  broadcastComments(pollId, poll.comments);

  res.json({ pollId, comments: poll.comments });
});

api.post("/duplicate", (req, res) => {
  const body = req.body || {};
  const sourceId = body.pollId ? String(body.pollId) : "";
  const source = polls.get(sourceId);
  if (!source) {
    return res.status(404).send("Poll not found.");
  }

  const pollId = crypto.randomUUID().slice(0, 8);
  const poll = {
    id: pollId,
    question: `${source.question} (Copy)`,
    options: source.options.map((opt, idx) => ({ id: String(idx + 1), text: opt.text })),
    votes: {},
    comments: [],
    createdAt: Date.now(),
    expiresAt: source.expiresAt || null,
    createdBy: source.createdBy || "Guest",
    isQuiz: !!source.isQuiz,
    correctOptionId: source.correctOptionId || null
  };

  polls.set(pollId, poll);

  const payload = {
    pollId,
    poll: serializePoll(poll),
    results: getResults(poll),
    comments: poll.comments
  };

  broadcastPoll(pollId, payload);
  res.json(payload);
});

api.delete("/poll/:id", (req, res) => {
  const pollId = String(req.params.id);
  if (!polls.has(pollId)) {
    return res.status(404).send("Poll not found.");
  }
  polls.delete(pollId);
  res.json({ ok: true });
});

wss.on("connection", (socket) => {
  socket.on("message", (buffer) => {
    let data;
    try {
      data = JSON.parse(buffer.toString());
    } catch (err) {
      return;
    }

    if (data && data.type === "subscribe" && data.pollId) {
      socket.pollId = String(data.pollId);
      const poll = polls.get(socket.pollId);
      if (poll) {
        sendMessage(socket, { type: "poll", pollId: poll.id, poll: serializePoll(poll) });
        sendMessage(socket, { type: "results", pollId: poll.id, results: getResults(poll) });
        sendMessage(socket, { type: "comments", pollId: poll.id, comments: poll.comments });
      }
    }
  });
});

function serializePoll(poll) {
  return {
    id: poll.id,
    question: poll.question,
    options: poll.options,
    createdAt: poll.createdAt,
    expiresAt: poll.expiresAt || null,
    createdBy: poll.createdBy || "Guest",
    isQuiz: !!poll.isQuiz,
    correctOptionId: poll.correctOptionId || null
  };
}

function getResults(poll) {
  return poll.options.map((opt) => ({
    optionId: opt.id,
    text: opt.text,
    votes: poll.votes[opt.id] || 0
  }));
}

function getTotalVotes(poll) {
  return Object.values(poll.votes).reduce((sum, value) => sum + value, 0);
}

function isExpired(poll) {
  return poll.expiresAt && Date.now() > poll.expiresAt;
}

function escapeCsv(value) {
  const text = String(value || "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/\"/g, "\"\"")}"`;
  }
  return text;
}

function extractOutputText(data) {
  if (!data || !Array.isArray(data.output)) return "";
  const parts = [];
  data.output.forEach((item) => {
    if (!item || !Array.isArray(item.content)) return;
    item.content.forEach((content) => {
      if (content && content.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    });
  });
  return parts.join("").trim();
}

function safeJsonParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (inner) {
      return null;
    }
  }
}

async function tryOpenAI(prompt, maxOptions, isQuiz) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "missing_openai_key" };
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const system = [
    "You create polls.",
    "Return ONLY valid JSON with keys:",
    "question (string), options (array of strings), correctOptionIndex (number or null).",
    "Options must be between 2 and " + maxOptions + ".",
    isQuiz ? "Set correctOptionIndex as 1-based index of the correct option." : "Set correctOptionIndex to null.",
    "No extra text."
  ].join(" ");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        instructions: system,
        input: prompt,
        max_output_tokens: 300,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      const reason = errorText && errorText.includes("insufficient_quota") ? "openai_quota" : "openai_error";
      return { ok: false, reason };
    }

    const data = await response.json();
    const outputText = extractOutputText(data);
    const parsed = safeJsonParse(outputText);

    if (!parsed) {
      return { ok: false, reason: "openai_parse" };
    }

    return { ok: true, data: buildAIResponse(parsed, maxOptions, isQuiz, "openai") };
  } catch (err) {
    return { ok: false, reason: "openai_exception" };
  }
}

async function tryGemini(prompt, maxOptions, isQuiz) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "missing_gemini_key" };
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const system = [
    "You create polls.",
    "Return ONLY valid JSON with keys:",
    "question (string), options (array of strings), correctOptionIndex (number or null).",
    "Options must be between 2 and " + maxOptions + ".",
    isQuiz ? "Set correctOptionIndex as 1-based index of the correct option." : "Set correctOptionIndex to null.",
    "No extra text."
  ].join(" ");

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" +
        model +
        ":generateContent?key=" +
        apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: system }] },
          generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
        })
      }
    );

    if (!response.ok) {
      return { ok: false, reason: "gemini_error" };
    }

    const data = await response.json();
    const outputText = extractGeminiText(data);
    const parsed = safeJsonParse(outputText);

    if (!parsed) {
      return { ok: false, reason: "gemini_parse" };
    }

    return { ok: true, data: buildAIResponse(parsed, maxOptions, isQuiz, "gemini") };
  } catch (err) {
    return { ok: false, reason: "gemini_exception" };
  }
}

function buildAIResponse(parsed, maxOptions, isQuiz, provider) {
  const question = String(parsed.question || "").trim();
  const options = Array.isArray(parsed.options)
    ? parsed.options.map((opt) => String(opt || "").trim()).filter(Boolean)
    : [];

  if (!question || options.length < 2) {
    return generateFallbackPoll(question || "What do you think?", maxOptions, isQuiz, provider + "_incomplete");
  }

  let correctOptionId = null;
  if (isQuiz) {
    const index = Number(parsed.correctOptionIndex);
    if (Number.isFinite(index) && index >= 1 && index <= options.length) {
      correctOptionId = String(index);
    } else {
      correctOptionId = "1";
    }
  }

  return {
    question,
    options: options.slice(0, maxOptions),
    correctOptionId,
    fallback: false,
    provider
  };
}

function extractGeminiText(data) {
  if (!data || !Array.isArray(data.candidates) || !data.candidates[0]) return "";
  const candidate = data.candidates[0];
  const content = candidate.content;
  if (!content || !Array.isArray(content.parts)) return "";
  const texts = content.parts
    .map((part) => (part && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean);
  return texts.join("").trim();
}

function generateFallbackPoll(prompt, maxOptions, isQuiz, reason) {
  const cleaned = String(prompt || "").replace(/\s+/g, " ").trim();
  const question = buildFallbackQuestion(cleaned);
  const options = buildFallbackOptions(cleaned, maxOptions);
  const safeOptions = options.length >= 2 ? options.slice(0, maxOptions) : ["Option 1", "Option 2"];
  return {
    question,
    options: safeOptions,
    correctOptionId: isQuiz ? "1" : null,
    fallback: true,
    fallbackReason: reason || "fallback"
  };
}

function buildFallbackQuestion(text) {
  if (!text) return "What is your opinion?";
  const match = text.match(/[^?.!]+\?/);
  if (match) return match[0].trim();
  const lower = text.toLowerCase();
  if (lower.includes("best") || lower.includes("favorite") || lower.includes("prefer")) {
    return "Which option do you prefer about " + text + "?";
  }
  if (lower.includes("should") || lower.includes("do you think") || lower.includes("is it")) {
    return "Do you agree: " + text + "?";
  }
  return "What do you think about " + text + "?";
}

function buildFallbackOptions(text, maxOptions) {
  const extracted = extractOptionsFromPrompt(text);
  if (extracted.length >= 2) return extracted.slice(0, maxOptions);

  const lower = text.toLowerCase();
  if (
    lower.includes("agree") ||
    lower.includes("should") ||
    lower.includes("do you think") ||
    lower.includes("is it")
  ) {
    return ["Strongly agree", "Agree", "Neutral", "Disagree"].slice(0, maxOptions);
  }
  if (lower.includes("best") || lower.includes("favorite") || lower.includes("prefer")) {
    return ["Option A", "Option B", "Option C", "Option D"].slice(0, maxOptions);
  }
  return ["Option 1", "Option 2", "Option 3", "Option 4"].slice(0, maxOptions);
}

function extractOptionsFromPrompt(text) {
  if (!text) return [];
  const listMatch = text.match(/options?\s*[:\-]\s*([^\n]+)/i);
  if (listMatch && listMatch[1]) {
    return listMatch[1]
      .split(/[;,|]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const bracketMatch = text.match(/\(([^)]+)\)|\[([^\]]+)\]/);
  if (bracketMatch) {
    const group = bracketMatch[1] || bracketMatch[2];
    if (group) {
      return group
        .split(/[;,|]/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function sendMessage(socket, payload) {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify(payload));
}

function broadcastPoll(pollId, payload) {
  const message = Object.assign({ type: "poll", pollId }, payload);
  broadcastToPoll(pollId, message);
}

function broadcastResults(pollId, results) {
  const message = { type: "results", pollId, results };
  broadcastToPoll(pollId, message);
}

function broadcastComments(pollId, comments) {
  const message = { type: "comments", pollId, comments };
  broadcastToPoll(pollId, message);
}

function broadcastToPoll(pollId, payload) {
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState !== 1) return;
    if (client.pollId !== pollId) return;
    client.send(data);
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`QuickPoll server running on http://localhost:${PORT}`);
});
