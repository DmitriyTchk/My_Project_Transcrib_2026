import React, { useState, useEffect, useRef } from 'react';
import {
  TabType,
  EngineMode,
  TranscriptionResult,
  AppSettings,
} from './types';
import { Navbar } from './components/Navbar';
import { FileTranscribeView } from './components/FileTranscribeView';
import { LiveDictationView } from './components/LiveDictationView';
import { ModelAdvisorView } from './components/ModelAdvisorView';
import { ResultsView } from './components/ResultsView';
import { HistoryView } from './components/HistoryView';
import { SettingsSecretsView } from './components/SettingsSecretsView';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import {
  loadSettings,
  saveSettings,
  loadHistory,
  saveToHistory,
  deleteHistoryItem,
  clearHistory,
  loadActiveResult,
  saveActiveResult,
} from './utils/storage';
import { MODELS_CATALOG } from './data/models';

export default function App() {
  // Settings & Theme
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [activeTab, setActiveTab] = useState<TabType>('transcribe');

  // Results & History
  const [activeResult, setActiveResult] = useState<TranscriptionResult | null>(loadActiveResult);
  const [history, setHistory] = useState<TranscriptionResult[]>(loadHistory);

  // Audio Player State
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Apply theme to DOM
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [settings.theme]);

  // Sync settings changes
  const handleUpdateSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const toggleTheme = () => {
    const nextTheme = settings.theme === 'dark' ? 'light' : 'dark';
    handleUpdateSettings({ ...settings, theme: nextTheme });
  };

  // Sync active result changes & history
  const handleSetTranscriptionSuccess = (result: TranscriptionResult) => {
    setActiveResult(result);
    saveActiveResult(result);
    saveToHistory(result);
    setHistory(loadHistory());

    if (result.audioUrl) {
      setAudioSrc(result.audioUrl);
      setDuration(result.duration || 0);
      setCurrentTime(0);
    } else {
      setAudioSrc(null);
      setDuration(result.duration || 0);
      setCurrentTime(0);
    }

    setActiveTab('results');
  };

  const handleUpdateResult = (updated: TranscriptionResult) => {
    setActiveResult(updated);
    saveActiveResult(updated);
    saveToHistory(updated);
    setHistory(loadHistory());
  };

  const handleDeleteHistoryItem = (id: string) => {
    const updated = deleteHistoryItem(id);
    setHistory(updated);
    if (activeResult?.id === id) {
      setActiveResult(null);
      saveActiveResult(null);
    }
  };

  const handleClearAllHistory = () => {
    clearHistory();
    setHistory([]);
    setActiveResult(null);
    saveActiveResult(null);
  };

  const handleSelectHistoryResult = (result: TranscriptionResult) => {
    setActiveResult(result);
    saveActiveResult(result);
    if (result.audioUrl) {
      setAudioSrc(result.audioUrl);
      setDuration(result.duration || 0);
      setCurrentTime(0);
    }
    setActiveTab('results');
  };

  // Audio Playback Handlers
  const handleTogglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
    setCurrentTime(time);
  };

  const handleChangePlaybackRate = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  // Find active segment for player subtitle ticker
  const activeSegment = activeResult?.segments?.find(
    (s) => currentTime >= s.start && currentTime <= s.end
  );

  const activeModel =
    MODELS_CATALOG.find((m) => m.id === settings.activeModelId) || MODELS_CATALOG[0];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col font-sans transition-colors selection:bg-zinc-900 selection:text-white dark:selection:bg-zinc-100 dark:selection:text-zinc-900">
      
      {/* Hidden native audio element */}
      {audioSrc && (
        <audio
          ref={audioRef}
          src={audioSrc}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || duration)}
          onEnded={() => setIsPlaying(false)}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
        />
      )}

      {/* Standard Top Navigation Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        engineMode={settings.engineMode}
        setEngineMode={(mode) =>
          handleUpdateSettings({ ...settings, engineMode: mode })
        }
        modelName={activeModel.name}
        theme={settings.theme}
        toggleTheme={toggleTheme}
        hasResult={!!activeResult}
      />

      {/* Main Screen Views */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-2 sm:px-4 pb-20">
        {activeTab === 'transcribe' && (
          <FileTranscribeView
            engineMode={settings.engineMode}
            setEngineMode={(mode) =>
              handleUpdateSettings({ ...settings, engineMode: mode })
            }
            activeModelId={settings.activeModelId}
            setActiveModelId={(id) =>
              handleUpdateSettings({ ...settings, activeModelId: id })
            }
            onTranscriptionSuccess={handleSetTranscriptionSuccess}
            onOpenAdvisor={() => setActiveTab('advisor')}
            onOpenSettings={() => setActiveTab('settings')}
            sessionId={settings.sessionId}
            localEndpoint={settings.localEndpoint}
            localApiKey={settings.localApiKey}
          />
        )}

        {activeTab === 'dictate' && (
          <LiveDictationView
            onSaveToResult={handleSetTranscriptionSuccess}
            sessionId={settings.sessionId}
          />
        )}

        {activeTab === 'advisor' && (
          <ModelAdvisorView
            onApplyRecommendation={(modelId, engineMode, presetId) => {
              handleUpdateSettings({
                ...settings,
                activeModelId: modelId,
                engineMode: engineMode,
              });
              setActiveTab('transcribe');
            }}
            sessionId={settings.sessionId}
          />
        )}

        {activeTab === 'results' && (
          <ResultsView
            result={activeResult}
            onUpdateResult={handleUpdateResult}
            onSeekAudio={handleSeek}
            currentTime={currentTime}
            onNewTranscription={() => setActiveTab('transcribe')}
            sessionId={settings.sessionId}
          />
        )}

        {activeTab === 'history' && (
          <HistoryView
            history={history}
            onSelectResult={handleSelectHistoryResult}
            onDeleteItem={handleDeleteHistoryItem}
            onClearHistory={handleClearAllHistory}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsSecretsView
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            sessionId={settings.sessionId}
          />
        )}
      </main>

      {/* Bottom Sticky Player Bar for audio playback */}
      {audioSrc && (
        <AudioPlayerBar
          audioUrl={audioSrc}
          currentTime={currentTime}
          duration={duration}
          onSeek={handleSeek}
          isPlaying={isPlaying}
          onTogglePlay={handleTogglePlay}
          playbackRate={playbackRate}
          onChangePlaybackRate={handleChangePlaybackRate}
          activeSegmentText={activeSegment?.text}
          activeSpeaker={activeSegment?.speaker}
        />
      )}
    </div>
  );
}
