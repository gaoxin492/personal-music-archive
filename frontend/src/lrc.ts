export interface LyricLine {
  time: number | null; // seconds; null for plain (unsynced) lyrics
  text: string;
}

export interface ParsedLyrics {
  synced: boolean;
  lines: LyricLine[];
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_TAG = /^\[(ti|ar|al|au|by|re|ve|length|offset|#):?[^\]]*\]\s*$/i;

/**
 * Parses LRC ("[01:02.34]line", several timestamps per line allowed, optional [offset:+ms])
 * or falls back to plain text when there are no timestamps.
 */
export function parseLrc(source: string): ParsedLyrics {
  const raw = source.replace(/\r\n?/g, "\n").split("\n");
  let offset = 0;
  const timed: LyricLine[] = [];
  const plain: LyricLine[] = [];

  for (const line of raw) {
    const off = line.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) {
      offset = parseInt(off[1], 10) / 1000; // positive offset = lyrics appear earlier
      continue;
    }
    if (META_TAG.test(line.trim())) continue;

    const stamps = [...line.matchAll(TIME_TAG)];
    const text = line.replace(TIME_TAG, "").trim();
    if (stamps.length) {
      for (const s of stamps) {
        const frac = s[3] ? parseInt(s[3], 10) / 10 ** s[3].length : 0;
        timed.push({ time: Math.max(0, parseInt(s[1], 10) * 60 + parseInt(s[2], 10) + frac - offset), text });
      }
    } else {
      plain.push({ time: null, text: line.trim() });
    }
  }

  if (timed.length) {
    timed.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
    return { synced: true, lines: timed };
  }
  // trim leading/trailing blank lines, keep inner blank lines as stanza breaks
  while (plain.length && !plain[0].text) plain.shift();
  while (plain.length && !plain[plain.length - 1].text) plain.pop();
  return { synced: false, lines: plain };
}

/** Index of the line being sung at `time`, or -1 before the first line. */
export function activeLine(lines: LyricLine[], time: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid].time ?? Infinity) <= time) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Decode a .lrc file: UTF-8 first, then GB18030 (common for Chinese lyric sites). */
export async function readLyricsFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("gb18030").decode(buf);
  }
}
