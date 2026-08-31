import React, { useState, useEffect } from 'react';
import {
  AppSettings,
  EngineMode,
  SecretsStatus,
} from '../types';
import { MODELS_CATALOG } from '../data/models';
import {
  Settings,
  Shield,
  Zap,
  Key,
  Cpu,
  Server,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  RotateCw,
  RefreshCw,
  Terminal,
  ExternalLink,
  Lock,
} from 'lucide-react';

interface SettingsSecretsViewProps {
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
  sessionId: string;
}

export const SettingsSecretsView: React.FC<SettingsSecretsViewProps> = ({
  settings,
  onUpdateSettings,
  sessionId,
}) => {
  const [activeTab, setActiveTab] = useState<'models' | 'local-gpu' | 'secrets'>('models');

  // Secrets status state
  const [secretsStatus, setSecretsStatus] = useState<SecretsStatus>({
    gemini: { hasServerKey: true, hasSessionKey: false, configured: true },
    groq: { hasServerKey: false, hasSessionKey: false, configured: false },
    openai: { hasServerKey: false, hasSessionKey: false, configured: false },
    deepgram: { hasServerKey: false, hasSessionKey: false, configured: false },
    huggingface: { hasServerKey: false, hasSessionKey: false, configured: false },
  });

  // Session keys inputs
  const [groqKeyInput, setGroqKeyInput] = useState('');
  const [openAIKeyInput, setOpenAIKeyInput] = useState('');
  const [deepgramKeyInput, setDeepgramKeyInput] = useState('');
  const [hfTokenInput, setHfTokenInput] = useState('');

  // Local endpoint test state
  const [testingEndpoint, setTestingEndpoint] = useState(false);
  const [endpointTestResult, setEndpointTestResult] = useState<{
    available?: boolean;
    message?: string;
  } | null>(null);

  // Fetch secrets status
  const fetchSecretsStatus = async () => {
    try {
      const res = await fetch('/api/secrets/status', {
        headers: { 'x-session-id': sessionId },
      });
      if (res.ok) {
        const data = await res.json();
        setSecretsStatus(data);
      }
    } catch (e) {
      console.error('Failed to fetch secrets status', e);
    }
  };

  useEffect(() => {
    fetchSecretsStatus();
  }, [sessionId]);

  // Save session key
  const handleSaveSessionKey = async (provider: string, apiKey: string) => {
    try {
      const res = await fetch('/api/secrets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, provider, apiKey: apiKey.trim() }),
      });
      if (res.ok) {
        fetchSecretsStatus();
        if (provider === 'groq') setGroqKeyInput('');
        if (provider === 'openai') setOpenAIKeyInput('');
        if (provider === 'deepgram') setDeepgramKeyInput('');
        if (provider === 'huggingface') setHfTokenInput('');
      }
    } catch (err) {
      console.error('Failed to save session key', err);
    }
  };

  // Local server setup instructions sub-tab
  const [setupGuideTab, setSetupGuideTab] = useState<'docker-gpu' | 'docker-cpu' | 'python' | 'tunnel' | 'auth-401'>('docker-gpu');
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const copyCommand = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  // Test local endpoint
  const handleTestLocalEndpoint = async () => {
    setTestingEndpoint(true);
    setEndpointTestResult(null);
    try {
      const res = await fetch('/api/local-engine/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: settings.localEndpoint,
          apiKey: settings.localApiKey,
        }),
      });
      const data = await res.json();
      setEndpointTestResult(data);
    } catch (e: any) {
      setEndpointTestResult({
        available: false,
        message: 'Ошибка подключения к ' + settings.localEndpoint,
      });
    } finally {
      setTestingEndpoint(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Settings className="w-5 h-5 text-zinc-500" />
            <span>Настройки моделей и безопасность</span>
          </h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Выбор активных нейросетей, конфигурация локального GPU (NVIDIA CUDA) и управление ключами
          </p>
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-1 text-xs font-medium shadow-xs">
          <button
            onClick={() => setActiveTab('models')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === 'models'
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
            }`}
          >
            Каталог моделей
          </button>
          <button
            onClick={() => setActiveTab('local-gpu')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === 'local-gpu'
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
            }`}
          >
            Локальный GPU / Сервер
          </button>
          <button
            onClick={() => setActiveTab('secrets')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              activeTab === 'secrets'
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
            }`}
          >
            Секреты & API Ключи
          </button>
        </div>
      </div>

      {/* TAB 1: Models Catalog */}
      {activeTab === 'models' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Доступные модели распознавания речи
            </span>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500">Режим:</span>
              <button
                onClick={() =>
                  onUpdateSettings({
                    ...settings,
                    engineMode: settings.engineMode === 'cloud' ? 'local' : 'cloud',
                  })
                }
                className="font-semibold text-zinc-900 dark:text-zinc-100 underline"
              >
                {settings.engineMode === 'cloud' ? 'Cloud API' : 'Local GPU'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {MODELS_CATALOG.map((model) => {
              const isActive = settings.activeModelId === model.id;
              return (
                <div
                  key={model.id}
                  onClick={() =>
                    onUpdateSettings({
                      ...settings,
                      activeModelId: model.id,
                      engineMode: model.engineMode,
                    })
                  }
                  className={`p-4 rounded-2xl border text-left cursor-pointer transition-all ${
                    isActive
                      ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900 shadow-sm ring-1 ring-zinc-900 dark:ring-zinc-100'
                      : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 hover:border-zinc-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div>
                      <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                        {model.name}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {model.bestFor}
                      </div>
                    </div>

                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${
                        model.engineMode === 'local'
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                          : 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                      }`}
                    >
                      {model.engineMode === 'local' ? 'Local' : 'Cloud'}
                    </span>
                  </div>

                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-relaxed mb-3">
                    {model.description}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                    <span>Скорость: {model.speed}</span>
                    <span>Память: {model.vramNeeded}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: Local GPU / Server Configuration */}
      {activeTab === 'local-gpu' && (
        <div className="space-y-6">
          <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-emerald-500" />
              <h2 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                Конфигурация локального ASR-движка (faster-whisper / WhisperX / OpenAI-совместимый)
              </h2>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Приложение может подключаться к локальному серверу распознавания речи, запущенному на вашей рабочей станции с NVIDIA GPU (или CPU). 100% приватность без передачи аудио во внешние сети.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              
              {/* Local endpoint URL */}
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
                  <span>URL локального сервера ASR</span>
                  <span className="text-[11px] text-zinc-400 font-normal">Эндпоинт транскрибации</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={settings.localEndpoint}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, localEndpoint: e.target.value })
                    }
                    placeholder="http://localhost:8000/v1/audio/transcriptions"
                    className="flex-1 px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-mono focus:ring-1 focus:ring-zinc-900 dark:focus:ring-zinc-100"
                  />
                  <button
                    onClick={handleTestLocalEndpoint}
                    disabled={testingEndpoint}
                    className="px-4 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium hover:opacity-90 disabled:opacity-50 shrink-0 flex items-center gap-1.5"
                  >
                    {testingEndpoint && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>{testingEndpoint ? 'Проверка...' : 'Проверить связь'}</span>
                  </button>
                </div>
              </div>

              {/* Local API Key (if required by docker or reverse proxy) */}
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center justify-between">
                  <span>Локальный API-ключ / Bearer токен (необязательно)</span>
                  <span className="text-[11px] text-zinc-400 font-normal">Если сервер защищен паролем (при ошибке 401)</span>
                </label>
                <input
                  type="password"
                  value={settings.localApiKey || ''}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, localApiKey: e.target.value })
                  }
                  placeholder="Введите токен или оставьте пустым, если авторизация выключена"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-mono"
                />
              </div>

              {/* Endpoint test status message */}
              {endpointTestResult && (
                <div
                  className={`sm:col-span-2 p-3.5 rounded-2xl border text-xs flex items-start gap-2.5 ${
                    endpointTestResult.available
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                      : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                  }`}
                >
                  {endpointTestResult.available ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1">
                    <p className="font-medium">{endpointTestResult.message}</p>
                    {endpointTestResult.status === 401 && (
                      <p className="text-[11px] opacity-90">
                        💡 <strong>Как исправить 401:</strong> Укажите ключ в поле «Локальный API-ключ» выше, либо перезапустите Docker контейнер без флага <code className="font-mono bg-black/10 dark:bg-white/10 px-1 py-0.5 rounded">WHISPER__API_KEY</code>.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* VRAM Tier */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Доступная видеопамять GPU (VRAM)
                </label>
                <select
                  value={settings.vramTier}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, vramTier: e.target.value as any })
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
                >
                  <option value="2gb">2 GB (Medium int8 / Base)</option>
                  <option value="4gb">4 GB (Large-v3-turbo int8 / RTX 3050)</option>
                  <option value="8gb">8 GB (Large-v3 float16 / RTX 3060/4060)</option>
                  <option value="16gb+">16+ GB (WhisperX + Forced Alignment / RTX 4080/4090)</option>
                </select>
              </div>

              {/* Compute type */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Тип квантования вычислений
                </label>
                <select
                  value={settings.computeType}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, computeType: e.target.value as any })
                  }
                  className="w-full px-3 py-2 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
                >
                  <option value="float16">float16 (Рекомендуется для NVIDIA GPU)</option>
                  <option value="int8_float16">int8_float16 (Экономия 50% VRAM)</option>
                  <option value="int8">int8 (Для работы на CPU)</option>
                  <option value="float32">float32 (Эталонная точность)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Detailed Setup Guides with Tabs */}
          <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-zinc-700 dark:text-zinc-300" />
                <h3 className="font-semibold text-xs uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                  Инструкция по запуску локального сервера
                </h3>
              </div>

              {/* Mini guide switcher */}
              <div className="flex flex-wrap gap-1 p-1 bg-zinc-200/70 dark:bg-zinc-800/80 rounded-xl text-[11px] font-medium">
                <button
                  onClick={() => setSetupGuideTab('docker-gpu')}
                  className={`px-2.5 py-1 rounded-lg transition-colors ${
                    setupGuideTab === 'docker-gpu'
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                  }`}
                >
                  🚀 Docker (NVIDIA GPU)
                </button>
                <button
                  onClick={() => setSetupGuideTab('docker-cpu')}
                  className={`px-2.5 py-1 rounded-lg transition-colors ${
                    setupGuideTab === 'docker-cpu'
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                  }`}
                >
                  💻 Docker (CPU)
                </button>
                <button
                  onClick={() => setSetupGuideTab('python')}
                  className={`px-2.5 py-1 rounded-lg transition-colors ${
                    setupGuideTab === 'python'
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                  }`}
                >
                  🐍 Python / pip
                </button>
                <button
                  onClick={() => setSetupGuideTab('auth-401')}
                  className={`px-2.5 py-1 rounded-lg transition-colors ${
                    setupGuideTab === 'auth-401'
                      ? 'bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 font-semibold shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                  }`}
                >
                  ⚠️ Ошибка 401
                </button>
                <button
                  onClick={() => setSetupGuideTab('tunnel')}
                  className={`px-2.5 py-1 rounded-lg transition-colors ${
                    setupGuideTab === 'tunnel'
                      ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                  }`}
                >
                  🌐 Туннель в облако
                </button>
              </div>
            </div>

            {/* Guide Content: Docker GPU */}
            {setupGuideTab === 'docker-gpu' && (
              <div className="space-y-3 text-xs">
                <p className="text-zinc-600 dark:text-zinc-400">
                  Запуск официального контейнера <strong>faster-whisper-server</strong> с поддержкой NVIDIA CUDA и автоматическим скачиванием моделей:
                </p>
                <div className="relative group">
                  <div className="p-3.5 rounded-xl bg-zinc-900 text-zinc-100 font-mono text-[11px] leading-relaxed overflow-x-auto select-all">
                    docker run --gpus all -p 8000:8000 fedirz/faster-whisper-server:latest-cuda
                  </div>
                  <button
                    onClick={() => copyCommand('docker run --gpus all -p 8000:8000 fedirz/faster-whisper-server:latest-cuda', 'dock-gpu')}
                    className="absolute right-2 top-2 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-mono border border-zinc-700 transition-colors"
                  >
                    {copiedCmd === 'dock-gpu' ? 'Скопировано!' : 'Скопировать'}
                  </button>
                </div>
                <div className="text-[11px] text-zinc-500 space-y-1">
                  <p>• Требования: установленные NVIDIA Drivers и NVIDIA Container Toolkit.</p>
                  <p>• Для выбора конкретной модели (например, large-v3-turbo) добавьте флаг: <code className="bg-zinc-200 dark:bg-zinc-800 px-1 py-0.5 rounded font-mono">-e WHISPER__MODEL=deepdml/faster-whisper-large-v3-turbo-ct2</code></p>
                </div>
              </div>
            )}

            {/* Guide Content: Docker CPU */}
            {setupGuideTab === 'docker-cpu' && (
              <div className="space-y-3 text-xs">
                <p className="text-zinc-600 dark:text-zinc-400">
                  Если у вас нет видеокарты NVIDIA или вы тестируете на процессоре (x86_64 / ARM / Mac Docker):
                </p>
                <div className="relative group">
                  <div className="p-3.5 rounded-xl bg-zinc-900 text-zinc-100 font-mono text-[11px] leading-relaxed overflow-x-auto select-all">
                    docker run -p 8000:8000 fedirz/faster-whisper-server:latest-cpu
                  </div>
                  <button
                    onClick={() => copyCommand('docker run -p 8000:8000 fedirz/faster-whisper-server:latest-cpu', 'dock-cpu')}
                    className="absolute right-2 top-2 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-mono border border-zinc-700 transition-colors"
                  >
                    {copiedCmd === 'dock-cpu' ? 'Скопировано!' : 'Скопировать'}
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Работает на любой операционной системе (Windows, macOS, Linux). На CPU рекомендуется модель <code className="font-mono">medium</code> или <code className="font-mono">base</code> с квантованием <code className="font-mono">int8</code>.
                </p>
              </div>
            )}

            {/* Guide Content: Python */}
            {setupGuideTab === 'python' && (
              <div className="space-y-3 text-xs">
                <p className="text-zinc-600 dark:text-zinc-400">
                  Запуск напрямую через Python (без Docker) в вашем виртуальном окружении или Conda:
                </p>
                <div className="space-y-2">
                  <div className="relative group">
                    <div className="p-3 rounded-xl bg-zinc-900 text-zinc-100 font-mono text-[11px] overflow-x-auto">
                      pip install faster-whisper-server
                    </div>
                    <button
                      onClick={() => copyCommand('pip install faster-whisper-server', 'py-install')}
                      className="absolute right-2 top-2 px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-mono border border-zinc-700"
                    >
                      {copiedCmd === 'py-install' ? 'Скопировано!' : 'Скопировать'}
                    </button>
                  </div>
                  <div className="relative group">
                    <div className="p-3 rounded-xl bg-zinc-900 text-zinc-100 font-mono text-[11px] overflow-x-auto">
                      faster-whisper-server --host 0.0.0.0 --port 8000
                    </div>
                    <button
                      onClick={() => copyCommand('faster-whisper-server --host 0.0.0.0 --port 8000', 'py-run')}
                      className="absolute right-2 top-2 px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-mono border border-zinc-700"
                    >
                      {copiedCmd === 'py-run' ? 'Скопировано!' : 'Скопировать'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Guide Content: HTTP 401 Fix */}
            {setupGuideTab === 'auth-401' && (
              <div className="space-y-3 text-xs">
                <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 space-y-2">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <span>Почему возникает ошибка «HTTP 401 Unauthorized»?</span>
                  </p>
                  <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                    HTTP 401 означает, что <strong>ваш сервер успешно работает и отвечает</strong>, но защищен паролем или ожидает Bearer-токен авторизации в заголовках.
                  </p>
                </div>

                <div className="space-y-2 text-zinc-600 dark:text-zinc-400">
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">Выберите удобный способ решения:</p>
                  
                  <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-1.5">
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">Способ 1: Задать свой API-ключ в Docker и ввести его в приложении</div>
                    <p className="text-[11px]">Запустите контейнер с ключом, например <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">my-secret-token</code>:</p>
                    <div className="relative group">
                      <div className="p-2.5 rounded-lg bg-zinc-900 text-zinc-100 font-mono text-[11px] overflow-x-auto">
                        docker run --gpus all -p 8000:8000 -e WHISPER__API_KEY=my-secret-token fedirz/faster-whisper-server:latest-cuda
                      </div>
                      <button
                        onClick={() => copyCommand('docker run --gpus all -p 8000:8000 -e WHISPER__API_KEY=my-secret-token fedirz/faster-whisper-server:latest-cuda', 'dock-token')}
                        className="absolute right-2 top-1.5 px-2 py-0.5 rounded bg-zinc-800 text-[10px] font-mono text-zinc-200 border border-zinc-700"
                      >
                        {copiedCmd === 'dock-token' ? 'Скопировано!' : 'Копировать'}
                      </button>
                    </div>
                    <p className="text-[11px] text-zinc-500">Затем введите <code className="font-mono text-zinc-900 dark:text-zinc-100">my-secret-token</code> в поле «Локальный API-ключ» выше.</p>
                  </div>

                  <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-1.5">
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">Способ 2: Запустить без авторизации (для домашней сети)</div>
                    <p className="text-[11px]">Убедитесь, что переменная <code className="font-mono">WHISPER__API_KEY</code> пустая или не задана:</p>
                    <div className="p-2.5 rounded-lg bg-zinc-900 text-zinc-100 font-mono text-[11px] overflow-x-auto select-all">
                      docker run --gpus all -p 8000:8000 fedirz/faster-whisper-server:latest-cuda
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Guide Content: Tunnel */}
            {setupGuideTab === 'tunnel' && (
              <div className="space-y-3 text-xs">
                <p className="text-zinc-600 dark:text-zinc-400">
                  Если вы открыли это веб-приложение в облачном браузере (Google Cloud / AI Studio), облачный сервер не видит ваш домашний <code className="font-mono">localhost:8000</code>. Пробросьте порт безопасным туннелем:
                </p>
                <div className="space-y-2">
                  <div className="relative group">
                    <div className="p-3 rounded-xl bg-zinc-900 text-zinc-100 font-mono text-[11px] overflow-x-auto">
                      npx localtunnel --port 8000
                    </div>
                    <button
                      onClick={() => copyCommand('npx localtunnel --port 8000', 'tunnel-lt')}
                      className="absolute right-2 top-2 px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-mono border border-zinc-700"
                    >
                      {copiedCmd === 'tunnel-lt' ? 'Скопировано!' : 'Скопировать'}
                    </button>
                  </div>
                  <div className="relative group">
                    <div className="p-3 rounded-xl bg-zinc-900 text-zinc-100 font-mono text-[11px] overflow-x-auto">
                      ngrok http 8000
                    </div>
                    <button
                      onClick={() => copyCommand('ngrok http 8000', 'tunnel-ngrok')}
                      className="absolute right-2 top-2 px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-mono border border-zinc-700"
                    >
                      {copiedCmd === 'tunnel-ngrok' ? 'Скопировано!' : 'Скопировать'}
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Полученный URL (например <code className="font-mono text-zinc-900 dark:text-zinc-100">https://your-tunnel.loca.lt/v1/audio/transcriptions</code>) вставьте в поле URL выше.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Secrets & API Keys */}
      {activeTab === 'secrets' && (
        <div className="space-y-6">
          <div className="p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/60 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-blue-500" />
              <h2 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                Безопасное управление секретами и API-ключами
              </h2>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Все ключи шифруются и обрабатываются исключительно на стороне сервера. Никакие секреты никогда не передаются в браузер в открытом виде.
            </p>

            {/* Provider List */}
            <div className="space-y-4 pt-2">
              
              {/* Gemini (Built-in) */}
              <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                    Google Gemini API (Встроенный серверный провайдер)
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    Используется для распознавания, саммари встреч и ассистента выбора моделей.
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Активен на сервере</span>
                </div>
              </div>

              {/* Groq Cloud */}
              <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                    Groq Cloud API Key (Whisper Large v3 на LPU)
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      secretsStatus.groq.configured
                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    {secretsStatus.groq.configured ? 'Ключ подключен' : 'Не настроен'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={groqKeyInput}
                    onChange={(e) => setGroqKeyInput(e.target.value)}
                    placeholder="gsk_..."
                    className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
                  />
                  <button
                    onClick={() => handleSaveSessionKey('groq', groqKeyInput)}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium"
                  >
                    Сохранить на сессию
                  </button>
                  {secretsStatus.groq.configured && (
                    <button
                      onClick={() => handleSaveSessionKey('groq', '')}
                      className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs"
                    >
                      Сбросить
                    </button>
                  )}
                </div>
              </div>

              {/* OpenAI Whisper */}
              <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                    OpenAI API Key (Whisper-1 Cloud)
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      secretsStatus.openai.configured
                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    {secretsStatus.openai.configured ? 'Ключ подключен' : 'Не настроен'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={openAIKeyInput}
                    onChange={(e) => setOpenAIKeyInput(e.target.value)}
                    placeholder="sk-..."
                    className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
                  />
                  <button
                    onClick={() => handleSaveSessionKey('openai', openAIKeyInput)}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium"
                  >
                    Сохранить на сессию
                  </button>
                  {secretsStatus.openai.configured && (
                    <button
                      onClick={() => handleSaveSessionKey('openai', '')}
                      className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs"
                    >
                      Сбросить
                    </button>
                  )}
                </div>
              </div>

              {/* HuggingFace Token for WhisperX Diarization */}
              <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-xs text-zinc-900 dark:text-zinc-100">
                    HuggingFace Token (Для PyAnnote Diarization в WhisperX)
                  </div>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      secretsStatus.huggingface.configured
                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    {secretsStatus.huggingface.configured ? 'Токен подключен' : 'Не настроен'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={hfTokenInput}
                    onChange={(e) => setHfTokenInput(e.target.value)}
                    placeholder="hf_..."
                    className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100"
                  />
                  <button
                    onClick={() => handleSaveSessionKey('huggingface', hfTokenInput)}
                    className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium"
                  >
                    Сохранить на сессию
                  </button>
                  {secretsStatus.huggingface.configured && (
                    <button
                      onClick={() => handleSaveSessionKey('huggingface', '')}
                      className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs"
                    >
                      Сбросить
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
