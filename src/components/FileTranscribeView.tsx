import React, { useState, useRef } from 'react';
import {
  TranscriptionOptions,
  EngineMode,
  TranscriptionResult,
  ModelInfo,
} from '../types';
import { PRESETS, SUPPORTED_LANGUAGES, MODELS_CATALOG } from '../data/models';
import {
  UploadCloud,
  FileAudio,
  Link,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Users,
  Settings2,
  ArrowRight,
  Shield,
  Zap,
  Play,
  RotateCw,
  FolderOpen,
  HelpCircle,
  Cloud,
  Video,
} from 'lucide-react';
import {
  fileToBase64,
  extractAndCompressAudio,
  splitAudioIntoChunks,
  transcribeChunkWithTimeout,
  formatFileSize,
  getAudioDuration,
  isAudioOrVideo,
  estimateProcessingCost,
} from '../utils/audioUtils';
import { formatTimeDisplay } from '../utils/exportUtils';

interface FileTranscribeViewProps {
  engineMode: EngineMode;
  setEngineMode: (mode: EngineMode) => void;
  activeModelId: string;
  setActiveModelId: (modelId: string) => void;
  onTranscriptionSuccess: (result: TranscriptionResult) => void;
  onOpenAdvisor: () => void;
  onOpenSettings: () => void;
  sessionId: string;
  localEndpoint: string;
  localApiKey?: string;
}

export const FileTranscribeView: React.FC<FileTranscribeViewProps> = ({
  engineMode,
  setEngineMode,
  activeModelId,
  setActiveModelId,
  onTranscriptionSuccess,
  onOpenAdvisor,
  onOpenSettings,
  sessionId,
  localEndpoint,
  localApiKey,
}) => {
  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileUrlInput, setFileUrlInput] = useState('');
  const [fileDuration, setFileDuration] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Active preset
  const [selectedPresetId, setSelectedPresetId] = useState<string>('meeting');

  // Options
  const [options, setOptions] = useState<TranscriptionOptions>({
    includeTimestamps: true,
    includeDiarization: true,
    autoPunctuation: true,
    autoSummary: true,
    autoActionItems: true,
    translateToEnglish: false,
    language: 'ru',
  });

  // Processing state
  const [status, setStatus] = useState<
    'idle' | 'uploading' | 'transcribing' | 'summarizing' | 'done' | 'error'
  >('idle');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [liveStreamedText, setLiveStreamedText] = useState<string>('');
  const [currentChunkInfo, setCurrentChunkInfo] = useState<{ current: number; total: number } | null>(null);

  const activeModel =
    MODELS_CATALOG.find((m) => m.id === activeModelId) || MODELS_CATALOG[0];

  // Handle Preset Selection
  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = PRESETS.find((p) => p.id === presetId);
    if (preset) {
      setOptions({ ...preset.options });
      if (preset.recommendedModelId) {
        setActiveModelId(preset.recommendedModelId);
      }
    }
  };

  // Handle File Input
  const handleFileChange = async (file: File) => {
    if (!isAudioOrVideo(file)) {
      setErrorMessage(
        'Пожалуйста, выберите поддерживаемый аудио или видео файл (MP3, WAV, M4A, MP4, MKV, OGG, WebM и др.).'
      );
      return;
    }
    setErrorMessage(null);
    setSelectedFile(file);
    const dur = await getAudioDuration(file);
    setFileDuration(dur);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await handleFileChange(e.dataTransfer.files[0]);
    }
  };

  // Start Transcription Execution Flow with Chunking + Streaming + 5-min Timeout
  const handleStartTranscription = async () => {
    if (!selectedFile && !fileUrlInput.trim()) {
      setErrorMessage('Пожалуйста, прикрепите аудио/видео файл или укажите URL/путь.');
      return;
    }

    setStatus('uploading');
    setProgressPercent(10);
    setStatusMessage('Подготовка аудиофайла к обработке...');
    setErrorMessage(null);
    setElapsedSeconds(0);
    setLiveStreamedText('');
    setCurrentChunkInfo(null);

    const startTime = Date.now();
    const timerInterval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    try {
      let title = selectedFile ? selectedFile.name : 'Аудиозапись по ссылке';
      let allSegments: any[] = [];
      let accumulatedText = '';
      let detectedLang = options.language !== 'auto' ? options.language : 'ru';
      let calculatedDuration = fileDuration || 60;

      if (selectedFile) {
        // 1. Split audio file into small digestible chunks (~45s each) in-browser
        setStatusMessage('Разбиение аудиозаписи на фрагменты по 45 секунд...');
        setProgressPercent(15);

        const { chunks, totalDuration } = await splitAudioIntoChunks(
          selectedFile,
          45,
          (msg) => setStatusMessage(msg)
        );

        calculatedDuration = totalDuration;
        setCurrentChunkInfo({ current: 0, total: chunks.length });
        setStatus('transcribing');

        // 2. Process each chunk sequentially with 5-minute timeout per chunk
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          setCurrentChunkInfo({ current: i + 1, total: chunks.length });

          const chunkPercent = Math.round(20 + (i / chunks.length) * 65);
          setProgressPercent(chunkPercent);

          const timeRangeStr = `${formatTimeDisplay(chunk.startTime)} - ${formatTimeDisplay(
            chunk.startTime + chunk.duration
          )}`;

          setStatusMessage(
            `Распознавание фрагмента ${i + 1} из ${chunks.length} (${timeRangeStr}) на ${
              engineMode === 'local' ? 'GPU' : 'Cloud'
            } (${activeModel.name})...`
          );

          const chunkBase64 = await fileToBase64(chunk.blob);

          const chunkResult = await transcribeChunkWithTimeout({
            chunk,
            audioBase64: chunkBase64,
            language: options.language,
            options,
            modelId: activeModelId,
            engineMode,
            customEndpoint: engineMode === 'local' ? localEndpoint : undefined,
            localApiKey: engineMode === 'local' ? localApiKey : undefined,
            sessionId,
            timeoutMs: 300000, // 5 minutes timeout per chunk
          });

          if (chunkResult.text) {
            accumulatedText = accumulatedText
              ? accumulatedText + ' ' + chunkResult.text
              : chunkResult.text;
            setLiveStreamedText(accumulatedText);
          }

          if (chunkResult.segments && chunkResult.segments.length > 0) {
            allSegments.push(...chunkResult.segments);
          }
        }
      } else {
        // Fallback for URL input
        setStatus('transcribing');
        setProgressPercent(40);
        setStatusMessage(`Облачное распознавание по ссылке (${activeModel.name})...`);

        const response = await fetch('/api/transcribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-session-id': sessionId,
          },
          body: JSON.stringify({
            fileUrl: fileUrlInput.trim(),
            mimeType: 'audio/mp3',
            language: options.language,
            options,
            modelId: activeModelId,
            engineMode: 'cloud',
            sessionId,
          }),
        });

        if (!response.ok) {
          const errJson = await response.json().catch(() => ({}));
          throw new Error(errJson.error || `HTTP error ${response.status}`);
        }

        const resData = await response.json();
        accumulatedText = resData.fullText || '';
        allSegments = resData.segments || [];
        detectedLang = resData.detectedLanguage || detectedLang;
      }

      // 3. AI Summarization & Action Items on the complete stitched transcript
      setProgressPercent(88);
      setStatus('summarizing');
      setStatusMessage('Формирование структурированного резюме и списка задач...');

      let summaryData: any = {
        summary: {
          title: selectedFile?.name ? `Транскрипция: ${selectedFile.name}` : 'Транскрипция аудио',
          overview: 'Расшифровка аудиозаписи успешно выполнена.',
          keyPoints: ['Все фрагменты успешно обработаны'],
        },
        actionItems: [],
      };

      if (options.autoSummary || options.autoActionItems) {
        try {
          const sumRes = await fetch('/api/summarize-transcript', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fullText: accumulatedText,
              title: selectedFile?.name ? `Транскрипция: ${selectedFile.name}` : 'Транскрипция аудио',
            }),
          });
          if (sumRes.ok) {
            summaryData = await sumRes.json();
          }
        } catch (sumErr) {
          console.warn('AI summary request skipped:', sumErr);
        }
      }

      clearInterval(timerInterval);
      const processingTime = Date.now() - startTime;
      const wordsCount = accumulatedText ? accumulatedText.split(/\s+/).filter(Boolean).length : 0;

      // Construct final TranscriptionResult object
      const newResult: TranscriptionResult = {
        id: 'transcription_' + Date.now(),
        title: summaryData.summary?.title || title,
        fileName: selectedFile?.name,
        audioUrl: selectedFile ? URL.createObjectURL(selectedFile) : undefined,
        fileSize: selectedFile?.size,
        duration: calculatedDuration || 60,
        language: options.language,
        detectedLanguage: detectedLang,
        modelId: activeModelId,
        modelName: activeModel.name,
        engineMode: engineMode,
        createdAt: new Date().toISOString(),
        fullText: accumulatedText,
        segments: allSegments,
        summary: summaryData.summary,
        actionItems: summaryData.actionItems || [],
        stats: {
          processingTimeMs: processingTime,
          wordCount: wordsCount,
          charCount: accumulatedText.length,
          speedRtf: calculatedDuration ? +(calculatedDuration / (processingTime / 1000)).toFixed(1) : undefined,
        },
      };

      setProgressPercent(100);
      setStatus('done');
      setStatusMessage('Транскрибация успешно завершена!');

      setTimeout(() => {
        onTranscriptionSuccess(newResult);
      }, 600);
    } catch (err: any) {
      clearInterval(timerInterval);
      setStatus('error');
      setErrorMessage(err.message || 'Ошибка транскрибации. Проверьте соединение.');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      
      {/* Top Banner: Preset Selectors */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Готовые сценарии (Пресеты)
          </label>
          <button
            onClick={onOpenAdvisor}
            className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Не знаете, какую модель выбрать? Пройдите ассистент</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {PRESETS.map((preset) => {
            const isSelected = selectedPresetId === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => handleSelectPreset(preset.id)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-sm ring-1 ring-zinc-900/10'
                    : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                <div className="font-semibold text-xs truncate mb-1">
                  {preset.name}
                </div>
                <div
                  className={`text-[11px] line-clamp-2 leading-tight ${
                    isSelected ? 'opacity-90' : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  {preset.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Grid: Upload Area & Options */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: File Dropzone & URL Input (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          
          {/* Drag & Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
              isDragging
                ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20'
                : selectedFile
                ? 'border-emerald-500/80 bg-emerald-50/30 dark:bg-emerald-950/10'
                : 'border-zinc-300 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 hover:border-zinc-400 dark:hover:border-zinc-700'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.aac,.flac,.mp4,.mkv,.mov,.webm"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleFileChange(e.target.files[0]);
                }
              }}
            />

            {selectedFile ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm max-w-sm truncate">
                    {selectedFile.name}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 flex items-center justify-center gap-3">
                    <span>{formatFileSize(selectedFile.size)}</span>
                    {fileDuration > 0 && (
                      <span>• {formatTimeDisplay(fileDuration)}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFile(null);
                    setFileDuration(0);
                  }}
                  className="text-xs text-zinc-500 hover:text-red-500 underline mt-1"
                >
                  Выбрать другой файл
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex items-center justify-center">
                  <UploadCloud className="w-6 h-6" />
                </div>
                <div>
                  <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                    Перетащите аудио или видео файл сюда
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    MP3, WAV, M4A, OGG, AAC, FLAC, MP4, MKV, MOV, WebM, AVI (любой размер)
                  </div>
                </div>
                <button
                  type="button"
                  className="px-4 py-2 text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:opacity-90 transition-opacity"
                >
                  Выбрать файл на устройстве
                </button>
              </div>
            )}
          </div>

          {/* In-Browser Video Streaming Audio Extraction Info Banner */}
          {selectedFile &&
            (selectedFile.type.startsWith('video/') ||
              /\.(mp4|mkv|mov|avi|webm|ts|m4v)$/i.test(selectedFile.name)) && (
              <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 shrink-0">
                  <Video className="w-4 h-4" />
                </div>
                <div className="space-y-1 text-left">
                  <div className="font-semibold text-xs text-blue-950 dark:text-blue-100 flex items-center gap-2">
                    <span>Потоковое извлечение аудио (Web Audio API)</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-200/60 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 font-medium">
                      Видео не выгружается на сервер
                    </span>
                  </div>
                  <p className="text-[11px] text-blue-800/90 dark:text-blue-300/90 leading-relaxed">
                    Тяжёлый видеоряд декодируется локально прямо в браузере. На распознавание отправляются только оптимизированные аудиофрагменты 16 кГц (~1 МБ), экономя до 98% интернет-трафика.
                  </p>
                </div>
              </div>
            )}

          {/* URL or Direct Local Path Input */}
          <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 space-y-2">
            <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
              <Link className="w-3.5 h-3.5 text-zinc-400" />
              <span>Или укажите прямую ссылку на файл / путь</span>
            </label>
            <input
              type="text"
              value={fileUrlInput}
              onChange={(e) => setFileUrlInput(e.target.value)}
              placeholder="https://example.com/audio.mp3 или /path/to/meeting.mp4"
              className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100"
            />
          </div>

          {/* Model & Hardware Banner */}
          <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {activeModel.name}
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    engineMode === 'local'
                      ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                      : 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                  }`}
                >
                  {engineMode === 'local' ? 'NVIDIA GPU / Local' : 'Cloud Server'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-1">
                {activeModel.bestFor}
              </p>
            </div>

            <button
              onClick={onOpenSettings}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white shrink-0 text-xs flex items-center gap-1"
              title="Сменить модель или настроить GPU"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span>Сменить</span>
            </button>
          </div>
        </div>

        {/* Right Column: Parameters & Toggles (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 space-y-4">
            <div className="font-semibold text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Параметры распознавания
            </div>

            {/* Language Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Язык аудиозаписи
              </label>
              <select
                value={options.language}
                onChange={(e) =>
                  setOptions({ ...options, language: e.target.value })
                }
                className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Checkboxes / Toggles */}
            <div className="space-y-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
              
              {/* Timestamps */}
              <label className="flex items-center justify-between text-xs cursor-pointer select-none">
                <span className="text-zinc-700 dark:text-zinc-300">
                  Временные метки (Таймкоды)
                </span>
                <input
                  type="checkbox"
                  checked={options.includeTimestamps}
                  onChange={(e) =>
                    setOptions({ ...options, includeTimestamps: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-zinc-900 focus:ring-zinc-900 dark:bg-zinc-800"
                />
              </label>

              {/* Speaker Diarization */}
              <label className="flex items-center justify-between text-xs cursor-pointer select-none">
                <div>
                  <span className="text-zinc-700 dark:text-zinc-300">
                    Разделение спикеров (Диаризация)
                  </span>
                  <p className="text-[10px] text-zinc-400">Спикер 1, Спикер 2...</p>
                </div>
                <input
                  type="checkbox"
                  checked={options.includeDiarization}
                  onChange={(e) =>
                    setOptions({ ...options, includeDiarization: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-zinc-900 focus:ring-zinc-900 dark:bg-zinc-800"
                />
              </label>

              {/* Auto Punctuation */}
              <label className="flex items-center justify-between text-xs cursor-pointer select-none">
                <span className="text-zinc-700 dark:text-zinc-300">
                  Авто-пунктуация и регистр букв
                </span>
                <input
                  type="checkbox"
                  checked={options.autoPunctuation}
                  onChange={(e) =>
                    setOptions({ ...options, autoPunctuation: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-zinc-900 focus:ring-zinc-900 dark:bg-zinc-800"
                />
              </label>

              {/* Auto Summary */}
              <label className="flex items-center justify-between text-xs cursor-pointer select-none">
                <span className="text-zinc-700 dark:text-zinc-300">
                  AI Резюме и тезисы (Summary)
                </span>
                <input
                  type="checkbox"
                  checked={options.autoSummary}
                  onChange={(e) =>
                    setOptions({ ...options, autoSummary: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-zinc-900 focus:ring-zinc-900 dark:bg-zinc-800"
                />
              </label>

              {/* Action items */}
              <label className="flex items-center justify-between text-xs cursor-pointer select-none">
                <span className="text-zinc-700 dark:text-zinc-300">
                  Список задач и поручений (Action Items)
                </span>
                <input
                  type="checkbox"
                  checked={options.autoActionItems}
                  onChange={(e) =>
                    setOptions({ ...options, autoActionItems: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-zinc-900 focus:ring-zinc-900 dark:bg-zinc-800"
                />
              </label>

              {/* Translate */}
              <label className="flex items-center justify-between text-xs cursor-pointer select-none">
                <span className="text-zinc-700 dark:text-zinc-300">
                  Перевод на английский (Translation)
                </span>
                <input
                  type="checkbox"
                  checked={options.translateToEnglish}
                  onChange={(e) =>
                    setOptions({ ...options, translateToEnglish: e.target.checked })
                  }
                  className="w-4 h-4 rounded text-zinc-900 focus:ring-zinc-900 dark:bg-zinc-800"
                />
              </label>
            </div>

            {/* Estimated cost badge */}
            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-500">
              <span>Стоимость обработки:</span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {estimateProcessingCost(fileDuration || 60, engineMode, activeModelId)}
              </span>
            </div>

            {/* Start Button */}
            <button
              onClick={handleStartTranscription}
              disabled={status === 'uploading' || status === 'transcribing' || status === 'summarizing'}
              className="w-full py-3 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white font-medium text-sm transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'idle' || status === 'done' || status === 'error' ? (
                <>
                  <span>Запустить транскрибацию</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                <>
                  <RotateCw className="w-4 h-4 animate-spin" />
                  <span>Обработка ({elapsedSeconds}с)...</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Progress & Error Card */}
      {status !== 'idle' && (
        <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              {status === 'error' ? (
                <AlertCircle className="w-4 h-4 text-red-500" />
              ) : status === 'done' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <RotateCw className="w-4 h-4 text-blue-500 animate-spin" />
              )}
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {statusMessage}
              </span>
            </div>
            <span className="font-mono text-zinc-500">{elapsedSeconds} сек</span>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                status === 'error'
                  ? 'bg-red-500'
                  : status === 'done'
                  ? 'bg-emerald-500'
                  : 'bg-zinc-900 dark:bg-zinc-100'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Chunk processing badges */}
          {currentChunkInfo && currentChunkInfo.total > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              {Array.from({ length: currentChunkInfo.total }).map((_, idx) => {
                const isFinished = idx < currentChunkInfo.current;
                const isCurrent = idx === currentChunkInfo.current - 1;
                return (
                  <div
                    key={idx}
                    className={`text-[10px] px-2 py-0.5 rounded-md font-mono border transition-all ${
                      isFinished
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                        : isCurrent
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-400 animate-pulse'
                        : 'bg-zinc-50 text-zinc-400 dark:bg-zinc-800/40 dark:text-zinc-600 border-zinc-200 dark:border-zinc-800'
                    }`}
                  >
                    #{idx + 1}
                  </div>
                );
              })}
            </div>
          )}

          {/* Live Streamed Text Preview */}
          {liveStreamedText && (
            <div className="mt-3 p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800/80 text-xs">
              <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-zinc-200/60 dark:border-zinc-800/60 text-zinc-500 text-[11px]">
                <div className="flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
                  <Sparkles className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
                  <span>Потоковый предпросмотр распознанного текста:</span>
                </div>
                <span className="text-[10px] font-mono text-zinc-400">
                  {liveStreamedText.split(/\s+/).filter(Boolean).length} слов
                </span>
              </div>
              <p className="text-zinc-700 dark:text-zinc-300 leading-relaxed font-sans max-h-32 overflow-y-auto pr-1">
                {liveStreamedText}
                <span className="inline-block w-1.5 h-3.5 bg-blue-500 ml-1 animate-pulse align-middle" />
              </p>
            </div>
          )}

          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300 text-xs flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{errorMessage}</span>
              </div>
              {engineMode === 'local' && (
                <div className="flex items-center gap-2 pt-1 border-t border-red-200/50 dark:border-red-800/40 mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEngineMode('cloud');
                      setErrorMessage(null);
                      setTimeout(() => handleStartTranscription(), 100);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium text-xs transition-colors shadow-sm cursor-pointer"
                  >
                    <Cloud className="w-3.5 h-3.5" />
                    Переключить на Cloud (Gemini) и продолжить
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMessage(null);
                      handleStartTranscription();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-800 border border-red-200 dark:border-red-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 font-medium text-xs transition-colors cursor-pointer"
                  >
                    Повторить на GPU
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
