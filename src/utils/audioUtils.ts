/**
 * Audio helpers for file inspection, base64 conversion, audio extraction and media recorder
 */

export async function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result);
    };
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

export interface AudioChunk {
  index: number;
  totalChunks: number;
  startTime: number;
  duration: number;
  blob: Blob;
  mimeType: string;
}

/**
 * Fast pure-JS 16-bit Mono PCM WAV encoder from Float32Array samples
 */
export function pcm16FloatToWavBlob(samples: Float32Array, sampleRate: number = 16000): Blob {
  const numChannels = 1;
  const bitDepth = 16;
  const dataLength = samples.length * 2;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;

  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const sampleVal = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, sampleVal, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Resample any AudioBuffer to 16,000 Hz Mono Float32Array in pure JavaScript (< 20ms)
 */
function resampleToMono16k(audioBuffer: AudioBuffer): Float32Array {
  const numChannels = audioBuffer.numberOfChannels;
  const srcRate = audioBuffer.sampleRate;
  const dstRate = 16000;

  if (srcRate === dstRate && numChannels === 1) {
    return audioBuffer.getChannelData(0);
  }

  const outLength = Math.max(1, Math.floor(audioBuffer.length * (dstRate / srcRate)));
  const outSamples = new Float32Array(outLength);

  const channelDatas: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channelDatas.push(audioBuffer.getChannelData(c));
  }

  const ratio = srcRate / dstRate;
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const srcIndex = Math.floor(srcPos);
    const frac = srcPos - srcIndex;
    const nextIndex = Math.min(srcIndex + 1, audioBuffer.length - 1);

    let mixedSample = 0;
    for (let c = 0; c < numChannels; c++) {
      const s1 = channelDatas[c][srcIndex] || 0;
      const s2 = channelDatas[c][nextIndex] || 0;
      mixedSample += s1 + frac * (s2 - s1);
    }
    outSamples[i] = mixedSample / numChannels;
  }

  return outSamples;
}

/**
 * Convert Base64 data URL to Blob
 */
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

/**
 * Split an audio or video file into small digestible chunks (e.g. 45 seconds each)
 * resampled to 16,000 Hz Mono WAV (approx ~1.4MB each).
 * This completely avoids HTTP 413 (Payload Too Large) and proxy timeout issues.
 */
export async function splitAudioIntoChunks(
  file: File,
  chunkDurationSeconds: number = 45,
  onProgress?: (msg: string) => void
): Promise<{ chunks: AudioChunk[]; totalDuration: number }> {
  let audioContext: AudioContext | null = null;
  const isVideo = file.type.startsWith('video/') || /\.(mp4|mkv|mov|avi|webm|ts|m4v)$/i.test(file.name);

  // Method A: In-Browser Web Audio API Fast Resampling
  try {
    if (onProgress) {
      onProgress(
        isVideo
          ? 'Потоковое извлечение аудиодорожки из видеофайла (локально в браузере, без загрузки видеоряда)...'
          : 'Декодирование аудиопотока в браузере...'
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const totalDuration = audioBuffer.duration || 1;
    const targetSampleRate = 16000;

    if (onProgress) {
      onProgress('Оптимизация моно-аудио 16 кГц и нарезка на фрагменты...');
    }

    // 1. Resample all audio to 16,000 Hz Mono Float32Array in pure JavaScript
    const mono16kSamples = resampleToMono16k(audioBuffer);
    const samplesPerChunk = targetSampleRate * chunkDurationSeconds;
    const totalChunks = Math.max(1, Math.ceil(mono16kSamples.length / samplesPerChunk));

    if (onProgress) {
      onProgress(
        isVideo
          ? `Аудио извлечено из видео. Нарезка (${Math.round(totalDuration)}с) на ${totalChunks} легковесных фрагментов по ${chunkDurationSeconds}с...`
          : `Разбиение записи (${Math.round(totalDuration)}с) на ${totalChunks} фрагментов по ${chunkDurationSeconds}с...`
      );
    }

    const chunks: AudioChunk[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const startSample = i * samplesPerChunk;
      const endSample = Math.min(mono16kSamples.length, startSample + samplesPerChunk);
      const chunkData = mono16kSamples.subarray(startSample, endSample);
      const chunkDuration = chunkData.length / targetSampleRate;

      if (chunkDuration < 0.2 && i > 0) continue; // Skip tiny end residue

      const wavBlob = pcm16FloatToWavBlob(chunkData, targetSampleRate);

      chunks.push({
        index: i,
        totalChunks,
        startTime: +(i * chunkDurationSeconds).toFixed(2),
        duration: +chunkDuration.toFixed(2),
        blob: wavBlob,
        mimeType: 'audio/wav',
      });
    }

    return { chunks, totalDuration };
  } catch (browserDecodeErr) {
    console.warn('In-browser audio decoding failed, using server-side FFmpeg extraction:', browserDecodeErr);

    // Method B: Server-Side FFmpeg Audio Extraction & Chunking Fallback
    try {
      if (onProgress) {
        onProgress('Извлечение аудиодорожки через серверный медиа-движок FFmpeg...');
      }

      const fileBase64 = await fileToBase64(file);
      const resp = await fetch('/api/extract-audio-chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64,
          chunkDurationSeconds,
        }),
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${resp.status}: Ошибка извлечения аудио`);
      }

      const data = await resp.json();
      const serverChunks = data.chunks || [];
      const totalDuration = data.totalDuration || 60;

      const chunks: AudioChunk[] = [];
      for (const sc of serverChunks) {
        const blob = await dataUrlToBlob(sc.audioBase64);
        chunks.push({
          index: sc.index,
          totalChunks: sc.totalChunks,
          startTime: sc.startTime,
          duration: sc.duration,
          blob,
          mimeType: 'audio/wav',
        });
      }

      return { chunks, totalDuration };
    } catch (serverExtractErr) {
      console.error('All audio splitting methods failed, fallback to single file:', serverExtractErr);
      return {
        chunks: [
          {
            index: 0,
            totalChunks: 1,
            startTime: 0,
            duration: 60,
            blob: file,
            mimeType: file.type || 'audio/mp3',
          },
        ],
        totalDuration: 60,
      };
    }
  } finally {
    if (audioContext && audioContext.state !== 'closed') {
      try {
        await audioContext.close().catch(() => {});
      } catch {}
    }
  }
}

/**
 * Transcribe a single audio chunk with a 5-minute timeout (300,000ms) and automatic retry
 */
export async function transcribeChunkWithTimeout(params: {
  chunk: AudioChunk;
  audioBase64: string;
  language: string;
  options: any;
  modelId: string;
  engineMode: 'cloud' | 'local';
  customEndpoint?: string;
  localApiKey?: string;
  sessionId?: string;
  timeoutMs?: number;
  retryCount?: number;
}): Promise<{
  text: string;
  segments: Array<{
    id: string;
    start: number;
    end: number;
    speaker?: string;
    text: string;
    confidence?: number;
  }>;
}> {
  const {
    chunk,
    audioBase64,
    language,
    options,
    modelId,
    engineMode,
    customEndpoint,
    localApiKey,
    sessionId,
    timeoutMs = 300000, // 5 minutes timeout
    retryCount = 2,
  } = params;

  let lastError: any = null;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch('/api/transcribe-chunk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-id': sessionId || '',
        },
        body: JSON.stringify({
          audioBase64,
          mimeType: chunk.mimeType,
          chunkIndex: chunk.index,
          totalChunks: chunk.totalChunks,
          startTime: chunk.startTime,
          duration: chunk.duration,
          language,
          options,
          modelId,
          engineMode,
          customEndpoint,
          localApiKey,
          sessionId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(
          errJson.error || `HTTP ${res.status}: Ошибка распознавания фрагмента ${chunk.index + 1}`
        );
      }

      const data = await res.json();
      return {
        text: data.text || '',
        segments: data.segments || [],
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      lastError = err;

      if (err.name === 'AbortError') {
        throw new Error(
          `Таймаут ожидания ответа (${Math.round(
            timeoutMs / 1000
          )}с) при распознавании фрагмента ${chunk.index + 1}. Проверьте нагрузку на GPU.`
        );
      }

      // Retry after small backoff if attempts remain
      if (attempt < retryCount) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error(`Не удалось распознать фрагмент ${chunk.index + 1}`);
}

/**
 * Extract audio from video/audio file and convert to compressed WebM (Opus) or optimized WAV.
 * This shrinks large video/audio files from hundreds of MBs down to < 2-5 MB.
 */
export async function extractAndCompressAudio(
  file: File,
  onProgress?: (msg: string) => void
): Promise<{ blob: Blob; mimeType: string }> {
  // If it's already a tiny compressed audio file (< 4MB), return directly
  if (
    file.size < 4 * 1024 * 1024 &&
    (file.type.includes('mp3') || file.type.includes('ogg') || file.type.includes('m4a') || file.type.includes('webm'))
  ) {
    return { blob: file, mimeType: file.type || 'audio/mp3' };
  }

  let audioContext: AudioContext | null = null;
  try {
    if (onProgress) onProgress('Извлечение аудиодорожки из медиафайла...');

    const arrayBuffer = await file.arrayBuffer();
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Decode audio data (works for mp4, mkv, mov, mp3, wav, flac, etc.)
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const duration = audioBuffer.duration || 60;
    
    // Choose 16kHz for short/medium, 11kHz/8kHz for long files to keep WAV tiny (< 5-10MB)
    let targetSampleRate = 16000;
    if (duration > 3600) {
      targetSampleRate = 8000;
    } else if (duration > 1200) {
      targetSampleRate = 11025;
    }

    if (onProgress) {
      onProgress(
        `Оптимизация звука (${Math.round(targetSampleRate / 1000)} кГц моно, ${Math.round(duration)} сек)...`
      );
    }

    const offlineCtx = new OfflineAudioContext(
      1,
      Math.max(1, Math.ceil(duration * targetSampleRate)),
      targetSampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const renderedBuffer = await offlineCtx.startRendering();

    // Encode to 16-bit Mono WAV
    const wavBlob = audioBufferToWavBlob(renderedBuffer);
    console.log(
      `Audio optimized: ${(wavBlob.size / 1024 / 1024).toFixed(2)} MB (${Math.round(duration)}s, ${targetSampleRate}Hz)`
    );

    return { blob: wavBlob, mimeType: 'audio/wav' };
  } catch (err) {
    console.warn('In-browser audio decoding failed, fallback to original file:', err);
    return { blob: file, mimeType: file.type || 'audio/mp3' };
  } finally {
    if (audioContext && audioContext.state !== 'closed') {
      try {
        await audioContext.close().catch(() => {});
      } catch {}
    }
  }
}

/**
 * Transcribe directly from browser to the user's local Faster-Whisper server / tunnel.
 * This completely bypasses Cloud Run and server-side request limits!
 */
export async function transcribeDirectToLocalServer(
  audioBlob: Blob,
  fileName: string,
  localEndpoint: string,
  modelId: string,
  language: string,
  apiKey?: string
): Promise<{ fullText: string; segments: any[]; detectedLanguage: string; duration: number }> {
  let targetUrl = localEndpoint.trim();
  if (!targetUrl.endsWith('/v1/audio/transcriptions')) {
    let baseUrl = targetUrl.replace(/\/+$/, '');
    targetUrl = `${baseUrl}/v1/audio/transcriptions`;
  }

  const formData = new FormData();
  formData.append('file', audioBlob, fileName.replace(/\.[^/.]+$/, '') + '.wav');
  formData.append('model', modelId || 'deepdml/faster-whisper-large-v3-turbo-ct2');
  if (language && language !== 'auto') {
    formData.append('language', language);
  }
  formData.append('response_format', 'verbose_json');

  const headers: Record<string, string> = {
    'Bypass-Tunnel-Reminder': 'true',
    'bypass-tunnel-reminder': 'true',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Локальный ASR сервер вернул ошибку HTTP ${response.status}: ${errorText.slice(0, 120)}`);
  }

  const data = await response.json();
  const rawSegments = data.segments || [];
  const segments = rawSegments.map((s: any, idx: number) => ({
    id: `seg-${idx + 1}`,
    start: +(s.start || 0).toFixed(2),
    end: +(s.end || (s.start || 0) + 2).toFixed(2),
    speaker: s.speaker || `Спикер ${((idx % 2) + 1)}`,
    text: (s.text || '').trim(),
    confidence: s.avg_logprob ? +(Math.exp(s.avg_logprob)).toFixed(2) : 0.95,
  }));

  const fullText = data.text || segments.map((s: any) => s.text).join(' ');
  const detectedLanguage = data.language || (language !== 'auto' ? language : 'ru');
  const duration = data.duration || (segments.length ? segments[segments.length - 1].end : 60);

  return {
    fullText,
    segments,
    detectedLanguage,
    duration,
  };
}

/**
 * Encode an AudioBuffer to a standard 16-bit PCM WAV Blob
 */
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const channelData = buffer.getChannelData(0);
  const dataLength = channelData.length * (bitDepth / 8);
  const headerLength = 44;
  const totalLength = headerLength + dataLength;
  
  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  // Write WAV header
  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // SubChunk1Size
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true); // ByteRate
  view.setUint16(32, numChannels * (bitDepth / 8), true); // BlockAlign
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  // Write PCM audio samples
  let offset = 44;
  for (let i = 0; i < channelData.length; i++) {
    // Clamp sample between -1.0 and 1.0
    let s = Math.max(-1, Math.min(1, channelData[i]));
    // Convert to 16-bit signed integer
    const sampleVal = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, sampleVal, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const isVideo = file.type.startsWith('video/') || /\.(mp4|mkv|mov|avi|webm|ts|m4v)$/i.test(file.name);
    const media = isVideo ? document.createElement('video') : new Audio();
    const objectUrl = URL.createObjectURL(file);
    media.src = objectUrl;
    media.preload = 'metadata';
    media.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(media.duration || 0);
    };
    media.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(0);
    };
  });
}

export function isAudioOrVideo(file: File): boolean {
  return (
    file.type.startsWith('audio/') ||
    file.type.startsWith('video/') ||
    /\.(mp3|wav|m4a|ogg|aac|flac|wma|webm|mp4|mkv|mov|avi|ts)$/i.test(file.name)
  );
}

export function estimateProcessingCost(durationSeconds: number, engineMode: string, modelId: string): string {
  if (engineMode === 'local') {
    return '0 ₽ (Локальный GPU / Бесплатно)';
  }
  if (modelId.includes('gemini')) {
    return 'Бесплатно (Включено в систему)';
  }
  if (modelId.includes('groq')) {
    const hours = durationSeconds / 3600;
    const costUsd = (hours * 0.04).toFixed(4);
    return `~$${costUsd} (~${(Number(costUsd) * 95).toFixed(2)} ₽)`;
  }
  if (modelId.includes('openai')) {
    const minutes = durationSeconds / 60;
    const costUsd = (minutes * 0.006).toFixed(4);
    return `~$${costUsd} (~${(Number(costUsd) * 95).toFixed(2)} ₽)`;
  }
  return 'Экономичный';
}
