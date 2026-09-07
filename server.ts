import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Set user-agent header as required by guidelines
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Настройки локального Whisper-сервера: берутся из окружения, если клиент не передал свои значения
const LOCAL_WHISPER_ENDPOINT =
  process.env.LOCAL_WHISPER_ENDPOINT || 'http://localhost:8000/v1/audio/transcriptions';
const LOCAL_WHISPER_API_KEY = process.env.LOCAL_WHISPER_API_KEY || '';

// Support large audio/video payloads (up to 250MB)
app.use(express.json({ limit: '250mb' }));
app.use(express.urlencoded({ limit: '250mb', extended: true }));

// --- Опциональная HTTP Basic авторизация ---
// APP_USER — логин (по умолчанию 'admin').
// APP_PASSWORD — пароль; если пустой, авторизация ВЫКЛЮЧЕНА и локальная работа не меняется.
const AUTH_USER = process.env.APP_USER || 'admin';
const AUTH_PASSWORD = process.env.APP_PASSWORD || '';

if (AUTH_PASSWORD) {
  console.log(`[auth] HTTP Basic авторизация включена (пользователь: "${AUTH_USER}")`);
  app.use((req, res, next) => {
    // Healthcheck всегда открыт (для docker/monitoring)
    if (req.method === 'GET' && req.path === '/api/health') return next();

    const header = req.headers.authorization || '';
    if (header.startsWith('Basic ')) {
      let decoded = '';
      try {
        decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
      } catch {
        decoded = '';
      }
      const sep = decoded.indexOf(':');
      const user = sep >= 0 ? decoded.slice(0, sep) : '';
      const pass = sep >= 0 ? decoded.slice(sep + 1) : '';
      // Сравнение через timingSafeEqual (защита от тайминг-атак);
      // при разной длине буферов timingSafeEqual бросает исключение — поэтому сначала проверяем длину.
      const expectedUser = Buffer.from(AUTH_USER, 'utf-8');
      const expectedPass = Buffer.from(AUTH_PASSWORD, 'utf-8');
      const actualUser = Buffer.from(user, 'utf-8');
      const actualPass = Buffer.from(pass, 'utf-8');
      const userOk =
        actualUser.length === expectedUser.length &&
        crypto.timingSafeEqual(actualUser, expectedUser);
      const passOk =
        actualPass.length === expectedPass.length &&
        crypto.timingSafeEqual(actualPass, expectedPass);
      if (userOk && passOk) return next();
    }

    // Браузер покажет нативный диалог логина/пароля
    res.set('WWW-Authenticate', 'Basic realm="VibeScribe Studio", charset="UTF-8"');
    res.status(401).send('Требуется авторизация');
  });
}

// In-memory session secrets storage (session ID -> provider -> apiKey)
// Keys are never sent back to the client plain text
const sessionSecrets = new Map<string, Record<string, string>>();

// Helper to get effective key for a provider
function getProviderKey(provider: string, sessionId?: string): string | null {
  if (sessionId && sessionSecrets.has(sessionId)) {
    const userKeys = sessionSecrets.get(sessionId)!;
    if (userKeys[provider]) return userKeys[provider];
  }
  if (provider === 'gemini') return process.env.GEMINI_API_KEY || null;
  if (provider === 'groq') return process.env.GROQ_API_KEY || null;
  if (provider === 'openai') return process.env.OPENAI_API_KEY || null;
  if (provider === 'deepgram') return process.env.DEEPGRAM_API_KEY || null;
  return null;
}

// 1. Health & Server Info
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasGroqKey: !!process.env.GROQ_API_KEY,
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    hasDeepgramKey: !!process.env.DEEPGRAM_API_KEY,
    authEnabled: !!process.env.APP_PASSWORD,
    timestamp: new Date().toISOString(),
  });
});

// 2. Secrets Management (Server-side only)
app.get('/api/secrets/status', (req, res) => {
  const sessionId = req.headers['x-session-id'] as string;
  const userSessionKeys = sessionId ? sessionSecrets.get(sessionId) || {} : {};

  res.json({
    gemini: {
      hasServerKey: !!process.env.GEMINI_API_KEY,
      hasSessionKey: !!userSessionKeys['gemini'],
      configured: !!process.env.GEMINI_API_KEY || !!userSessionKeys['gemini'],
    },
    groq: {
      hasServerKey: !!process.env.GROQ_API_KEY,
      hasSessionKey: !!userSessionKeys['groq'],
      configured: !!process.env.GROQ_API_KEY || !!userSessionKeys['groq'],
    },
    openai: {
      hasServerKey: !!process.env.OPENAI_API_KEY,
      hasSessionKey: !!userSessionKeys['openai'],
      configured: !!process.env.OPENAI_API_KEY || !!userSessionKeys['openai'],
    },
    deepgram: {
      hasServerKey: !!process.env.DEEPGRAM_API_KEY,
      hasSessionKey: !!userSessionKeys['deepgram'],
      configured: !!process.env.DEEPGRAM_API_KEY || !!userSessionKeys['deepgram'],
    },
    huggingface: {
      hasServerKey: !!process.env.HUGGINGFACE_TOKEN,
      hasSessionKey: !!userSessionKeys['huggingface'],
      configured: !!process.env.HUGGINGFACE_TOKEN || !!userSessionKeys['huggingface'],
    },
  });
});

app.post('/api/secrets/save', (req, res) => {
  const { sessionId, provider, apiKey } = req.body;
  if (!sessionId || !provider) {
    res.status(400).json({ error: 'sessionId and provider are required' });
    return;
  }

  if (!sessionSecrets.has(sessionId)) {
    sessionSecrets.set(sessionId, {});
  }

  const current = sessionSecrets.get(sessionId)!;
  if (!apiKey) {
    delete current[provider];
  } else {
    current[provider] = apiKey;
  }

  res.json({ success: true, provider, configured: !!apiKey });
});

// 3. Test Local Backend Endpoint
app.post('/api/local-engine/test', async (req, res) => {
  const { endpoint, apiKey } = req.body;
  let rawUrl = (endpoint || LOCAL_WHISPER_ENDPOINT).trim();
  const effectiveApiKey = apiKey || LOCAL_WHISPER_API_KEY;

  // Normalize URL: extract base host
  let baseUrl = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    baseUrl = `${parsed.protocol}//${parsed.host}`;
  } catch (e) {}

  const normalizedTranscriptionUrl = rawUrl.endsWith('/v1/audio/transcriptions')
    ? rawUrl
    : `${baseUrl}/v1/audio/transcriptions`;

  const testUrls = [
    normalizedTranscriptionUrl,
    `${baseUrl}/v1/models`,
    `${baseUrl}/docs`,
    `${baseUrl}/health`,
    baseUrl, // Root (where Gradio "Whisper Playground" lives!)
  ];

  const headers: Record<string, string> = {
    'Bypass-Tunnel-Reminder': 'true',
    'bypass-tunnel-reminder': 'true',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  let lastStatus = 0;
  let lastError = '';

  for (const url of testUrls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      lastStatus = response.status;

      // 200 OK or 405 Method Not Allowed (means server is alive and POST route is present!)
      if (response.ok || response.status === 405) {
        const textContent = await response.text().catch(() => '');
        let parsedData: any = {};
        try {
          parsedData = JSON.parse(textContent);
        } catch (_) {
          parsedData = { textPreview: textContent.slice(0, 150) };
        }

        const isGradioOrWhisper =
          textContent.includes('Whisper') ||
          textContent.includes('Gradio') ||
          textContent.includes('fastapi') ||
          response.status === 405 ||
          response.ok;

        if (isGradioOrWhisper) {
          res.json({
            available: true,
            status: response.status,
            message: 'Локальный ASR-сервер (faster-whisper / Whisper Playground) успешно обнаружен и готов к работе!',
            data: parsedData,
            targetUrl: normalizedTranscriptionUrl,
          });
          return;
        }
      }

      // 401 Unauthorized means server is running, but requires auth header
      if (response.status === 401) {
        res.json({
          available: false,
          status: 401,
          message: 'Локальный сервер работает, но вернул HTTP 401 (Требуется API-ключ авторизации). Укажите ключ в поле ниже или отключите авторизацию на сервере.',
        });
        return;
      }
    } catch (err: any) {
      lastError = err.message || String(err);
    }
  }

  res.json({
    available: false,
    status: lastStatus || 500,
    message: lastStatus === 401
      ? 'Локальный сервер вернул HTTP 401 (Требуется токен авторизации). Укажите API-ключ в настройках.'
      : 'Не удалось подключиться к серверу. Убедитесь, что локальный Whisper-сервер запущен (например, docker start faster-whisper-server или start-whisper.bat) и порт 8000 доступен. Если сервер находится на другой машине, можно использовать туннель (localtunnel/ngrok) — проверьте, что он активен.',
    error: lastError,
  });
});

// Стандартный 44-байтовый WAV-заголовок для 16-битного моно PCM 16 кГц
function createPcmWavHeader(dataLen: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(44 + dataLen - 8, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(16000, 24); // SampleRate
  header.writeUInt32LE(32000, 28); // ByteRate (16000 * 1 * 2)
  header.writeUInt16LE(2, 32); // BlockAlign
  header.writeUInt16LE(16, 34); // BitsPerSample
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return header;
}

// Находит смещение PCM-данных (чанк 'data') внутри WAV-файла.
// FFmpeg может дописывать служебные чанки (LIST/INFO), поэтому жёсткое 44 не всегда верно.
function findWavDataOffset(buf: Buffer): number {
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    let off = 12;
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4);
      const size = buf.readUInt32LE(off + 4);
      if (id === 'data') return off + 8;
      off += 8 + size + (size % 2);
    }
  }
  return 44;
}

// Helper to ensure any audio or video buffer is a clean 16kHz Mono 16-bit PCM WAV using ffmpeg
async function ensureClean16kWavBuffer(inputBuffer: Buffer): Promise<Buffer> {
  if (
    inputBuffer.length > 44 &&
    inputBuffer.toString('ascii', 0, 4) === 'RIFF' &&
    inputBuffer.toString('ascii', 8, 12) === 'WAVE'
  ) {
    const sampleRate = inputBuffer.readUInt32LE(24);
    const channels = inputBuffer.readUInt16LE(22);
    if (sampleRate === 16000 && channels === 1) {
      return inputBuffer;
    }
  }

  return new Promise((resolve) => {
    try {
      const ffmpeg = spawn('/usr/bin/ffmpeg', [
        '-i', 'pipe:0',
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-acodec', 'pcm_s16le',
        '-f', 'wav',
        'pipe:1',
      ]);

      const chunks: Buffer[] = [];
      let errOutput = '';

      ffmpeg.stdout.on('data', (c) => chunks.push(c));
      ffmpeg.stderr.on('data', (e) => {
        errOutput += e.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          console.warn(`ffmpeg audio normalization warning (code ${code}):`, errOutput.slice(-100));
          resolve(inputBuffer);
        }
      });

      ffmpeg.on('error', (err) => {
        console.warn('ffmpeg spawn error:', err);
        resolve(inputBuffer);
      });

      ffmpeg.stdin.write(inputBuffer);
      ffmpeg.stdin.end();
    } catch (e) {
      console.warn('ffmpeg invocation failed:', e);
      resolve(inputBuffer);
    }
  });
}

// Helper to query and execute transcription on local GPU server with multiple model and route fallbacks
async function transcribeViaLocalWhisper(params: {
  customEndpoint: string;
  buffer: Buffer;
  mimeType?: string;
  fileName: string;
  requestedModelId?: string;
  language?: string;
  localApiKey?: string;
  includeDiarization?: boolean;
  timeoutMs?: number;
}): Promise<{ text: string; segments: any[]; language?: string; duration?: number }> {
  const {
    customEndpoint,
    buffer: rawBuffer,
    mimeType = 'audio/wav',
    fileName,
    requestedModelId,
    language,
    localApiKey,
    includeDiarization,
    timeoutMs = 300000,
  } = params;

  // Normalize audio to standard 16kHz mono WAV to guarantee compatibility
  const buffer = await ensureClean16kWavBuffer(rawBuffer);

  let rawEndpoint = customEndpoint.trim().replace(/\/+$/, '');
  let baseUrl = rawEndpoint;
  try {
    const parsed = new URL(rawEndpoint);
    baseUrl = `${parsed.protocol}//${parsed.host}`;
  } catch {}

  const targetUrls = Array.from(
    new Set([
      rawEndpoint.endsWith('/v1/audio/transcriptions') ? rawEndpoint : `${baseUrl}/v1/audio/transcriptions`,
      rawEndpoint,
      `${baseUrl}/transcribe`,
      `${baseUrl}/audio/transcriptions`,
      `${baseUrl}/api/transcribe`,
      `${baseUrl}/asr`,
      `${baseUrl}/api/v1/audio/transcriptions`,
      `${baseUrl}/inference`,
    ])
  );

  const requestHeaders: Record<string, string> = {
    'Bypass-Tunnel-Reminder': 'true',
    'bypass-tunnel-reminder': 'true',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  if (localApiKey) {
    requestHeaders['Authorization'] = `Bearer ${localApiKey}`;
  }

  // 1. Try to discover what model is actually loaded in the local server
  let discoveredModels: string[] = [];
  try {
    const modelsUrl = `${baseUrl}/v1/models`;
    const mRes = await fetch(modelsUrl, {
      headers: requestHeaders,
      signal: AbortSignal.timeout(4000),
    });
    if (mRes.ok) {
      const mData: any = await mRes.json();
      if (mData?.data && Array.isArray(mData.data)) {
        discoveredModels = mData.data.map((m: any) => m.id || m.name).filter(Boolean);
        console.log(`Discovered active models on local server:`, discoveredModels);
      }
    }
  } catch {}

  // Resolve model mapping based on requested ID.
  // ВНИМАНИЕ: модель 'deepdml/faster-whisper-large-v3-turbo-ct2' вызывает ValueError в faster-whisper,
  // поэтому она полностью исключена из кандидатов. Приоритет: модели, реально загруженные
  // на сервере (discoveredModels), затем large-v3 и её алиасы.
  function getModelCandidates(id?: string): string[] {
    const specific: string[] = [];
    if (id === 'faster-whisper-large-v3-turbo') {
      // На локальном сервере физически загружена large-v3 — сервер сматчит по факту
      specific.push('large-v3', 'Systran/faster-whisper-large-v3', 'whisper-1');
    } else if (id === 'faster-whisper-large-v3' || id === 'whisperx-large-v3') {
      specific.push('large-v3', 'Systran/faster-whisper-large-v3', 'whisper-1');
    } else if (id === 'faster-whisper-medium') {
      specific.push('medium', 'Systran/faster-whisper-medium', 'whisper-1');
    } else if (id === 'faster-whisper-small') {
      specific.push('small', 'Systran/faster-whisper-small', 'whisper-1');
    } else if (id) {
      specific.push(id, 'large-v3', 'Systran/faster-whisper-large-v3', 'whisper-1');
    } else {
      specific.push('large-v3', 'Systran/faster-whisper-large-v3', 'whisper-1');
    }
    // ВАЖНО: запрошенная модель (specific) имеет приоритет над discoveredModels.
    // /v1/models у faster-whisper-server возвращает ВСЕ известные модели (small, tiny, base, ...),
    // поэтому брать первую из списка нельзя — иначе вместо large-v3 будет использоваться small.
    return Array.from(new Set([...specific, ...discoveredModels, 'large-v3', 'Systran/faster-whisper-large-v3', 'whisper-1']));
  }

  const modelCandidates = getModelCandidates(requestedModelId);

  // Normalize language parameter
  let langCode: string | undefined = undefined;
  if (language && language !== 'auto') {
    if (language.startsWith('ru')) langCode = 'ru';
    else if (language.startsWith('en')) langCode = 'en';
    else if (language.startsWith('de')) langCode = 'de';
    else if (language.startsWith('fr')) langCode = 'fr';
    else if (language.startsWith('es')) langCode = 'es';
    else langCode = language.slice(0, 2).toLowerCase();
  }

  let lastStatus = 500;
  let lastErrorText = '';

  // Try candidate target URLs and models
  for (const targetUrl of targetUrls) {
    for (const modelCandidate of modelCandidates) {
      // Attempt A: verbose_json
      try {
        const freshBlob = new Blob([buffer], { type: mimeType });
        const formData = new FormData();
        formData.append('file', freshBlob, fileName || 'chunk.wav');
        formData.append('model', modelCandidate);
        if (langCode) {
          formData.append('language', langCode);
        }
        formData.append('response_format', 'verbose_json');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(targetUrl, {
          method: 'POST',
          headers: requestHeaders,
          body: formData,
          signal: controller.signal,
        }).catch((e) => {
          clearTimeout(timeoutId);
          throw e;
        });

        clearTimeout(timeoutId);
        lastStatus = res.status;

        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('text/event-stream')) {
            const rawText = await res.text();
            const lines = rawText.split('\n');
            let streamedText = '';
            for (const line of lines) {
              if (line.startsWith('data:')) {
                try {
                  const parsed = JSON.parse(line.replace(/^data:\s*/, ''));
                  if (parsed.text) streamedText += parsed.text + ' ';
                  else if (parsed.delta) streamedText += parsed.delta;
                } catch {}
              }
            }
            return {
              text: streamedText.trim(),
              segments: [{ id: 'seg-1', start: 0, end: 5, speaker: 'Спикер 1', text: streamedText.trim() }],
            };
          }

          const data: any = await res.json();
          const rawSegments = data.segments || [];
          const segments = rawSegments.map((seg: any, idx: number) => ({
            id: `seg-${idx + 1}`,
            start: +(seg.start || 0).toFixed(2),
            end: +(seg.end || (seg.start || 0) + 2).toFixed(2),
            speaker: seg.speaker || (includeDiarization ? `Спикер ${(idx % 2) + 1}` : 'Спикер'),
            text: (seg.text || '').trim(),
            confidence: seg.avg_logprob ? +(Math.exp(seg.avg_logprob)).toFixed(2) : 0.95,
          }));
          const text = (data.text || segments.map((s: any) => s.text).join(' ')).trim();
          return { text, segments, language: data.language, duration: data.duration };
        } else {
          lastErrorText = await res.text().catch(() => '');
          // If 404, break model loop and try next targetUrl
          if (res.status === 404) {
            break;
          }
        }
      } catch (e: any) {
        lastErrorText = e.message;
      }

      // Attempt B: standard json
      try {
        const freshBlob = new Blob([buffer], { type: mimeType });
        const formData = new FormData();
        formData.append('file', freshBlob, fileName || 'chunk.wav');
        formData.append('model', modelCandidate);
        if (langCode) {
          formData.append('language', langCode);
        }
        formData.append('response_format', 'json');

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(targetUrl, {
          method: 'POST',
          headers: requestHeaders,
          body: formData,
          signal: controller.signal,
        }).catch((e) => {
          clearTimeout(timeoutId);
          throw e;
        });

        clearTimeout(timeoutId);
        lastStatus = res.status;

        if (res.ok) {
          const data: any = await res.json();
          const text = (data.text || '').trim();
          return {
            text,
            segments: [{ id: 'seg-1', start: 0, end: 5, speaker: 'Спикер 1', text }],
            language: data.language,
            duration: data.duration,
          };
        } else if (res.status === 404) {
          break;
        }
      } catch {}
    }
  }

  let friendlyMessage = `Локальный GPU вернул HTTP ${lastStatus}`;
  if (lastStatus === 404) {
    friendlyMessage = `Локальный туннель вернул 404 (Not Found). Проверьте, активна ли сессия localtunnel / ngrok и не изменился ли URL после перезапуска`;
  } else if (lastStatus === 502 || lastStatus === 504) {
    friendlyMessage = `Связь с локальным туннелем прервана (${lastStatus} Bad Gateway). Проверьте окно терминала с туннелем`;
  } else if (lastErrorText) {
    friendlyMessage += `: ${lastErrorText.slice(0, 150)}`;
  }

  throw new Error(friendlyMessage);
}

// 4. Transcription API Endpoint
app.post('/api/transcribe', async (req, res) => {
  try {
    const {
      audioBase64,
      mimeType = 'audio/mp3',
      language = 'auto',
      options = {},
      modelId = 'gemini-3.7-flash',
      engineMode = 'cloud',
      sessionId,
      customEndpoint,
      localApiKey,
    } = req.body;

    if (!audioBase64 && !req.body.fileUrl) {
      res.status(400).json({ error: 'Аудио или видео данные обязательны для транскрибации.' });
      return;
    }

    const {
      includeTimestamps = true,
      includeDiarization = false,
      autoPunctuation = true,
      autoSummary = true,
      autoActionItems = true,
      translateToEnglish = false,
    } = options;

    // Handle Local mode proxy (прямое локальное подключение; URL/ключ из клиента или из env)
    if (engineMode === 'local') {
      const effectiveEndpoint = (customEndpoint || LOCAL_WHISPER_ENDPOINT).trim();
      const effectiveLocalApiKey = localApiKey || LOCAL_WHISPER_API_KEY;
      try {
        // Срезаем возможный data-URI префикс (data:audio/...;base64,) перед декодированием
        const cleanLocalBase64 = String(audioBase64).replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(cleanLocalBase64, 'base64');

        const localResult = await transcribeViaLocalWhisper({
          customEndpoint: effectiveEndpoint,
          buffer,
          mimeType: mimeType || 'audio/wav',
          fileName: 'audio.wav',
          requestedModelId: modelId,
          language,
          localApiKey: effectiveLocalApiKey,
          includeDiarization,
          timeoutMs: 300000,
        });

        const fullText = localResult.text || '';
        const segments = localResult.segments || [];
        const detectedLang = localResult.language || (language !== 'auto' ? language : 'ru');
        const duration = localResult.duration || (segments.length ? segments[segments.length - 1].end : 0);

        let summary = {
          title: 'Транскрипция (Локальный GPU)',
          overview: 'Расшифровка успешно выполнена на вашей видеокарте через faster-whisper.',
          keyPoints: ['Локальная обработка на GPU'],
        };
        let actionItems: any[] = [];

        // Generate AI Summary & Action Items via Gemini if requested
        if (autoSummary || autoActionItems) {
          try {
            const summaryResp = await ai.models.generateContent({
              model: 'gemini-3.7-flash',
              contents: `Составь краткое резюме и задачи по следующей транскрипции:\n\n"""\n${fullText.slice(0, 15000)}\n"""`,
              config: {
                systemInstruction: `Ты профессиональный AI-ассистент. Верни строго JSON:
{
  "title": "Краткий заголовок темы",
  "overview": "Краткая суть записи (2-3 предложения)",
  "keyPoints": ["Ключевой пункт 1", "Ключевой пункт 2"],
  "actionItems": [{"task": "Задача", "assignee": null, "deadline": null}]
}`,
                responseMimeType: 'application/json',
              },
            });
            const parsed = JSON.parse(summaryResp.text || '{}');
            if (parsed.overview) {
              summary = {
                title: parsed.title || summary.title,
                overview: parsed.overview,
                keyPoints: parsed.keyPoints || summary.keyPoints,
              };
            }
            if (parsed.actionItems) {
              actionItems = parsed.actionItems;
            }
          } catch (sumErr) {
            console.warn('AI summary for local transcript skipped:', sumErr);
          }
        }

        res.json({
          fullText,
          segments,
          detectedLanguage: detectedLang,
          durationSeconds: duration,
          summary,
          actionItems,
          engineMode: 'local',
          modelId: modelId || 'faster-whisper',
        });
        return;
      } catch (localErr: any) {
        console.warn('Local engine request error:', localErr.message);
        res.status(502).json({
          error: `Ошибка локального GPU сервера (${localErr.message}). Убедитесь, что контейнер faster-whisper запущен (docker ps) и видеопамять не переполнена.`,
        });
        return;
      }
    }

    // Process via Gemini 3.7 Flash Audio
    const langInstruction =
      language === 'auto'
        ? 'Автоматически определи основной язык аудио (русский, английский и др.).'
        : `Основной язык аудио: ${language === 'ru' ? 'русский' : language}.`;

    const diarizationInstruction = includeDiarization
      ? 'Определи разных спикеров и пометь каждого спикера в сегментах ("Спикер 1", "Спикер 2", "Ведущий", "Гость" и т.д.).'
      : 'Если говорит один человек, используй "Спикер 1".';

    const timestampInstruction = includeTimestamps
      ? 'Разбей речь на логические сегменты (предложения или короткие фразы) с точными таймкодами начала (start) и конца (end) в секундах.'
      : 'Разбей на логические смысловые сегменты с примерными таймкодами.';

    const punctuationInstruction = autoPunctuation
      ? 'Обязательно расставь правильную пунктуацию, заглавные буквы и устрани очевидные паразитные звуки, сохранив смысл.'
      : 'Сохрани дословную речь.';

    const translationInstruction = translateToEnglish
      ? 'Также добавь качественный перевод всего текста на английский язык.'
      : '';

    const systemPrompt = `Ты профессиональная высокоточная система распознавания речи (ASR) и транскрибации аудио/видео.
Твоя задача — транскрибировать переданное аудио с максимальной точностью, расставить таймкоды, спикеров и выполнить структурированный анализ.

Инструкции:
1. ${langInstruction}
2. ${timestampInstruction}
3. ${diarizationInstruction}
4. ${punctuationInstruction}
5. ${translationInstruction}

Верни результат строго в JSON формате по следующей схеме:
{
  "detectedLanguage": "ru",
  "languageName": "Русский",
  "durationSeconds": 120.5,
  "fullText": "Полный связный текст транскрипта...",
  "segments": [
    {
      "id": "seg-1",
      "start": 0.0,
      "end": 4.5,
      "speaker": "Спикер 1",
      "text": "Текст первой фразы...",
      "confidence": 0.98
    }
  ],
  "summary": {
    "title": "Краткий заголовок записи",
    "overview": "Краткое резюме сути обсуждения (2-4 предложения)...",
    "keyPoints": ["Ключевой пункт 1", "Ключевой пункт 2"]
  },
  "actionItems": [
    {
      "task": "Конкретная задача или договоренность",
      "assignee": "Имя или Спикер (если понятно из контекста, иначе null)",
      "deadline": "Срок (если упомянут, иначе null)"
    }
  ]
}`;

    // Inline audio data
    const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, '');

    const audioPart = {
      inlineData: {
        mimeType: mimeType,
        data: cleanBase64,
      },
    };

    const promptText = `Пожалуйста, выполни полную расшифровку этой аудиозаписи в соответствии с системной инструкцией. 
Обязательно верни JSON со всеми сегментами, спикерами, таймкодами, итоговым текстом, резюме и action items.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: {
        parts: [
          audioPart,
          { text: promptText },
        ],
      },
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedLanguage: { type: Type.STRING },
            languageName: { type: Type.STRING },
            durationSeconds: { type: Type.NUMBER },
            fullText: { type: Type.STRING },
            segments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  start: { type: Type.NUMBER },
                  end: { type: Type.NUMBER },
                  speaker: { type: Type.STRING },
                  text: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                },
                required: ['id', 'start', 'end', 'speaker', 'text'],
              },
            },
            summary: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                overview: { type: Type.STRING },
                keyPoints: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['title', 'overview', 'keyPoints'],
            },
            actionItems: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  task: { type: Type.STRING },
                  assignee: { type: Type.STRING },
                  deadline: { type: Type.STRING },
                },
                required: ['task'],
              },
            },
          },
          required: ['detectedLanguage', 'fullText', 'segments', 'summary', 'actionItems'],
        },
      },
    });

    const responseText = response.text || '{}';
    let parsedData: any = {};
    try {
      parsedData = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse Gemini JSON output:', responseText);
      parsedData = {
        detectedLanguage: language !== 'auto' ? language : 'ru',
        fullText: responseText,
        segments: [
          {
            id: 'seg-1',
            start: 0,
            end: 10,
            speaker: 'Спикер 1',
            text: responseText,
          },
        ],
        summary: {
          title: 'Расшифровка аудио',
          overview: responseText.slice(0, 200) + '...',
          keyPoints: ['Расшифровка завершена'],
        },
        actionItems: [],
      };
    }

    res.json({
      ...parsedData,
      engineMode: 'cloud',
      modelId: 'gemini-3.7-flash',
      processedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Transcription error:', err);
    res.status(500).json({
      error: 'Ошибка при транскрибации аудио: ' + (err.message || 'Неизвестная ошибка сервера'),
    });
  }
});

// 4.1 Transcribe individual small chunk (30-60s) with 5-minute timeout and segment timestamp shifting
app.post('/api/transcribe-chunk', async (req, res) => {
  try {
    const {
      audioBase64,
      mimeType = 'audio/wav',
      chunkIndex = 0,
      totalChunks = 1,
      startTime = 0,
      duration = 45,
      language = 'ru',
      modelId = 'gemini-3.7-flash',
      engineMode = 'cloud',
      customEndpoint,
      localApiKey,
      options = {},
    } = req.body;

    if (!audioBase64) {
      res.status(400).json({ error: 'Аудиоданные фрагмента отсутствуют.' });
      return;
    }

    const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, '');

    // 1. Local Faster-Whisper GPU Engine (прямое локальное подключение; URL/ключ из клиента или из env)
    if (engineMode === 'local') {
      const effectiveEndpoint = (customEndpoint || LOCAL_WHISPER_ENDPOINT).trim();
      const effectiveLocalApiKey = localApiKey || LOCAL_WHISPER_API_KEY;
      try {
        const buffer = Buffer.from(cleanBase64, 'base64');

        const localResult = await transcribeViaLocalWhisper({
          customEndpoint: effectiveEndpoint,
          buffer,
          mimeType: mimeType || 'audio/wav',
          fileName: `chunk_${chunkIndex}.wav`,
          requestedModelId: modelId,
          language,
          localApiKey: effectiveLocalApiKey,
          includeDiarization: options.includeDiarization,
          timeoutMs: 300000,
        });

        const rawSegments = localResult.segments || [];
        const segments = rawSegments.map((seg: any, idx: number) => ({
          id: `seg-${chunkIndex + 1}-${idx + 1}`,
          start: +((seg.start || 0) + startTime).toFixed(2),
          end: +((seg.end || (seg.start || 0) + 2) + startTime).toFixed(2),
          speaker: seg.speaker || (options.includeDiarization ? `Спикер ${(idx % 2) + 1}` : 'Спикер'),
          text: (seg.text || '').trim(),
          confidence: seg.confidence || 0.95,
        }));

        const text = (localResult.text || segments.map((s: any) => s.text).join(' ')).trim();

        res.json({
          text,
          segments: segments.length > 0 ? segments : [
            {
              id: `seg-${chunkIndex + 1}-1`,
              start: +startTime.toFixed(2),
              end: +(startTime + duration).toFixed(2),
              speaker: 'Спикер 1',
              text: text,
            },
          ],
        });
        return;
      } catch (localErr: any) {
        console.warn(`Local GPU chunk #${chunkIndex + 1} failed:`, localErr.message);
        res.status(502).json({
          error: localErr.message || 'Ошибка обработки фрагмента на локальном сервере',
        });
        return;
      }
    }

    // 2. Cloud AI Engine (Gemini 3.7 Flash)
    // Normalize raw buffer with ffmpeg if needed
    const rawBuffer = Buffer.from(cleanBase64, 'base64');
    const normalizedBuffer = await ensureClean16kWavBuffer(rawBuffer);
    const normalizedBase64 = normalizedBuffer.toString('base64');

    const prompt = `Расшифруй этот аудиофрагмент речи (фрагмент ${chunkIndex + 1} из ${totalChunks}, смещение во времени: ${startTime} сек).
Язык речи: ${language}.
${options.includeDiarization ? 'Укажи спикеров.' : ''}

Верни строго валидный JSON:
{
  "text": "Полный текст расшифровки данного фрагмента",
  "segments": [
    {
      "start": 0.0,
      "end": 5.0,
      "speaker": "Спикер 1",
      "text": "Текст предложения"
    }
  ]
}`;

    const geminiResp = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'audio/wav',
              data: normalizedBase64,
            },
          },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(geminiResp.text || '{}');
    const rawSegments = parsed.segments || [];

    const segments = rawSegments.map((seg: any, idx: number) => ({
      id: `seg-${chunkIndex + 1}-${idx + 1}`,
      start: +((seg.start || 0) + startTime).toFixed(2),
      end: +((seg.end || (seg.start || 0) + 2) + startTime).toFixed(2),
      speaker: seg.speaker || 'Спикер 1',
      text: (seg.text || '').trim(),
    }));

    const text = parsed.text || segments.map((s: any) => s.text).join(' ');

    res.json({
      text,
      segments: segments.length > 0 ? segments : [
        {
          id: `seg-${chunkIndex + 1}-1`,
          start: +startTime.toFixed(2),
          end: +(startTime + duration).toFixed(2),
          speaker: 'Спикер 1',
          text: text,
        },
      ],
    });
  } catch (err: any) {
    console.error('Chunk transcription error:', err);
    res.status(500).json({ error: err.message || 'Ошибка обработки фрагмента' });
  }
});

// 4.2 Stream/Extract Audio Chunks with FFmpeg on Server for unsupported video/audio containers
app.post('/api/extract-audio-chunks', async (req, res) => {
  try {
    const { fileBase64, chunkDurationSeconds = 45 } = req.body;
    if (!fileBase64) {
      res.status(400).json({ error: 'Файл не передан' });
      return;
    }

    const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '');
    const inputBuffer = Buffer.from(cleanBase64, 'base64');

    // Transcode whole file/video to 16kHz mono WAV buffer via ffmpeg
    const wavBuffer = await ensureClean16kWavBuffer(inputBuffer);

    // Read header & split into chunks of chunkDurationSeconds
    const sampleRate = 16000;
    const bytesPerSample = 2; // 16-bit PCM mono
    const headerSize = 44;
    const pcmData = wavBuffer.subarray(headerSize);
    const totalSamples = pcmData.length / bytesPerSample;
    const totalDuration = totalSamples / sampleRate;

    const samplesPerChunk = Math.floor(chunkDurationSeconds * sampleRate);
    const bytesPerChunk = samplesPerChunk * bytesPerSample;
    const totalChunks = Math.max(1, Math.ceil(pcmData.length / bytesPerChunk));

    const chunks = [];
    for (let i = 0; i < totalChunks; i++) {
      const startByte = i * bytesPerChunk;
      const endByte = Math.min(pcmData.length, startByte + bytesPerChunk);
      const chunkPcm = pcmData.subarray(startByte, endByte);
      const chunkDuration = (chunkPcm.length / bytesPerSample) / sampleRate;

      // Construct standard WAV header
      const chunkWav = Buffer.concat([createPcmWavHeader(chunkPcm.length), chunkPcm]);
      const chunkBase64 = chunkWav.toString('base64');

      chunks.push({
        index: i,
        totalChunks,
        startTime: i * chunkDurationSeconds,
        duration: +chunkDuration.toFixed(2),
        audioBase64: `data:audio/wav;base64,${chunkBase64}`,
        mimeType: 'audio/wav',
      });
    }

    res.json({
      success: true,
      totalDuration: +totalDuration.toFixed(2),
      chunks,
    });
  } catch (err: any) {
    console.error('Extract audio chunks error:', err);
    res.status(500).json({ error: 'Ошибка извлечения аудио дорожки: ' + err.message });
  }
});

// 4.2 Summarize & Extract Action Items from an already transcribed text (e.g. from local GPU)
app.post('/api/summarize-transcript', async (req, res) => {
  try {
    const { fullText, title = 'Транскрипция' } = req.body;
    if (!fullText || typeof fullText !== 'string' || fullText.trim().length === 0) {
      res.json({
        summary: {
          title,
          overview: 'Запись распознана на локальном GPU.',
          keyPoints: ['Транскрибация завершена'],
        },
        actionItems: [],
      });
      return;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: `Проанализируй следующий текст расшифрованной аудиозаписи и сформируй структурированное резюме и задачи:\n\n"""\n${fullText.slice(0, 15000)}\n"""`,
      config: {
        systemInstruction: `Ты опытный AI-ассистент. Твоя задача — составить краткое резюме и выписать список задач/договоренностей из текста.
Верни строго JSON формат:
{
  "title": "Краткий емкий заголовок",
  "overview": "Краткое резюме сути (2-4 предложения)",
  "keyPoints": ["Ключевой пункт 1", "Ключевой пункт 2"],
  "actionItems": [
    {
      "task": "Конкретное действие или задача",
      "assignee": "Ответственный (если есть, иначе null)",
      "deadline": "Срок (если есть, иначе null)"
    }
  ]
}`,
        responseMimeType: 'application/json',
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json({
      summary: {
        title: parsed.title || title,
        overview: parsed.overview || 'Краткое резюме сформировано.',
        keyPoints: parsed.keyPoints || ['Анализ завершен'],
      },
      actionItems: parsed.actionItems || [],
    });
  } catch (err: any) {
    console.warn('Summarization fallback:', err.message);
    res.json({
      summary: {
        title: req.body.title || 'Транскрипция',
        overview: req.body.fullText?.slice(0, 200) + '...',
        keyPoints: ['Локальное распознавание выполнено'],
      },
      actionItems: [],
    });
  }
});

// 5. Fast Dictation Chunk Endpoint (for streaming / live dictation slice)
app.post('/api/dictate-chunk', async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/webm', language = 'ru', autoPunctuation = true } = req.body;

    if (!audioBase64) {
      res.status(400).json({ error: 'Аудиофрагмент отсутствует' });
      return;
    }

    const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, '');

    const response = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: cleanBase64,
            },
          },
          {
            text: `Точно распознай речь из этого короткого аудиофрагмента. Язык: ${language}. ${autoPunctuation ? 'Расставь знаки препинания.' : ''} Верни ТОЛЬКО распознанный текст без кавычек и лишних слов.`,
          },
        ],
      },
      config: {
        temperature: 0.1,
      },
    });

    const recognizedText = response.text?.trim() || '';
    res.json({ text: recognizedText });
  } catch (err: any) {
    console.error('Dictation chunk error:', err);
    res.status(500).json({ error: err.message || 'Ошибка обработки диктовки' });
  }
});

// 6. Summarize & Action Items Generator (if regenerating from edited text)
app.post('/api/analyze-summary', async (req, res) => {
  try {
    const { transcriptText, title = 'Аудиозапись' } = req.body;
    if (!transcriptText) {
      res.status(400).json({ error: 'Текст транскрипта обязателен.' });
      return;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: `Проанализируй следующий текст расшифровки записи и подготовь структурированное резюме и список задач (action items).

Текст записи:
"""
${transcriptText}
"""

Сформируй ответ строго в JSON формате:
{
  "title": "Информативный заголовок записи",
  "overview": "Краткое изложение содержания и главных тем (3-5 предложений)",
  "keyPoints": ["Ключевой вывод или тема 1", "Ключевой вывод 2", "Ключевой вывод 3"],
  "actionItems": [
    {
      "task": "Что конкретно нужно сделать",
      "assignee": "Ответственное лицо (если указано в тексте, иначе null)",
      "deadline": "Срок выполнения (если указан, иначе null)"
    }
  ]
}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            overview: { type: Type.STRING },
            keyPoints: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            actionItems: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  task: { type: Type.STRING },
                  assignee: { type: Type.STRING },
                  deadline: { type: Type.STRING },
                },
                required: ['task'],
              },
            },
          },
          required: ['title', 'overview', 'keyPoints', 'actionItems'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json(parsed);
  } catch (err: any) {
    console.error('Summary error:', err);
    res.status(500).json({ error: err.message || 'Ошибка генерации резюме' });
  }
});

// 7. Translate Transcript
app.post('/api/translate-transcript', async (req, res) => {
  try {
    const { segments, targetLanguage = 'en' } = req.body;
    if (!segments || !Array.isArray(segments)) {
      res.status(400).json({ error: 'Сегменты обязательны' });
      return;
    }

    const segmentsPayload = JSON.stringify(
      segments.map((s) => ({ id: s.id, text: s.text, speaker: s.speaker }))
    );

    const response = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: `Переведи текст следующих сегментов транскрипта на язык "${targetLanguage}".
Сохрани исходные id и speaker для каждого сегмента.

Сегменты:
${segmentsPayload}

Верни JSON:
{
  "translatedSegments": [
    { "id": "seg-1", "text": "Translated text..." }
  ]
}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            translatedSegments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  text: { type: Type.STRING },
                },
                required: ['id', 'text'],
              },
            },
          },
          required: ['translatedSegments'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    const translationMap = new Map(
      (parsed.translatedSegments || []).map((t: any) => [t.id, t.text])
    );

    const updatedSegments = segments.map((seg) => ({
      ...seg,
      text: translationMap.get(seg.id) || seg.text,
    }));

    const fullText = updatedSegments.map((s) => s.text).join(' ');

    res.json({ segments: updatedSegments, fullText });
  } catch (err: any) {
    console.error('Translation error:', err);
    res.status(500).json({ error: err.message || 'Ошибка перевода транскрипта' });
  }
});

// 8. Model Advisor AI Recommendation Engine
app.post('/api/model-advisor', async (req, res) => {
  try {
    const { answers } = req.body;

    const advisorPrompt = `Ты ведущий AI/ASR архитектор и инженер по речевым технологиям.
Пользователь заполнил опросник для подбора оптимальной модели распознавания речи (ASR) для своей задачи.

Ответы пользователя:
- Тип задачи: ${answers.scenario || 'Встреча/совещание'}
- Язык: ${answers.language || 'Русский'}
- Приоритет: ${answers.priority || 'Сбалансированный'}
- Качество аудио: ${answers.audioQuality || 'Обычное качество, возможен шум'}
- Нужны ли таймкоды: ${answers.timestampsNeeded || 'На уровне фраз/предложений'}
- Нужна ли диаризация (разделение спикеров): ${answers.diarizationNeeded ? 'Да, обязательно' : 'Нет / не критично'}
- Приватность и локальность: ${answers.privacyRequired ? 'Только локально (без отправки в облако)' : 'Облако разрешено'}
- Устройство / Железо: ${answers.hardware || 'ПК с NVIDIA GPU'}
- Режим работы: ${answers.realtimeNeeded ? 'Реальное время / низкая задержка' : 'Пакетная обработка файла'}
- Бюджет / API: ${answers.budget || 'Бесплатный / Open Source'}

Доступные модели и движки в каталоге:
1. "faster-whisper-large-v3-turbo" (Локальный GPU NVIDIA: ~3-4GB VRAM, 4-8x быстрее standard whisper, превосходное качество русского и мультиязычного аудио).
2. "whisperx-large-v3" (Локальный GPU NVIDIA: forced alignment для word-level таймкодов + PyAnnote диаризация спикеров, 6-8GB VRAM).
3. "faster-whisper-medium" (Локальный CPU / слабый GPU: ~2GB VRAM, сбалансированная скорость).
4. "whisper-base-ru" (Локальный легкий CPU / мобильный: минимальные требования, сверхбыстрый).
5. "gigaam-v2-russian" (Локальный специализированный для сложной русской разговорной речи).
6. "gemini-3.7-flash" (Облачный: встроенный в приложение, высочайшая точность, авто-диаризация, резюме, без необходимости настройки GPU).
7. "groq-whisper-large-v3" (Облачный: экстремальная скорость ~300x realtime, идеален для быстрой пакетной обработки с API ключом).
8. "deepgram-nova-3" (Облачный: низкая задержка для стриминга).

Задача:
1. Выбери наиболее подходящую модель (primaryModel).
2. Объясни выбор понятным языком, акцентируя внимание на оборудовании пользователя и его приоритетах.
3. Опиши компромиссы (Trade-offs) между скоростью, точностью, приватностью, стоимостью и требованиями к железу.
4. Предложи альтернативную модель (fallbackModel) на случай других условий.
5. Дай практический совет по железу/настройке (gpuTip), особенно если используется NVIDIA GPU (CUDA/cuDNN).

Верни результат строго в JSON:
{
  "primaryModelId": "faster-whisper-large-v3-turbo",
  "primaryModelName": "faster-whisper (Large-v3-Turbo)",
  "badge": "Рекомендуемый выбор для NVIDIA GPU",
  "summaryReason": "Идеально подходит для локальной обработки на вашей видеокарте...",
  "detailedExplanation": "Подробное объяснение почему эта модель лучше всего справится с задачей...",
  "tradeoffs": {
    "speed": "Очень высокая (до 8x быстрее стандартного Whisper)",
    "accuracy": "97%+ точность распознавания русской речи",
    "privacy": "100% приватность, данные не покидают ваш компьютер",
    "cost": "Полностью бесплатно",
    "vramRequired": "~3.5 GB VRAM (FP16 / INT8)"
  },
  "fallbackModelId": "gemini-3.7-flash",
  "fallbackModelName": "Gemini 3.7 Flash Audio",
  "fallbackReason": "Если потребуется обработать файл без нагрузки на локальный GPU...",
  "recommendedPreset": "meeting",
  "gpuTip": "Для ускорения на NVIDIA GPU используйте compute_type='float16' или 'int8_float16' для экономии VRAM."
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.7-flash',
      contents: advisorPrompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            primaryModelId: { type: Type.STRING },
            primaryModelName: { type: Type.STRING },
            badge: { type: Type.STRING },
            summaryReason: { type: Type.STRING },
            detailedExplanation: { type: Type.STRING },
            tradeoffs: {
              type: Type.OBJECT,
              properties: {
                speed: { type: Type.STRING },
                accuracy: { type: Type.STRING },
                privacy: { type: Type.STRING },
                cost: { type: Type.STRING },
                vramRequired: { type: Type.STRING },
              },
              required: ['speed', 'accuracy', 'privacy', 'cost', 'vramRequired'],
            },
            fallbackModelId: { type: Type.STRING },
            fallbackModelName: { type: Type.STRING },
            fallbackReason: { type: Type.STRING },
            recommendedPreset: { type: Type.STRING },
            gpuTip: { type: Type.STRING },
          },
          required: [
            'primaryModelId',
            'primaryModelName',
            'badge',
            'summaryReason',
            'detailedExplanation',
            'tradeoffs',
            'fallbackModelId',
            'fallbackModelName',
            'fallbackReason',
            'recommendedPreset',
            'gpuTip',
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json(parsed);
  } catch (err: any) {
    console.error('Model advisor error:', err);
    // Fallback recommendation
    res.json({
      primaryModelId: 'faster-whisper-large-v3-turbo',
      primaryModelName: 'faster-whisper (Large-v3-Turbo)',
      badge: 'Оптимальный выбор для баланса скорости и качества',
      summaryReason: 'Обеспечивает превосходную точность русской и мультиязычной речи при высокой скорости работы на GPU.',
      detailedExplanation: 'Faster-whisper использует оптимизированный движок CTranslate2, снижающий потребление видеопамяти в 2-4 раза по сравнению с оригинальным OpenAI Whisper.',
      tradeoffs: {
        speed: 'Очень высокая (в 4-8 раз быстрее базового Whisper)',
        accuracy: 'Высокая (до 98% для студийного и 94% для зашумленного звука)',
        privacy: '100% локально при запуске на вашем сервере / ПК',
        cost: 'Бесплатно (Open Source)',
        vramRequired: '3-4 GB VRAM при float16 / int8_float16',
      },
      fallbackModelId: 'gemini-3.7-flash',
      fallbackModelName: 'Gemini 3.7 Flash Cloud',
      fallbackReason: 'Встроенное облачное решение без необходимости локального GPU.',
      recommendedPreset: 'meeting',
      gpuTip: 'Установите драйверы CUDA 12.x и cuDNN для максимальной производительности на видеокартах NVIDIA RTX.',
    });
  }
});

// 9. Серверная нарезка больших файлов через прямую бинарную загрузку.
// Клиент шлёт файл СЫРЫМ бинарным телом (Content-Type: application/octet-stream),
// поэтому express.json/urlencoded его не трогают, а мы стримим тело сразу на диск —
// файл никогда не поднимается целиком в память ни браузера, ни сервера.
interface PrepareChunksJob {
  dir: string;
  totalChunks: number;
  totalDuration: number;
  chunkDurationSeconds: number;
  timer: NodeJS.Timeout;
}

const prepareChunksJobs = new Map<string, PrepareChunksJob>();
const PREPARE_CHUNKS_ROOT = path.join(os.tmpdir(), 'vibescribe-chunks');
const PREPARE_JOB_TTL_MS = 2 * 60 * 60 * 1000; // 2 часа
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000; // 10 минут
const JOB_ID_PATTERN = /^job-\d+-[a-z0-9]+$/;

// POST /api/prepare-chunks?chunkDurationSeconds=45
app.post('/api/prepare-chunks', async (req, res) => {
  const chunkDurationSeconds = Math.max(5, Math.min(600, Number(req.query.chunkDurationSeconds) || 45));
  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const jobDir = path.join(PREPARE_CHUNKS_ROOT, jobId);
  const inputPath = path.join(jobDir, 'input.bin');
  const outputPath = path.join(jobDir, 'output.wav');

  const cleanupJobDir = () => {
    fs.rm(jobDir, { recursive: true, force: true }, () => {});
  };

  try {
    await fs.promises.mkdir(jobDir, { recursive: true });

    // 1. Стримим сырое бинарное тело запроса напрямую во временный файл (без буферизации в память)
    await new Promise<void>((resolve, reject) => {
      const ws = fs.createWriteStream(inputPath);
      req.pipe(ws);
      req.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', () => resolve());
    });

    const inputStats = await fs.promises.stat(inputPath);
    if (inputStats.size === 0) {
      cleanupJobDir();
      res.status(400).json({ error: 'Пустое тело запроса: файл не был получен сервером.' });
      return;
    }

    // 2. Транскодируем файл целиком в 16 кГц моно PCM WAV на ДИСКЕ через FFmpeg.
    // Сознательно НЕ используем ensureClean16kWavBuffer (она держит весь файл в памяти).
    try {
      await new Promise<void>((resolve, reject) => {
        const ff = spawn('/usr/bin/ffmpeg', [
          '-y',
          '-i', inputPath,
          '-vn',
          '-ac', '1',
          '-ar', '16000',
          '-acodec', 'pcm_s16le',
          outputPath,
        ]);
        let errOut = '';
        const timer = setTimeout(() => {
          ff.kill('SIGKILL');
          reject(new Error('превышен таймаут обработки FFmpeg (10 минут)'));
        }, FFMPEG_TIMEOUT_MS);
        ff.stderr.on('data', (d) => {
          errOut += d.toString();
        });
        ff.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
        ff.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0 && fs.existsSync(outputPath)) {
            resolve();
          } else {
            reject(new Error(`FFmpeg завершился с кодом ${code}: ${errOut.slice(-200)}`));
          }
        });
      });
    } catch (ffErr: any) {
      console.error('Prepare chunks FFmpeg error:', ffErr);
      cleanupJobDir();
      res.status(500).json({
        error:
          'Серверный FFmpeg недоступен или не смог обработать этот файл. ' +
          'Убедитесь, что FFmpeg установлен на сервере (/usr/bin/ffmpeg), а файл содержит аудиодорожку. ' +
          (ffErr?.message || String(ffErr)),
      });
      return;
    }

    // 3. Нарезаем полученный WAV на фрагменты по chunkDurationSeconds и складываем на диск
    const sampleRate = 16000;
    const bytesPerSample = 2; // 16-bit PCM mono
    const wavBuffer = await fs.promises.readFile(outputPath);
    const headerSize = findWavDataOffset(wavBuffer);
    const pcmData = wavBuffer.subarray(headerSize);
    const totalDuration = pcmData.length / bytesPerSample / sampleRate;
    const bytesPerChunk = Math.floor(chunkDurationSeconds * sampleRate) * bytesPerSample;
    const totalChunks = Math.max(1, Math.ceil(pcmData.length / bytesPerChunk));

    for (let i = 0; i < totalChunks; i++) {
      const startByte = i * bytesPerChunk;
      const endByte = Math.min(pcmData.length, startByte + bytesPerChunk);
      const chunkPcm = pcmData.subarray(startByte, endByte);
      const chunkWav = Buffer.concat([createPcmWavHeader(chunkPcm.length), chunkPcm]);
      await fs.promises.writeFile(path.join(jobDir, `chunk_${i}.wav`), chunkWav);
    }

    // 4. Тяжёлые промежуточные файлы больше не нужны
    await fs.promises.unlink(inputPath).catch(() => {});
    await fs.promises.unlink(outputPath).catch(() => {});

    // 5. Регистрируем задание с TTL: через 2 часа каталог удаляется автоматически
    const timer = setTimeout(() => {
      prepareChunksJobs.delete(jobId);
      fs.rm(jobDir, { recursive: true, force: true }, () => {});
    }, PREPARE_JOB_TTL_MS);
    timer.unref?.();
    prepareChunksJobs.set(jobId, {
      dir: jobDir,
      totalChunks,
      totalDuration: +totalDuration.toFixed(2),
      chunkDurationSeconds,
      timer,
    });

    res.json({
      success: true,
      jobId,
      totalDuration: +totalDuration.toFixed(2),
      totalChunks,
      chunkDurationSeconds,
    });
  } catch (err: any) {
    console.error('Prepare chunks error:', err);
    cleanupJobDir();
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Ошибка серверной нарезки файла: ' + (err.message || 'Неизвестная ошибка сервера'),
      });
    }
  }
});

// GET /api/prepare-chunks/:jobId/:index — отдать один фрагмент с диска
app.get('/api/prepare-chunks/:jobId/:index', async (req, res) => {
  try {
    const { jobId, index } = req.params;
    if (!JOB_ID_PATTERN.test(jobId)) {
      res.status(400).json({ error: 'Некорректный идентификатор задания нарезки.' });
      return;
    }

    const job = prepareChunksJobs.get(jobId);
    if (!job) {
      res.status(410).json({
        error: 'Задание нарезки не найдено или срок его хранения истёк (2 часа). Загрузите файл заново.',
      });
      return;
    }

    const chunkIndex = parseInt(index, 10);
    const chunkPath = path.join(job.dir, `chunk_${chunkIndex}.wav`);
    if (
      !Number.isInteger(chunkIndex) ||
      chunkIndex < 0 ||
      chunkIndex >= job.totalChunks ||
      !fs.existsSync(chunkPath)
    ) {
      res.status(404).json({
        error: `Фрагмент ${index} не найден (всего фрагментов в задании: ${job.totalChunks}).`,
      });
      return;
    }

    const chunkBuffer = await fs.promises.readFile(chunkPath);
    const dataOffset = findWavDataOffset(chunkBuffer);
    const duration = (chunkBuffer.length - dataOffset) / 2 / 16000;

    res.json({
      index: chunkIndex,
      totalChunks: job.totalChunks,
      startTime: +(chunkIndex * job.chunkDurationSeconds).toFixed(2),
      duration: +duration.toFixed(2),
      audioBase64: `data:audio/wav;base64,${chunkBuffer.toString('base64')}`,
    });
  } catch (err: any) {
    console.error('Get prepared chunk error:', err);
    res.status(500).json({ error: 'Ошибка чтения фрагмента: ' + (err.message || 'Неизвестная ошибка') });
  }
});

// DELETE /api/prepare-chunks/:jobId — удалить временные файлы задания
app.delete('/api/prepare-chunks/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = prepareChunksJobs.get(jobId);
  if (job) {
    clearTimeout(job.timer);
    prepareChunksJobs.delete(jobId);
  }
  if (JOB_ID_PATTERN.test(jobId)) {
    fs.rm(path.join(PREPARE_CHUNKS_ROOT, jobId), { recursive: true, force: true }, () => {});
  }
  res.json({ success: true });
});

// Vite frontend integration (development vs production)
async function setupVite() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

setupVite().catch((err) => {
  console.error('Failed to start server:', err);
});
