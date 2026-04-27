import os
import json
import re
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from pydantic import BaseModel, Field


MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
MODEL_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
MODEL_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b-instruct")
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "90"))
OLLAMA_ENABLED = os.getenv("OLLAMA_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}

DISCHARGE_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "fields": {
            "type": "object",
            "properties": {
                "patient_name": {"type": "string"},
                "patient_id": {"type": "string"},
                "department": {"type": "string"},
                "doctor_name": {"type": "string"},
                "admission_date": {"type": "string"},
                "discharge_date": {"type": "string"},
                "main_diagnosis": {"type": "string"},
                "secondary_diagnoses": {"type": "string"},
                "anamnesis": {"type": "string"},
                "hospital_course": {"type": "string"},
                "procedures": {"type": "string"},
                "therapy_during_stay": {"type": "string"},
                "therapy_on_discharge": {"type": "string"},
                "recommendations": {"type": "string"},
                "follow_up": {"type": "string"},
                "red_flags": {"type": "string"},
            },
            "required": [
                "patient_name",
                "patient_id",
                "department",
                "doctor_name",
                "admission_date",
                "discharge_date",
                "main_diagnosis",
                "secondary_diagnoses",
                "anamnesis",
                "hospital_course",
                "procedures",
                "therapy_during_stay",
                "therapy_on_discharge",
                "recommendations",
                "follow_up",
                "red_flags",
            ],
            "additionalProperties": False,
        },
        "quality_notes": {"type": "string"},
    },
    "required": ["fields", "quality_notes"],
    "additionalProperties": False,
}

TRANSCRIPT_CORRECTION_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "corrected_transcript": {"type": "string"},
        "quality_notes": {"type": "string"},
        "corrections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "original": {"type": "string"},
                    "suggested": {"type": "string"},
                    "reason": {"type": "string"},
                    "confidence": {"type": "number"},
                },
                "required": ["original", "suggested", "reason", "confidence"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["corrected_transcript", "corrections", "quality_notes"],
    "additionalProperties": False,
}

app = FastAPI(title="Faster Whisper API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

model: Optional[WhisperModel] = None

MIME_SUFFIX_MAP = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
}

SECTION_KEYWORDS = {
    "main_diagnosis": ["dijagnoza", "dg", "diagnoza", "dx", "otpustna dijagnoza"],
    "secondary_diagnoses": ["pridruz", "komorbid", "hronic", "ranije bolesti"],
    "anamnesis": ["anamneza", "tegobe", "razlog prijema", "javio se", "simptom"],
    "hospital_course": ["tok", "hospitaliz", "u toku lecenja", "tok lecenja"],
    "procedures": ["uradjen", "uradjena", "intervencija", "procedura", "analiza", "pregled"],
    "therapy_during_stay": ["terapija", "lek", "lijek", "infuz", "antibiotik", "mg"],
    "therapy_on_discharge": ["otpustu", "otpusna terapija", "nastaviti", "prepisana terapija"],
    "recommendations": ["preporuka", "saveti", "rezim", "izbegavati", "nastaviti"],
    "follow_up": ["kontrola", "zakazati", "za", "dana", "nedelj", "mesec"],
    "red_flags": ["hitno", "odmah", "krvarenje", "bol", "temperatur", "dispne", "pogorsanje"],
}

DISCHARGE_FIELD_KEYS = [
    "patient_name",
    "patient_id",
    "department",
    "doctor_name",
    "admission_date",
    "discharge_date",
    "main_diagnosis",
    "secondary_diagnoses",
    "anamnesis",
    "hospital_course",
    "procedures",
    "therapy_during_stay",
    "therapy_on_discharge",
    "recommendations",
    "follow_up",
    "red_flags",
]


class SegmentInput(BaseModel):
    start: float = 0.0
    end: float = 0.0
    text: str = ""


class WordInput(BaseModel):
    start: float = 0.0
    end: float = 0.0
    word: str = ""
    probability: Optional[float] = None


class TranscriptSegmentInput(BaseModel):
    start: float = 0.0
    end: float = 0.0
    text: str = ""
    words: list[WordInput] = Field(default_factory=list)


class DischargeDraftRequest(BaseModel):
    transcript: str = Field(..., min_length=1)
    detected_language: Optional[str] = None
    segments: list[SegmentInput] = Field(default_factory=list)
    patient_name: Optional[str] = None
    patient_id: Optional[str] = None
    doctor_name: Optional[str] = None
    department: Optional[str] = None
    admission_date: Optional[str] = None
    discharge_date: Optional[str] = None


class TranscriptCorrectionRequest(BaseModel):
    transcript: str = Field(..., min_length=1)
    detected_language: Optional[str] = None
    segments: list[TranscriptSegmentInput] = Field(default_factory=list)
    max_corrections: int = Field(default=20, ge=1, le=80)


def _normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _chunk_words(text: str, words_per_chunk: int = 20, max_chunks: int = 10) -> list[str]:
    words = _normalize_space(text).split()
    chunks: list[str] = []
    for i in range(0, len(words), words_per_chunk):
        chunk = " ".join(words[i : i + words_per_chunk]).strip()
        if chunk:
            chunks.append(chunk)
        if len(chunks) >= max_chunks:
            break
    return chunks


def _split_units(text: str) -> list[str]:
    clean = _normalize_space(text)
    if not clean:
        return []

    parts = [part.strip() for part in re.split(r"(?<=[.!?])\s+", clean) if part.strip()]
    if len(parts) > 1:
        return parts

    return _chunk_words(clean)


def _pick_by_keywords(units: list[str], keywords: list[str], limit: int = 2) -> list[str]:
    if not units:
        return []
    lowered_keywords = [k.lower() for k in keywords]
    picked = [unit for unit in units if any(k in unit.lower() for k in lowered_keywords)]
    return picked[:limit]


def _join_or_default(values: list[str], fallback: str) -> str:
    merged = " ".join(_normalize_space(value) for value in values if _normalize_space(value))
    return merged if merged else fallback


def _extract_json_payload(raw_text: str) -> dict[str, Any]:
    if not raw_text:
        raise ValueError("Empty LLM response.")

    safe = raw_text.strip()
    parse_errors: list[str] = []

    def _try_parse(candidate: str) -> Optional[dict[str, Any]]:
        if not candidate:
            return None
        for variant in (candidate, _cleanup_json_candidate(candidate)):
            try:
                parsed = json.loads(variant)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError as exc:
                parse_errors.append(str(exc))
        return None

    direct = _try_parse(safe)
    if direct is not None:
        return direct

    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", safe, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        fenced_parsed = _try_parse(fenced.group(1))
        if fenced_parsed is not None:
            return fenced_parsed

    braced = _extract_first_balanced_object(safe)
    if braced:
        braced_parsed = _try_parse(braced)
        if braced_parsed is not None:
            return braced_parsed

    if parse_errors:
        raise ValueError(parse_errors[-1])
    raise ValueError("Could not parse JSON object from LLM response.")


def _extract_first_balanced_object(text: str) -> str:
    if not text:
        return ""

    start = text.find("{")
    if start < 0:
        return ""

    depth = 0
    in_string = False
    escape = False
    for idx in range(start, len(text)):
        char = text[idx]
        if in_string:
            if escape:
                escape = False
                continue
            if char == "\\":
                escape = True
                continue
            if char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue
        if char == "{":
            depth += 1
            continue
        if char == "}":
            depth -= 1
            if depth == 0:
                return text[start : idx + 1]

    end = text.rfind("}")
    if end > start:
        return text[start : end + 1]
    return ""


def _insert_missing_commas_between_pairs(candidate: str) -> str:
    lines = candidate.splitlines()
    if len(lines) < 2:
        return candidate

    updated = list(lines)
    for idx in range(len(updated) - 1):
        current = updated[idx].rstrip()
        nxt = updated[idx + 1].lstrip()

        if not current or not nxt:
            continue

        # If next line starts a new key and current looks like a finished value pair, add comma.
        if re.match(r'^"[^"]+"\s*:', nxt):
            if re.search(r'"\s*:\s*', current):
                if not current.endswith((",", "{", "[", ":")):
                    updated[idx] = f"{current},"

    return "\n".join(updated)


def _cleanup_json_candidate(candidate: str) -> str:
    cleaned = (candidate or "").strip()
    if not cleaned:
        return cleaned

    cleaned = cleaned.replace("\u201c", '"').replace("\u201d", '"')
    cleaned = cleaned.replace("\u2018", "'").replace("\u2019", "'")
    cleaned = cleaned.replace("\ufeff", "")
    cleaned = re.sub(r",(\s*[}\]])", r"\1", cleaned)
    cleaned = re.sub(r"\bNaN\b", "0", cleaned)
    cleaned = re.sub(r"\bInfinity\b", "0", cleaned)
    cleaned = re.sub(r"\b-Infinity\b", "0", cleaned)
    cleaned = _insert_missing_commas_between_pairs(cleaned)
    return cleaned


def _ollama_json_completion(
    system_prompt: str,
    user_prompt: str,
    num_predict: int = 1200,
    response_format: Any = "json",
) -> tuple[str, str]:
    formats_to_try = [response_format]
    if response_format != "json":
        formats_to_try.append("json")

    last_error: Optional[Exception] = None

    for active_format in formats_to_try:
        api_variant = "chat"
        chat_response = requests.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "stream": False,
                "format": active_format,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "options": {"temperature": 0.1, "num_predict": num_predict},
            },
            timeout=OLLAMA_TIMEOUT_SECONDS,
        )

        if chat_response.status_code == 404:
            # Compatibility fallback for installations exposing only /api/generate.
            api_variant = "generate"
            generate_response = requests.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "system": system_prompt,
                    "prompt": user_prompt,
                    "stream": False,
                    "format": active_format,
                    "options": {"temperature": 0.1, "num_predict": num_predict},
                },
                timeout=OLLAMA_TIMEOUT_SECONDS,
            )

            if generate_response.status_code >= 400:
                # Some setups may reject schema format; retry with plain json mode.
                if generate_response.status_code == 400 and active_format != "json":
                    last_error = requests.HTTPError(f"400 from /api/generate with schema format: {active_format}")
                    continue
                generate_response.raise_for_status()

            generate_body = generate_response.json()
            return generate_body.get("response", ""), api_variant

        if chat_response.status_code >= 400:
            if chat_response.status_code == 400 and active_format != "json":
                last_error = requests.HTTPError(f"400 from /api/chat with schema format: {active_format}")
                continue
            chat_response.raise_for_status()

        chat_body = chat_response.json()
        return chat_body.get("message", {}).get("content", ""), api_variant

    if last_error:
        raise last_error
    raise RuntimeError("Ollama completion failed without explicit error.")


def _repair_json_with_ollama(raw_text: str, num_predict: int = 1000) -> dict[str, Any]:
    repair_system_prompt = (
        "You are a strict JSON repair assistant. "
        "Return only valid JSON object. Keep original keys and values whenever possible."
    )
    repair_user_prompt = (
        "Popravi JSON da bude striktno validan. "
        "Nemoj dodavati uvod ili objasnjenje, vrati samo JSON objekat.\n\n"
        f"Malformed JSON input:\n{raw_text}"
    )

    repaired_content, _ = _ollama_json_completion(
        system_prompt=repair_system_prompt,
        user_prompt=repair_user_prompt,
        num_predict=num_predict,
    )
    return _extract_json_payload(repaired_content)


def _parse_llm_json_with_repair(raw_text: str, num_predict: int = 1000) -> dict[str, Any]:
    try:
        return _extract_json_payload(raw_text)
    except ValueError as first_error:
        try:
            return _repair_json_with_ollama(raw_text, num_predict=num_predict)
        except Exception as second_error:
            raise ValueError(f"{first_error} | repair_failed: {second_error}") from second_error


def _normalize_discharge_fields(raw_fields: dict[str, Any], fallback_fields: dict[str, Any]) -> dict[str, str]:
    output: dict[str, str] = {}
    for key in DISCHARGE_FIELD_KEYS:
        candidate = raw_fields.get(key)
        if isinstance(candidate, (list, tuple)):
            candidate = "; ".join(str(item) for item in candidate if str(item).strip())
        if candidate is None:
            candidate = ""
        clean_value = _normalize_space(str(candidate))
        if not clean_value:
            clean_value = _normalize_space(str(fallback_fields.get(key, "")))
        output[key] = clean_value
    return output


def _build_ollama_prompt(payload: DischargeDraftRequest, fallback_fields: dict[str, str]) -> str:
    transcript = _normalize_space(payload.transcript)
    segments = payload.segments[:30] if payload.segments else []
    compact_segments = [
        {
            "index": index + 1,
            "start": round(segment.start, 2),
            "end": round(segment.end, 2),
            "text": _normalize_space(segment.text)[:500],
        }
        for index, segment in enumerate(segments)
        if _normalize_space(segment.text)
    ]

    return (
        "Zadatak: pretvori medicinski transkript u uredjen draft otpusne liste.\n"
        "Vazno:\n"
        "- Vrati ISKLJUCIVO validan JSON objekat.\n"
        "- Ne izmisljaj cinjenice koje ne postoje u transkriptu.\n"
        "- Jezik izlaza neka bude isti kao jezik transkripta (sr/hr/bs ako je transkript takav).\n"
        "- Ispravi ocigledne greske u pisanju i interpunkciji.\n"
        "- Ako nema dovoljno podataka za polje, ostavi fallback vrednost.\n\n"
        "Obavezan JSON schema:\n"
        "{\n"
        '  "fields": {\n'
        '    "patient_name": "...",\n'
        '    "patient_id": "...",\n'
        '    "department": "...",\n'
        '    "doctor_name": "...",\n'
        '    "admission_date": "...",\n'
        '    "discharge_date": "...",\n'
        '    "main_diagnosis": "...",\n'
        '    "secondary_diagnoses": "...",\n'
        '    "anamnesis": "...",\n'
        '    "hospital_course": "...",\n'
        '    "procedures": "...",\n'
        '    "therapy_during_stay": "...",\n'
        '    "therapy_on_discharge": "...",\n'
        '    "recommendations": "...",\n'
        '    "follow_up": "...",\n'
        '    "red_flags": "..."\n'
        "  },\n"
        '  "quality_notes": "kratka napomena sta je automatski popunjeno"\n'
        "}\n\n"
        f"Fallback fields (koristi ako nema informacija):\n{json.dumps(fallback_fields, ensure_ascii=False, indent=2)}\n\n"
        f"Detected language: {payload.detected_language or 'auto'}\n\n"
        f"Transcript:\n{transcript}\n\n"
        f"Segmenti (opcioni kontekst):\n{json.dumps(compact_segments, ensure_ascii=False)}"
    )


def _collect_low_confidence_words(
    segments: list[TranscriptSegmentInput],
    threshold: float = 0.76,
    limit: int = 70,
) -> list[dict[str, Any]]:
    if not segments:
        return []

    candidates: list[dict[str, Any]] = []
    for segment in segments:
        for word in segment.words or []:
            probability = float(word.probability) if word.probability is not None else 1.0
            normalized_word = _normalize_space(word.word)
            if not normalized_word:
                continue
            if probability <= threshold:
                candidates.append(
                    {
                        "word": normalized_word,
                        "probability": round(probability, 3),
                        "start": round(word.start or 0.0, 2),
                        "end": round(word.end or 0.0, 2),
                        "segment_text": _normalize_space(segment.text)[:220],
                    }
                )
            if len(candidates) >= limit:
                return candidates
    return candidates


def _build_transcript_correction_prompt(payload: TranscriptCorrectionRequest) -> str:
    transcript = _normalize_space(payload.transcript)
    low_conf_words = _collect_low_confidence_words(payload.segments)

    return (
        "Zadatak: uradi laganu medicinsku korekciju transkripta.\n"
        "Pravila:\n"
        "- Ispravi samo reci/frasze koje su ocigledno pogresne ili nelogicne u kontekstu.\n"
        "- Ne menjaj medicinske cinjenice i ne dodaj nove informacije.\n"
        "- Ako nisi siguran, ostavi original.\n"
        "- Fokus na pravopis, interpunkciju i ASR greske slicnih reci.\n"
        "- Jezik izlaza zadrzi isti kao jezik ulaza.\n\n"
        "Vrati ISKLJUCIVO validan JSON:\n"
        "{\n"
        '  "corrected_transcript": "....",\n'
        '  "corrections": [\n'
        "    {\n"
        '      "original": "...",\n'
        '      "suggested": "...",\n'
        '      "reason": "kratko objasnjenje",\n'
        '      "confidence": 0.0\n'
        "    }\n"
        "  ],\n"
        '  "quality_notes": "kratka napomena"\n'
        "}\n\n"
        f"Detected language: {payload.detected_language or 'auto'}\n"
        f"Max corrections: {payload.max_corrections}\n\n"
        f"Transcript:\n{transcript}\n\n"
        f"Words with low confidence (opcioni trag):\n{json.dumps(low_conf_words, ensure_ascii=False)}"
    )


def _normalize_correction_items(items: Any, max_corrections: int) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []

    normalized: list[dict[str, Any]] = []
    for raw in items:
        if not isinstance(raw, dict):
            continue

        original = _normalize_space(str(raw.get("original", "")))
        suggested = _normalize_space(str(raw.get("suggested", "")))
        reason = _normalize_space(str(raw.get("reason", "")))

        try:
            confidence = float(raw.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = max(0.0, min(1.0, confidence))

        if not original or not suggested:
            continue
        if original.lower() == suggested.lower():
            continue

        normalized.append(
            {
                "original": original,
                "suggested": suggested,
                "reason": reason,
                "confidence": confidence,
            }
        )
        if len(normalized) >= max_corrections:
            break

    return normalized


def _build_ai_transcript_corrections(payload: TranscriptCorrectionRequest) -> dict[str, Any]:
    if not OLLAMA_ENABLED:
        raise RuntimeError("Ollama integration is disabled by environment.")

    transcript = _normalize_space(payload.transcript)
    prompt = _build_transcript_correction_prompt(payload)
    system_prompt = (
        "You are an assistant for clinical transcript proofreading. "
        "Return valid JSON only."
    )

    message_content, api_variant = _ollama_json_completion(
        system_prompt=system_prompt,
        user_prompt=prompt,
        num_predict=1100,
        response_format=TRANSCRIPT_CORRECTION_JSON_SCHEMA,
    )

    parsed = _parse_llm_json_with_repair(message_content, num_predict=1200)
    corrected_transcript = _normalize_space(str(parsed.get("corrected_transcript", ""))) or transcript
    corrections = _normalize_correction_items(parsed.get("corrections"), payload.max_corrections)
    quality_notes = _normalize_space(str(parsed.get("quality_notes", "")))

    return {
        "engine": f"ollama:{OLLAMA_MODEL}({api_variant})",
        "provider": "local-ollama",
        "detected_language": payload.detected_language or "auto",
        "original_transcript": transcript,
        "corrected_transcript": corrected_transcript,
        "corrections": corrections,
        "quality_notes": quality_notes,
    }


def _extract_medication_mentions(text: str) -> list[str]:
    pattern = re.compile(
        r"\b([A-Za-zŠĐČĆŽšđčćž][A-Za-z0-9ŠĐČĆŽšđčćž\-]{2,}(?:\s+[A-Za-z0-9ŠĐČĆŽšđčćž\-]{2,}){0,2}\s+\d+\s?(?:mg|mcg|g|ml))\b",
        flags=re.IGNORECASE,
    )
    found = []
    seen = set()
    for match in pattern.findall(text or ""):
        normalized = _normalize_space(match)
        key = normalized.lower()
        if key and key not in seen:
            seen.add(key)
            found.append(normalized)
        if len(found) >= 8:
            break
    return found


def _segment_sources(segments: list[SegmentInput], keywords: list[str], limit: int = 6) -> list[int]:
    if not segments:
        return []
    lowered_keywords = [k.lower() for k in keywords]
    hits: list[int] = []
    for index, segment in enumerate(segments):
        text = (segment.text or "").lower()
        if any(keyword in text for keyword in lowered_keywords):
            hits.append(index)
        if len(hits) >= limit:
            break
    return hits


def _build_demo_discharge_draft(payload: DischargeDraftRequest) -> dict[str, Any]:
    transcript = _normalize_space(payload.transcript)
    units = _split_units(transcript)

    main_diagnosis = _join_or_default(
        _pick_by_keywords(units, SECTION_KEYWORDS["main_diagnosis"], limit=1),
        units[0] if units else "Potrebna je rucna dopuna glavne dijagnoze.",
    )

    secondary_diagnoses = _join_or_default(
        _pick_by_keywords(units, SECTION_KEYWORDS["secondary_diagnoses"], limit=2),
        "Nisu eksplicitno navedene pridruzene dijagnoze u transkriptu.",
    )

    anamnesis = _join_or_default(
        _pick_by_keywords(units, SECTION_KEYWORDS["anamnesis"], limit=2),
        "Pacijent navodi tegobe koje su opisane u razgovoru. Potrebna je rucna validacija.",
    )

    hospital_course = _join_or_default(
        _pick_by_keywords(units, SECTION_KEYWORDS["hospital_course"], limit=3),
        _join_or_default(units[:3], "Tok hospitalizacije nije dovoljno opisan u transkriptu."),
    )

    procedures = _join_or_default(
        _pick_by_keywords(units, SECTION_KEYWORDS["procedures"], limit=2),
        "Nisu jasno navedene procedure/intervencije. Potrebna je dopuna.",
    )

    therapy_during_stay = _join_or_default(
        _pick_by_keywords(units, SECTION_KEYWORDS["therapy_during_stay"], limit=3),
        "Nije eksplicitno opisana terapija tokom hospitalizacije.",
    )

    medication_mentions = _extract_medication_mentions(transcript)
    default_discharge_therapy = (
        "; ".join(medication_mentions)
        if medication_mentions
        else "Nije prepoznata konkretna terapija sa dozama. Potrebna je rucna dopuna."
    )

    therapy_on_discharge = _join_or_default(
        _pick_by_keywords(units, SECTION_KEYWORDS["therapy_on_discharge"], limit=2),
        default_discharge_therapy,
    )

    recommendations = _join_or_default(
        _pick_by_keywords(units, SECTION_KEYWORDS["recommendations"], limit=3),
        "Preporucena kontrola kod nadleznog lekara i pracenje simptoma.",
    )

    follow_up = _join_or_default(
        _pick_by_keywords(units, SECTION_KEYWORDS["follow_up"], limit=2),
        "Kontrola za 7-14 dana ili ranije po proceni lekara.",
    )

    red_flags = _join_or_default(
        _pick_by_keywords(units, SECTION_KEYWORDS["red_flags"], limit=2),
        "Pri pogorsanju simptoma, bolu u grudima, gušenju ili temperaturi javiti se hitno.",
    )

    fields = {
        "patient_name": _normalize_space(payload.patient_name or "") or "Demo Pacijent",
        "patient_id": _normalize_space(payload.patient_id or "") or "N/A",
        "department": _normalize_space(payload.department or "") or "Interno odeljenje",
        "doctor_name": _normalize_space(payload.doctor_name or "") or "Dr Med Demo",
        "admission_date": _normalize_space(payload.admission_date or "") or "N/A",
        "discharge_date": _normalize_space(payload.discharge_date or "") or datetime.now().date().isoformat(),
        "main_diagnosis": main_diagnosis,
        "secondary_diagnoses": secondary_diagnoses,
        "anamnesis": anamnesis,
        "hospital_course": hospital_course,
        "procedures": procedures,
        "therapy_during_stay": therapy_during_stay,
        "therapy_on_discharge": therapy_on_discharge,
        "recommendations": recommendations,
        "follow_up": follow_up,
        "red_flags": red_flags,
    }

    sources = {
        key: _segment_sources(payload.segments, keywords)
        for key, keywords in SECTION_KEYWORDS.items()
    }

    return {
        "document_title": "Demo Otpusna Lista",
        "template_version": "discharge-demo-v1",
        "generated_at": datetime.now().isoformat(),
        "disclaimer": "DEMO DRAFT: Dokument je automatski generisan iz transkripta i zahteva obaveznu medicinsku proveru pre upotrebe.",
        "engine": "rule-based-local-free",
        "detected_language": payload.detected_language or "auto",
        "fields": fields,
        "sources": sources,
    }


def _build_ai_discharge_draft(payload: DischargeDraftRequest) -> dict[str, Any]:
    if not OLLAMA_ENABLED:
        raise RuntimeError("Ollama integration is disabled by environment.")

    demo_fallback = _build_demo_discharge_draft(payload)
    fallback_fields = demo_fallback.get("fields", {})
    prompt = _build_ollama_prompt(payload, fallback_fields)

    system_prompt = (
        "You are a medical discharge document formatter. "
        "Always answer with valid JSON only and no additional text."
    )

    message_content, api_variant = _ollama_json_completion(
        system_prompt=system_prompt,
        user_prompt=prompt,
        num_predict=1200,
        response_format=DISCHARGE_JSON_SCHEMA,
    )

    parsed = _parse_llm_json_with_repair(message_content, num_predict=1000)
    raw_fields = parsed.get("fields") if isinstance(parsed.get("fields"), dict) else {}

    merged_fields = _normalize_discharge_fields(raw_fields, fallback_fields)
    quality_notes = _normalize_space(str(parsed.get("quality_notes", "")))

    return {
        "document_title": "AI Otpusna Lista Draft",
        "template_version": "discharge-ai-v1",
        "generated_at": datetime.now().isoformat(),
        "disclaimer": (
            "AI DRAFT: Dokument je automatski generisan iz transkripta i zahteva "
            "obaveznu medicinsku proveru pre upotrebe."
        ),
        "engine": f"ollama:{OLLAMA_MODEL}({api_variant})",
        "provider": "local-ollama",
        "detected_language": payload.detected_language or "auto",
        "fields": merged_fields,
        "sources": demo_fallback.get("sources", {}),
        "quality_notes": quality_notes,
    }


@app.on_event("startup")
def load_model() -> None:
    global model
    model = WhisperModel(
        MODEL_NAME,
        device=MODEL_DEVICE,
        compute_type=MODEL_COMPUTE_TYPE,
    )


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "model_name": MODEL_NAME,
        "device": MODEL_DEVICE,
        "compute_type": MODEL_COMPUTE_TYPE,
        "model_loaded": model is not None,
        "ollama_enabled": OLLAMA_ENABLED,
        "ollama_base_url": OLLAMA_BASE_URL,
        "ollama_model": OLLAMA_MODEL,
    }


def _resolve_suffix(file: UploadFile) -> str:
    explicit = Path(file.filename or "").suffix
    if explicit:
        return explicit

    content_type = (file.content_type or "").lower()
    if content_type in MIME_SUFFIX_MAP:
        return MIME_SUFFIX_MAP[content_type]

    base_type = content_type.split(";")[0].strip()
    if base_type in MIME_SUFFIX_MAP:
        return MIME_SUFFIX_MAP[base_type]

    return ".webm"


async def _transcribe_upload(file: UploadFile, language: Optional[str], word_timestamps: bool) -> dict:
    if model is None:
        raise HTTPException(status_code=503, detail="Model is not loaded yet.")

    suffix = _resolve_suffix(file)
    temp_path: Optional[str] = None
    converted_path: Optional[str] = None

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            temp_path = tmp.name
            shutil.copyfileobj(file.file, tmp)

        if not os.path.exists(temp_path) or os.path.getsize(temp_path) == 0:
            raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")

        transcription_target = temp_path
        try:
            segments, info = model.transcribe(
                transcription_target,
                language=language or None,
                word_timestamps=word_timestamps,
                vad_filter=True,
                beam_size=5,
            )
        except Exception as first_exc:
            ffmpeg_bin = shutil.which("ffmpeg")
            if not ffmpeg_bin:
                raise first_exc

            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as wav_tmp:
                converted_path = wav_tmp.name

            conversion_result = subprocess.run(
                [
                    ffmpeg_bin,
                    "-y",
                    "-i",
                    temp_path,
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    converted_path,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

            if conversion_result.returncode != 0:
                raise RuntimeError(
                    "Audio decode failed and ffmpeg conversion failed: "
                    f"{conversion_result.stderr.strip()[:800]}"
                ) from first_exc

            segments, info = model.transcribe(
                converted_path,
                language=language or None,
                word_timestamps=word_timestamps,
                vad_filter=True,
                beam_size=5,
            )

        full_text_parts = []
        serialized_segments = []

        for segment in segments:
            full_text_parts.append(segment.text)
            payload = {
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
            }

            if word_timestamps:
                payload["words"] = [
                    {
                        "start": word.start,
                        "end": word.end,
                        "word": word.word,
                        "probability": word.probability,
                    }
                    for word in (segment.words or [])
                ]

            serialized_segments.append(payload)

        return {
            "detected_language": info.language,
            "language_probability": info.language_probability,
            "text": " ".join(part.strip() for part in full_text_parts if part.strip()),
            "segments": serialized_segments,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        if converted_path and os.path.exists(converted_path):
            os.remove(converted_path)
        await file.close()


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
    word_timestamps: bool = Form(default=False),
) -> dict:
    return await _transcribe_upload(
        file=file,
        language=language,
        word_timestamps=word_timestamps,
    )


@app.post("/transcribe-microphone")
async def transcribe_microphone(
    file: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
    word_timestamps: bool = Form(default=False),
) -> dict:
    return await _transcribe_upload(
        file=file,
        language=language,
        word_timestamps=word_timestamps,
    )


@app.post("/discharge-draft")
def discharge_draft(payload: DischargeDraftRequest) -> dict[str, Any]:
    transcript = _normalize_space(payload.transcript)
    if not transcript:
        raise HTTPException(status_code=400, detail="Transcript is required for discharge draft generation.")
    return _build_demo_discharge_draft(payload)


@app.post("/discharge-draft-ai")
def discharge_draft_ai(payload: DischargeDraftRequest, fallback_to_rules: bool = True) -> dict[str, Any]:
    transcript = _normalize_space(payload.transcript)
    if not transcript:
        raise HTTPException(status_code=400, detail="Transcript is required for discharge draft generation.")

    try:
        return _build_ai_discharge_draft(payload)
    except requests.RequestException as exc:
        if fallback_to_rules:
            fallback = _build_demo_discharge_draft(payload)
            fallback["engine"] = "rule-based-local-free-fallback"
            fallback["ai_error"] = f"Ollama request failed: {exc.__class__.__name__}"
            return fallback
        raise HTTPException(status_code=503, detail=f"Ollama request failed: {exc}") from exc
    except Exception as exc:
        if fallback_to_rules:
            fallback = _build_demo_discharge_draft(payload)
            fallback["engine"] = "rule-based-local-free-fallback"
            fallback["ai_error"] = str(exc)
            return fallback
        raise HTTPException(status_code=500, detail=f"AI discharge draft failed: {exc}") from exc


@app.post("/transcript-corrections")
def transcript_corrections(payload: TranscriptCorrectionRequest, fallback_noop: bool = True) -> dict[str, Any]:
    transcript = _normalize_space(payload.transcript)
    if not transcript:
        raise HTTPException(status_code=400, detail="Transcript is required for correction.")

    try:
        return _build_ai_transcript_corrections(payload)
    except requests.RequestException as exc:
        if fallback_noop:
            return {
                "engine": "no-op-local-fallback",
                "provider": "none",
                "detected_language": payload.detected_language or "auto",
                "original_transcript": transcript,
                "corrected_transcript": transcript,
                "corrections": [],
                "quality_notes": "AI korekcija nije bila dostupna, vracen je originalni tekst.",
                "ai_error": f"Ollama request failed: {exc.__class__.__name__}",
            }
        raise HTTPException(status_code=503, detail=f"Ollama request failed: {exc}") from exc
    except Exception as exc:
        if fallback_noop:
            return {
                "engine": "no-op-local-fallback",
                "provider": "none",
                "detected_language": payload.detected_language or "auto",
                "original_transcript": transcript,
                "corrected_transcript": transcript,
                "corrections": [],
                "quality_notes": "AI korekcija nije bila dostupna, vracen je originalni tekst.",
                "ai_error": str(exc),
            }
        raise HTTPException(status_code=500, detail=f"Transcript correction failed: {exc}") from exc
