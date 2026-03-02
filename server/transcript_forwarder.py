"""Forwards transcription and LLM text as JSON messages to the client."""

import json

from pipecat.frames.frames import (
    Frame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    TextFrame,
    TranscriptionFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor


class TranscriptForwarder(FrameProcessor):
    """Intercepts STT transcriptions and LLM text, sends as JSON to client."""

    def __init__(self, transport, **kwargs):
        super().__init__(**kwargs)
        self._transport = transport
        self._assistant_text = ""

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            await self._send({"type": "user-transcript", "text": frame.text})

        elif isinstance(frame, LLMFullResponseStartFrame):
            self._assistant_text = ""

        elif isinstance(frame, TextFrame) and not isinstance(frame, TranscriptionFrame):
            self._assistant_text += frame.text

        elif isinstance(frame, LLMFullResponseEndFrame):
            if self._assistant_text.strip():
                await self._send({"type": "assistant-transcript", "text": self._assistant_text.strip()})
            self._assistant_text = ""

        await self.push_frame(frame, direction)

    async def _send(self, msg: dict):
        try:
            output = self._transport.output()
            if output._websocket:
                await output._websocket.send(json.dumps(msg))
        except Exception:
            pass
