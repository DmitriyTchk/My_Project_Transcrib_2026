import React, { useState, useMemo } from 'react';
import {
  TranscriptionResult,
  TranscriptionSegment,
  ActionItem,
} from '../types';
import {
  FileText,
  Clock,
  Users,
  Search,
  Download,
  Copy,
  Check,
  Sparkles,
  CheckSquare,
  Square,
  Play,
  RotateCw,
  Globe,
  Edit2,
  ListFilter,
  Layers,
  Share2,
} from 'lucide-react';
import {
  exportToSrt,
  exportToVtt,
  exportToTxt,
  exportToJson,
  exportToCsv,
  downloadFile,
  formatTimeDisplay,
} from '../utils/exportUtils';

interface ResultsViewProps {
  result: TranscriptionResult | null;
  onUpdateResult: (updated: TranscriptionResult) => void;
  onSeekAudio: (time: number) => void;
  currentTime: number;
  onNewTranscription: () => void;
  sessionId: string;
}

export const ResultsView: React.FC<ResultsViewProps> = ({
  result,
  onUpdateResult,
  onSeekAudio,
  currentTime,
  onNewTranscription,
  sessionId,
}) => {
  if (!result) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 mx-auto flex items-center justify-center">
          <FileText className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Нет активной расшифровки
          </h2>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto">
            Загрузите аудио/видео файл во вкладке «Файл» или надиктуйте голос во вкладке «Диктант».
          </p>
        </div>
        <button
          onClick={onNewTranscription}
          className="px-4 py-2 text-xs font-medium bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl hover:opacity-90 transition-opacity"
        >
          Перейти к загрузке файла
        </button>
      </div>
    );
  }

  // Active view: 'segments' or 'fulltext'
  const [viewMode, setViewMode] = useState<'segments' | 'fulltext'>('segments');
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [newSpeakerName, setNewSpeakerName] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);

  // Search filter
  const filteredSegments = useMemo(() => {
    if (!searchQuery.trim()) return result.segments;
    const q = searchQuery.toLowerCase();
    return result.segments.filter(
      (s) =>
        s.text.toLowerCase().includes(q) ||
        (s.speaker && s.speaker.toLowerCase().includes(q))
    );
  }, [result.segments, searchQuery]);

  // Copy full transcript text
  const handleCopyText = () => {
    const text = exportToTxt(result, { includeTimestamps: true, includeSpeakers: true, includeSummary: true });
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Toggle Action item completed
  const handleToggleActionItem = (index: number) => {
    if (!result.actionItems) return;
    const updatedItems = [...result.actionItems];
    updatedItems[index] = {
      ...updatedItems[index],
      completed: !updatedItems[index].completed,
    };
    onUpdateResult({ ...result, actionItems: updatedItems });
  };

  // Rename Speaker across all segments
  const handleRenameSpeaker = (oldName: string) => {
    if (!newSpeakerName.trim() || newSpeakerName === oldName) {
      setEditingSpeaker(null);
      return;
    }
    const updatedSegments = result.segments.map((seg) =>
      seg.speaker === oldName ? { ...seg, speaker: newSpeakerName.trim() } : seg
    );
    onUpdateResult({ ...result, segments: updatedSegments });
    setEditingSpeaker(null);
    setNewSpeakerName('');
  };

  // Update single segment text inline
  const handleSegmentTextChange = (id: string, text: string) => {
    const updatedSegments = result.segments.map((s) =>
      s.id === id ? { ...s, text } : s
    );
    const fullText = updatedSegments.map((s) => s.text).join(' ');
    onUpdateResult({ ...result, segments: updatedSegments, fullText });
  };

  // Translate Transcript
  const handleTranslate = async (targetLang = 'en') => {
    setIsTranslating(true);
    try {
      const response = await fetch('/api/translate-transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
        body: JSON.stringify({ segments: result.segments, targetLanguage: targetLang }),
      });
      if (response.ok) {
        const data = await response.json();
        onUpdateResult({
          ...result,
          segments: data.segments,
          fullText: data.fullText,
          language: targetLang,
        });
      }
    } catch (e) {
      console.error('Translation error:', e);
    } finally {
      setIsTranslating(false);
    }
  };

  // Unique list of speakers
  const speakersList = useMemo(() => {
    const set = new Set<string>();
    result.segments.forEach((s) => {
      if (s.speaker) set.add(s.speaker);
    });
    return Array.from(set);
  }, [result.segments]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6 pb-24">
      
      {/* Top Header Card */}
      <div className="p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-zinc-500 uppercase tracking-wider">
                Результат транскрибации
              </span>
              <span className="text-zinc-300 dark:text-zinc-700">•</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {result.modelName}
              </span>
            </div>
            <h1 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {result.title}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 mt-1">
              <span>{new Date(result.createdAt).toLocaleString('ru-RU')}</span>
              <span>• Длительность: {formatTimeDisplay(result.duration)}</span>
              {result.stats?.wordCount && (
                <span>• {result.stats.wordCount} слов</span>
              )}
              {result.languageName && (
                <span>• Язык: {result.languageName}</span>
              )}
            </div>
          </div>

          {/* Export & Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleCopyText}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors shadow-xs"
              title="Скопировать весь текст"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Скопировано!' : 'Копировать'}</span>
            </button>

            {/* Export Dropdown buttons */}
            <div className="flex items-center rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 p-0.5 text-xs font-medium shadow-xs">
              <button
                onClick={() =>
                  downloadFile(
                    exportToTxt(result),
                    `${result.title || 'transcript'}.txt`,
                    'text/plain'
                  )
                }
                className="px-2.5 py-1.5 rounded-lg text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                title="Экспорт в TXT"
              >
                TXT
              </button>
              <button
                onClick={() =>
                  downloadFile(
                    exportToSrt(result.segments),
                    `${result.title || 'subtitles'}.srt`,
                    'text/plain'
                  )
                }
                className="px-2.5 py-1.5 rounded-lg text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700 font-semibold"
                title="Субтитры SRT"
              >
                SRT
              </button>
              <button
                onClick={() =>
                  downloadFile(
                    exportToVtt(result.segments),
                    `${result.title || 'subtitles'}.vtt`,
                    'text/vtt'
                  )
                }
                className="px-2.5 py-1.5 rounded-lg text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                title="Субтитры WebVTT"
              >
                VTT
              </button>
              <button
                onClick={() =>
                  downloadFile(
                    exportToJson(result),
                    `${result.title || 'transcript'}.json`,
                    'application/json'
                  )
                }
                className="px-2.5 py-1.5 rounded-lg text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                title="Структурированный JSON"
              >
                JSON
              </button>
              <button
                onClick={() =>
                  downloadFile(
                    exportToCsv(result.segments),
                    `${result.title || 'transcript'}.csv`,
                    'text/csv'
                  )
                }
                className="px-2.5 py-1.5 rounded-lg text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                title="Таблица CSV"
              >
                CSV
              </button>
            </div>

            {/* Translate button */}
            <button
              onClick={() => handleTranslate('en')}
              disabled={isTranslating}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors shadow-xs"
              title="Перевести транскрипт на английский"
            >
              <Globe className="w-3.5 h-3.5 text-blue-500" />
              <span>{isTranslating ? 'Перевод...' : 'Перевести на EN'}</span>
            </button>
          </div>
        </div>

        {/* Speakers Management Bar */}
        {speakersList.length > 0 && (
          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-zinc-400 font-medium flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              <span>Спикеры:</span>
            </span>
            {speakersList.map((speaker) => (
              <div key={speaker} className="flex items-center gap-1">
                {editingSpeaker === speaker ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={newSpeakerName}
                      onChange={(e) => setNewSpeakerName(e.target.value)}
                      placeholder={speaker}
                      className="px-2 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950"
                      autoFocus
                    />
                    <button
                      onClick={() => handleRenameSpeaker(speaker)}
                      className="px-2 py-0.5 text-xs rounded bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      OK
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingSpeaker(speaker);
                      setNewSpeakerName(speaker);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs text-zinc-800 dark:text-zinc-200 transition-colors"
                    title="Нажмите, чтобы переименовать спикера"
                  >
                    <span>{speaker}</span>
                    <Edit2 className="w-3 h-3 text-zinc-400" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Structured AI Summary & Action items Grid */}
      {(result.summary || (result.actionItems && result.actionItems.length > 0)) && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Summary Box (7 cols) */}
          {result.summary && (
            <div className="lg:col-span-7 p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 shadow-xs space-y-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span className="font-semibold text-xs uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                  Краткое резюме и ключевые темы
                </span>
              </div>
              <p className="text-xs sm:text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">
                {result.summary.overview}
              </p>
              {result.summary.keyPoints && result.summary.keyPoints.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                  <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Ключевые тезисы:
                  </div>
                  <ul className="space-y-1">
                    {result.summary.keyPoints.map((pt, i) => (
                      <li key={i} className="text-xs text-zinc-600 dark:text-zinc-400 flex items-start gap-2">
                        <span className="text-amber-500 font-bold">•</span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Action Items Box (5 cols) */}
          {result.actionItems && result.actionItems.length > 0 && (
            <div className="lg:col-span-5 p-5 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 shadow-xs space-y-3">
              <div className="flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-emerald-500" />
                <span className="font-semibold text-xs uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                  Договоренности (Action Items)
                </span>
              </div>
              <div className="space-y-2">
                {result.actionItems.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleToggleActionItem(idx)}
                    className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all flex items-start gap-2.5 ${
                      item.completed
                        ? 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-400 line-through'
                        : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-200 hover:border-zinc-300'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {item.completed ? (
                        <CheckSquare className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <Square className="w-4 h-4 text-zinc-400" />
                      )}
                    </div>
                    <div className="space-y-0.5">
                      <div className="font-medium">{item.task}</div>
                      {(item.assignee || item.deadline) && (
                        <div className="text-[10px] text-zinc-400">
                          {item.assignee && <span>Отв: {item.assignee} </span>}
                          {item.deadline && <span>• Срок: {item.deadline}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Transcript Body */}
      <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xs space-y-4">
        
        {/* Navigation & Search toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('segments')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                viewMode === 'segments'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              Сегменты с таймкодами
            </button>
            <button
              onClick={() => setViewMode('fulltext')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                viewMode === 'fulltext'
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              Сплошной текст
            </button>
          </div>

          {/* Search box */}
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по транскрипту..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
            />
          </div>
        </div>

        {/* View Mode: Segments with click-to-seek */}
        {viewMode === 'segments' ? (
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {filteredSegments.map((seg) => {
              const isActive = currentTime >= seg.start && currentTime <= seg.end;
              return (
                <div
                  key={seg.id}
                  className={`p-3.5 rounded-2xl border transition-all ${
                    isActive
                      ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20 shadow-xs'
                      : 'border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/40 dark:bg-zinc-950/40 hover:border-zinc-200 dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs text-zinc-500 mb-1.5">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onSeekAudio(seg.start)}
                        className="font-mono text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-semibold"
                        title="Воспроизвести с этой секунды"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>{formatTimeDisplay(seg.start)} - {formatTimeDisplay(seg.end)}</span>
                      </button>

                      {seg.speaker && (
                        <span className="font-semibold text-zinc-800 dark:text-zinc-200 px-1.5 py-0.5 rounded bg-zinc-200/60 dark:bg-zinc-800 text-[11px]">
                          {seg.speaker}
                        </span>
                      )}
                    </div>
                  </div>

                  <p
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) =>
                      handleSegmentTextChange(seg.id, e.currentTarget.textContent || '')
                    }
                    className="text-xs sm:text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed outline-hidden focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600 rounded p-1"
                  >
                    {seg.text}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800">
            <textarea
              value={result.fullText}
              onChange={(e) => onUpdateResult({ ...result, fullText: e.target.value })}
              rows={16}
              className="w-full text-xs sm:text-sm text-zinc-800 dark:text-zinc-200 bg-transparent border-0 focus:ring-0 leading-relaxed resize-y"
            />
          </div>
        )}
      </div>
    </div>
  );
};
