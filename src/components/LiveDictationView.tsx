import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Square,
  Play,
  Pause,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  Volume2,
  FileText,
  Radio,
  Sliders,
  Send,
} from 'lucide-react';
import { TranscriptionResult } from '../types';

interface LiveDictationViewProps {
  onSaveToResult: (result: TranscriptionResult) => void;
  sessionId: string;
}

export const LiveDictationView: React.FC<LiveDictationViewProps> = ({
  onSaveToResult,
  sessionId,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [pushToTalkMode, setPushToTalkMode] = useState(false);
  const [autoPunctuation, setAutoPunctuation] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState('ru-RU');

  // Text buffers
  const [finalTranscript, setFinalTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [copied, setCopied] = useState(false);

  // Audio recording & volume meter
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [backendType, setBackendType] = useState<
    'webspeech' | 'cloud-chunked' | 'unsupported'
  >('webspeech');

  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Check Web Speech API support
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      setBackendType('webspeech');
    } else {
      setBackendType('cloud-chunked');
    }
  }, []);

  // Timer counter
  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording, isPaused]);

  // Audio level visualizer
  const startAudioMeter = async (stream: MediaStream) => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateMeter = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animFrameRef.current = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch (e) {
      console.warn('Audio meter init error:', e);
    }
  };

  const stopAudioMeter = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== 'closed') {
        try {
          audioContextRef.current.close().catch(() => {});
        } catch {}
      }
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  };

  // Start Recognition Flow
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await startAudioMeter(stream);

      const SpeechRecognition =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = selectedLanguage;

        recognition.onresult = (event: any) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              setFinalTranscript((prev) => {
                const space = prev && !prev.endsWith(' ') ? ' ' : '';
                return prev + space + transcript.trim();
              });
            } else {
              interim += transcript;
            }
          }
          setInterimTranscript(interim);
        };

        recognition.onerror = (event: any) => {
          console.warn('SpeechRecognition error:', event.error);
        };

        recognition.onend = () => {
          // Restart if still in active recording state
          if (isRecording && !isPaused && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch {}
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      } else {
        // Fallback to MediaRecorder + slice chunking
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = async (e) => {
          if (e.data.size > 0) {
            audioChunksRef.current.push(e.data);
            // Process chunk via server
            const blob = new Blob([e.data], { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onload = async () => {
              const base64 = reader.result as string;
              try {
                const res = await fetch('/api/dictate-chunk', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    audioBase64: base64,
                    language: selectedLanguage.split('-')[0],
                    autoPunctuation,
                  }),
                });
                if (res.ok) {
                  const data = await res.json();
                  if (data.text) {
                    setFinalTranscript((prev) => (prev ? prev + ' ' : '') + data.text);
                  }
                }
              } catch (err) {
                console.error('Dictate chunk error:', err);
              }
            };
            reader.readAsDataURL(blob);
          }
        };

        mediaRecorder.start(4000); // 4-second slices
      }

      setIsRecording(true);
      setIsPaused(false);
    } catch (err: any) {
      alert('Не удалось получить доступ к микрофону: ' + err.message);
    }
  };

  const pauseRecording = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
    }
    setIsPaused(true);
  };

  const resumeRecording = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch {}
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
    }
    setIsPaused(false);
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
      mediaRecorderRef.current = null;
    }
    stopAudioMeter();
    setIsRecording(false);
    setIsPaused(false);
    setInterimTranscript('');
  };

  const copyToClipboard = () => {
    const fullText = (finalTranscript + (interimTranscript ? ' ' + interimTranscript : '')).trim();
    if (!fullText) return;
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    setFinalTranscript('');
    setInterimTranscript('');
    setRecordingSeconds(0);
  };

  const handleSendToStudio = () => {
    const text = (finalTranscript + (interimTranscript ? ' ' + interimTranscript : '')).trim();
    if (!text) return;

    const words = text.split(/\s+/).filter(Boolean);
    const result: TranscriptionResult = {
      id: 'dictation_' + Date.now(),
      title: 'Голосовая диктовка (' + new Date().toLocaleTimeString('ru-RU') + ')',
      duration: recordingSeconds || Math.max(5, words.length * 0.4),
      language: selectedLanguage.split('-')[0],
      detectedLanguage: selectedLanguage.split('-')[0],
      languageName: selectedLanguage === 'ru-RU' ? 'Русский' : 'English',
      modelId: 'gemini-3.7-flash',
      modelName: 'Живой Голосовой Диктант',
      engineMode: 'cloud',
      createdAt: new Date().toISOString(),
      fullText: text,
      segments: [
        {
          id: 'seg-1',
          start: 0,
          end: recordingSeconds || 10,
          speaker: 'Диктор',
          text: text,
        },
      ],
      summary: {
        title: 'Заметка из диктовки',
        overview: text.slice(0, 150) + (text.length > 150 ? '...' : ''),
        keyPoints: ['Голосовая запись сохранена'],
      },
      stats: {
        wordCount: words.length,
        charCount: text.length,
      },
    };

    onSaveToResult(result);
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      
      {/* Top Header & Settings bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Живой микрофон
            </span>
          </div>

          <span className="text-xs text-zinc-400">|</span>

          {/* Backend Status indicator */}
          <div className="text-xs text-zinc-500 flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-blue-500" />
            <span>
              {backendType === 'webspeech'
                ? 'Web Speech Streaming (Реальное время)'
                : 'Cloud Slices ASR (Пакетный)'}
            </span>
          </div>
        </div>

        {/* Options */}
        <div className="flex items-center gap-3">
          {/* Language Selector */}
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            disabled={isRecording}
            className="px-2.5 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
          >
            <option value="ru-RU">Русский (RU)</option>
            <option value="en-US">English (US)</option>
            <option value="de-DE">Deutsch (DE)</option>
            <option value="es-ES">Español (ES)</option>
          </select>

          {/* Push-to-Talk Toggle */}
          <button
            onClick={() => setPushToTalkMode(!pushToTalkMode)}
            className={`px-2.5 py-1 text-xs rounded-lg border font-medium transition-colors ${
              pushToTalkMode
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
            }`}
          >
            Push-to-Talk: {pushToTalkMode ? 'ВКЛ' : 'ВЫКЛ'}
          </button>
        </div>
      </div>

      {/* Main Recording Center: Giant Finger-friendly Mic Button */}
      <div className="flex flex-col items-center justify-center p-8 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-gradient-to-b from-white to-zinc-50 dark:from-zinc-900 dark:to-zinc-950 shadow-sm space-y-6">
        
        {/* Timer & Live volume equalizer */}
        <div className="flex flex-col items-center gap-2">
          <div className="font-mono text-3xl sm:text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {formatTimer(recordingSeconds)}
          </div>

          {/* Equalizer bars */}
          <div className="flex items-center gap-1 h-6">
            {Array.from({ length: 12 }).map((_, i) => {
              const active = isRecording && !isPaused && audioLevel > i * 8;
              const height = active ? Math.max(20, (audioLevel / 100) * 24) : 4;
              return (
                <div
                  key={i}
                  className={`w-1.5 rounded-full transition-all duration-75 ${
                    active
                      ? 'bg-emerald-500'
                      : 'bg-zinc-200 dark:bg-zinc-800'
                  }`}
                  style={{ height: `${height}px` }}
                />
              );
            })}
          </div>
        </div>

        {/* Big Finger-Friendly Mic Button */}
        {pushToTalkMode ? (
          <button
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
            className={`w-28 h-28 sm:w-36 sm:h-36 rounded-full flex flex-col items-center justify-center transition-all shadow-xl select-none active:scale-95 ${
              isRecording
                ? 'bg-red-500 text-white ring-8 ring-red-500/20'
                : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 ring-4 ring-zinc-900/10'
            }`}
          >
            <Mic className="w-10 h-10 sm:w-12 sm:h-12" />
            <span className="text-[11px] font-semibold tracking-wide uppercase mt-1">
              {isRecording ? 'Слушаю...' : 'Удерживайте'}
            </span>
          </button>
        ) : (
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`w-28 h-28 sm:w-36 sm:h-36 rounded-full flex flex-col items-center justify-center transition-all shadow-xl active:scale-95 ${
              isRecording
                ? 'bg-red-500 text-white ring-8 ring-red-500/20 animate-pulse'
                : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 ring-4 ring-zinc-900/10'
            }`}
            title={isRecording ? 'Остановить запись' : 'Начать запись'}
          >
            {isRecording ? (
              <>
                <Square className="w-10 h-10 sm:w-12 sm:h-12 fill-current" />
                <span className="text-[11px] font-semibold tracking-wide uppercase mt-1">
                  Стоп
                </span>
              </>
            ) : (
              <>
                <Mic className="w-10 h-10 sm:w-12 sm:h-12" />
                <span className="text-[11px] font-semibold tracking-wide uppercase mt-1">
                  Диктовать
                </span>
              </>
            )}
          </button>
        )}

        {/* Secondary controls (Pause / Resume / Reset) */}
        {isRecording && !pushToTalkMode && (
          <div className="flex items-center gap-3">
            <button
              onClick={isPaused ? resumeRecording : pauseRecording}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
            >
              {isPaused ? (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Продолжить</span>
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>Пауза</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Transcript Text Display Area */}
      <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-zinc-500" />
            <span className="font-semibold text-xs uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
              Распознанный текст в реальном времени
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleClear}
              disabled={!finalTranscript && !interimTranscript}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 text-xs flex items-center gap-1 disabled:opacity-30"
              title="Очистить текст"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Очистить</span>
            </button>

            <button
              onClick={copyToClipboard}
              disabled={!finalTranscript && !interimTranscript}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 text-xs flex items-center gap-1 disabled:opacity-30"
              title="Копировать в буфер"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Скопировано!' : 'Копировать'}</span>
            </button>
          </div>
        </div>

        {/* Text Box */}
        <div className="min-h-[160px] p-4 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/60 text-zinc-900 dark:text-zinc-100 text-sm leading-relaxed whitespace-pre-wrap select-text">
          {finalTranscript || interimTranscript ? (
            <>
              <span>{finalTranscript}</span>
              {interimTranscript && (
                <span className="text-zinc-400 dark:text-zinc-500 italic ml-1">
                  {interimTranscript}
                </span>
              )}
            </>
          ) : (
            <span className="text-zinc-400 dark:text-zinc-600 text-xs italic">
              Нажмите кнопку микрофона и начните говорить. Текст появится здесь моментально...
            </span>
          )}
        </div>

        {/* Action bar: Send to Studio */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={handleSendToStudio}
            disabled={!finalTranscript && !interimTranscript}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Открыть в студии (Резюме, Таймкоды, Экспорт)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
