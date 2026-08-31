export type TabType = 'transcribe' | 'dictate' | 'advisor' | 'results' | 'history' | 'settings';

export type EngineMode = 'cloud' | 'local';

export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface TranscriptionSegment {
  id: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
  confidence?: number;
  words?: TranscriptionWord[];
}

export interface SummaryData {
  title: string;
  overview: string;
  keyPoints: string[];
}

export interface ActionItem {
  task: string;
  assignee?: string | null;
  deadline?: string | null;
  completed?: boolean;
}

export interface TranscriptionResult {
  id: string;
  title: string;
  fileName?: string;
  audioUrl?: string;
  fileSize?: number;
  duration: number;
  language: string;
  detectedLanguage?: string;
  languageName?: string;
  modelId: string;
  modelName: string;
  engineMode: EngineMode;
  createdAt: string;
  fullText: string;
  segments: TranscriptionSegment[];
  summary?: SummaryData;
  actionItems?: ActionItem[];
  stats?: {
    processingTimeMs?: number;
    wordCount: number;
    charCount: number;
    speedRtf?: number;
  };
}

export interface TranscriptionOptions {
  includeTimestamps: boolean;
  includeDiarization: boolean;
  autoPunctuation: boolean;
  autoSummary: boolean;
  autoActionItems: boolean;
  translateToEnglish: boolean;
  language: string; // 'auto', 'ru', 'en', etc.
}

export interface ModelInfo {
  id: string;
  name: string;
  category: 'local-gpu' | 'local-cpu' | 'cloud-builtin' | 'cloud-api';
  engineMode: EngineMode;
  family: 'faster-whisper' | 'whisperx' | 'whisper' | 'gemini' | 'groq' | 'deepgram' | 'gigaam';
  description: string;
  bestFor: string;
  speed: 'Ultra-fast' | 'Fast' | 'Medium' | 'Normal';
  accuracy: 'Extreme (98%+)' | 'High (95%+)' | 'Good (90%+)';
  vramNeeded: string;
  privacy: '100% Local (Air-Gapped)' | 'Cloud API';
  requiresKey: boolean;
  keyProvider?: 'gemini' | 'groq' | 'openai' | 'deepgram' | 'huggingface';
  features: {
    timestamps: boolean;
    wordTimestamps: boolean;
    diarization: boolean;
    russianSpecialized: boolean;
    streaming: boolean;
  };
}

export interface PresetConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  recommendedModelId: string;
  options: TranscriptionOptions;
}

export interface AdvisorAnswers {
  scenario: string;
  language: string;
  priority: string;
  audioQuality: string;
  timestampsNeeded: string;
  diarizationNeeded: boolean;
  privacyRequired: boolean;
  hardware: string;
  realtimeNeeded: boolean;
  budget: string;
}

export interface AdvisorRecommendation {
  primaryModelId: string;
  primaryModelName: string;
  badge: string;
  summaryReason: string;
  detailedExplanation: string;
  tradeoffs: {
    speed: string;
    accuracy: string;
    privacy: string;
    cost: string;
    vramRequired: string;
  };
  fallbackModelId: string;
  fallbackModelName: string;
  fallbackReason: string;
  recommendedPreset: string;
  gpuTip: string;
}

export interface AppSettings {
  engineMode: EngineMode;
  activeModelId: string;
  localEndpoint: string;
  localApiKey?: string;
  vramTier: '2gb' | '4gb' | '8gb' | '16gb+';
  cudaDevice: string;
  computeType: 'float16' | 'int8_float16' | 'int8' | 'float32';
  theme: 'dark' | 'light';
  autoSaveHistory: boolean;
  sessionId: string;
}

export interface SecretsStatus {
  gemini: { hasServerKey: boolean; hasSessionKey: boolean; configured: boolean };
  groq: { hasServerKey: boolean; hasSessionKey: boolean; configured: boolean };
  openai: { hasServerKey: boolean; hasSessionKey: boolean; configured: boolean };
  deepgram: { hasServerKey: boolean; hasSessionKey: boolean; configured: boolean };
  huggingface: { hasServerKey: boolean; hasSessionKey: boolean; configured: boolean };
}
