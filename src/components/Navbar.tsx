import React from 'react';
import { TabType, EngineMode } from '../types';
import {
  FileAudio,
  Mic,
  Cpu,
  FileText,
  History,
  Settings,
  Sun,
  Moon,
  Zap,
  Shield,
  Radio,
} from 'lucide-react';

interface NavbarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  engineMode: EngineMode;
  setEngineMode: (mode: EngineMode) => void;
  modelName: string;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  hasResult: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  engineMode,
  setEngineMode,
  modelName,
  theme,
  toggleTheme,
  hasResult,
}) => {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-15 flex items-center justify-between gap-4">
        
        {/* Zone 1: Brand title (One single text element) */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center font-bold text-base tracking-wider shadow-sm">
            VS
          </div>
          <span className="font-semibold text-base sm:text-lg tracking-tight text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
            VibeScribe Studio
          </span>
        </div>

        {/* Zone 2: Navigation Links (1-2 word labels, single-line, ≤6 items) */}
        <nav className="hidden md:flex items-center gap-1 overflow-x-auto py-1">
          <button
            onClick={() => setActiveTab('transcribe')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'transcribe'
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900'
            }`}
          >
            <FileAudio className="w-4 h-4" />
            <span>Файл</span>
          </button>

          <button
            onClick={() => setActiveTab('dictate')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'dictate'
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900'
            }`}
          >
            <Mic className="w-4 h-4 text-emerald-500" />
            <span>Диктант</span>
          </button>

          <button
            onClick={() => setActiveTab('advisor')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'advisor'
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>Подбор модели</span>
          </button>

          <button
            onClick={() => setActiveTab('results')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'results'
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Результаты</span>
            {hasResult && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'history'
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900'
            }`}
          >
            <History className="w-4 h-4" />
            <span>История</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'settings'
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Настройки</span>
          </button>
        </nav>

        {/* Zone 3: Primary Actions (1-2 actions: Engine mode badge + Theme) */}
        <div className="flex items-center gap-2 shrink-0">
          
          {/* Quick Engine Mode Switcher */}
          <div className="hidden sm:flex items-center p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs">
            <button
              onClick={() => setEngineMode('cloud')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all font-medium whitespace-nowrap ${
                engineMode === 'cloud'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
              }`}
              title="Cloud / API Режим"
            >
              <Zap className="w-3.5 h-3.5 text-blue-500" />
              <span>Cloud</span>
            </button>

            <button
              onClick={() => setEngineMode('local')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all font-medium whitespace-nowrap ${
                engineMode === 'local'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
              }`}
              title="Local GPU (faster-whisper / WhisperX)"
            >
              <Shield className="w-3.5 h-3.5 text-emerald-500" />
              <span>Local GPU</span>
            </button>
          </div>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
            aria-label="Переключить тему"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-zinc-700" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Bottom Navigation Bar for phones */}
      <div className="md:hidden flex items-center justify-around border-t border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 py-2 px-2">
        <button
          onClick={() => setActiveTab('transcribe')}
          className={`flex flex-col items-center gap-1 py-1 px-2 rounded-lg text-xs font-medium ${
            activeTab === 'transcribe'
              ? 'text-zinc-900 dark:text-zinc-100 font-semibold'
              : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          <FileAudio className="w-4 h-4" />
          <span className="whitespace-nowrap">Файл</span>
        </button>

        <button
          onClick={() => setActiveTab('dictate')}
          className={`flex flex-col items-center gap-1 py-1 px-2 rounded-lg text-xs font-medium ${
            activeTab === 'dictate'
              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
              : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          <Mic className="w-4 h-4" />
          <span className="whitespace-nowrap">Диктант</span>
        </button>

        <button
          onClick={() => setActiveTab('advisor')}
          className={`flex flex-col items-center gap-1 py-1 px-2 rounded-lg text-xs font-medium ${
            activeTab === 'advisor'
              ? 'text-zinc-900 dark:text-zinc-100 font-semibold'
              : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          <Cpu className="w-4 h-4" />
          <span className="whitespace-nowrap">Подбор</span>
        </button>

        <button
          onClick={() => setActiveTab('results')}
          className={`flex flex-col items-center gap-1 py-1 px-2 rounded-lg text-xs font-medium relative ${
            activeTab === 'results'
              ? 'text-zinc-900 dark:text-zinc-100 font-semibold'
              : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span className="whitespace-nowrap">Текст</span>
          {hasResult && (
            <span className="absolute top-1 right-2 w-1.5 h-1.5 rounded-full bg-emerald-500" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`flex flex-col items-center gap-1 py-1 px-2 rounded-lg text-xs font-medium ${
            activeTab === 'history'
              ? 'text-zinc-900 dark:text-zinc-100 font-semibold'
              : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          <History className="w-4 h-4" />
          <span className="whitespace-nowrap">История</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center gap-1 py-1 px-2 rounded-lg text-xs font-medium ${
            activeTab === 'settings'
              ? 'text-zinc-900 dark:text-zinc-100 font-semibold'
              : 'text-zinc-500 dark:text-zinc-400'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span className="whitespace-nowrap">Опции</span>
        </button>
      </div>
    </header>
  );
};
