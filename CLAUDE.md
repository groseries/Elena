# Elena — Real-Time Russian Language Tutor

## Project Overview
Voice-first Russian conversation tutor. User speaks Russian, AI responds with natural conversation and inline grammar corrections. Target: C1+ proficiency, mostly-Russian dialogue.

## Architecture
- **Backend:** Python + Pipecat (async voice pipeline framework)
- **Frontend:** Next.js PWA (works on phone via browser)
- **Transport:** WebSocket (bidirectional audio streaming)

## Stack
- **VAD:** Silero VAD (via Pipecat)
- **STT:** faster-whisper large-v3 (NVIDIA GPU)
- **LLM:** Qwen2.5-7B-Instruct via Ollama (NVIDIA GPU)
- **TTS:** Silero TTS v5 Russian (custom Pipecat processor, CPU)
- **Frontend:** Next.js + Web Audio API + PWA

## Key Paths
- `server/main.py` — WebSocket server entry point
- `server/tutor_pipeline.py` — Pipecat pipeline definition
- `server/silero_tts.py` — Custom Silero TTS processor for Pipecat
- `server/prompts.py` — Tutor system prompts
- `client/app/page.tsx` — Voice UI
- `client/lib/audio.ts` — Audio streaming logic
- `Modelfile` — Ollama model configuration

## Guidelines
- Surgical edits over refactoring
- No unnecessary documentation files
- Keep responses conversational (2-4 sentences) in the tutor prompt
- Pipeline latency is critical — always consider impact on response time
