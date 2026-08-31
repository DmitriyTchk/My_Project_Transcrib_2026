import React, { useState } from 'react';
import {
  AdvisorAnswers,
  AdvisorRecommendation,
  EngineMode,
} from '../types';
import {
  Cpu,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Shield,
  Layers,
  ArrowRight,
  RotateCcw,
  Check,
  Server,
  Laptop,
  Smartphone,
  HardDrive,
  Users,
  Mic,
  FileAudio,
} from 'lucide-react';
import { MODELS_CATALOG } from '../data/models';

interface ModelAdvisorViewProps {
  onApplyRecommendation: (modelId: string, engineMode: EngineMode, presetId?: string) => void;
  sessionId: string;
}

export const ModelAdvisorView: React.FC<ModelAdvisorViewProps> = ({
  onApplyRecommendation,
  sessionId,
}) => {
  // Step in wizard (0: Questionnaire, 1: Generating, 2: Result)
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [recommendation, setRecommendation] = useState<AdvisorRecommendation | null>(null);

  // Questionnaire form state
  const [answers, setAnswers] = useState<AdvisorAnswers>({
    scenario: 'Встреча / Совещание',
    language: 'Русский (основной)',
    priority: 'Сбалансированная точность и скорость',
    audioQuality: 'Обычное качество, возможен шум',
    timestampsNeeded: 'Таймкоды предложений/фраз',
    diarizationNeeded: true,
    privacyRequired: false,
    hardware: 'ПК с видеокартой NVIDIA GPU (RTX)',
    realtimeNeeded: false,
    budget: 'Бесплатно / Open-source',
  });

  const handleRunAdvisor = async () => {
    setLoading(true);
    setCurrentStep(1);

    try {
      const response = await fetch('/api/model-advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-id': sessionId },
        body: JSON.stringify({ answers }),
      });

      if (!response.ok) {
        throw new Error('Failed to get recommendation');
      }

      const recData: AdvisorRecommendation = await response.json();
      setRecommendation(recData);
      setCurrentStep(2);
    } catch (err) {
      // Robust client-side fallback recommendation logic
      let primaryId = 'faster-whisper-large-v3-turbo';
      let primaryName = 'faster-whisper (Large-v3-Turbo)';
      let badge = 'Идеально для ПК с NVIDIA GPU';
      let engineMode: EngineMode = 'local';

      if (answers.privacyRequired || answers.hardware.includes('NVIDIA')) {
        if (answers.timestampsNeeded.includes('слов') || answers.diarizationNeeded) {
          primaryId = 'whisperx-large-v3';
          primaryName = 'WhisperX (Large-v3 + Diarization)';
          badge = 'Выбор для точнейших субтитров и спикеров';
        } else {
          primaryId = 'faster-whisper-large-v3-turbo';
          primaryName = 'faster-whisper (Large-v3-Turbo)';
          badge = 'Топ-рекомендация для NVIDIA GPU';
        }
        engineMode = 'local';
      } else if (answers.hardware.includes('Мобильный') || answers.hardware.includes('Слабый')) {
        primaryId = 'gemini-3.7-flash';
        primaryName = 'Gemini 3.7 Flash Audio (Cloud)';
        badge = 'Оптимально для телефонов и облачной обработки';
        engineMode = 'cloud';
      }

      setRecommendation({
        primaryModelId: primaryId,
        primaryModelName: primaryName,
        badge: badge,
        summaryReason:
          'Модель подобрана на основе ваших ответов с учетом оборудования (' +
          answers.hardware +
          ') и требований к приватности.',
        detailedExplanation:
          'Обеспечивает высокую скорость и качество распознавания русской речи, разделение спикеров и поддержку выбранных таймкодов.',
        tradeoffs: {
          speed: 'Высокая (до 8x быстрее стандартного Whisper)',
          accuracy: '97%+ точность русской речи',
          privacy: answers.privacyRequired ? '100% Локально (без интернета)' : 'Облако',
          cost: 'Бесплатно (Open-Source)',
          vramRequired: '3-6 GB VRAM',
        },
        fallbackModelId: 'gemini-3.7-flash',
        fallbackModelName: 'Gemini 3.7 Flash Cloud',
        fallbackReason: 'Универсальный облачный запасной вариант без нагрузки на процессор.',
        recommendedPreset: 'meeting',
        gpuTip: 'На видеокартах NVIDIA используйте тип вычислений float16 или int8_float16 для максимальной скорости.',
      });
      setCurrentStep(2);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!recommendation) return;
    const model = MODELS_CATALOG.find((m) => m.id === recommendation.primaryModelId);
    const engineMode = model ? model.engineMode : 'cloud';
    onApplyRecommendation(recommendation.primaryModelId, engineMode, recommendation.recommendedPreset);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
          <Cpu className="w-3.5 h-3.5 text-blue-500" />
          <span>Интеллектуальный ассистент выбора ASR-модели</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Подберите идеальную модель под ваше железо и задачу
        </h1>
        <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
          Ответьте на несколько вопросов, и алгоритм рассчитает компромиссы между скоростью, точностью, приватностью и видеопамятью GPU.
        </p>
      </div>

      {currentStep === 0 && (
        <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 shadow-xs space-y-6">
          
          {/* Question 1: Scenario */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              1. Тип задачи и формат аудио
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                'Встреча / Совещание',
                'Интервью / Подкаст',
                'Лекция / Вебинар',
                'Быстрая диктовка',
              ].map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setAnswers({ ...answers, scenario: opt })}
                  className={`p-3 rounded-xl border text-xs font-medium text-left transition-all ${
                    answers.scenario === opt
                      ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs'
                      : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>

          {/* Question 2: Hardware */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              2. Ваше оборудование (Железо)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                { title: 'ПК с NVIDIA GPU', desc: 'RTX 3060/4060/4070/4090 с CUDA' },
                { title: 'Ноутбук / CPU', desc: 'Intel, AMD или Apple Silicon M1/M2/M3' },
                { title: 'Мобильный телефон / Сервер', desc: 'Смартфон или слабое устройство' },
              ].map((opt) => (
                <button
                  key={opt.title}
                  type="button"
                  onClick={() => setAnswers({ ...answers, hardware: opt.title })}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    answers.hardware === opt.title
                      ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs'
                      : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300'
                  }`}
                >
                  <div className="font-semibold text-xs">{opt.title}</div>
                  <div className="text-[11px] opacity-75 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Question 3: Privacy & Cloud */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              3. Приватность и конфиденциальность
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAnswers({ ...answers, privacyRequired: false })}
                className={`p-3 rounded-xl border text-left transition-all ${
                  !answers.privacyRequired
                    ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs'
                    : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300'
                }`}
              >
                <div className="font-semibold text-xs">Облако разрешено</div>
                <div className="text-[11px] opacity-75">
                  Быстрая обработка на мощных серверах без нагрузки на ваш компьютер.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAnswers({ ...answers, privacyRequired: true })}
                className={`p-3 rounded-xl border text-left transition-all ${
                  answers.privacyRequired
                    ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs'
                    : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300'
                }`}
              >
                <div className="font-semibold text-xs flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Строго локально (Privacy First)</span>
                </div>
                <div className="text-[11px] opacity-75">
                  100% обработка на локальной видеокарте/процессоре, аудио не передается в интернет.
                </div>
              </button>
            </div>
          </div>

          {/* Question 4: Timestamps & Diarization */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                4. Детализация таймкодов
              </label>
              <select
                value={answers.timestampsNeeded}
                onChange={(e) => setAnswers({ ...answers, timestampsNeeded: e.target.value })}
                className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
              >
                <option value="Таймкоды предложений/фраз">Таймкоды предложений/фраз (Стандарт)</option>
                <option value="Точные таймкоды каждого слова (Word-level)">
                  Точные таймкоды каждого слова (Word-level для субтитров)
                </option>
                <option value="Без таймкодов (только сплошной текст)">
                  Без таймкодов (только сплошной текст)
                </option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                5. Разделение спикеров (Диаризация)
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAnswers({ ...answers, diarizationNeeded: true })}
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium ${
                    answers.diarizationNeeded
                      ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  Да, несколько спикеров
                </button>
                <button
                  type="button"
                  onClick={() => setAnswers({ ...answers, diarizationNeeded: false })}
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium ${
                    !answers.diarizationNeeded
                      ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  Один говорящий
                </button>
              </div>
            </div>
          </div>

          {/* Submit Calculation Button */}
          <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
            <button
              onClick={handleRunAdvisor}
              className="py-3 px-6 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white font-medium text-xs sm:text-sm transition-all shadow-sm flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Подобрать оптимальную модель</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </button>
          </div>
        </div>
      )}

      {/* Generating State */}
      {currentStep === 1 && (
        <div className="p-12 text-center rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 shadow-xs space-y-4">
          <div className="w-12 h-12 rounded-full border-2 border-zinc-900 dark:border-zinc-100 border-t-transparent animate-spin mx-auto" />
          <div>
            <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
              Анализ характеристик и подбор ASR-модели...
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Оцениваем требования к VRAM, алгоритм диаризации и языковой профиль...
            </div>
          </div>
        </div>
      )}

      {/* Result Recommendation Card */}
      {currentStep === 2 && recommendation && (
        <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm space-y-6">
          
          {/* Header Badge */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-100 dark:border-zinc-800">
            <div>
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                {recommendation.badge}
              </span>
              <h2 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 mt-2">
                {recommendation.primaryModelName}
              </h2>
            </div>

            <button
              onClick={() => setCurrentStep(0)}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Изменить ответы</span>
            </button>
          </div>

          {/* Explanation */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Почему эта модель?
            </h3>
            <p className="text-xs sm:text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">
              {recommendation.detailedExplanation}
            </p>
          </div>

          {/* Trade-offs Matrix */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Матрица компромиссов (Trade-offs)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-left">
                <div className="text-[11px] text-zinc-400 font-medium">Скорость</div>
                <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 mt-1">
                  {recommendation.tradeoffs.speed}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-left">
                <div className="text-[11px] text-zinc-400 font-medium">Точность</div>
                <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 mt-1">
                  {recommendation.tradeoffs.accuracy}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-left">
                <div className="text-[11px] text-zinc-400 font-medium">Приватность</div>
                <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 mt-1">
                  {recommendation.tradeoffs.privacy}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-left">
                <div className="text-[11px] text-zinc-400 font-medium">Стоимость</div>
                <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 mt-1">
                  {recommendation.tradeoffs.cost}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-left col-span-2 sm:col-span-1">
                <div className="text-[11px] text-zinc-400 font-medium">Память / VRAM</div>
                <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100 mt-1">
                  {recommendation.tradeoffs.vramRequired}
                </div>
              </div>
            </div>
          </div>

          {/* NVIDIA GPU Tip */}
          {recommendation.gpuTip && (
            <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex items-start gap-3">
              <Zap className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                  Совет по настройке GPU / CUDA
                </div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">
                  {recommendation.gpuTip}
                </div>
              </div>
            </div>
          )}

          {/* Fallback option */}
          <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="text-[11px] text-zinc-400 font-medium">
                Запасной вариант (Альтернатива):
              </div>
              <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                {recommendation.fallbackModelName}
              </div>
              <p className="text-[11px] text-zinc-500">
                {recommendation.fallbackReason}
              </p>
            </div>
          </div>

          {/* Action Button */}
          <div className="pt-2 flex justify-end">
            <button
              onClick={handleApply}
              className="py-3 px-6 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white font-medium text-xs sm:text-sm transition-all shadow-sm flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              <span>Применить эту модель и перейти к транскрибации</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
