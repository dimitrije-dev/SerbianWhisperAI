from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

import main as api  # noqa: E402
from quality_metrics import (  # noqa: E402
    char_error_rate,
    confidence_metrics,
    speaking_rate_wpm,
    word_error_rate,
)


@dataclass
class DummyWord:
    start: float
    end: float
    word: str
    probability: float


@dataclass
class DummySegment:
    start: float
    end: float
    text: str
    words: list[DummyWord]


@dataclass
class DummyInfo:
    language: str
    language_probability: float


class DummyWhisperModel:
    def __init__(self, model_name: str, device: str, compute_type: str) -> None:
        self.model_name = model_name
        self.device = device
        self.compute_type = compute_type

    def transcribe(
        self,
        _audio_path: str,
        language: str | None = None,
        word_timestamps: bool = False,
        vad_filter: bool = True,
        beam_size: int = 5,
    ) -> tuple[list[DummySegment], DummyInfo]:
        assert word_timestamps is True
        assert vad_filter is True
        assert beam_size == 5

        segments = [
            DummySegment(
                start=0.0,
                end=3.2,
                text="Pacijent je primljen zbog bol u grudima.",
                words=[
                    DummyWord(0.00, 0.33, "Pacijent", 0.96),
                    DummyWord(0.33, 0.46, "je", 0.98),
                    DummyWord(0.46, 1.10, "primljen", 0.91),
                    DummyWord(1.10, 1.50, "zbog", 0.88),
                    DummyWord(1.50, 1.86, "bol", 0.72),
                    DummyWord(1.86, 2.00, "u", 0.95),
                    DummyWord(2.00, 2.40, "grudima", 0.93),
                ],
            ),
            DummySegment(
                start=3.2,
                end=7.0,
                text="I otezanog disanja pri naporu.",
                words=[
                    DummyWord(3.20, 3.35, "I", 0.89),
                    DummyWord(3.35, 4.10, "otezanog", 0.92),
                    DummyWord(4.10, 4.65, "disanja", 0.86),
                    DummyWord(4.65, 4.90, "pri", 0.84),
                    DummyWord(4.90, 5.50, "naporu", 0.90),
                ],
            ),
        ]
        return segments, DummyInfo(language=language or "sr", language_probability=0.97)


@pytest.fixture(autouse=True)
def _reset_model() -> None:
    api.model = None


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(api, "WhisperModel", DummyWhisperModel)
    with TestClient(api.app) as test_client:
        yield test_client


def test_transcription_kpi_metrics_are_extractable(client: TestClient) -> None:
    reference = "Pacijent je primljen zbog bola u grudima i otezanog disanja pri naporu."

    response = client.post(
        "/transcribe",
        files={"file": ("clinical.wav", b"FAKEAUDIO", "audio/wav")},
        data={"language": "sr", "word_timestamps": "true"},
    )
    assert response.status_code == 200
    payload = response.json()

    confidence = confidence_metrics(payload["segments"], low_confidence_threshold=0.8)
    duration_seconds = payload["segments"][-1]["end"] - payload["segments"][0]["start"]
    wpm = speaking_rate_wpm(payload["text"], duration_seconds)
    wer_value = word_error_rate(reference, payload["text"])
    cer_value = char_error_rate(reference, payload["text"])

    assert payload["detected_language"] == "sr"
    assert payload["language_probability"] == pytest.approx(0.97, abs=1e-9)
    assert confidence["word_count"] == pytest.approx(12.0, abs=1e-9)
    assert confidence["avg_word_probability"] == pytest.approx(0.895, abs=1e-9)
    assert confidence["min_word_probability"] == pytest.approx(0.72, abs=1e-9)
    assert confidence["low_confidence_rate"] == pytest.approx(1 / 12, abs=1e-9)
    assert duration_seconds == pytest.approx(7.0, abs=1e-9)
    assert wpm == pytest.approx(102.8571428571, rel=1e-6)
    assert wer_value == pytest.approx(1 / 12, rel=1e-6)
    assert cer_value == pytest.approx(1 / 30, rel=1e-6)
