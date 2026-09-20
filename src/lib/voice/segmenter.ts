// Adaptive speech segmenter (§3–4, §25–26).
// Token stream in → speakable phrases out. Never splits a word; flushes on
// sentence ends, long-clause commas, max length, and stall timeouts.
// Pure + synchronous — unit-testable without audio.

import type { SegmenterConfig } from './types';

const DEFAULTS: SegmenterConfig = {
  minLen: 24,
  maxLen: 220,
  softFlushMs: 900,
  hardFlushMs: 2400,
};

export class AdaptiveSegmenter {
  private buf = '';
  private lastLen = 0;
  private cfg: SegmenterConfig;
  private lastPushAt = 0;
  private lastFlushAt = Date.now();

  constructor(cfg: Partial<SegmenterConfig> = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
  }

  reset() {
    this.buf = '';
    this.lastLen = 0;
    this.lastFlushAt = Date.now();
  }

  pending(): string {
    return this.buf;
  }

  /**
   * Feed the newest FULL streamed text (cumulative, append-only).
   * Only the unseen tail enters the buffer, so nothing is ever
   * emitted twice. Returns newly completed stable segments.
   * Stability rule: only text before the last whitespace run is
   * eligible — the trailing partial word is never spoken.
   */
  push(fullText: string): string[] {
    if (fullText.length < this.lastLen) this.reset(); // stream restarted
    this.buf += fullText.slice(this.lastLen);
    this.lastLen = fullText.length;
    this.lastPushAt = Date.now();
    return this.extract(false);
  }

  /** Time-based flush check — call on an interval while streaming. */
  poll(): string[] {
    const idle = Date.now() - this.lastPushAt;
    const sinceFlush = Date.now() - this.lastFlushAt;
    if (!this.buf.trim()) return [];
    if (sinceFlush >= this.cfg.hardFlushMs) return this.extract(true);
    if (idle >= this.cfg.softFlushMs && this.buf.trim().length >= this.cfg.minLen) {
      return this.extract(true);
    }
    return this.extract(false);
  }

  /** Final flush at stream end. */
  finish(): string[] {
    const out = this.extract(true, true);
    this.reset();
    return out;
  }

  private extract(allowUnstable: boolean, forceAll = false): string[] {
    const out: string[] = [];
    let text = this.buf;
    for (;;) {
      const seg = this.takeOne(text, allowUnstable, forceAll);
      if (!seg) break;
      out.push(seg.text);
      text = seg.rest;
    }
    this.buf = text;
    if (out.length) this.lastFlushAt = Date.now();
    return out;
  }

  private takeOne(
    text: string,
    allowUnstable: boolean,
    forceAll: boolean
  ): { text: string; rest: string } | null {
    const t = text;
    if (!t.trim()) return null;

    // hard ceiling: break at last space before maxLen (word-safe)
    if (t.length >= this.cfg.maxLen) {
      const cut = t.lastIndexOf(' ', this.cfg.maxLen);
      const at = cut > this.cfg.minLen ? cut : this.cfg.maxLen;
      return { text: t.slice(0, at).trim(), rest: t.slice(at) };
    }

    // sentence end with enough body (ASCII + Devanagari danda + CJK + Arabic)
    const sent = t.match(/^(.{12,}?[.!?…।。؟]["'”’)]?\s+)/);
    if (sent) return { text: sent[1].trim(), rest: t.slice(sent[1].length) };

    // long clause at comma/semicolon/dash
    const clause = t.match(/^(.{60,}?[,;:—–]\s+)/);
    if (clause && t.length > this.cfg.minLen) {
      return { text: clause[1].trim(), rest: t.slice(clause[1].length) };
    }

    if (forceAll || (allowUnstable && t.trim().length >= this.cfg.minLen)) {
      // keep trailing partial word back unless forcing everything
      if (!forceAll) {
        const m = t.match(/^(.*\s)\S*$/);
        if (m && m[1].trim().length >= this.cfg.minLen) {
          return { text: m[1].trim(), rest: t.slice(m[1].length) };
        }
        return null;
      }
      return { text: t.trim(), rest: '' };
    }
    return null;
  }
}
