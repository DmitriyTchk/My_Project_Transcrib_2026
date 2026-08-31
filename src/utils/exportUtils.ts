import { TranscriptionResult, TranscriptionSegment } from '../types';

/**
 * Format seconds to SRT timestamp: 00:01:23,450
 */
export function formatSrtTimestamp(seconds: number): string {
  const pad = (num: number, size = 2) => String(Math.floor(num)).padStart(size, '0');
  const hours = pad(seconds / 3600);
  const minutes = pad((seconds % 3600) / 60);
  const secs = pad(seconds % 60);
  const millis = pad(Math.floor((seconds % 1) * 1000), 3);
  return `${hours}:${minutes}:${secs},${millis}`;
}

/**
 * Format seconds to WebVTT timestamp: 00:01:23.450
 */
export function formatVttTimestamp(seconds: number): string {
  const pad = (num: number, size = 2) => String(Math.floor(num)).padStart(size, '0');
  const hours = pad(seconds / 3600);
  const minutes = pad((seconds % 3600) / 60);
  const secs = pad(seconds % 60);
  const millis = pad(Math.floor((seconds % 1) * 1000), 3);
  return `${hours}:${minutes}:${secs}.${millis}`;
}

/**
 * Export segments to SRT format
 */
export function exportToSrt(segments: TranscriptionSegment[]): string {
  return segments
    .map((seg, idx) => {
      const index = idx + 1;
      const timeRange = `${formatSrtTimestamp(seg.start)} --> ${formatSrtTimestamp(seg.end)}`;
      const speakerPrefix = seg.speaker ? `[${seg.speaker}] ` : '';
      return `${index}\n${timeRange}\n${speakerPrefix}${seg.text}\n`;
    })
    .join('\n');
}

/**
 * Export segments to WebVTT format
 */
export function exportToVtt(segments: TranscriptionSegment[]): string {
  const header = 'WEBVTT\n\n';
  const body = segments
    .map((seg, idx) => {
      const timeRange = `${formatVttTimestamp(seg.start)} --> ${formatVttTimestamp(seg.end)}`;
      const speakerPrefix = seg.speaker ? `<v ${seg.speaker}>` : '';
      return `${idx + 1}\n${timeRange}\n${speakerPrefix}${seg.text}\n`;
    })
    .join('\n');
  return header + body;
}

/**
 * Export to Clean TXT format with optional timestamps and speakers
 */
export function exportToTxt(
  result: TranscriptionResult,
  options: { includeTimestamps?: boolean; includeSpeakers?: boolean; includeSummary?: boolean } = {
    includeTimestamps: true,
    includeSpeakers: true,
    includeSummary: true,
  }
): string {
  let content = `=== ${result.title || 'Транскрипт аудиозаписи'} ===\n`;
  content += `Дата: ${new Date(result.createdAt).toLocaleString('ru-RU')}\n`;
  content += `Модель: ${result.modelName} (${result.engineMode === 'local' ? 'Локальный режим' : 'Облачный режим'})\n`;
  content += `Длительность: ${Math.round(result.duration)} сек\n\n`;

  if (options.includeSummary && result.summary) {
    content += `--- КРАТКОЕ РЕЗЮМЕ ---\n`;
    content += `${result.summary.overview}\n\n`;
    if (result.summary.keyPoints && result.summary.keyPoints.length > 0) {
      content += `Ключевые тезисы:\n`;
      result.summary.keyPoints.forEach((kp) => (content += `• ${kp}\n`));
      content += '\n';
    }
  }

  if (result.actionItems && result.actionItems.length > 0) {
    content += `--- ЗАДАЧИ И ДОГОВОРЕННОСТИ (ACTION ITEMS) ---\n`;
    result.actionItems.forEach((ai) => {
      const assignee = ai.assignee ? ` [Отв: ${ai.assignee}]` : '';
      const deadline = ai.deadline ? ` [Срок: ${ai.deadline}]` : '';
      content += `[ ] ${ai.task}${assignee}${deadline}\n`;
    });
    content += '\n';
  }

  content += `--- ПОЛНАЯ РАСШИФРОВКА ---\n\n`;

  if (options.includeTimestamps && result.segments && result.segments.length > 0) {
    result.segments.forEach((seg) => {
      const startFmt = formatTimeDisplay(seg.start);
      const endFmt = formatTimeDisplay(seg.end);
      const speaker = options.includeSpeakers && seg.speaker ? ` [${seg.speaker}]` : '';
      content += `[${startFmt} - ${endFmt}]${speaker}: ${seg.text}\n\n`;
    });
  } else {
    content += result.fullText || '';
  }

  return content;
}

/**
 * Export to JSON
 */
export function exportToJson(result: TranscriptionResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Export to CSV format for data analysis
 */
export function exportToCsv(segments: TranscriptionSegment[]): string {
  const header = '"Index","Start (sec)","End (sec)","Start Time","End Time","Speaker","Text"\n';
  const rows = segments.map((s, idx) => {
    const cleanText = s.text.replace(/"/g, '""');
    const cleanSpeaker = (s.speaker || '').replace(/"/g, '""');
    return `${idx + 1},${s.start.toFixed(2)},${s.end.toFixed(2)},"${formatTimeDisplay(s.start)}","${formatTimeDisplay(s.end)}","${cleanSpeaker}","${cleanText}"`;
  });
  return header + rows.join('\n');
}

/**
 * Helper to trigger browser download
 */
export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Display format helper mm:ss or hh:mm:ss
 */
export function formatTimeDisplay(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}
