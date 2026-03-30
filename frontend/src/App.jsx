import { useEffect, useMemo, useRef, useState } from "react";
import {
  FiClock,
  FiDownload,
  FiLoader,
  FiMenu,
  FiMoon,
  FiSettings,
  FiSun,
  FiX,
} from "react-icons/fi";

const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const THEME_STORAGE_KEY = "sebianwhisper_theme";
const HISTORY_STORAGE_KEY = "sebianwhisper_history";
const SETTINGS_STORAGE_KEY = "sebianwhisper_settings";
const LANGUAGE_OPTIONS = [
  { value: "", label: "Auto detect" },
  { value: "sr", label: "Serbian (sr)" },
  { value: "en", label: "English (en)" },
  { value: "hr", label: "Croatian (hr)" },
  { value: "bs", label: "Bosnian (bs)" },
  { value: "de", label: "German (de)" },
  { value: "fr", label: "French (fr)" },
  { value: "it", label: "Italian (it)" },
  { value: "es", label: "Spanish (es)" },
];

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const secs = (total % 60).toString().padStart(2, "0");
  return hours > 0 ? `${hours}:${minutes}:${secs}` : `${minutes}:${secs}`;
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleString("sr-RS", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimestamp(seconds, separator = ",") {
  const safe = Math.max(0, Number(seconds) || 0);
  const hrs = Math.floor(safe / 3600)
    .toString()
    .padStart(2, "0");
  const mins = Math.floor((safe % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const secs = Math.floor(safe % 60)
    .toString()
    .padStart(2, "0");
  const millis = Math.floor((safe % 1) * 1000)
    .toString()
    .padStart(3, "0");
  return `${hrs}:${mins}:${secs}${separator}${millis}`;
}

function toSrt(segments) {
  return segments
    .map((segment, index) => {
      return `${index + 1}
${formatTimestamp(segment.start, ",")} --> ${formatTimestamp(segment.end, ",")}
${segment.text.trim()}`;
    })
    .join("\n\n");
}

function toVtt(segments) {
  const body = segments
    .map((segment) => {
      return `${formatTimestamp(segment.start, ".")} --> ${formatTimestamp(segment.end, ".")}
${segment.text.trim()}`;
    })
    .join("\n\n");

  return `WEBVTT\n\n${body}`;
}

function normalizeResponse(raw) {
  const segments = Array.isArray(raw?.segments)
    ? raw.segments.map((segment) => ({
        start: Number(segment.start) || 0,
        end: Number(segment.end) || 0,
        text: String(segment.text || ""),
        words: Array.isArray(segment.words)
          ? segment.words.map((word) => ({
              start: Number(word.start) || 0,
              end: Number(word.end) || 0,
              word: String(word.word || ""),
              probability:
                typeof word.probability === "number" ? word.probability : Number(word.probability) || 0,
            }))
          : undefined,
      }))
    : [];

  return {
    detected_language: raw?.detected_language || "",
    language_probability:
      typeof raw?.language_probability === "number"
        ? raw.language_probability
        : Number(raw?.language_probability) || 0,
    text: String(raw?.text || ""),
    segments,
  };
}

function getInitialTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === "light" || savedTheme === "dark") {
    return savedTheme;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistHistory(items) {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items));
}

function loadSettings() {
  const defaults = {
    defaultLanguage: "",
    defaultWordTimestamps: false,
    apiBaseUrl: DEFAULT_API_BASE_URL,
  };

  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    return {
      defaultLanguage: typeof parsed.defaultLanguage === "string" ? parsed.defaultLanguage : defaults.defaultLanguage,
      defaultWordTimestamps: Boolean(parsed.defaultWordTimestamps),
      apiBaseUrl: typeof parsed.apiBaseUrl === "string" && parsed.apiBaseUrl.trim()
        ? parsed.apiBaseUrl.trim()
        : defaults.apiBaseUrl,
    };
  } catch {
    return defaults;
  }
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function normalizeLanguage(value) {
  const safe = typeof value === "string" ? value.trim() : "";
  return LANGUAGE_OPTIONS.some((option) => option.value === safe) ? safe : "";
}

function App() {
  const initialSettings = useMemo(() => loadSettings(), []);
  const [activePage, setActivePage] = useState("transcribe");
  const [theme, setTheme] = useState(getInitialTheme);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [audioFile, setAudioFile] = useState(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState("");
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0);
  const [language, setLanguage] = useState(normalizeLanguage(initialSettings.defaultLanguage));
  const [wordTimestamps, setWordTimestamps] = useState(initialSettings.defaultWordTimestamps);
  const [apiBaseUrl, setApiBaseUrl] = useState(initialSettings.apiBaseUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(loadHistory);
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [settingsForm, setSettingsForm] = useState({
    ...initialSettings,
    defaultLanguage: normalizeLanguage(initialSettings.defaultLanguage),
  });
  const [settingsMessage, setSettingsMessage] = useState("");
  const audioRef = useRef(null);

  useEffect(() => {
    if (!selectedHistoryId && history.length > 0) {
      setSelectedHistoryId(history[0].id);
    }
  }, [history, selectedHistoryId]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!audioFile) {
      setAudioPreviewUrl("");
      setCurrentPlaybackTime(0);
      return;
    }

    const objectUrl = URL.createObjectURL(audioFile);
    setAudioPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [audioFile]);

  const canSubmit = useMemo(() => Boolean(audioFile) && !loading, [audioFile, loading]);
  const ThemeIcon = theme === "dark" ? FiSun : FiMoon;
  const themeLabel = theme === "dark" ? "Light Theme" : "Dark Theme";

  const selectedHistory = useMemo(() => {
    return history.find((entry) => entry.id === selectedHistoryId) || null;
  }, [history, selectedHistoryId]);

  const activeSegmentIndex = useMemo(() => {
    if (!result?.segments?.length) return -1;
    const time = currentPlaybackTime;

    for (let i = 0; i < result.segments.length; i += 1) {
      const segment = result.segments[i];
      const next = result.segments[i + 1];
      const upperBound = next ? next.start : segment.end + 0.25;

      if (time >= segment.start && time < upperBound) {
        return i;
      }
    }

    return -1;
  }, [currentPlaybackTime, result]);

  function toggleTheme() {
    setTheme((curr) => (curr === "dark" ? "light" : "dark"));
  }

  function goToPage(page) {
    setActivePage(page);
    setMobileMenuOpen(false);
  }

  function updateJob(jobId, patch) {
    setJobs((prev) =>
      prev.map((job) => {
        if (job.id !== jobId) return job;
        return { ...job, ...patch };
      })
    );
  }

  function saveHistoryEntry(entry) {
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, 30);
      persistHistory(next);
      return next;
    });
    setSelectedHistoryId(entry.id);
  }

  function clearHistory() {
    setHistory([]);
    setSelectedHistoryId(null);
    persistHistory([]);
  }

  function exportTranscript(record, kind) {
    if (!record) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeName = (record.fileName || "transcript").replace(/\.[^/.]+$/, "").replace(/\s+/g, "_");

    if (kind === "txt") {
      downloadFile(`${safeName}-${stamp}.txt`, record.text || "", "text/plain;charset=utf-8");
      return;
    }

    if (kind === "srt") {
      const srt = toSrt(record.segments || []);
      downloadFile(`${safeName}-${stamp}.srt`, srt, "text/plain;charset=utf-8");
      return;
    }

    if (kind === "vtt") {
      const vtt = toVtt(record.segments || []);
      downloadFile(`${safeName}-${stamp}.vtt`, vtt, "text/vtt;charset=utf-8");
    }
  }

  function jumpToSegment(start) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Number(start) || 0);
    audioRef.current.play().catch(() => {});
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!audioFile) {
      setError("Prvo izaberi audio fajl.");
      return;
    }

    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const createdAt = new Date().toISOString();

    setJobs((prev) =>
      [
        {
          id: jobId,
          fileName: audioFile.name,
          status: "uploading",
          createdAt,
          updatedAt: createdAt,
        },
        ...prev,
      ].slice(0, 40)
    );

    setLoading(true);
    setError("");
    setResult(null);

    try {
      updateJob(jobId, { status: "transcribing", updatedAt: new Date().toISOString() });

      const formData = new FormData();
      formData.append("file", audioFile);
      formData.append("word_timestamps", String(wordTimestamps));

      if (language.trim()) {
        formData.append("language", language.trim());
      }

      const response = await fetch(`${apiBaseUrl}/transcribe`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || "Transcription request failed.");
      }

      const normalized = normalizeResponse(data);
      const finalRecord = {
        ...normalized,
        id: `tr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString(),
        fileName: audioFile.name,
        requestedLanguage: language.trim() || null,
        usedWordTimestamps: wordTimestamps,
      };

      setResult(finalRecord);
      saveHistoryEntry(finalRecord);
      updateJob(jobId, {
        status: "done",
        updatedAt: new Date().toISOString(),
        segmentCount: normalized.segments.length,
      });
    } catch (err) {
      setError(err.message || "Doslo je do greske.");
      updateJob(jobId, {
        status: "error",
        error: err.message || "Unknown error",
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }

  function handleSettingsSave(event) {
    event.preventDefault();
    const clean = {
      defaultLanguage: normalizeLanguage(settingsForm.defaultLanguage),
      defaultWordTimestamps: Boolean(settingsForm.defaultWordTimestamps),
      apiBaseUrl: settingsForm.apiBaseUrl.trim() || DEFAULT_API_BASE_URL,
    };

    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(clean));
    setApiBaseUrl(clean.apiBaseUrl);
    setLanguage(clean.defaultLanguage);
    setWordTimestamps(clean.defaultWordTimestamps);
    setSettingsForm(clean);
    setSettingsMessage("Settings su sacuvane.");
  }

  return (
    <div className="app-shell">
      <div className="bg-orb orb-a" />
      <div className="bg-orb orb-b" />

      <header className="topbar reveal">
        <div className="topbar-inner">
          <div className="brand" aria-label="SerbianWhisper AI">
            <img src="/mini-logo.png" alt="SebianWhisper mini logo" />
            <span>SerbianWhisper AI</span>
          </div>

          <button
            type="button"
            className="hamburger-btn"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <FiX /> : <FiMenu />}
          </button>

          <div className={mobileMenuOpen ? "menu-wrap open" : "menu-wrap"}>
            <nav className="menu">
              <button
                className={activePage === "transcribe" ? "menu-btn active" : "menu-btn"}
                onClick={() => goToPage("transcribe")}
                type="button"
              >
                Transkripcija
              </button>
              <button
                className={activePage === "history" ? "menu-btn active" : "menu-btn"}
                onClick={() => goToPage("history")}
                type="button"
              >
                Istorija
              </button>
              <button
                className={activePage === "jobs" ? "menu-btn active" : "menu-btn"}
                onClick={() => goToPage("jobs")}
                type="button"
              >
                Jobs
              </button>
              <button
                className={activePage === "settings" ? "menu-btn active" : "menu-btn"}
                onClick={() => goToPage("settings")}
                type="button"
              >
                Settings
              </button>
              <button
                className={activePage === "about" ? "menu-btn active" : "menu-btn"}
                onClick={() => goToPage("about")}
                type="button"
              >
                O projektu
              </button>
            </nav>

            <button className="theme-toggle" onClick={toggleTheme} type="button">
              <ThemeIcon />
              <span>{themeLabel}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="content">
        {activePage === "transcribe" ? (
          <section className="panel">
            <div className="hero reveal">
              <img className="hero-logo" src="/serbianwhisper-logo.jpg" alt="SebianWhisper logo" />
              <div className="hero-copy">
                <h1>SebianWhisper</h1>
                <p>
                  Lokalna AI transkripcija zvuka sa jasnim segmentima i timestampovima. Upload,
                  pokreni obradu i odmah pregledaj rezultat u profesionalnom dashboard prikazu.
                </p>
                <div className="hero-badges">
                  <span>FastAPI backend</span>
                  <span>Faster-Whisper</span>
                  <span>CPU ready</span>
                </div>
              </div>
            </div>

            <form className="card reveal delay-1" onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="audio-file">Audio fajl</label>
                <label htmlFor="audio-file" className={audioFile ? "upload-box has-file" : "upload-box"}>
                  <input
                    id="audio-file"
                    type="file"
                    accept="audio/*"
                    onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                  />
                  <span className="upload-title">
                    {audioFile ? audioFile.name : "Prevuci ili izaberi audio fajl"}
                  </span>
                  <span className="upload-help">Podrzano: mp3, wav, m4a, ogg i ostali formati</span>
                </label>
              </div>

              <div className="input-row">
                <div className="field">
                  <label htmlFor="language">Kod jezika (opciono)</label>
                  <select
                    id="language"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    {LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.value || "auto"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={wordTimestamps}
                  className={wordTimestamps ? "toggle-control on" : "toggle-control"}
                  onClick={() => setWordTimestamps((current) => !current)}
                >
                  <span className="toggle-track">
                    <span className="toggle-thumb" />
                  </span>
                  <span className="toggle-text">Word timestamps</span>
                </button>
              </div>

              <button type="submit" disabled={!canSubmit} className="primary-btn">
                {loading ? "Transkribujem..." : "Pokreni transkripciju"}
              </button>
            </form>

            {audioPreviewUrl ? (
              <div className="card audio-card reveal">
                <h3>Audio preview</h3>
                <audio
                  ref={audioRef}
                  controls
                  src={audioPreviewUrl}
                  onTimeUpdate={(event) => setCurrentPlaybackTime(event.currentTarget.currentTime)}
                />
              </div>
            ) : null}

            {loading ? (
              <div className="card loading-card reveal">
                <FiLoader className="spinner-icon" />
                <div>
                  <h3>Obrada je u toku</h3>
                  <p>
                    Molim sacekaj dok model zavrsi transkripciju. Vece audio datoteke mogu trajati
                    malo duze.
                  </p>
                </div>
              </div>
            ) : null}

            {error ? <p className="error reveal">{error}</p> : null}

            {result ? (
              <section className="results reveal delay-2">
                <div className="card metrics">
                  <div className="metric-item">
                    <p>Detektovan jezik</p>
                    <strong>{result.detected_language || "nepoznat"}</strong>
                  </div>
                  <div className="metric-item">
                    <p>Pouzdanost</p>
                    <strong>
                      {typeof result.language_probability === "number"
                        ? `${(result.language_probability * 100).toFixed(1)}%`
                        : "n/a"}
                    </strong>
                  </div>
                  <div className="metric-item">
                    <p>Segmenti</p>
                    <strong>{Array.isArray(result.segments) ? result.segments.length : 0}</strong>
                  </div>
                </div>

                <div className="card">
                  <div className="title-row">
                    <h2>Kompletan transkript</h2>
                    <div className="export-actions">
                      <button type="button" className="ghost-btn" onClick={() => exportTranscript(result, "txt")}>
                        <FiDownload /> TXT
                      </button>
                      <button type="button" className="ghost-btn" onClick={() => exportTranscript(result, "srt")}>
                        <FiDownload /> SRT
                      </button>
                      <button type="button" className="ghost-btn" onClick={() => exportTranscript(result, "vtt")}>
                        <FiDownload /> VTT
                      </button>
                    </div>
                  </div>
                  <p className="transcript-text">{result.text || "(prazan transkript)"}</p>
                </div>

                <div className="card">
                  <h2>Vremenski segmenti</h2>
                  {Array.isArray(result.segments) && result.segments.length > 0 ? (
                    <ul className="segments">
                      {result.segments.map((segment, index) => (
                        <li
                          key={`${segment.start}-${segment.end}-${index}`}
                          className={activeSegmentIndex === index ? "clickable-segment active-segment" : "clickable-segment"}
                          onClick={() => jumpToSegment(segment.start)}
                        >
                          <div className="segment-meta">
                            <span>{formatTime(segment.start)}</span>
                            <span>{formatTime(segment.end)}</span>
                          </div>
                          <p>{segment.text}</p>
                          {Array.isArray(segment.words) && segment.words.length > 0 ? (
                            <div className="word-grid">
                              {segment.words.map((word, wordIndex) => (
                                <span key={`${word.start}-${word.end}-${wordIndex}`}>
                                  {word.word.trim()} ({formatTime(word.start)})
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Nema dostupnih segmenata.</p>
                  )}
                </div>
              </section>
            ) : null}
          </section>
        ) : null}

        {activePage === "history" ? (
          <section className="panel reveal">
            <div className="title-row">
              <h1>Istorija transkripcije</h1>
              {history.length > 0 ? (
                <button type="button" className="ghost-btn" onClick={clearHistory}>
                  Obrisi istoriju
                </button>
              ) : null}
            </div>

            <div className="history-layout">
              <div className="card history-list">
                {history.length === 0 ? (
                  <p>Jos uvek nema sacuvanih transkripata.</p>
                ) : (
                  history.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={selectedHistoryId === item.id ? "history-item active" : "history-item"}
                      onClick={() => setSelectedHistoryId(item.id)}
                    >
                      <strong>{item.fileName || "Audio file"}</strong>
                      <span>{formatDate(item.createdAt)}</span>
                      <span className="history-lang">Jezik: {item.detected_language || "auto"}</span>
                      <p>{item.text?.slice(0, 120) || "(prazno)"}...</p>
                    </button>
                  ))
                )}
              </div>

              <div className="card history-detail">
                {selectedHistory ? (
                  <>
                    <div className="title-row">
                      <h2>{selectedHistory.fileName}</h2>
                      <div className="export-actions">
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => exportTranscript(selectedHistory, "txt")}
                        >
                          <FiDownload /> TXT
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => exportTranscript(selectedHistory, "srt")}
                        >
                          <FiDownload /> SRT
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => exportTranscript(selectedHistory, "vtt")}
                        >
                          <FiDownload /> VTT
                        </button>
                      </div>
                    </div>

                    <p className="history-meta">
                      <FiClock /> {formatDate(selectedHistory.createdAt)}
                    </p>
                    <p className="transcript-text">{selectedHistory.text || "(prazan transkript)"}</p>

                    <h3>Segmenti</h3>
                    {Array.isArray(selectedHistory.segments) && selectedHistory.segments.length > 0 ? (
                      <ul className="segments">
                        {selectedHistory.segments.map((segment, index) => (
                          <li key={`${selectedHistory.id}-${index}`}>
                            <div className="segment-meta">
                              <span>{formatTime(segment.start)}</span>
                              <span>{formatTime(segment.end)}</span>
                            </div>
                            <p>{segment.text}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>Nema segmenata.</p>
                    )}
                  </>
                ) : (
                  <p>Izaberi transcript sa leve strane.</p>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {activePage === "jobs" ? (
          <section className="panel reveal">
            <h1>Jobs status</h1>
            <div className="card">
              {jobs.length === 0 ? (
                <p>Trenutno nema job-ova. Pokreni transkripciju da vidis queue.</p>
              ) : (
                <ul className="jobs-list">
                  {jobs.map((job) => (
                    <li key={job.id}>
                      <div>
                        <strong>{job.fileName}</strong>
                        <p>{formatDate(job.updatedAt)}</p>
                      </div>
                      <span className={`job-pill ${job.status}`}>{job.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ) : null}

        {activePage === "settings" ? (
          <section className="panel reveal">
            <h1>Settings</h1>
            <form className="card settings-form" onSubmit={handleSettingsSave}>
              <div className="field">
                <label htmlFor="settings-api-url">
                  <FiSettings /> Backend API URL
                </label>
                <input
                  id="settings-api-url"
                  type="text"
                  value={settingsForm.apiBaseUrl}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({
                      ...prev,
                      apiBaseUrl: e.target.value,
                    }))
                  }
                  placeholder="http://localhost:8000"
                />
              </div>

              <div className="field">
                <label htmlFor="settings-language">Podrazumevani jezik</label>
                <select
                  id="settings-language"
                  value={settingsForm.defaultLanguage}
                  onChange={(e) =>
                    setSettingsForm((prev) => ({
                      ...prev,
                      defaultLanguage: e.target.value,
                    }))
                  }
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={`settings-${option.value || "auto"}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={settingsForm.defaultWordTimestamps}
                className={settingsForm.defaultWordTimestamps ? "toggle-control on" : "toggle-control"}
                onClick={() =>
                  setSettingsForm((prev) => ({
                    ...prev,
                    defaultWordTimestamps: !prev.defaultWordTimestamps,
                  }))
                }
              >
                <span className="toggle-track">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-text">Podrazumevano ukljuci word timestamps</span>
              </button>

              <button type="submit" className="primary-btn">
                Sacuvaj settings
              </button>

              {settingsMessage ? <p className="success-message">{settingsMessage}</p> : null}
            </form>
          </section>
        ) : null}

        {activePage === "about" ? (
          <section className="panel">
            <div className="card reveal about-card">
              <h1>O projektu</h1>
              <p>
                SebianWhisper aplikacija je minimalisticka web aplikacija za lokalnu transkripciju
                audio fajlova koristeci FastAPI backend i Faster-Whisper model.
              </p>

              <div className="about-grid">
                <article className="about-item">
                  <h3>Autor</h3>
                  <p>Dimitrije Milenkovic</p>
                </article>
                <article className="about-item">
                  <h3>Stack</h3>
                  <p>React + Vite (frontend), Python FastAPI + Faster-Whisper (backend)</p>
                </article>
                <article className="about-item">
                  <h3>Cilj</h3>
                  <p>Brza i citljiva transkripcija sa segmentima i opcionalnim word timestampovima.</p>
                </article>
                <article className="about-item">
                  <h3>Local-first</h3>
                  <p>Model radi na server strani u CPU modu, optimizovano za lokalni razvoj na Mac-u.</p>
                </article>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

export default App;
