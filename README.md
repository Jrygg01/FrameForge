# FrameForge

FrameForge is an experimental design assistant that turns voice prompts and sketch inputs into interactive web mockups. This repository is structured as a full-stack playground with a React + Tailwind front-end and a Node.js + Express API backend.

## Code Origin
This code was generated using "npm create vite@latest". We then moved some files around and added more structure. Finally, we used a bit of AI to help set up the basics of the server file and API calling files.

## Tech Stack
- React 18 with Vite and Tailwind CSS for the live mockup workspace
- Node.js 18+ with Express for API orchestration and future AI integrations
- OpenAI Whisper + Chat Completions (planned) for voice transcription and design reasoning

## Project Structure
```
FrameForge/
├── frontend/      # React + Tailwind application
│   ├── src/       # Entry point and UI shells
│   └── index.html # Vite document shell
├── backend/       # Express server
│   ├── src/       # API entry point
│   └── .env.example
└── README.md
```

## Getting Started

### 1. Prerequisites
- Node.js 18 or newer
- npm 9+

### 2. Install Dependencies
```bash
# Frontend (React + Tailwind)
cd frontend
npm install

# Backend (Express API)
cd ../backend
npm install
```

### 3. Run the Apps
```bash
# Frontend: starts Vite dev server on http://localhost:5173
cd frontend
npm run dev

# Backend: starts Express API on http://localhost:4000
cd backend
npm run dev
```

### 4. Configure Environment Variables
Copy `backend/.env.example` to `backend/.env` and update it with your local values. At minimum set `OPENAI_API_KEY`. You can also override `OPENAI_RESPONSES_MODEL` or raise `OPENAI_RESPONSES_MAX_TOKENS` if a model runs out of output tokens.

### 5. Generate HTML Mockups
With both servers running and the API key configured, sketch on the left canvas and press **Generate**. The frontend captures the drawing, the backend sends it to the OpenAI Responses API (including the sketch image), and the returned HTML/CSS is rendered in the right-hand preview pane.

## Next Steps
- Implement real voice transcription through Whisper
- Iterate on the prompting and post-processing used for HTML generation
- Capture version history for generated previews

FrameForge is currently a skeleton meant to help the team align on architecture. Build upon this foundation by layering the interactive canvas, voice command handling, and AI-driven mockup generation.*** End Patch
