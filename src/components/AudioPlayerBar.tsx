import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Sparkles } from 'lucide-react';
import { formatTimeDisplay } from '../utils/exportUtils';

interface AudioPlayerBarProps {
  audioUrl: string | null;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  playbackRate: number;
  onChangePlaybackRate: (rate: number) => void;
  activeSegmentText?: string;
  activeSpeaker?: string;
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  audioUrl,
  currentTime,
  duration,
  onSeek,
  isPlaying,
  onTogglePlay,
  playbackRate,
  onChangePlaybackRate,
  activeSegmentText,
  activeSpeaker,
}) => {
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);

  if (!audioUrl && duration === 0) return null;

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    onSeek(val);
  };

  const skipSeconds = (delta: number) => {
    const next = Math.max(0, Math.min(duration, currentTime + delta));
    onSeek(next);
  };

  const cyclePlaybackRate = () => {
    const rates = [0.8, 1.0, 1.25, 1.5, 1.75, 2.0];
    const currentIndex = rates.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % rates.length;
    onChangePlaybackRate(rates[nextIndex]);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-zinc-950/95 border-t border-zinc-200 dark:border-zinc-800 shadow-xl backdrop-blur-md px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex flex-col gap-1.5">
        
        {/* Active speaker subtitle ticker */}
        {activeSegmentText && (
          <div className="flex items-center gap-2 text-xs truncate py-0.5 text-zinc-600 dark:text-zinc-300">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100 shrink-0 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded">
              {activeSpeaker || 'Спикер'}
            </span>
            <span className="truncate italic">"{activeSegmentText}"</span>
          </div>
        )}

        {/* Progress bar */}
        <div className="flex items-center gap-3 w-full">
          <span className="text-xs font-mono text-zinc-500 w-11 text-right shrink-0">
            {formatTimeDisplay(currentTime)}
          </span>

          <div className="relative flex-1 flex items-center group">
            <input
              type="range"
              min="0"
              max={duration || 100}
              step="0.1"
              value={currentTime}
              onChange={handleSliderChange}
              className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-900 dark:accent-zinc-100"
            />
          </div>

          <span className="text-xs font-mono text-zinc-500 w-11 shrink-0">
            {formatTimeDisplay(duration)}
          </span>
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => skipSeconds(-5)}
              className="p-1.5 rounded-md text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs flex items-center gap-1"
              title="Назад на 5 секунд"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">-5s</span>
            </button>

            <button
              onClick={onTogglePlay}
              className="p-2 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90 shadow-sm transition-transform active:scale-95"
              title={isPlaying ? 'Пауза (Пробел)' : 'Воспроизведение (Пробел)'}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
            </button>

            <button
              onClick={() => skipSeconds(5)}
              className="p-1.5 rounded-md text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs flex items-center gap-1"
              title="Вперед на 5 секунд"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">+5s</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Playback speed */}
            <button
              onClick={cyclePlaybackRate}
              className="px-2 py-1 text-xs font-mono font-medium rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
              title="Скорость воспроизведения"
            >
              {playbackRate}x
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
