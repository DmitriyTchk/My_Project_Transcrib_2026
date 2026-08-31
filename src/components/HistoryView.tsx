import React, { useState } from 'react';
import { TranscriptionResult } from '../types';
import {
  History,
  FileText,
  Trash2,
  Download,
  Play,
  Search,
  Calendar,
  Clock,
  RotateCcw,
} from 'lucide-react';
import {
  exportToTxt,
  exportToSrt,
  downloadFile,
  formatTimeDisplay,
} from '../utils/exportUtils';

interface HistoryViewProps {
  history: TranscriptionResult[];
  onSelectResult: (result: TranscriptionResult) => void;
  onDeleteItem: (id: string) => void;
  onClearHistory: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  onSelectResult,
  onDeleteItem,
  onClearHistory,
}) => {
  const [search, setSearch] = useState('');

  const filtered = history.filter(
    (item) =>
      item.title.toLowerCase().includes(search.toLowerCase()) ||
      item.fullText.toLowerCase().includes(search.toLowerCase()) ||
      item.modelName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <History className="w-5 h-5 text-zinc-500" />
            <span>История сессий транскрибации</span>
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Сохраненные расшифровки, таймкоды и резюме (хранятся локально на вашем устройстве)
          </p>
        </div>

        {history.length > 0 && (
          <button
            onClick={() => {
              if (confirm('Вы уверены, что хотите очистить всю историю?')) {
                onClearHistory();
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-950 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-medium transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Очистить историю</span>
          </button>
        )}
      </div>

      {/* Search box */}
      {history.length > 0 && (
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию или тексту..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
          />
        </div>
      )}

      {/* History List or Empty state */}
      {filtered.length === 0 ? (
        <div className="p-12 text-center rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 shadow-xs space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 mx-auto flex items-center justify-center">
            <FileText className="w-6 h-6" />
          </div>
          <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
            {history.length === 0 ? 'История пуста' : 'Ничего не найдено'}
          </div>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto">
            {history.length === 0
              ? 'Здесь будут автоматически сохраняться ваши аудиозаписи, расшифровки и резюме.'
              : 'Попробуйте изменить поисковый запрос.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 shadow-xs hover:border-zinc-300 dark:hover:border-zinc-700 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
            >
              <div className="space-y-1.5 flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                    {item.title}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      item.engineMode === 'local'
                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                        : 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                    }`}
                  >
                    {item.modelName}
                  </span>
                </div>

                <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-1">
                  {item.summary?.overview || item.fullText}
                </p>

                <div className="flex items-center gap-3 text-[11px] text-zinc-400">
                  <span>{new Date(item.createdAt).toLocaleDateString('ru-RU')}</span>
                  <span>• {formatTimeDisplay(item.duration)}</span>
                  {item.stats?.wordCount && (
                    <span>• {item.stats.wordCount} слов</span>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                <button
                  onClick={() =>
                    downloadFile(
                      exportToTxt(item),
                      `${item.title || 'transcript'}.txt`,
                      'text/plain'
                    )
                  }
                  className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white text-xs"
                  title="Экспорт в TXT"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => onDeleteItem(item.id)}
                  className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-400 hover:text-red-500 text-xs"
                  title="Удалить из истории"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => onSelectResult(item)}
                  className="px-3.5 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium hover:opacity-90 transition-opacity"
                >
                  Открыть
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
