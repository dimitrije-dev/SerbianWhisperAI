import { useEffect, useMemo, useRef, useState } from "react";
import {
  FiClock,
  FiDownload,
  FiFileText,
  FiLoader,
  FiMenu,
  FiMic,
  FiMoon,
  FiRotateCcw,
  FiSettings,
  FiSquare,
  FiSun,
  FiX,
} from "react-icons/fi";

const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const THEME_STORAGE_KEY = "sebianwhisper_theme";
const THEME_PRESET_KEY = "sebianwhisper_theme_preset";
const HISTORY_STORAGE_KEY = "sebianwhisper_history";
const SETTINGS_STORAGE_KEY = "sebianwhisper_settings";
const DISCHARGE_ENGINE_STORAGE_KEY = "sebianwhisper_discharge_engine";
const RECORDER_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const TRANSCRIPTION_MODEL_OPTIONS = [
  {
    value: "small",
    label: "Small",
    subtitle: "Faster start, CPU-friendly",
  },
  {
    value: "turbo",
    label: "Large-v3 Turbo",
    subtitle: "Higher quality, heavier model",
  },
];
const THEME_PRESETS = [
  { value: "mint", label: "Mint" },
  { value: "studio", label: "Studio" },
  { value: "classic", label: "Classic" },
];
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
    model_used: raw?.model_used || "small",
    model_name: raw?.model_name || "",
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
    defaultTranscriptionModel: "small",
    apiBaseUrl: DEFAULT_API_BASE_URL,
    themePreset: "mint",
  };

  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    return {
      defaultLanguage: typeof parsed.defaultLanguage === "string" ? parsed.defaultLanguage : defaults.defaultLanguage,
      defaultWordTimestamps: Boolean(parsed.defaultWordTimestamps),
      defaultTranscriptionModel:
        typeof parsed.defaultTranscriptionModel === "string"
          ? normalizeTranscriptionModel(parsed.defaultTranscriptionModel)
          : defaults.defaultTranscriptionModel,
      apiBaseUrl: typeof parsed.apiBaseUrl === "string" && parsed.apiBaseUrl.trim()
        ? parsed.apiBaseUrl.trim()
        : defaults.apiBaseUrl,
      themePreset:
        typeof parsed.themePreset === "string" && parsed.themePreset.trim()
          ? parsed.themePreset.trim()
          : defaults.themePreset,
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

function normalizeTranscriptionModel(value) {
  const safe = typeof value === "string" ? value.trim().toLowerCase() : "";
  return TRANSCRIPTION_MODEL_OPTIONS.some((option) => option.value === safe) ? safe : "small";
}

function normalizeThemePreset(value) {
  const safe = typeof value === "string" ? value.trim() : "";
  return THEME_PRESETS.some((preset) => preset.value === safe) ? safe : "mint";
}

function normalizeDischargeEngine(value) {
  const safe = typeof value === "string" ? value.trim().toLowerCase() : "";
  return safe === "rule" ? "rule" : "ai";
}

function getSupportedRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";

  for (const candidate of RECORDER_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return "";
}

function getExtensionForMimeType(mimeType) {
  const safe = (mimeType || "").toLowerCase();
  if (safe.includes("ogg")) return "ogg";
  if (safe.includes("mp4")) return "mp4";
  if (safe.includes("mpeg")) return "mp3";
  if (safe.includes("wav")) return "wav";
  return "webm";
}

function buildDischargeDocumentText(fields = {}, disclaimer = "") {
  const lines = [
    "Otpusna lista",
    "",
    `Pacijent: ${fields.patient_name || ""}`,
    `Pacijent ID: ${fields.patient_id || ""}`,
    `Odeljenje: ${fields.department || ""}`,
    `Lekar: ${fields.doctor_name || ""}`,
    `Datum prijema: ${fields.admission_date || ""}`,
    `Datum otpusta: ${fields.discharge_date || ""}`,
    "",
    "Glavna dijagnoza:",
    fields.main_diagnosis || "",
    "",
    "Pratece dijagnoze:",
    fields.secondary_diagnoses || "",
    "",
    "Anamneza / razlog prijema:",
    fields.anamnesis || "",
    "",
    "Tok hospitalizacije:",
    fields.hospital_course || "",
    "",
    "Procedure i nalazi:",
    fields.procedures || "",
    "",
    "Terapija tokom lecenja:",
    fields.therapy_during_stay || "",
    "",
    "Terapija pri otpustu:",
    fields.therapy_on_discharge || "",
    "",
    "Preporuke:",
    fields.recommendations || "",
    "",
    "Plan kontrole:",
    fields.follow_up || "",
    "",
    "Upozorenja (red flags):",
    fields.red_flags || "",
  ];

  if (disclaimer) {
    lines.push("", "Napomena:", disclaimer);
  }

  return lines.join("\n");
}

function App() {
  const initialSettings = useMemo(() => loadSettings(), []);
  const [activePage, setActivePage] = useState("transcribe");
  const [theme, setTheme] = useState(getInitialTheme);
  const [themePreset, setThemePreset] = useState(
    normalizeThemePreset(localStorage.getItem(THEME_PRESET_KEY) || initialSettings.themePreset)
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [audioFile, setAudioFile] = useState(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState("");
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState("");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState("");
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0);
  const [waveformBars, setWaveformBars] = useState([]);
  const [waveformDuration, setWaveformDuration] = useState(0);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const [waveformError, setWaveformError] = useState("");
  const [language, setLanguage] = useState(normalizeLanguage(initialSettings.defaultLanguage));
  const [wordTimestamps, setWordTimestamps] = useState(initialSettings.defaultWordTimestamps);
  const [transcriptionModel, setTranscriptionModel] = useState(
    normalizeTranscriptionModel(initialSettings.defaultTranscriptionModel)
  );
  const [apiBaseUrl, setApiBaseUrl] = useState(initialSettings.apiBaseUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [dischargeForm, setDischargeForm] = useState({
    patientName: "",
    patientId: "",
    doctorName: "",
    department: "Interno odeljenje",
    admissionDate: "",
    dischargeDate: "",
  });
  const [dischargeDraft, setDischargeDraft] = useState(null);
  const [dischargeLoading, setDischargeLoading] = useState(false);
  const [dischargeError, setDischargeError] = useState("");
  const [correctionLoading, setCorrectionLoading] = useState(false);
  const [correctionError, setCorrectionError] = useState("");
  const [correctionInfo, setCorrectionInfo] = useState(null);
  const [correctedTranscript, setCorrectedTranscript] = useState("");
  const [correctionItems, setCorrectionItems] = useState([]);
  const [useCorrectedTranscript, setUseCorrectedTranscript] = useState(true);
  const [dischargeDocumentText, setDischargeDocumentText] = useState("");
  const [dischargeEngine, setDischargeEngine] = useState(() =>
    normalizeDischargeEngine(localStorage.getItem(DISCHARGE_ENGINE_STORAGE_KEY))
  );
  const [history, setHistory] = useState(loadHistory);
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [settingsForm, setSettingsForm] = useState({
    ...initialSettings,
    defaultLanguage: normalizeLanguage(initialSettings.defaultLanguage),
    defaultTranscriptionModel: normalizeTranscriptionModel(initialSettings.defaultTranscriptionModel),
    themePreset: normalizeThemePreset(initialSettings.themePreset),
  });
  const [settingsMessage, setSettingsMessage] = useState("");
  const audioRef = useRef(null);
  const recorderPreviewRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);
  const waveformCanvasRef = useRef(null);
  const waveformContainerRef = useRef(null);

  const microphoneSupported = useMemo(() => {
    return Boolean(
      typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      typeof MediaRecorder !== "undefined"
    );
  }, []);

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
    if (!mobileMenuOpen) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";
    const onEscape = (event) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onEscape);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const normalized = normalizeThemePreset(themePreset);
    document.documentElement.setAttribute("data-theme-preset", normalized);
    localStorage.setItem(THEME_PRESET_KEY, normalized);
  }, [themePreset]);

  useEffect(() => {
    localStorage.setItem(DISCHARGE_ENGINE_STORAGE_KEY, dischargeEngine);
  }, [dischargeEngine]);

  useEffect(() => {
    setCorrectionLoading(false);
    setCorrectionError("");
    setCorrectionInfo(null);
    setCorrectedTranscript("");
    setCorrectionItems([]);
    setUseCorrectedTranscript(true);
    setDischargeDocumentText("");
  }, [result?.id]);

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

  useEffect(() => {
    if (!recordedBlob) {
      setRecordedAudioUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(recordedBlob);
    setRecordedAudioUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [recordedBlob]);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
      }

      if (mediaRecorderRef.current && mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const canSubmit = useMemo(() => Boolean(audioFile) && !loading, [audioFile, loading]);
  const canTranscribeRecording = useMemo(() => Boolean(recordedBlob) && !isRecording && !loading, [recordedBlob, isRecording, loading]);
  const selectedTranscriptionModel = useMemo(
    () => TRANSCRIPTION_MODEL_OPTIONS.find((option) => option.value === transcriptionModel) || TRANSCRIPTION_MODEL_OPTIONS[0],
    [transcriptionModel]
  );
  const ThemeIcon = theme === "dark" ? FiSun : FiMoon;
  const themeLabel = theme === "dark" ? "Light Theme" : "Dark Theme";

  const selectedHistory = useMemo(() => {
    return history.find((entry) => entry.id === selectedHistoryId) || null;
  }, [history, selectedHistoryId]);

  const activeResultAudioUrl = useMemo(() => {
    if (!result) return "";
    return result.source === "microphone" ? recordedAudioUrl : audioPreviewUrl;
  }, [result, recordedAudioUrl, audioPreviewUrl]);

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

  useEffect(() => {
    if (!activeResultAudioUrl) {
      setWaveformBars([]);
      setWaveformDuration(0);
      setWaveformError("");
      return;
    }

    let cancelled = false;
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    async function buildWaveform() {
      setWaveformLoading(true);
      setWaveformError("");

      try {
        const response = await fetch(activeResultAudioUrl);
        const buffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));

        if (cancelled) return;

        const data = audioBuffer.getChannelData(0);
        const bucketCount = 240;
        const blockSize = Math.max(1, Math.floor(data.length / bucketCount));
        const bars = new Array(bucketCount).fill(0);

        for (let i = 0; i < bucketCount; i += 1) {
          let peak = 0;
          const start = i * blockSize;
          const end = Math.min(start + blockSize, data.length);

          for (let j = start; j < end; j += 1) {
            const value = Math.abs(data[j]);
            if (value > peak) {
              peak = value;
            }
          }
          bars[i] = peak;
        }

        const maxPeak = Math.max(...bars, 0.001);
        const normalizedBars = bars.map((value) => value / maxPeak);

        setWaveformBars(normalizedBars);
        setWaveformDuration(audioBuffer.duration || 0);
      } catch {
        if (!cancelled) {
          setWaveformBars([]);
          setWaveformDuration(0);
          setWaveformError("Waveform prikaz nije dostupan za ovaj audio.");
        }
      } finally {
        if (!cancelled) {
          setWaveformLoading(false);
        }
      }
    }

    buildWaveform();

    return () => {
      cancelled = true;
      audioContext.close().catch(() => { });
    };
  }, [activeResultAudioUrl]);

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    const container = waveformContainerRef.current;
    if (!canvas || !container || waveformBars.length === 0) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = container.clientWidth;
      const height = 132;

      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const styles = getComputedStyle(document.documentElement);
      const borderColor = styles.getPropertyValue("--border").trim() || "rgba(34, 87, 122, 0.2)";
      const accentColor = styles.getPropertyValue("--c2").trim() || "#38a3a5";
      const accentMuted = styles.getPropertyValue("--text-muted").trim() || "#5d7788";
      const segmentColor = styles.getPropertyValue("--c3").trim() || "#57cc99";
      const activeSegmentColor = styles.getPropertyValue("--c1").trim() || "#22577a";

      context.clearRect(0, 0, width, height);

      const progressRatio = waveformDuration > 0 ? Math.min(1, Math.max(0, currentPlaybackTime / waveformDuration)) : 0;
      const barWidth = width / waveformBars.length;

      for (let i = 0; i < waveformBars.length; i += 1) {
        const value = waveformBars[i];
        const x = i * barWidth;
        const normalized = Math.max(0.06, value);
        const barHeight = normalized * (height - 24);
        const y = (height - barHeight) / 2;
        const played = x / width <= progressRatio;

        context.fillStyle = played ? accentColor : accentMuted;
        context.globalAlpha = played ? 0.85 : 0.35;
        context.fillRect(x + 0.9, y, Math.max(1.4, barWidth - 1.8), barHeight);
      }

      context.globalAlpha = 1;
      context.strokeStyle = borderColor;
      context.lineWidth = 1;
      context.strokeRect(0.5, 0.5, width - 1, height - 1);

      if (Array.isArray(result?.segments) && waveformDuration > 0) {
        result.segments.forEach((segment, index) => {
          const markerX = (segment.start / waveformDuration) * width;
          context.beginPath();
          context.moveTo(markerX, 6);
          context.lineTo(markerX, height - 6);
          context.lineWidth = activeSegmentIndex === index ? 2.2 : 1.2;
          context.strokeStyle = activeSegmentIndex === index ? activeSegmentColor : segmentColor;
          context.globalAlpha = activeSegmentIndex === index ? 0.95 : 0.55;
          context.stroke();
        });
      }

      context.globalAlpha = 1;
    };

    draw();
    const observer = new ResizeObserver(() => draw());
    observer.observe(container);

    return () => observer.disconnect();
  }, [waveformBars, waveformDuration, currentPlaybackTime, result, activeSegmentIndex, theme, themePreset]);

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

  function useHistoryRecordForDischarge(record) {
    if (!record) return;
    setResult(record);
    setDischargeDraft(null);
    setDischargeDocumentText("");
    setDischargeError("");
    setCurrentPlaybackTime(0);
    goToPage("discharge");
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
    const preferredRef =
      result?.source === "microphone" ? recorderPreviewRef.current : audioRef.current;
    const player = preferredRef || audioRef.current || recorderPreviewRef.current;
    if (!player) return;

    player.currentTime = Math.max(0, Number(start) || 0);
    player.play().catch(() => { });
  }

  function handleWaveformSeek(event) {
    if (!waveformDuration) return;

    const canvas = waveformCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const offsetX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const ratio = rect.width > 0 ? offsetX / rect.width : 0;
    const targetTime = ratio * waveformDuration;

    const preferredRef = result?.source === "microphone" ? recorderPreviewRef.current : audioRef.current;
    const player = preferredRef || audioRef.current || recorderPreviewRef.current;
    if (!player) return;

    player.currentTime = targetTime;
    setCurrentPlaybackTime(targetTime);
    player.play().catch(() => { });
  }

  async function submitTranscriptionFile(fileToTranscribe, options = {}) {
    const endpoint = options.fromMicrophone ? "/transcribe-microphone" : "/transcribe";
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const createdAt = new Date().toISOString();

    setJobs((prev) =>
      [
        {
          id: jobId,
          fileName: fileToTranscribe.name,
          status: "uploading",
          createdAt,
          updatedAt: createdAt,
          source: options.fromMicrophone ? "microphone" : "upload",
        },
        ...prev,
      ].slice(0, 40)
    );

    setLoading(true);
    setError("");
    setResult(null);
    setDischargeDraft(null);
    setDischargeError("");

    try {
      updateJob(jobId, { status: "transcribing", updatedAt: new Date().toISOString() });

      const formData = new FormData();
      formData.append("file", fileToTranscribe);
      formData.append("word_timestamps", String(wordTimestamps));
      formData.append("transcription_model", transcriptionModel);

      if (language.trim()) {
        formData.append("language", language.trim());
      }

      const response = await fetch(`${apiBaseUrl}${endpoint}`, {
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
        fileName: fileToTranscribe.name,
        requestedLanguage: language.trim() || null,
        usedWordTimestamps: wordTimestamps,
        usedTranscriptionModel: normalized.model_used || transcriptionModel,
        usedTranscriptionModelName: normalized.model_name || "",
        source: options.fromMicrophone ? "microphone" : "upload",
      };

      setResult(finalRecord);
      saveHistoryEntry(finalRecord);
      updateJob(jobId, {
        status: "done",
        updatedAt: new Date().toISOString(),
        segmentCount: normalized.segments.length,
      });
    } catch (err) {
      setError(err.message || "Došlo je do greške.");
      updateJob(jobId, {
        status: "error",
        error: err.message || "Unknown error",
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!audioFile) {
      setError("Prvo izaberi audio fajl.");
      return;
    }

    await submitTranscriptionFile(audioFile);
  }

  async function startRecording() {
    if (!microphoneSupported) {
      setRecordingError("Browser ne podrzava snimanje mikrofona.");
      return;
    }

    try {
      setRecordingError("");
      setError("");
      setRecordedBlob(null);
      setRecordingSeconds(0);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      recordingChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const finalMime = recorder.mimeType || "audio/webm";
        const finalBlob = new Blob(recordingChunksRef.current, { type: finalMime });
        setRecordedBlob(finalBlob.size ? finalBlob : null);
        setIsRecording(false);

        if (recordingTimerRef.current) {
          window.clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.onerror = () => {
        setRecordingError("Došlo je do greške tokom snimanja.");
      };

      recorder.start(200);
      setIsRecording(true);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((seconds) => seconds + 1);
      }, 1000);
    } catch {
      setRecordingError("Pristup mikrofonu nije dozvoljen ili nije dostupan.");
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  async function transcribeRecordedAudio() {
    if (!recordedBlob) {
      setRecordingError("Nema snimljenog audio zapisa.");
      return;
    }

    const extension = getExtensionForMimeType(recordedBlob.type);
    const file = new File([recordedBlob], `mic-recording-${Date.now()}.${extension}`, {
      type: recordedBlob.type || "audio/webm",
    });

    await submitTranscriptionFile(file, { fromMicrophone: true });
  }

  function restartRecordingSession() {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;

      if (recorder.stream) {
        recorder.stream.getTracks().forEach((track) => track.stop());
      }

      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Ignore stop errors on restart.
        }
      }

      mediaRecorderRef.current = null;
    }

    recordingChunksRef.current = [];
    setIsRecording(false);
    setRecordingSeconds(0);
    setRecordedBlob(null);
    setRecordedAudioUrl("");
    setRecordingError("");
    setCurrentPlaybackTime(0);
    setError("");

    if (recorderPreviewRef.current) {
      recorderPreviewRef.current.pause();
      recorderPreviewRef.current.currentTime = 0;
    }

    if (result?.source === "microphone") {
      setResult(null);
    }
  }

  function handleSettingsSave(event) {
    event.preventDefault();
    const clean = {
      defaultLanguage: normalizeLanguage(settingsForm.defaultLanguage),
      defaultWordTimestamps: Boolean(settingsForm.defaultWordTimestamps),
      defaultTranscriptionModel: normalizeTranscriptionModel(settingsForm.defaultTranscriptionModel),
      apiBaseUrl: settingsForm.apiBaseUrl.trim() || DEFAULT_API_BASE_URL,
      themePreset: normalizeThemePreset(settingsForm.themePreset),
    };

    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(clean));
    setApiBaseUrl(clean.apiBaseUrl);
    setLanguage(clean.defaultLanguage);
    setWordTimestamps(clean.defaultWordTimestamps);
    setTranscriptionModel(clean.defaultTranscriptionModel);
    setThemePreset(clean.themePreset);
    setSettingsForm(clean);
    setSettingsMessage("Settings su sacuvane.");
  }

  function exportDischargeDraftTxt() {
    if (!dischargeDraft?.fields && !dischargeDocumentText.trim()) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fallbackText = buildDischargeDocumentText(dischargeDraft?.fields || {}, dischargeDraft?.disclaimer || "");
    const finalText = dischargeDocumentText.trim() ? dischargeDocumentText : fallbackText;
    downloadFile(`otpusna-lista-demo-${stamp}.txt`, finalText, "text/plain;charset=utf-8");
  }

  async function runTranscriptCorrections() {
    if (!result?.text?.trim()) {
      setCorrectionError("Prvo uradi transkripciju pa zatim pokreni AI korekciju.");
      return;
    }

    setCorrectionLoading(true);
    setCorrectionError("");

    try {
      const response = await fetch(`${apiBaseUrl}/transcript-corrections?fallback_noop=true`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transcript: result.text,
          detected_language: result.detected_language || "",
          segments: result.segments || [],
          max_corrections: 24,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || "AI korekcija nije uspela.");
      }

      const nextCorrected = (data?.corrected_transcript || result.text || "").trim();
      const nextItems = Array.isArray(data?.corrections) ? data.corrections : [];

      setCorrectedTranscript(nextCorrected);
      setCorrectionItems(nextItems);
      setCorrectionInfo({
        engine: data?.engine || "",
        qualityNotes: data?.quality_notes || "",
        aiError: data?.ai_error || "",
      });
      setUseCorrectedTranscript(true);
    } catch (err) {
      setCorrectionError(err.message || "AI korekcija nije uspela.");
    } finally {
      setCorrectionLoading(false);
    }
  }

  async function generateDischargeDraft() {
    if (!result?.text?.trim()) {
      setDischargeError("Prvo uradi transkripciju pa zatim generisi demo otpusnu listu.");
      return;
    }

    setDischargeLoading(true);
    setDischargeError("");
    const transcriptForDraft =
      useCorrectedTranscript && correctedTranscript.trim() ? correctedTranscript.trim() : result.text;
    const usingAiEngine = dischargeEngine === "ai";
    const endpoint = usingAiEngine
      ? `${apiBaseUrl}/discharge-draft-ai?fallback_to_rules=false`
      : `${apiBaseUrl}/discharge-draft`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transcript: transcriptForDraft,
          detected_language: result.detected_language || "",
          segments: result.segments || [],
          patient_name: dischargeForm.patientName,
          patient_id: dischargeForm.patientId,
          doctor_name: dischargeForm.doctorName,
          department: dischargeForm.department,
          admission_date: dischargeForm.admissionDate,
          discharge_date: dischargeForm.dischargeDate,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || "Generisanje otpusne liste nije uspelo.");
      }

      setDischargeDraft({
        ...data,
        fields: { ...(data.fields || {}) },
        sources: data.sources || {},
      });
      setDischargeDocumentText(
        buildDischargeDocumentText(
          { ...(data.fields || {}) },
          data.disclaimer || ""
        )
      );
    } catch (err) {
      const baseMessage = err.message || "Došlo je do greške tokom generisanja drafta.";
      if (usingAiEngine) {
        setDischargeError(`${baseMessage} Pokreni Ollama servis ili prebaci mode na Rule-based.`);
      } else {
        setDischargeError(baseMessage);
      }
    } finally {
      setDischargeLoading(false);
    }
  }

  function renderTranscriptionResult() {
    if (!result) return null;

    return (
      <section className="results reveal delay-2">
        <div className="card metrics">
          <div className="metric-item">
            <p>Model</p>
            <strong>{result.model_used || result.usedTranscriptionModel || "small"}</strong>
          </div>
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

        <div className="results-layout">
          <div className="results-main">
            <div className="card waveform-card">
              <div className="title-row">
                <h2>Waveform timeline</h2>
                <span className="wave-time">
                  {formatTime(currentPlaybackTime)} /{" "}
                  {formatTime(waveformDuration || result.segments?.[result.segments.length - 1]?.end || 0)}
                </span>
              </div>
              <p className="wave-help">Klikni na talasnu liniju za brzi skok na deo snimka.</p>
              <div className="waveform-wrap" ref={waveformContainerRef}>
                {waveformLoading ? (
                  <div className="waveform-placeholder">
                    <FiLoader className="inline-spin" /> Ucitavam waveform...
                  </div>
                ) : null}
                {!waveformLoading && waveformError ? (
                  <div className="waveform-placeholder">{waveformError}</div>
                ) : null}
                {!waveformLoading && !waveformError && waveformBars.length > 0 ? (
                  <canvas ref={waveformCanvasRef} className="waveform-canvas" onClick={handleWaveformSeek} />
                ) : null}
              </div>
            </div>
          </div>

          <aside className="results-sticky">
            <div className="card sticky-transcript">
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

              <h2>Vremenski segmenti</h2>
              {Array.isArray(result.segments) && result.segments.length > 0 ? (
                <ul className="segments">
                  {result.segments.map((segment, index) => (
                    <li
                      key={`${segment.start}-${segment.end}-${index}`}
                      className={
                        activeSegmentIndex === index ? "clickable-segment active-segment" : "clickable-segment"
                      }
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
          </aside>
        </div>
      </section>
    );
  }

  return (
    <div className="app-shell">
      <div className="bg-orb orb-a" />
      <div className="bg-orb orb-b" />

      <header className="topbar reveal">
        <div className="topbar-inner">
          <div className="brand-wrap">
            <div className="brand" aria-label="SerbianWhisper AI">
              <img src="/mini-logo.png" alt="SebianWhisper mini logo" />
              <span>SerbianWhisper AI</span>
            </div>
            <p className="topbar-context">Bolnički informacioni sistem | Klinička dokumentacija</p>
          </div>

          <div className="topbar-actions">
            <button
              className={activePage === "settings" ? "settings-entry active" : "settings-entry"}
              onClick={() => goToPage("settings")}
              type="button"
            >
              <FiSettings />
              <span>Settings</span>
            </button>

            <button className="theme-toggle" onClick={toggleTheme} type="button">
              <ThemeIcon />
              <span>{themeLabel}</span>
            </button>

            <button
              type="button"
              className="hamburger-btn"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <FiX /> : <FiMenu />}
            </button>
          </div>
        </div>
      </header>

      <main className="content">
        {mobileMenuOpen ? (
          <button
            type="button"
            className="sidebar-backdrop"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
          />
        ) : null}

        <div className="workspace">
          <aside className={mobileMenuOpen ? "his-sidebar open" : "his-sidebar"}>
            <p className="his-sidebar-title">Navigacija modula</p>
            <nav className="his-nav">
              <button
                className={activePage === "transcribe" ? "menu-btn active" : "menu-btn"}
                onClick={() => goToPage("transcribe")}
                type="button"
              >
                <FiFileText /> Transkripcija
              </button>
              <button
                className={activePage === "recording" ? "menu-btn active" : "menu-btn"}
                onClick={() => goToPage("recording")}
                type="button"
              >
                <FiMic /> Snimanje
              </button>
              <button
                className={activePage === "discharge" ? "menu-btn active" : "menu-btn"}
                onClick={() => goToPage("discharge")}
                type="button"
              >
                <FiFileText /> Otpusna lista
              </button>
              <button
                className={activePage === "history" ? "menu-btn active" : "menu-btn"}
                onClick={() => goToPage("history")}
                type="button"
              >
                <FiClock /> Istorija
              </button>
              <button
                className={activePage === "jobs" ? "menu-btn active" : "menu-btn"}
                onClick={() => goToPage("jobs")}
                type="button"
              >
                <FiLoader /> Jobs
              </button>
              <button
                className={activePage === "about" ? "menu-btn active" : "menu-btn"}
                onClick={() => goToPage("about")}
                type="button"
              >
                <FiSettings /> O projektu
              </button>
            </nav>
          </aside>

          <div className="workspace-main">
            {activePage === "transcribe" ? (
              <section className="panel">
                <div className="hero reveal">
                  <img className="hero-logo" src="/serbianwhisper-logo.jpg" alt="SebianWhisper logo" />
                  <div className="hero-copy">
                    <h1>SerbianWhisper Clinical Assistant</h1>
                    <p>
                      Bolnički demo sistem za klinički diktat, transkripciju i automatsko formiranje
                      draft otpusne liste. Sve radi lokalno i pripremljeno je za workflow sa medicinskom
                      validacijom.
                    </p>
                    <div className="hero-badges">
                      <span>HIS demo UI</span>
                      <span>Klinička dokumentacija</span>
                      <span>Audit workflow</span>
                    </div>
                    <div className="clinical-summary">
                      <span>
                        Transkripcija: {selectedTranscriptionModel.label} ({selectedTranscriptionModel.subtitle})
                      </span>
                      <span>Dokument: lokalni demo generator otpusne liste</span>
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
                        onChange={(event) => setAudioFile(event.target.files?.[0] || null)}
                      />
                      <span className="upload-title">
                        {audioFile ? audioFile.name : "Prevuci ili izaberi audio fajl"}
                      </span>
                      <span className="upload-help">Podrzano: mp3, wav, m4a, ogg i ostali formati</span>
                    </label>
                  </div>

                  <div className="field">
                    <label>Faster-Whisper model</label>
                    <div className="preset-grid">
                      {TRANSCRIPTION_MODEL_OPTIONS.map((option) => (
                        <button
                          type="button"
                          key={`transcribe-model-${option.value}`}
                          className={transcriptionModel === option.value ? "preset-btn active" : "preset-btn"}
                          onClick={() => setTranscriptionModel(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="input-row">
                    <div className="field">
                      <label htmlFor="language">Kod jezika (opciono)</label>
                      <select id="language" value={language} onChange={(event) => setLanguage(event.target.value)}>
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
                        Molim sačekaj dok model završi transkripciju. Veće audio datoteke mogu trajati
                        malo duže.
                      </p>
                    </div>
                  </div>
                ) : null}

                {error ? <p className="error reveal">{error}</p> : null}
                {result?.source !== "microphone" ? renderTranscriptionResult() : null}
              </section>
            ) : null}

            {activePage === "recording" ? (
              <section className="panel reveal">
                <div className="card recording-card">
                  <div className="recording-head">
                    <div>
                      <h1>Klinicko snimanje</h1>
                      <p className="recording-intro">
                        Snimi klinički diktat, proveri audio i jednim klikom prebaci rezultat u transkript
                        spreman za dokumentaciju pacijenta.
                      </p>
                    </div>
                    <div className="recording-status-wrap">
                      <span className={isRecording ? "recording-status on" : "recording-status"}>
                        {isRecording ? "Snimanje: ON" : "Snimanje: OFF"}
                      </span>
                      <span className={isRecording ? "recording-timer live" : "recording-timer"}>
                        {formatTime(recordingSeconds)}
                      </span>
                    </div>
                  </div>

                  <div className="recording-kpis">
                    <article>
                      <p>Status mikrofona</p>
                      <strong>{microphoneSupported ? "Dostupan" : "Nije dostupan"}</strong>
                    </article>
                    <article>
                      <p>Model</p>
                      <strong>{selectedTranscriptionModel.label}</strong>
                    </article>
                    <article>
                      <p>Aktivni jezik</p>
                      <strong>{language || "Auto detect"}</strong>
                    </article>
                    <article>
                      <p>Word timestamps</p>
                      <strong>{wordTimestamps ? "Ukljuceno" : "Iskljuceno"}</strong>
                    </article>
                  </div>

                  <div className="recording-workspace">
                    <div className="recording-main">
                      <div className={isRecording ? "recording-visualizer live" : "recording-visualizer"}>
                        <span />
                        <span />
                        <span />
                        <span />
                        <span />
                        <span />
                      </div>

                      <div className="recording-control-grid">
                        <button
                          type="button"
                          className={isRecording ? "ghost-btn" : "primary-btn"}
                          onClick={startRecording}
                          disabled={isRecording || !microphoneSupported}
                        >
                          <FiMic /> Start snimanja
                        </button>
                        <button type="button" className="ghost-btn" onClick={stopRecording} disabled={!isRecording}>
                          <FiSquare /> Stop
                        </button>
                        <button type="button" className="ghost-btn" onClick={restartRecordingSession} disabled={loading}>
                          <FiRotateCcw /> Restart
                        </button>
                        <button
                          type="button"
                          className="primary-btn"
                          onClick={transcribeRecordedAudio}
                          disabled={!canTranscribeRecording}
                        >
                          {loading ? (
                            <>
                              <FiLoader className="inline-spin" /> Transkribujem...
                            </>
                          ) : (
                            "Sačuvaj i transkribuj"
                          )}
                        </button>
                      </div>

                      <div className="recording-meta compact">
                        <span>Duzina snimka: {formatTime(recordingSeconds)}</span>
                        <span>Jezik: {language || "auto"}</span>
                      </div>

                      <div className="field">
                        <label>Faster-Whisper model</label>
                        <div className="preset-grid">
                          {TRANSCRIPTION_MODEL_OPTIONS.map((option) => (
                            <button
                              type="button"
                              key={`recording-model-${option.value}`}
                              className={transcriptionModel === option.value ? "preset-btn active" : "preset-btn"}
                              onClick={() => setTranscriptionModel(option.value)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="input-row recording-options">
                        <div className="field">
                          <label htmlFor="recording-language">Kod jezika (opciono)</label>
                          <select
                            id="recording-language"
                            value={language}
                            onChange={(event) => setLanguage(event.target.value)}
                          >
                            {LANGUAGE_OPTIONS.map((option) => (
                              <option key={`recording-${option.value || "auto"}`} value={option.value}>
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
                    </div>

                    <aside className="recording-guide">
                      <h3>Check lista pre snimanja</h3>
                      <ul>
                        <li>Potvrdi identitet pacijenta i broj istorije bolesti.</li>
                        <li>Govori jasno i navedi kljucne sekcije (anamneza, dijagnoza, terapija).</li>
                        <li>Posle transkripcije obavezno uradi stručnu medicinsku proveru.</li>
                      </ul>
                    </aside>
                  </div>

                  {!microphoneSupported ? (
                    <p className="error">Tvoj browser ne podrzava MediaRecorder API.</p>
                  ) : null}

                  {recordingError ? <p className="error">{recordingError}</p> : null}
                </div>

                {recordedAudioUrl ? (
                  <div className="card audio-card reveal">
                    <h3>Snimljeni audio</h3>
                    <audio
                      ref={recorderPreviewRef}
                      controls
                      src={recordedAudioUrl}
                      onTimeUpdate={(event) => setCurrentPlaybackTime(event.currentTarget.currentTime)}
                    />
                  </div>
                ) : null}

                {loading ? (
                  <div className="card loading-card reveal">
                    <FiLoader className="spinner-icon" />
                    <div>
                      <h3>Transkripcija snimka je u toku</h3>
                      <p>Obrada će automatski prikazati rezultat ispod čim se završi.</p>
                    </div>
                  </div>
                ) : null}

                {error ? <p className="error reveal">{error}</p> : null}
                {result?.source === "microphone" ? renderTranscriptionResult() : null}
              </section>
            ) : null}

            {activePage === "discharge" ? (
              <section className="panel reveal">
                <div className="card discharge-hero">
                  <div>
                    <h1>Demo generator otpusne liste</h1>
                    <p>
                      Stranica pretvara transkript u strukturisan nacrt otpusne liste koji je spreman
                      za lekarsku proveru i finalnu dopunu u bolnickom procesu.
                    </p>
                  </div>
                  <span className="discharge-badge">Local Free Demo</span>
                </div>

                <div className="discharge-layout">
                  <form
                    className="card discharge-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      generateDischargeDraft();
                    }}
                  >
                    <h2>Osnovni podaci pacijenta</h2>

                    <div className="field">
                      <label>Engine za generisanje</label>
                      <div className="preset-grid">
                        <button
                          type="button"
                          className={dischargeEngine === "ai" ? "preset-btn active" : "preset-btn"}
                          onClick={() => setDischargeEngine("ai")}
                          disabled={dischargeLoading}
                        >
                          AI model
                        </button>
                        <button
                          type="button"
                          className={dischargeEngine === "rule" ? "preset-btn active" : "preset-btn"}
                          onClick={() => setDischargeEngine("rule")}
                          disabled={dischargeLoading}
                        >
                          Rule-based
                        </button>
                      </div>
                    </div>

                    <div className="field">
                      <label>AI korekcija transkripta</label>
                      <div className="export-actions">
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={runTranscriptCorrections}
                          disabled={correctionLoading || !result?.text}
                        >
                          {correctionLoading ? (
                            <>
                              <FiLoader className="inline-spin" /> Analiziram tekst...
                            </>
                          ) : (
                            <>
                              <FiFileText /> AI ispravi transkript
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={useCorrectedTranscript}
                          className={useCorrectedTranscript ? "toggle-control on" : "toggle-control"}
                          onClick={() => setUseCorrectedTranscript((current) => !current)}
                          disabled={!correctedTranscript}
                        >
                          <span className="toggle-track">
                            <span className="toggle-thumb" />
                          </span>
                          <span className="toggle-text">Koristi korigovani tekst za draft</span>
                        </button>
                      </div>
                      {correctionInfo?.engine ? <span className="source-chip">Correction engine: {correctionInfo.engine}</span> : null}
                      {correctionInfo?.qualityNotes ? <span className="source-chip">Notes: {correctionInfo.qualityNotes}</span> : null}
                      {correctionInfo?.aiError ? <span className="source-chip">AI warning: {correctionInfo.aiError}</span> : null}
                      {correctionError ? <p className="error">{correctionError}</p> : null}
                    </div>

                    <div className="field">
                      <label htmlFor="patient-name">Ime i prezime</label>
                      <input
                        id="patient-name"
                        type="text"
                        value={dischargeForm.patientName}
                        onChange={(event) =>
                          setDischargeForm((prev) => ({
                            ...prev,
                            patientName: event.target.value,
                          }))
                        }
                        placeholder="npr. Petar Petrovic"
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="patient-id">Pacijent ID / broj istorije</label>
                      <input
                        id="patient-id"
                        type="text"
                        value={dischargeForm.patientId}
                        onChange={(event) =>
                          setDischargeForm((prev) => ({
                            ...prev,
                            patientId: event.target.value,
                          }))
                        }
                        placeholder="npr. HIS-2026-00125"
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="doctor-name">Lekar</label>
                      <input
                        id="doctor-name"
                        type="text"
                        value={dischargeForm.doctorName}
                        onChange={(event) =>
                          setDischargeForm((prev) => ({
                            ...prev,
                            doctorName: event.target.value,
                          }))
                        }
                        placeholder="npr. Dr Dimitrije Milenković"
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="department">Odeljenje</label>
                      <input
                        id="department"
                        type="text"
                        value={dischargeForm.department}
                        onChange={(event) =>
                          setDischargeForm((prev) => ({
                            ...prev,
                            department: event.target.value,
                          }))
                        }
                        placeholder="npr. Interno odeljenje"
                      />
                    </div>

                    <div className="discharge-date-row">
                      <div className="field">
                        <label htmlFor="admission-date">Datum prijema</label>
                        <input
                          id="admission-date"
                          type="text"
                          value={dischargeForm.admissionDate}
                          onChange={(event) =>
                            setDischargeForm((prev) => ({
                              ...prev,
                              admissionDate: event.target.value,
                            }))
                          }
                          placeholder="YYYY-MM-DD"
                        />
                      </div>

                      <div className="field">
                        <label htmlFor="discharge-date">Datum otpusta</label>
                        <input
                          id="discharge-date"
                          type="text"
                          value={dischargeForm.dischargeDate}
                          onChange={(event) =>
                            setDischargeForm((prev) => ({
                              ...prev,
                              dischargeDate: event.target.value,
                            }))
                          }
                          placeholder="YYYY-MM-DD"
                        />
                      </div>
                    </div>

                    <p className="discharge-supporting-text">
                      {result?.text
                        ? `Aktivni transkript: ${result.fileName || "trenutni audio"}`
                        : "Nema aktivnog transkripta. Prvo uradi transkripciju na stranici Transkripcija ili Snimanje."}
                    </p>
                    {correctedTranscript ? (
                      <p className="discharge-supporting-text">
                        Aktivni izvor za draft: {useCorrectedTranscript ? "AI korigovan transkript" : "Original transkript"}
                      </p>
                    ) : null}

                    <button type="submit" className="primary-btn" disabled={dischargeLoading || !result?.text}>
                      {dischargeLoading ? (
                        <>
                          <FiLoader className="inline-spin" /> {dischargeEngine === "ai" ? "Generisem AI draft..." : "Generisem rule draft..."}
                        </>
                      ) : (
                        <>
                          <FiFileText /> Generisi otpusnu listu
                        </>
                      )}
                    </button>

                    {dischargeError ? <p className="error">{dischargeError}</p> : null}
                  </form>

                  <div className="card discharge-editor">
                    <div className="title-row">
                      <h2>Draft otpusne liste</h2>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={exportDischargeDraftTxt}
                        disabled={!dischargeDocumentText.trim()}
                      >
                        <FiDownload /> Export TXT
                      </button>
                    </div>

                    {!dischargeDraft?.fields ? (
                      <p className="discharge-empty">
                        Kada kliknes <strong>Generisi otpusnu listu</strong>, ovde ces dobiti editable demo dokument.
                      </p>
                    ) : (
                      <div className="discharge-fields">
                        <div className="discharge-meta">
                          <span>{dischargeDraft.document_title || "Demo Otpusna Lista"}</span>
                          <span>{dischargeDraft.generated_at ? formatDate(dischargeDraft.generated_at) : ""}</span>
                          <span>{dischargeDraft.engine || "engine:n/a"}</span>
                        </div>

                        <p className="disclaimer-note">{dischargeDraft.disclaimer}</p>
                        {dischargeDraft.quality_notes ? (
                          <p className="source-chip">AI quality notes: {dischargeDraft.quality_notes}</p>
                        ) : null}
                        {Array.isArray(correctionItems) && correctionItems.length > 0 ? (
                          <div className="correction-list">
                            <h3>Predložene korekcije transkripta</h3>
                            <ul>
                              {correctionItems.map((item, index) => (
                                <li key={`${item.original}-${item.suggested}-${index}`}>
                                  <strong>{item.original}</strong> → <strong>{item.suggested}</strong>{" "}
                                  {item.reason ? <span>({item.reason})</span> : null}{" "}
                                  {typeof item.confidence === "number"
                                    ? <em>{`${(item.confidence * 100).toFixed(0)}%`}</em>
                                    : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <div className="field">
                          <label htmlFor="discharge-document">Dokument otpusne liste</label>
                          <textarea
                            id="discharge-document"
                            className="discharge-document-box"
                            rows={24}
                            value={dischargeDocumentText}
                            onChange={(event) => setDischargeDocumentText(event.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
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
                      <p>Još uvek nema sačuvanih transkripata.</p>
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
                          <span className="history-lang">Model: {item.model_used || item.usedTranscriptionModel || "small"}</span>
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
                              onClick={() => useHistoryRecordForDischarge(selectedHistory)}
                            >
                              <FiFileText /> Otpusna lista
                            </button>
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
                    <p>Trenutno nema job-ova. Pokreni transkripciju da vidiš queue.</p>
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
                      onChange={(event) =>
                        setSettingsForm((prev) => ({
                          ...prev,
                          apiBaseUrl: event.target.value,
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
                      onChange={(event) =>
                        setSettingsForm((prev) => ({
                          ...prev,
                          defaultLanguage: event.target.value,
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

                  <div className="field">
                    <label>Podrazumevani model transkripcije</label>
                    <div className="preset-grid">
                      {TRANSCRIPTION_MODEL_OPTIONS.map((option) => (
                        <button
                          type="button"
                          key={`settings-model-${option.value}`}
                          className={settingsForm.defaultTranscriptionModel === option.value ? "preset-btn active" : "preset-btn"}
                          onClick={() =>
                            setSettingsForm((prev) => ({
                              ...prev,
                              defaultTranscriptionModel: option.value,
                            }))
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="field">
                    <label>Tema paleta</label>
                    <div className="preset-grid">
                      {THEME_PRESETS.map((preset) => (
                        <button
                          type="button"
                          key={preset.value}
                          className={settingsForm.themePreset === preset.value ? "preset-btn active" : "preset-btn"}
                          onClick={() => {
                            setThemePreset(preset.value);
                            setSettingsForm((prev) => ({
                              ...prev,
                              themePreset: preset.value,
                            }));
                          }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
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
                    <span className="toggle-text">Podrazumevano uključi word timestamps</span>
                  </button>

                  <button type="submit" className="primary-btn">
                    Sačuvaj settings
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
                    SerbianWhisper Clinical Assistant je akademski projekat za demonstraciju primene
                    veštačke inteligencije u bolničkom okruženju, sa fokusom na transkripciju i nacrt
                    otpusne liste.
                  </p>

                  <div className="about-grid">
                    <article className="about-item">
                      <h3>Tim</h3>
                      <p>Dimitrije Milenković</p>
                      <p>Nemanja Vidić</p>
                      <p>Stevan Stojanović</p>
                    </article>
                    <article className="about-item">
                      <h3>Institucija</h3>
                      <p>Univerzitet Metropolitan</p>
                      <p>Projekat veštačke inteligencije</p>
                    </article>
                    <article className="about-item">
                      <h3>Univerzitet</h3>
                      <img
                        className="about-metro-image"
                        src="/metropolitan-20.png"
                        alt="Univerzitet Metropolitan 20 godina"
                      />
                      <p>Univerzitet Metropolitan Beograd</p>
                    </article>
                    <article className="about-item">
                      <h3>Modeli</h3>
                      <ul className="about-list">
                        <li>faster-whisper WhisperModel: small + large-v3-turbo</li>
                        <li>Inferencija: CPU + int8 quantization</li>
                        <li>VAD filter + beam size 5</li>
                        <li>Rule-based local discharge draft engine</li>
                      </ul>
                    </article>
                    <article className="about-item">
                      <h3>Cilj sistema</h3>
                      <p>
                        Ubrzanje pripreme kliničke dokumentacije uz obaveznu stručnu proveru pre finalnog
                        izdavanja otpusne liste.
                      </p>
                    </article>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
