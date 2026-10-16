# ⚡ QuickPoll — Real-Time Polling Application

Create, share, and vote on polls instantly with **real-time results** powered by WebSockets. Features AI-powered poll generation, quiz mode, CSV exports, QR code sharing, and live commenting.

![Node.js](https://img.shields.io/badge/Node.js-24+-339933?style=flat-square&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express&logoColor=white)
![WebSocket](https://img.shields.io/badge/WebSocket-Realtime-blue?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

---

## ✨ Features

| Feature | Description |
|---|---|
| **📊 Real-Time Voting** | Live vote updates via WebSockets — no page refresh needed |
| **🤖 AI Poll Generator** | Generate polls from prompts using OpenAI or Gemini APIs |
| **🧠 Quiz Mode** | Create quizzes with correct answer validation |
| **📤 Share Polls** | Shareable links + QR code generation |
| **💬 Live Comments** | Real-time comment threads on each poll |
| **📁 CSV Export** | Download poll results as CSV files |
| **📋 Poll Management** | Duplicate, delete, and manage polls |
| **⏰ Expiration Timer** | Set poll expiration deadlines |
| **🎨 Modern UI** | Dark-themed, responsive glassmorphism design |

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js
- **Real-Time:** WebSocket (ws library)
- **Frontend:** Vanilla HTML/CSS/JS (single-page app)
- **AI Integration:** OpenAI GPT-4o / Google Gemini 2.0 Flash (optional)
- **Storage:** In-memory (polls reset on server restart)

---

## 📂 Project Structure

```
Quick-Poll/
├── server.js           # Express + WebSocket server (API + real-time)
├── index.html          # Frontend SPA
├── styles.css          # Dark-themed responsive styles
├── QuickPoll.js        # Client-side logic (voting, comments, etc.)
├── package.json        # Dependencies & scripts
└── README.md
```

---

## ⚙️ Quick Start

### 1. Clone the repository
```bash
git clone https://github.com/Adil-0786/Quick-Poll.git
cd Quick-Poll
```

### 2. Install dependencies
```bash
npm install
```

### 3. Start the server
```bash
npm start
```

The app starts at **http://localhost:3000** 🚀

---

## 🤖 AI Poll Generation (Optional)

To enable AI-powered poll generation, set API keys as environment variables:

```bash
# OpenAI
export OPENAI_API_KEY=your-openai-key

# Google Gemini
export GEMINI_API_KEY=your-gemini-key

# Choose preferred provider (default: openai)
export AI_PROVIDER=openai  # or "gemini"
```

> Without API keys, the app falls back to smart template-based poll generation.

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/polls` | List all polls |
| `GET` | `/api/poll/:id` | Get poll details + results |
| `POST` | `/api/poll` | Create a new poll |
| `POST` | `/api/vote` | Vote on a poll |
| `POST` | `/api/comment` | Add a comment to a poll |
| `POST` | `/api/duplicate` | Duplicate an existing poll |
| `DELETE` | `/api/poll/:id` | Delete a poll |
| `GET` | `/api/poll/:id/export` | Export results as CSV |
| `POST` | `/api/ai/generate-poll` | AI-generate a poll from a prompt |

### WebSocket

Connect to `ws://localhost:3000/ws` and send:
```json
{ "type": "subscribe", "pollId": "abc12345" }
```
Receive real-time `poll`, `results`, and `comments` events.

---

## 📄 License

MIT License — feel free to use, modify, and distribute.

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/Adil-0786">Adil</a>
</p>
