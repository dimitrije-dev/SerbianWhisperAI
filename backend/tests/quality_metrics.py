from __future__ import annotations

import re
from typing import Iterable


def _normalize_text(text: str) -> str:
    lowered = (text or "").lower()
    lowered = re.sub(r"\s+", " ", lowered).strip()
    return lowered


def _word_tokens(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z0-9šđčćžŠĐČĆŽ]+", _normalize_text(text))


def _char_tokens(text: str) -> list[str]:
    normalized = _normalize_text(text)
    return list(normalized.replace(" ", ""))


def _levenshtein_distance(source: Iterable[str], target: Iterable[str]) -> int:
    src = list(source)
    tgt = list(target)

    if not src:
        return len(tgt)
    if not tgt:
        return len(src)

    prev = list(range(len(tgt) + 1))
    for i, src_item in enumerate(src, start=1):
        curr = [i]
        for j, tgt_item in enumerate(tgt, start=1):
            deletion = prev[j] + 1
            insertion = curr[j - 1] + 1
            substitution = prev[j - 1] + (0 if src_item == tgt_item else 1)
            curr.append(min(deletion, insertion, substitution))
        prev = curr

    return prev[-1]


def word_error_rate(reference: str, hypothesis: str) -> float:
    ref_words = _word_tokens(reference)
    hyp_words = _word_tokens(hypothesis)

    if not ref_words:
        return 0.0 if not hyp_words else 1.0

    return _levenshtein_distance(ref_words, hyp_words) / len(ref_words)


def char_error_rate(reference: str, hypothesis: str) -> float:
    ref_chars = _char_tokens(reference)
    hyp_chars = _char_tokens(hypothesis)

    if not ref_chars:
        return 0.0 if not hyp_chars else 1.0

    return _levenshtein_distance(ref_chars, hyp_chars) / len(ref_chars)


def confidence_metrics(segments: list[dict], low_confidence_threshold: float = 0.8) -> dict[str, float]:
    words: list[dict] = []
    for segment in segments or []:
        for word in segment.get("words", []) or []:
            words.append(word)

    if not words:
        return {
            "word_count": 0.0,
            "avg_word_probability": 0.0,
            "min_word_probability": 0.0,
            "low_confidence_rate": 0.0,
        }

    probabilities = [float(word.get("probability", 0.0)) for word in words]
    low_count = sum(1 for probability in probabilities if probability < low_confidence_threshold)

    return {
        "word_count": float(len(probabilities)),
        "avg_word_probability": sum(probabilities) / len(probabilities),
        "min_word_probability": min(probabilities),
        "low_confidence_rate": low_count / len(probabilities),
    }


def speaking_rate_wpm(text: str, duration_seconds: float) -> float:
    tokens = _word_tokens(text)
    if duration_seconds <= 0:
        return 0.0
    return len(tokens) / (duration_seconds / 60.0)

