# SerbianWhisper - KPI Metrics Test Report

Execution date: 2026-04-27 (Europe/Belgrade)

## Cilj

Ovaj set meri numeričke KPI metrike koje možeš direktno koristiti u prezentaciji:

- Word Error Rate (WER)
- Character Error Rate (CER)
- Jezička pouzdanost (`language_probability`)
- Prosečna pouzdanost reči (`avg_word_probability`)
- Minimalna pouzdanost reči (`min_word_probability`)
- Udeo reči ispod confidence praga (`low_confidence_rate`)
- Brzina govora (`words per minute`)
- Trajanje transkripta i broj reči

## Test fajlovi

- `backend/tests/test_transcription_metrics.py`
- `backend/tests/quality_metrics.py`
- `backend/tests/print_metrics_demo.py`

## Kako pokrenuti

```bash
cd backend
source .venv/bin/activate
pip install -r requirements-dev.txt
cd ..
backend/.venv/bin/python -m pytest -q backend/tests/test_transcription_metrics.py
backend/.venv/bin/python backend/tests/print_metrics_demo.py
```

## Brojevi (deterministički demo sample)

| KPI | Value |
|---|---:|
| Detected language | `sr` |
| Language probability | `0.97` |
| Word count | `12` |
| Duration (sec) | `7.0` |
| Speaking rate (WPM) | `102.86` |
| Avg word probability | `0.895` |
| Min word probability | `0.72` |
| Low confidence rate (`p < 0.8`) | `0.0833` (8.33%) |
| WER | `0.0833` (8.33%) |
| CER | `0.0333` (3.33%) |

## Tumačenje (za prezentaciju)

- `WER 8.33%` znači da je približno 1 od 12 reči u uzorku pogrešno prepoznata.
- `CER 3.33%` pokazuje da je greška manja na nivou karaktera nego na nivou tokena.
- `Low confidence 8.33%` pomaže da targetiraš delove transkripta za ručnu proveru.
- `WPM` je koristan za procenu brzine diktiranja i opterećenja modela.

## Napomena

Ove brojke su iz kontrolisanog test primera (mock model + fiksni ulaz) i zato su stabilne i ponovljive.
Za produkcioni benchmark preporučeno je pokretanje iste metrike nad realnim audio dataset-om.

