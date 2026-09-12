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
  // Движок распознавания диктанта: локальный Whisper (приватно) по умолчанию
  // или «живой текст» браузера (Web Speech API = облако Google)
  const [engine, setEngine] = useState<'local' | 'webspeech'>(() => {
    try {
      const saved = localStorage.getItem('vibescribe_dictation_engine');
      return saved === 'webspeech' ? 'webspeech' : 'local';
    } catch {
      return 'local';
    }
  });
  const [backendType, setBackendType] = useState<
    'webspeech' | 'local-whisper' | 'unsupported'
  >('local-whisper');
  const [dictationError, setDictationError] = useState<string>('');
  // Показывать ли в баннере ошибки кнопку «Переключиться на локальный Whisper»
  const [suggestLocalSwitch, setSuggestLocalSwitch] = useState(false);

  // Показать ошибку диктанта в видимом баннере (с опциональным предложением сменить движок)
  const showDictationError = (message: string, canSwitchToLocal = false) => {
    setDictationError(message);
    setSuggestLocalSwitch(canSwitchToLocal);
  };

  const clearDictationError = () => {
    setDictationError('');
    setSuggestLocalSwitch(false);
  };

  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const chunkTimerRef = useRef<any>(null);
  const isRecordingRef = useRef(false);
  const isPausedRef = useRef(false);
  const chunkFailuresRef = useRef(0);

  // Сохраняем выбранный движок диктанта
  useEffect(() => {
    try {
      localStorage.setItem('vibescribe_dictation_engine', engine);
    } catch {}
  }, [engine]);

  // Check Web Speech API support (нужен только для режима «Живой текст браузера»)
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (engine === 'webspeech' && SpeechRecognition) {
      setBackendType('webspeech');
    } else {
      setBackendType('local-whisper');
    }
  }, [engine]);

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

  // Отправка одного аудиофрагмента на локальный Whisper через сервер
  const sendChunkToServer = async (blob: Blob) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      try {
        const res = await fetch('/api/dictate-chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: base64,
            mimeType: blob.type || 'audio/webm',
            language: selectedLanguage.split('-')[0],
            autoPunctuation,
          }),
        });
        if (res.ok) {
          chunkFailuresRef.current = 0;
          const data = await res.json();
          if (data.text) {
            setFinalTranscript((prev) => (prev ? prev + ' ' : '') + data.text);
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Сервер вернул ошибку (HTTP ${res.status})`);
        }
      } catch (err: any) {
        console.error('Dictate chunk error:', err);
        chunkFailuresRef.current += 1;
        showDictationError(err.message || 'Ошибка распознавания фрагмента');
        // Если 3 подряд фрагмента не распознались — останавливаем запись
        if (chunkFailuresRef.current >= 3) {
          stopRecording();
          showDictationError(
            'Запись остановлена: локальный сервер распознавания не отвечает (3 ошибки подряд). Проверьте, что faster-whisper-server запущен.'
          );
        }
      }
    };
    reader.readAsDataURL(blob);
  };

  // Цикл записи: каждые 4 секунды формируем ПОЛНЫЙ файл (stop/start),
  // чтобы каждый фрагмент был самостоятельно декодируемым для Whisper
  const startChunkCycle = () => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state !== 'inactive') return;
    if (!isRecordingRef.current || isPausedRef.current) return;
    audioChunksRef.current = [];
    try {
      mr.start();
    } catch {
      return;
    }
    chunkTimerRef.current = setTimeout(() => {
      try {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      } catch {}
    }, 4000);
  };

  // Start Recognition Flow
  const startRecording = async () => {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    // Режим «Живой текст браузера» выбран, но Web Speech API отсутствует
    if (engine === 'webspeech' && !SpeechRecognitionCtor) {
      showDictationError(
        'Этот браузер не поддерживает живое распознавание (Web Speech API). Используйте Chrome или переключитесь на «Локальный Whisper».',
        true
      );
      return;
    }

    // Проверка безопасного контекста: getUserMedia недоступен по HTTP по IP-адресу
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showDictationError(
        'Доступ к микрофону возможен только по HTTPS или http://localhost:3000. Откройте приложение по защищённому адресу (например, через ngrok-туннель) или по localhost.'
      );
      return;
    }

    clearDictationError();
    chunkFailuresRef.current = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await startAudioMeter(stream);

      isRecordingRef.current = true;
      isPausedRef.current = false;

      if (engine === 'webspeech' && SpeechRecognitionCtor) {
        const recognition = new SpeechRecognitionCtor();
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
          const code: string = event?.error || 'unknown';
          console.warn('SpeechRecognition error:', code);

          // 'no-speech' — просто не расслышал, не показываем как ошибку
          if (code === 'no-speech') {
            return;
          }

          // Фатальные коды: останавливаем запись и показываем понятный баннер,
          // иначе цикл auto-restart в onend будет молча спамить ошибками
          if (code === 'network') {
            stopRecording();
            showDictationError(
              'Сервис распознавания Google недоступен (нет связи с серверами Google или они заблокированы сетью). Рекомендуется переключиться на «Локальный Whisper».',
              true
            );
          } else if (code === 'not-allowed' || code === 'service-not-allowed') {
            stopRecording();
            showDictationError(
              'Доступ к микрофону или к сервису распознавания запрещён браузером. Проверьте разрешение на микрофон для этого сайта.',
              code === 'service-not-allowed'
            );
          } else if (code === 'audio-capture') {
            stopRecording();
            showDictationError('Микрофон не найден или занят другим приложением.');
          } else {
            showDictationError(`Ошибка распознавания браузера: ${code}`);
          }
        };

        recognition.onend = () => {
          // Restart if still in active recording state
          if (isRecordingRef.current && !isPausedRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch {}
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      } else {
        // Локальный Whisper: MediaRecorder + отправка фрагментов на /api/dictate-chunk
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };

        mediaRecorder.onstop = () => {
          const chunks = audioChunksRef.current;
          if (chunks.length > 0) {
            // Передаём реальный mimeType фрагмента
            const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            sendChunkToServer(blob);
          }
          // Перезапускаем цикл, если запись всё ещё активна
          if (isRecordingRef.current && !isPausedRef.current) {
            startChunkCycle();
          }
        };

        startChunkCycle();
      }

      setIsRecording(true);
      setIsPaused(false);
    } catch (err: any) {
      isRecordingRef.current = false;
      isPausedRef.current = false;
      showDictationError('Не удалось получить доступ к микрофону: ' + err.message);
    }
  };

  const pauseRecording = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    isPausedRef.current = true;
    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    // Останавливаем текущий фрагмент: onstop отправит его, но не начнёт новый цикл
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    setIsPaused(true);
  };

  const resumeRecording = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch {}
    }
    isPausedRef.current = false;
    // Запускаем новый цикл записи фрагментов
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
      startChunkCycle();
    }
    setIsPaused(false);
  };

  const stopRecording = () => {
    isRecordingRef.current = false;
    isPausedRef.current = false;
    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {}
      mediaRecorderRef.current = null;
    }
    stopAudioMeter();
    setIsRecording(false);
    setIsPaused(false);
    setInterimTranscript('');
  };

  // Корректно останавливаем запись и переключаемся на локальный Whisper
  const switchToLocalEngine = () => {
    stopRecording();
    clearDictationError();
    setEngine('local');
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
      modelId: engine === 'local' ? 'faster-whisper-large-v3' : 'webspeech-browser',
      modelName: engine === 'local' ? 'Локальный Whisper (Диктант)' : 'Живой Голосовой Диктант',
      engineMode: engine === 'local' ? 'local' : 'cloud',
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
                : 'Локальный Whisper (Пакетный)'}
            </span>
          </div>
        </div>

        {/* Options */}
        <div className="flex items-center gap-3">
          {/* Dictation Engine Selector */}
          <div className="flex flex-col gap-0.5">
            <select
              value={engine}
              onChange={(e) => setEngine(e.target.value as 'local' | 'webspeech')}
              disabled={isRecording}
              className="px-2.5 py-1 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
              title="Движок распознавания диктанта"
            >
              <option value="local">Локальный Whisper (приватно)</option>
              <option value="webspeech">Живой текст браузера (Google)</option>
            </select>
            {engine === 'webspeech' && (
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                ⚠️ Аудио отправляется на серверы Google
              </span>
            )}
          </div>

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

      {/* Error / Status notification */}
      {dictationError && (
        <div className="flex items-start justify-between gap-3 p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs leading-relaxed">
          <div className="flex flex-col gap-2">
            <span>{dictationError}</span>
            {suggestLocalSwitch && (
              <button
                onClick={switchToLocalEngine}
                className="self-start px-2.5 py-1 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-red-900/40 text-red-700 dark:text-red-200 font-medium hover:bg-red-100 dark:hover:bg-red-900/70 transition-colors"
              >
                Переключиться на локальный Whisper
              </button>
            )}
          </div>
          <button
            onClick={clearDictationError}
            className="shrink-0 px-2 py-0.5 rounded-md text-red-500 hover:text-red-700 dark:hover:text-red-200 font-semibold"
            title="Скрыть сообщение"
          >
            ✕
          </button>
        </div>
      )}

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
