"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ElenaAudioClient, TutorState, ConnectionState } from "@/lib/audio";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
}

// Auto-upgrade ws:// → wss:// when page is served over HTTPS
function getServerUrl() {
  const url = process.env.NEXT_PUBLIC_SERVER_URL ?? "ws://localhost:8765";
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return url.replace(/^ws:\/\//, "wss://");
  }
  return url;
}
const SERVER_URL = getServerUrl();

// ── State → UI helpers ───────────────────────────────────────────────────────

function stateLabel(s: TutorState, conn: ConnectionState): string {
  if (conn === "connecting") return "Подключаемся...";
  if (conn === "disconnected" || conn === "error") return "Нажми, чтобы начать";
  switch (s) {
    case "listening":   return "Слушаю...";
    case "processing":  return "Думаю...";
    case "speaking":    return "Говорит Елена";
    default:            return "Готово";
  }
}

function buttonColors(s: TutorState, conn: ConnectionState) {
  if (conn !== "connected") return { ring: "#333", bg: "#1a1a1a", shadow: "none" };
  switch (s) {
    case "listening":
      return { ring: "var(--accent)", bg: "#2a0a0d", shadow: "0 0 40px var(--accent-glow)" };
    case "speaking":
      return { ring: "var(--blue)", bg: "#0a1528", shadow: "0 0 40px var(--blue-glow)" };
    case "processing":
      return { ring: "var(--green)", bg: "#0a1a10", shadow: "0 0 30px rgba(46,204,113,0.2)" };
    default:
      return { ring: "#444", bg: "#1a1a1a", shadow: "none" };
  }
}

// ── Waveform bars (visible when AI speaking) ─────────────────────────────────

function Waveform() {
  return (
    <div className="flex items-center gap-1 h-8">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="wave-bar w-1 rounded-full bg-blue-400 opacity-80"
        />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Home() {
  const [tutorState, setTutorState] = useState<TutorState>("idle");
  const [connState, setConnState] = useState<ConnectionState>("disconnected");
  const [messages, setMessages] = useState<Message[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(true);

  const clientRef = useRef<ElenaAudioClient | null>(null);
  const msgIdRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const addMessage = useCallback((text: string, role: "user" | "assistant") => {
    setMessages((prev) => {
      // Append to last assistant message if streaming
      const last = prev[prev.length - 1];
      if (last && last.role === role && role === "assistant") {
        return prev.slice(0, -1).concat({ ...last, text: last.text + " " + text });
      }
      return prev.concat({ id: ++msgIdRef.current, role, text });
    });
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const connect = useCallback(() => {
    if (clientRef.current) return;
    const client = new ElenaAudioClient(SERVER_URL, {
      onStateChange: setTutorState,
      onConnectionChange: setConnState,
      onTranscript: addMessage,
      onError: (msg) => {
        setErrorMsg(msg);
        setTimeout(() => setErrorMsg(null), 4000);
      },
    });
    clientRef.current = client;
    client.connect();
  }, [addMessage]);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setMessages([]);
  }, []);

  // Main button: connect if idle, interrupt if AI is speaking
  const handleMainButton = useCallback(() => {
    if (connState === "disconnected" || connState === "error") {
      connect();
    } else if (tutorState === "speaking") {
      clientRef.current?.interrupt();
    }
  }, [connState, tutorState, connect]);

  const colors = buttonColors(tutorState, connState);
  const isListening = connState === "connected" && tutorState === "listening";
  const isSpeaking = connState === "connected" && tutorState === "speaking";

  return (
    <div className="flex flex-col h-screen w-screen" style={{ background: "var(--bg)" }}>

      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div>
          <h1 className="text-lg font-semibold" style={{ color: "var(--text)" }}>Елена</h1>
          <p className="text-xs" style={{ color: "var(--muted)" }}>Russian Tutor</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className="text-xs px-3 py-1 rounded-full border transition-colors"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            {showTranscript ? "скрыть текст" : "показать текст"}
          </button>
          {connState === "connected" && (
            <button
              onClick={disconnect}
              className="text-xs px-3 py-1 rounded-full border transition-colors"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
            >
              завершить
            </button>
          )}
        </div>
      </div>

      {/* Transcript */}
      {showTranscript && (
        <div
          ref={transcriptRef}
          className="flex-1 overflow-y-auto px-4 py-3 transcript-area"
          style={{ minHeight: 0 }}
        >
          {messages.length === 0 && connState === "connected" && (
            <p className="text-center text-sm mt-8" style={{ color: "var(--muted)" }}>
              Разговор начнётся автоматически...
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`mb-3 max-w-xs ${m.role === "user" ? "ml-auto text-right" : "mr-auto"}`}
            >
              <div
                className="inline-block px-3 py-2 text-sm leading-relaxed"
                style={{
                  background: m.role === "user" ? "var(--accent)" : "var(--surface)",
                  color: "var(--text)",
                  borderRadius:
                    m.role === "user"
                      ? "18px 18px 4px 18px"
                      : "18px 18px 18px 4px",
                }}
              >
                {/* Highlight inline corrections: (правильно: ...) */}
                {m.text.split(/(\([^)]+\))/).map((part, i) =>
                  part.startsWith("(") ? (
                    <span key={i} style={{ color: "#ffd166", fontStyle: "italic" }}>
                      {part}
                    </span>
                  ) : (
                    <span key={i}>{part}</span>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!showTranscript && <div className="flex-1" />}

      {/* Error toast */}
      {errorMsg && (
        <div
          className="mx-4 mb-2 px-4 py-2 rounded-xl text-sm text-center"
          style={{ background: "#3a0a0a", color: "#ff6b6b" }}
        >
          {errorMsg}
        </div>
      )}

      {/* Voice button area */}
      <div className="flex flex-col items-center pb-12 pt-6 gap-4">
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {stateLabel(tutorState, connState)}
        </p>

        <div style={{ height: 32, opacity: isSpeaking ? 1 : 0, transition: "opacity 0.3s" }}>
          <Waveform />
        </div>

        {/* Orb button */}
        <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
          {(isListening || isSpeaking) && (
            <div
              className={`absolute inset-0 rounded-full ${isListening ? "ring-listening" : "ring-speaking"}`}
              style={{
                background: "transparent",
                border: `2px solid ${colors.ring}`,
                opacity: 0.5,
              }}
            />
          )}
          <button
            onPointerDown={handleMainButton}
            className="relative flex items-center justify-center rounded-full transition-all duration-300 active:scale-95"
            style={{
              width: 120,
              height: 120,
              background: colors.bg,
              boxShadow: colors.shadow,
              border: `2px solid ${colors.ring}`,
              outline: "none",
              cursor: "pointer",
            }}
            aria-label="Voice button"
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke={isListening ? "var(--accent)" : isSpeaking ? "var(--blue)" : "var(--muted)"}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transition: "stroke 0.3s" }}
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </button>
        </div>

        {isSpeaking && (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Нажми, чтобы перебить
          </p>
        )}
      </div>
    </div>
  );
}
