# TwinMind - Live Suggestions

Live meeting copilot app built for the TwinMind assignment.
It captures mic audio, transcribes continuously, generates exactly 3 live suggestions per batch, and expands suggestions into detailed chat answers.

## Assignment Coverage

### Mic + transcript

- `Start/Stop mic` implemented.
- Transcript appends as rolling chunks while recording.
- Transcript auto-scrolls to newest entry.
- Current default transcript cadence is `8s` (configurable in Settings, range `3-20s`).

### Live suggestions

- Suggestions auto-refresh while recording on adaptive cadence (`15-30s` by default, configurable).
- Manual `Reload suggestions` button flushes latest audio chunk first, then regenerates suggestions.
- Each batch is enforced to exactly `3` suggestions.
- Newest batch appears at top; older batches stay visible.
- Suggestion types are mixed by context using:
  - `question_to_ask`
  - `talking_point`
  - `answer`
  - `fact_check`
  - `clarification`

### Chat panel

- Clicking a suggestion adds it to chat and requests detailed answer.
- Users can type direct questions in same continuous session chat.
- Assistant responses are streamed.

### Export

- Export button downloads full session JSON including timestamps:
  - transcript
  - every suggestion batch
  - full chat history
  - settings snapshot (API key is redacted)

### Models + API key requirements

- Groq used for all inference calls.
- Transcription default model: `whisper-large-v3`.
- Suggestions default model: `openai/gpt-oss-120b`.
- Chat default model: `openai/gpt-oss-120b`.
- User-pasted Groq API key in Settings; no hardcoded key.

### Settings requirements

- Settings modal opens via button.
- Editable prompts:
  - live suggestions prompt
  - detailed answer prompt
  - chat prompt
- Editable model + context + cadence parameters.
- Defaults are hardcoded in `src/app/defaults.js`; runtime edits are applied immediately after Save.

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Speech: Groq `whisper-large-v3`
- LLM: Groq `openai/gpt-oss-120b`

## Runtime Flow

1. Browser captures mic stream via `MediaRecorder` in short segments.
2. Client normalizes audio (WAV conversion fallback) and sends chunk to `/api/transcribe`.
3. Transcript lines are appended/stitched in UI.
4. Suggestion pipeline runs on auto/manual cadence:
   - builds context window + rolling memory + policy hints
   - calls `/api/suggestions`
   - validates strict JSON and exactly 3 suggestions
   - applies novelty and type-mix guard
5. Suggestion click or user question sends chat request to `/api/chat/stream`.
6. Export produces full session JSON.

## Key Files

```txt
api/
  health.js
  transcribe.js
  suggestions.js
  chat/
    stream.js
  _lib/
    groq.js
    http.js

server/
  app.js
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
  hooks/
    useRecorder.js
    useMeetingPipeline.js
    useChatEngine.js
  services/
    apiClient.js
    promptBuilder.js
    suggestionIntelligence.js
    exportSession.js
  components/
    transcript/
    suggestions/
    chat/
    settings/
```

## Default Parameters (Hardcoded)

Defined in `src/app/defaults.js`.

- `transcriptIntervalSec`: `8`
- `suggestionIntervalMinSec`: `15`
- `suggestionIntervalMaxSec`: `30`
- `realtimeRefreshMinGapSec`: `15`
- `suggestionContextChunks`: `4`
- `suggestionContextMaxAgeSec`: `90`
- `memoryContextChunks`: `36`
- `semanticWindowChunks`: `14`
- `semanticChangeThreshold`: `0.30`
- `noveltyHistoryBatches`: `8`

## Setup

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

## Build + Start

```bash
npm run build
npm start
```

## Deployment Notes

- Vercel single-project deployment is supported in this repo.
- Vercel uses native serverless function files under `api/*`.
- Local development keeps using Express (`server/index.js`) via Vite proxy.
- Required API paths:
  - `/api/health`
  - `/api/transcribe`
  - `/api/suggestions`
  - `/api/chat/stream`

## Known Tradeoffs

- Session state is in-memory only (no persistence across page reload).
- Suggestion generation is chunk/cadence based, not token-by-token live ASR.
- Free-tier Groq limits can throttle suggestion/chat calls during long runs; app shows rate-limit feedback and cooldown behavior.
