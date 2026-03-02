"""Raw WebSocket serializer for Elena.

Binary messages → InputAudioRawFrame (16-bit PCM, 16 kHz mono)
Text messages   → ignored (client JSON commands handled elsewhere)
OutputAudioRawFrame → raw bytes sent to client
OutputTransportMessage → JSON text sent to client
"""

import json

from pipecat.frames.frames import (
    Frame,
    InputAudioRawFrame,
    OutputAudioRawFrame,
    OutputTransportMessageFrame,
    OutputTransportMessageUrgentFrame,
)
from pipecat.serializers.base_serializer import FrameSerializer


class RawFrameSerializer(FrameSerializer):
    """Minimal serializer: binary ↔ audio, text ↔ JSON messages."""

    def __init__(self, sample_rate: int = 16000, **kwargs):
        super().__init__(**kwargs)
        self._sample_rate = sample_rate

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, OutputAudioRawFrame):
            return bytes(frame.audio)
        if isinstance(frame, (OutputTransportMessageFrame, OutputTransportMessageUrgentFrame)):
            if self.should_ignore_frame(frame):
                return None
            return json.dumps(frame.message)
        return None

    async def deserialize(self, data: str | bytes) -> Frame | None:
        if isinstance(data, bytes):
            return InputAudioRawFrame(
                audio=data,
                sample_rate=self._sample_rate,
                num_channels=1,
            )
        # Text messages (JSON) — not used for now
        return None
