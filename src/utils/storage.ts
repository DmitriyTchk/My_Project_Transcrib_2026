import { AppSettings, TranscriptionResult } from '../types';

const STORAGE_KEYS = {
  SETTINGS: 'vibescribe_settings',
  HISTORY: 'vibescribe_history',
  ACTIVE_RESULT: 'vibescribe_active_result',
  THEME: 'vibescribe_theme',
};

export function getSessionId(): string {
  let sid = sessionStorage.getItem('vibescribe_session_id');
  if (!sid) {
    sid = 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    sessionStorage.setItem('vibescribe_session_id', sid);
  }
  return sid;
}

export const defaultSettings: AppSettings = {
  engineMode: 'cloud',
  activeModelId: 'gemini-3.7-flash',
  localEndpoint: 'http://localhost:8000/v1/audio/transcriptions',
  vramTier: '4gb',
  cudaDevice: 'cuda:0',
  computeType: 'float16',
  theme: 'dark',
  autoSaveHistory: true,
  sessionId: getSessionId(),
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return { ...defaultSettings, sessionId: getSessionId() };
    const parsed = JSON.parse(raw);
    return { ...defaultSettings, ...parsed, sessionId: getSessionId() };
  } catch {
    return { ...defaultSettings, sessionId: getSessionId() };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  } catch (err) {
    console.error('Failed to save settings to localStorage', err);
  }
}

export function loadHistory(): TranscriptionResult[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.HISTORY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveToHistory(item: TranscriptionResult): void {
  try {
    const history = loadHistory();
    const filtered = history.filter((h) => h.id !== item.id);
    const updated = [item, ...filtered].slice(0, 50); // Keep last 50
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(updated));
  } catch (err) {
    console.error('Failed to save history', err);
  }
}

export function deleteHistoryItem(id: string): TranscriptionResult[] {
  try {
    const history = loadHistory();
    const updated = history.filter((h) => h.id !== id);
    localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.HISTORY);
  } catch (err) {
    console.error('Failed to clear history', err);
  }
}

export function loadActiveResult(): TranscriptionResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_RESULT);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveActiveResult(result: TranscriptionResult | null): void {
  try {
    if (!result) {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_RESULT);
    } else {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_RESULT, JSON.stringify(result));
    }
  } catch (err) {
    console.error('Failed to save active result', err);
  }
}
