// Audio streaming module for Elena voice tutor.
// Handles: MediaRecorder capture → WebSocket → AudioContext playback
// with interruption support (speaking while AI talks stops AI audio).

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";
export type TutorState = "idle" | "listening" | "processing" | "speaking";

export interface ElenaAudioCallbacks {
  onStateChange: (state: TutorState) => void;
  onConnectionChange: (state: ConnectionState) => void;
  onTranscript: (text: string, role: "user" | "assistant") => void;
  onError: (message: string) => void;
}

const SAMPLE_RATE = 16000;
const CHUNK_MS = 40; // send audio every 40ms

export class ElenaAudioClient {
  private ws: WebSocket | null = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private outputContext: AudioContext | null = null;

  // Playback queue for gapless audio
  private playbackQueue: AudioBuffer[] = [];
  private playbackNextTime = 0;
  private currentSource: AudioBufferSourceNode | null = null;
  private isPlayingAudio = false;

  private state: TutorState = "idle";
  private connectionState: ConnectionState = "disconnected";
  private callbacks: ElenaAudioCallbacks;
  private serverUrl: string;

  constructor(serverUrl: string, callbacks: ElenaAudioCallbacks) {
    this.serverUrl = serverUrl;
    this.callbacks = callbacks;
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.setConnection("connecting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Microphone not available. Use localhost or HTTPS — plain HTTP on a phone blocks mic access."
        );
      }
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      this.outputContext = new AudioContext({ sampleRate: 24000 });

      this.ws = new WebSocket(this.serverUrl);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.setConnection("connected");
        this.startCapture();
      };

      this.ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          this.handleTextMessage(event.data);
        } else {
          this.handleAudioChunk(event.data as ArrayBuffer);
        }
      };

      this.ws.onerror = () => {
        this.callbacks.onError("WebSocket error");
        this.setConnection("error");
      };

      this.ws.onclose = () => {
        this.setConnection("disconnected");
        this.setState("idle");
        this.stopCapture();
      };
    } catch (e) {
      this.callbacks.onError(`Failed to connect: ${e}`);
      this.setConnection("error");
    }
  }

  disconnect(): void {
    this.stopCapture();
    this.stopPlayback();
    this.ws?.close();
    this.ws = null;
    this.audioContext?.close();
    this.outputContext?.close();
    this.audioContext = null;
    this.outputContext = null;
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    this.mediaStream = null;
    this.setConnection("disconnected");
    this.setState("idle");
  }

  // ── Audio capture → WebSocket ──────────────────────────────────────────────

  private startCapture(): void {
    if (!this.audioContext || !this.mediaStream) return;

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    // ScriptProcessorNode gives us raw PCM access (deprecated but still works in all browsers)
    this.processor = this.audioContext.createScriptProcessor(1024, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      const float32 = e.inputBuffer.getChannelData(0);
      // Convert Float32 to Int16 PCM
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.ws.send(int16.buffer);
    };

    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
    this.setState("listening");
  }

  private stopCapture(): void {
    this.processor?.disconnect();
    this.processor = null;
  }

  // ── WebSocket messages ─────────────────────────────────────────────────────

  private handleTextMessage(data: string): void {
    try {
      const msg = JSON.parse(data);
      if (msg.type === "user-transcript") {
        this.callbacks.onTranscript(msg.text, "user");
        this.setState("processing");
      } else if (msg.type === "assistant-transcript") {
        this.callbacks.onTranscript(msg.text, "assistant");
      } else if (msg.type === "bot-started-speaking") {
        this.setState("speaking");
      } else if (msg.type === "bot-stopped-speaking") {
        if (this.state === "speaking") this.setState("listening");
      }
    } catch {
      // not JSON, ignore
    }
  }

  private handleAudioChunk(buffer: ArrayBuffer): void {
    if (!this.outputContext) return;
    this.setState("speaking");

    // Decode Int16 PCM to AudioBuffer
    const int16 = new Int16Array(buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const audioBuffer = this.outputContext.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);
    this.schedulePlayback(audioBuffer);
  }

  // ── Gapless audio playback ─────────────────────────────────────────────────

  private schedulePlayback(buffer: AudioBuffer): void {
    if (!this.outputContext) return;

    const source = this.outputContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputContext.destination);

    const now = this.outputContext.currentTime;
    const startAt = Math.max(this.playbackNextTime, now);
    source.start(startAt);

    this.playbackNextTime = startAt + buffer.duration;
    this.currentSource = source;
    this.isPlayingAudio = true;

    source.onended = () => {
      // If nothing else is scheduled soon, we've stopped speaking
      if (
        this.outputContext &&
        this.playbackNextTime <= this.outputContext.currentTime + 0.05
      ) {
        this.isPlayingAudio = false;
        if (this.state === "speaking") this.setState("listening");
      }
    };
  }

  stopPlayback(): void {
    try {
      this.currentSource?.stop();
    } catch {
      // already stopped
    }
    this.currentSource = null;
    this.playbackNextTime = 0;
    this.isPlayingAudio = false;
  }

  // Signal server to interrupt the current response
  interrupt(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "interrupt" }));
    }
    this.stopPlayback();
    this.setState("listening");
  }

  // ── State helpers ──────────────────────────────────────────────────────────

  private setState(s: TutorState): void {
    if (this.state !== s) {
      this.state = s;
      this.callbacks.onStateChange(s);
    }
  }

  private setConnection(s: ConnectionState): void {
    if (this.connectionState !== s) {
      this.connectionState = s;
      this.callbacks.onConnectionChange(s);
    }
  }

  get currentState(): TutorState {
    return this.state;
  }

  get isConnected(): boolean {
    return this.connectionState === "connected";
  }
}
