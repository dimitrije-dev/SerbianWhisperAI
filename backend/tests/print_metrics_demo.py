from __future__ import annotations

import json

from quality_metrics import char_error_rate, confidence_metrics, speaking_rate_wpm, word_error_rate


def main() -> None:
    reference = "Pacijent je primljen zbog bola u grudima i otezanog disanja pri naporu."
    hypothesis = "Pacijent je primljen zbog bol u grudima. I otezanog disanja pri naporu."

    segments = [
        {
            "start": 0.0,
            "end": 3.2,
            "text": "Pacijent je primljen zbog bol u grudima.",
            "words": [
                {"start": 0.00, "end": 0.33, "word": "Pacijent", "probability": 0.96},
                {"start": 0.33, "end": 0.46, "word": "je", "probability": 0.98},
                {"start": 0.46, "end": 1.10, "word": "primljen", "probability": 0.91},
                {"start": 1.10, "end": 1.50, "word": "zbog", "probability": 0.88},
                {"start": 1.50, "end": 1.86, "word": "bol", "probability": 0.72},
                {"start": 1.86, "end": 2.00, "word": "u", "probability": 0.95},
                {"start": 2.00, "end": 2.40, "word": "grudima", "probability": 0.93},
            ],
        },
        {
            "start": 3.2,
            "end": 7.0,
            "text": "I otezanog disanja pri naporu.",
            "words": [
                {"start": 3.20, "end": 3.35, "word": "I", "probability": 0.89},
                {"start": 3.35, "end": 4.10, "word": "otezanog", "probability": 0.92},
                {"start": 4.10, "end": 4.65, "word": "disanja", "probability": 0.86},
                {"start": 4.65, "end": 4.90, "word": "pri", "probability": 0.84},
                {"start": 4.90, "end": 5.50, "word": "naporu", "probability": 0.90},
            ],
        },
    ]

    duration_seconds = segments[-1]["end"] - segments[0]["start"]
    confidence = confidence_metrics(segments, low_confidence_threshold=0.8)

    report = {
        "reference_text": reference,
        "hypothesis_text": hypothesis,
        "duration_seconds": duration_seconds,
        "word_error_rate": word_error_rate(reference, hypothesis),
        "char_error_rate": char_error_rate(reference, hypothesis),
        "speaking_rate_wpm": speaking_rate_wpm(hypothesis, duration_seconds),
        "word_count": int(confidence["word_count"]),
        "avg_word_probability": confidence["avg_word_probability"],
        "min_word_probability": confidence["min_word_probability"],
        "low_confidence_rate": confidence["low_confidence_rate"],
    }

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

