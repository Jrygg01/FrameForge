# FrameForge

FrameForge is a full-stack playground for turning quick sketches and prompts into live HTML previews. The frontend provides a dark-mode canvas with Excalidraw plus voice and typed prompts, and the backend wraps OpenAI's responses API to transform uploaded sketches into semantic, accessible web mockups.

## Features
- Excalidraw sketch canvas with saved scene state and a centered "Generate" call-to-action.
- Three input modes: sketch, typed prompt, and voice capture (record, pause, resume, edit transcript, and playback).
- Live preview iframe that sanitizes returned HTML, CSS, and JS before rendering.
- Backend status banner so you know when the API is ready.
- Local sketch persistence to `backend/sketches` for quick reloads and basic versioning.

## Tech Stack
- Frontend: React 18 + Vite, Tailwind utility classes, MUI icon set, Excalidraw.
- Backend: Node.js 18+, Express, OpenAI SDK (Responses API).
- Tooling: npm scripts, Nodemon for backend dev reloads, DOMPurify for client-side sanitization.

## Project Structure
```
FrameForge/
|-- frontend/             # React app (Vite)
|   |-- src/App.jsx       # Canvas + prompt/preview experience
|   |-- src/main.jsx
|   `-- src/styles.css
|-- backend/              # Express API + OpenAI bridge
|   |-- src/server.js     # REST endpoints and OpenAI call
|   |-- src/sketchStore.js # Local JSON persistence for sketches
|   |-- sketches/         # Saved sketches (gitignored)
|   `-- .env.example
`-- README.md
```

## Prerequisites
- Node.js 18 or newer
- npm 9+
- OpenAI API key with access to the Responses API (for `/api/generate-ui`)

## Setup & Run
1) Install dependencies  
```bash
# Frontend
cd frontend
npm install

# Backend
cd ../backend
npm install
```

2) Configure environment  
- Copy `backend/.env.example` to `backend/.env` and set:
  - `PORT` (default: 4000)
  - `CLIENT_ORIGIN` (default: http://localhost:5173)
  - `OPENAI_API_KEY` (required for UI generation)
- Optional frontend override: set `VITE_API_URL` if the API is not on the default `http://localhost:4000`.

3) Start in development  
```bash
# Terminal 1 (backend)
cd backend
npm run dev   # nodemon on http://localhost:4000

# Terminal 2 (frontend)
cd frontend
npm run dev   # Vite on http://localhost:5173
```

4) Build/serve for production  
```bash
cd frontend
npm run build      # output to frontend/dist

cd ../backend
npm start          # runs src/server.js (ensure env vars are set)
```

## Usage Workflow
- Pick an input mode (sketch, type, speak).
- Draw in Excalidraw or add prompt context (typed or recorded).
- Click **Generate** to send the sketch (exported PNG data URL) and prompt to the backend.
- Review the sanitized HTML, CSS, and JS in the right-hand preview; regenerate as you iterate.

## API Reference (backend/src/server.js)
- `GET /api/status` - health check.
- `POST /api/generate-ui` - body: `{ image: "<data-url>", prompt?: "<text>" }`; returns `{ html, css, js, model }`.
- `POST /api/mockups` - placeholder that echoes prompt/sketch data.
- `GET /api/sketches` - list saved sketches (metadata only).
- `GET /api/sketches/:id` - retrieve a saved sketch (full scene).
- `POST /api/sketches` - body: `{ title, scene }` where `scene` matches Excalidraw's elements/appState/files shape.

Sketch files are stored as JSON under `backend/sketches/` (created on demand, ignored by git).

## Notes & Tips
- Voice capture relies on the browser's Web Speech API and MediaRecorder; use a Chromium-based browser for best results.
- The OpenAI call uses `OPENAI_RESPONSES_MODEL` and `OPENAI_RESPONSES_MAX_TOKENS` if set; defaults are defined in `src/server.js`.
- If previews stay empty, confirm the backend health banner is green and your OpenAI key is present.
