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
        self.variant = "turbo" if "turbo" in model_name.lower() else "small"

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

        if self.variant == "turbo":
            segments = [
                DummySegment(
                    start=0.0,
                    end=3.2,
                    text="Pacijent je primljen zbog bola u grudima i",
                    words=[
                        DummyWord(0.00, 0.30, "Pacijent", 0.98),
                        DummyWord(0.30, 0.42, "je", 0.99),
                        DummyWord(0.42, 1.05, "primljen", 0.96),
                        DummyWord(1.05, 1.40, "zbog", 0.94),
                        DummyWord(1.40, 1.78, "bola", 0.92),
                        DummyWord(1.78, 1.92, "u", 0.97),
                        DummyWord(1.92, 2.33, "grudima", 0.95),
                        DummyWord(2.33, 2.46, "i", 0.93),
                    ],
                ),
                DummySegment(
                    start=3.2,
                    end=7.0,
                    text="otezanog disanja pri naporu.",
                    words=[
                        DummyWord(3.20, 3.92, "otezanog", 0.94),
                        DummyWord(3.92, 4.52, "disanja", 0.92),
                        DummyWord(4.52, 4.78, "pri", 0.93),
                        DummyWord(4.78, 5.42, "naporu", 0.94),
                    ],
                ),
            ]
        else:
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
    api.models = {}
    api.model_load_errors = {}


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


def test_transcription_kpi_metrics_turbo_model(client: TestClient) -> None:
    response = client.post(
        "/transcribe",
        files={"file": ("clinical.wav", b"FAKEAUDIO", "audio/wav")},
        data={"language": "sr", "word_timestamps": "true", "transcription_model": "turbo"},
    )
    assert response.status_code == 200
    payload = response.json()

    confidence = confidence_metrics(payload["segments"], low_confidence_threshold=0.8)

    assert payload["model_used"] == "turbo"
    assert "turbo" in payload["model_name"]
    assert payload["detected_language"] == "sr"
    assert confidence["word_count"] == pytest.approx(12.0, abs=1e-9)
    assert confidence["avg_word_probability"] == pytest.approx(0.9475, abs=1e-9)
    assert confidence["min_word_probability"] == pytest.approx(0.92, abs=1e-9)
    assert confidence["low_confidence_rate"] == pytest.approx(0.0, abs=1e-9)


def test_small_vs_turbo_comparison_metrics(client: TestClient) -> None:
    reference = "Pacijent je primljen zbog bola u grudima i otezanog disanja pri naporu."

    small_response = client.post(
        "/transcribe",
        files={"file": ("clinical.wav", b"FAKEAUDIO", "audio/wav")},
        data={"language": "sr", "word_timestamps": "true", "transcription_model": "small"},
    )
    turbo_response = client.post(
        "/transcribe",
        files={"file": ("clinical.wav", b"FAKEAUDIO", "audio/wav")},
        data={"language": "sr", "word_timestamps": "true", "transcription_model": "turbo"},
    )

    assert small_response.status_code == 200
    assert turbo_response.status_code == 200

    small_payload = small_response.json()
    turbo_payload = turbo_response.json()

    small_confidence = confidence_metrics(small_payload["segments"], low_confidence_threshold=0.8)
    turbo_confidence = confidence_metrics(turbo_payload["segments"], low_confidence_threshold=0.8)

    small_wer = word_error_rate(reference, small_payload["text"])
    turbo_wer = word_error_rate(reference, turbo_payload["text"])
    small_cer = char_error_rate(reference, small_payload["text"])
    turbo_cer = char_error_rate(reference, turbo_payload["text"])

    assert small_payload["model_used"] == "small"
    assert turbo_payload["model_used"] == "turbo"
    assert turbo_wer < small_wer
    assert turbo_cer < small_cer
    assert turbo_confidence["avg_word_probability"] > small_confidence["avg_word_probability"]
    assert turbo_confidence["low_confidence_rate"] < small_confidence["low_confidence_rate"]
