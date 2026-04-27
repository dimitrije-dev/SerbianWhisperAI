from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main as api  # noqa: E402


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
        assert vad_filter is True
        assert beam_size == 5

        used_lang = language or "sr"
        segments = [
            DummySegment(
                start=0.0,
                end=2.8,
                text="Pacijent je primljen zbog bola u grudima.",
                words=[
                    DummyWord(0.0, 0.4, "Pacijent", 0.96),
                    DummyWord(0.4, 0.55, "je", 0.98),
                    DummyWord(0.55, 1.2, "primljen", 0.91),
                ],
            ),
            DummySegment(
                start=2.8,
                end=5.2,
                text="Uradjen je EKG i laboratorija.",
                words=[
                    DummyWord(2.8, 3.2, "Uradjen", 0.93),
                    DummyWord(3.2, 3.4, "je", 0.97),
                    DummyWord(3.4, 3.7, "EKG", 0.99),
                ],
            ),
        ]
        return segments, DummyInfo(language=used_lang, language_probability=0.97)


class FakeHTTPResponse:
    def __init__(self, status_code: int, body: dict[str, Any]) -> None:
        self.status_code = status_code
        self._body = body

    def json(self) -> dict[str, Any]:
        return self._body

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise api.requests.HTTPError(f"{self.status_code} error")


@pytest.fixture(autouse=True)
def _reset_globals() -> None:
    api.model = None


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(api, "WhisperModel", DummyWhisperModel)

    with TestClient(api.app) as test_client:
        yield test_client


def test_transcribe_serializes_segments_and_words(client: TestClient) -> None:
    response = client.post(
        "/transcribe",
        files={"file": ("sample.wav", b"RIFFFAKEAUDIO", "audio/wav")},
        data={"language": "sr", "word_timestamps": "true"},
    )

    assert response.status_code == 200
    payload = response.json()

    assert payload["detected_language"] == "sr"
    assert isinstance(payload["language_probability"], float)
    assert "Pacijent je primljen" in payload["text"]
    assert len(payload["segments"]) == 2
    assert "words" in payload["segments"][0]
    assert payload["segments"][0]["words"][0]["word"] == "Pacijent"


def test_qwen_transcript_corrections_via_chat_endpoint(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_post(url: str, json: dict[str, Any], timeout: float) -> FakeHTTPResponse:
        assert timeout == api.OLLAMA_TIMEOUT_SECONDS
        if url.endswith("/api/chat"):
            content = {
                "corrected_transcript": "Pacijent je primljen zbog bola u grudima i gusenja pri naporu.",
                "quality_notes": "Korigovan pravopis i interpunkcija.",
                "corrections": [
                    {
                        "original": "gusenja",
                        "suggested": "gusenja",
                        "reason": "bez promene",
                        "confidence": 0.2,
                    },
                    {
                        "original": "napor",
                        "suggested": "naporu",
                        "reason": "gramaticki padez",
                        "confidence": 0.91,
                    },
                ],
            }
            return FakeHTTPResponse(
                200,
                {
                    "message": {
                        "content": json_module_dumps(content),
                    }
                },
            )

        raise AssertionError(f"Unexpected URL in test: {url}")

    monkeypatch.setattr(api.requests, "post", fake_post)

    response = client.post(
        "/transcript-corrections?fallback_noop=false",
        json={
            "transcript": "Pacijent je primljen zbog bola u grudima i gusenja pri napor.",
            "detected_language": "sr",
            "max_corrections": 20,
        },
    )

    assert response.status_code == 200
    payload = response.json()

    assert payload["engine"].startswith("ollama:")
    assert "(chat)" in payload["engine"]
    assert payload["provider"] == "local-ollama"
    assert payload["corrected_transcript"].endswith("naporu.")
    assert len(payload["corrections"]) == 1
    assert payload["corrections"][0]["original"] == "napor"


def test_qwen_generate_fallback_when_chat_returns_404(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    def fake_post(url: str, json: dict[str, Any], timeout: float) -> FakeHTTPResponse:
        assert timeout == api.OLLAMA_TIMEOUT_SECONDS
        calls.append(url)

        if url.endswith("/api/chat"):
            return FakeHTTPResponse(404, {"error": "not found"})

        if url.endswith("/api/generate"):
            body = {
                "corrected_transcript": "Tekst je korektan.",
                "quality_notes": "Generate fallback uspesan.",
                "corrections": [],
            }
            return FakeHTTPResponse(200, {"response": json_module_dumps(body)})

        raise AssertionError(f"Unexpected URL in test: {url}")

    monkeypatch.setattr(api.requests, "post", fake_post)

    response = client.post(
        "/transcript-corrections?fallback_noop=false",
        json={
            "transcript": "Tekst je korektan.",
            "detected_language": "sr",
            "max_corrections": 10,
        },
    )

    assert response.status_code == 200
    payload = response.json()

    assert payload["engine"].endswith("(generate)")
    assert payload["corrected_transcript"] == "Tekst je korektan."
    assert any(call.endswith("/api/chat") for call in calls)
    assert any(call.endswith("/api/generate") for call in calls)


def test_qwen_ai_discharge_draft_after_transcription(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_post(url: str, json: dict[str, Any], timeout: float) -> FakeHTTPResponse:
        assert timeout == api.OLLAMA_TIMEOUT_SECONDS

        if url.endswith("/api/chat"):
            ai_payload = {
                "fields": {
                    "patient_name": "Petar Petrovic",
                    "patient_id": "HIS-001",
                    "department": "Interno",
                    "doctor_name": "Dr Dimitrije Milenkovic",
                    "admission_date": "2026-04-20",
                    "discharge_date": "2026-04-22",
                    "main_diagnosis": "Bol u grudima",
                    "secondary_diagnoses": "N/A",
                    "anamnesis": "Pacijent navodi bol u grudima pri naporu.",
                    "hospital_course": "Uradjen EKG i laboratorija, stanje stabilizovano.",
                    "procedures": "EKG, laboratorijske analize",
                    "therapy_during_stay": "Simptomatska terapija",
                    "therapy_on_discharge": "Nastaviti ordiniranu terapiju",
                    "recommendations": "Kontrola kod kardiologa",
                    "follow_up": "Kontrola za 7 dana",
                    "red_flags": "Javiti se hitno kod jacih bolova",
                },
                "quality_notes": "Popunjeno iz transkripta i fallback podataka.",
            }
            return FakeHTTPResponse(200, {"message": {"content": json_module_dumps(ai_payload)}})

        raise AssertionError(f"Unexpected URL in test: {url}")

    monkeypatch.setattr(api.requests, "post", fake_post)

    transcribe_response = client.post(
        "/transcribe",
        files={"file": ("clinical.wav", b"FAKEAUDIO", "audio/wav")},
        data={"language": "sr", "word_timestamps": "false"},
    )
    assert transcribe_response.status_code == 200
    transcript_payload = transcribe_response.json()

    discharge_response = client.post(
        "/discharge-draft-ai?fallback_to_rules=false",
        json={
            "transcript": transcript_payload["text"],
            "detected_language": transcript_payload["detected_language"],
            "segments": transcript_payload["segments"],
            "patient_name": "Petar Petrovic",
            "patient_id": "HIS-001",
            "doctor_name": "Dr Dimitrije Milenkovic",
            "department": "Interno",
            "admission_date": "2026-04-20",
            "discharge_date": "2026-04-22",
        },
    )

    assert discharge_response.status_code == 200
    discharge_payload = discharge_response.json()

    assert discharge_payload["engine"].startswith("ollama:")
    assert discharge_payload["provider"] == "local-ollama"
    assert discharge_payload["fields"]["patient_name"] == "Petar Petrovic"
    assert discharge_payload["fields"]["main_diagnosis"] == "Bol u grudima"
    assert "quality_notes" in discharge_payload


def json_module_dumps(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False)
