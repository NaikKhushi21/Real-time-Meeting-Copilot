# TwinMind - Live Suggestions Assignment

Web app that captures live mic audio, transcribes in short rolling chunks (configurable), generates exactly 3 live suggestions, and supports detailed chat answers on suggestion click.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Models (Groq only):
  - Transcription: `whisper-large-v3`
  - Suggestions: `gpt-oss-120b`
  - Chat: `gpt-oss-120b` (streamed)

## Features Implemented

- Start/stop microphone recording.
- Transcript chunk append in configurable intervals (default 8s).
- Auto-refresh suggestions every 15-30s (configurable).
- Manual refresh button that flushes latest audio chunk, updates transcript, then regenerates suggestions.
- Exactly 3 suggestions per batch.
- Newest suggestion batch appears at top; older batches remain visible.
- Suggestion click adds user item to chat and streams a detailed answer.
- Direct user chat input in one continuous session chat.
- Settings modal:
  - Groq API key
  - Prompt editing (suggestions, detailed click answer, chat)
  - Model names
  - Context windows
  - Novelty/semantic controls
  - Temperatures
  - Refresh interval
- Export full session as JSON:
  - Transcript chunks with timestamps
  - All suggestion batches with timestamps
  - Full chat history with timestamps
  - Redacted API key in settings snapshot

## Project Structure

```txt
server/
  index.js
  routes/
    transcribe.js
    suggestions.js
    chat.js
  services/
    groqClient.js

src/
  app/
    App.jsx
    defaults.js
  components/
    layout/
    transcript/
    suggestions/
    chat/
    settings/
  hooks/
    useRecorder.js
    useAutoScroll.js
  services/
    apiClient.js
    promptBuilder.js
    exportSession.js
  utils/
    time.js
    ids.js
```

## Prompt Strategy

### Live Suggestions

- System prompt enforces:
  - exactly 3 suggestions
  - allowed types (`question_to_ask`, `talking_point`, `answer`, `fact_check`, `clarification`)
  - useful preview text (short and actionable)
  - a short `why` explanation for timing relevance
- Context passed:
  - recent transcript window (`suggestionContextChunks`)
  - rolling meeting memory summary
  - phase/policy guidance (opening/exploration/decision/closing)
  - recent suggestion batch history to reduce repetition
- Backend enforces strict JSON parsing in single-call mode.

### Detailed Answer (Suggestion Click)

- Separate prompt tuned for longer-form practical guidance.
- Context passed:
  - clicked suggestion
  - wider transcript window (`detailContextChunks`)
  - recent chat history (`chatContextMessages`)
- Response is streamed to reduce time-to-first-token.

### Direct Chat

- Separate chat prompt for concise, practical responses.
- Uses recent transcript and recent chat context.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Run frontend + backend:

```bash
npm run dev
```

3. Open app:

- `http://localhost:5173`

4. In Settings:

- Paste your Groq API key
- Keep defaults or tune prompts/settings
- Save

## Production Build

```bash
npm run build
npm start
```

Server starts on `http://localhost:8787`.

## Deployment Notes

Any platform works (Vercel, Render, Replit, Netlify + server host) if both frontend and backend are deployed and `/api/*` routes are reachable by the frontend.

## Known Tradeoffs

- Uses browser `MediaRecorder` with `audio/webm` output for broad compatibility.
- Suggestion generation is refresh-based (every interval) rather than per-token transcript streaming.
- Session data is intentionally in-memory only (no persistence after reload).
