// Voice segmenter contract.
//
// This is the layer between "tokens are arriving" and "the speaker starts
// talking". A regression here is felt, not read: half-words spoken aloud,
// duplicated phrases, or Hindi never splitting at all — a real bug this
// project already shipped once, when the Devanagari danda was missing from
// the sentence-punctuation set.
//
// Contract: push() takes the CUMULATIVE streamed text and returns only newly
// completed, speakable segments; finish() releases the remainder; nothing is
// ever emitted twice.

import { describe, it, expect } from 'vitest';
import { AdaptiveSegmenter } from './segmenter';

describe('AdaptiveSegmenter', () => {
  it('flushes a complete sentence once, with no leftover', () => {
    const seg = new AdaptiveSegmenter();
    expect(seg.push('Hello there, world. ')).toEqual(['Hello there, world.']);
    expect(seg.pending()).toBe('');
  });

  it('never speaks a partial word while tokens are still arriving', () => {
    const seg = new AdaptiveSegmenter();
    expect(seg.push('The answer is proba')).toEqual([]);
    expect(seg.push('The answer is probably yes, but let')).toEqual([]);
    // nothing half-formed has been handed to the speaker yet
    expect(seg.pending()).toContain('probably yes');
  });

  it('splits a multi-sentence answer into speakable segments', () => {
    const seg = new AdaptiveSegmenter({ minLen: 10 });
    const out = seg.push('First sentence here. Second sentence follows. Third one closes it out. ');
    expect(out).toEqual([
      'First sentence here.',
      'Second sentence follows.',
      'Third one closes it out.',
    ]);
  });

  it('splits Hindi at the danda (the regression that shipped once)', () => {
    const seg = new AdaptiveSegmenter({ minLen: 8 });
    const out = seg.push('नमस्ते दोस्तों, आज हम कुछ नया करेंगे। अब बताइए क्या करना है? ');
    expect(out.length).toBe(2);
    expect(out[0]).toContain('नमस्ते');
    expect(out[1]).toContain('बताइए');
  });

  it('never emits the same text twice when fed a cumulative stream', () => {
    const seg = new AdaptiveSegmenter({ minLen: 8 });
    const first = seg.push('Good ');
    const second = seg.push('Good morning. ');
    const third = seg.push('Good morning. How are you? ');
    const all = [...first, ...second, ...third];
    expect(all.filter((s) => s.includes('Good morning.'))).toHaveLength(1);
  });

  it('finish() releases the trailing fragment so the last words are spoken', () => {
    const seg = new AdaptiveSegmenter({ minLen: 8 });
    seg.push('a trailing fragment with no ending');
    expect(seg.finish()).toEqual(['a trailing fragment with no ending']);
    expect(seg.pending()).toBe('');
  });

  it('respects maxLen: long text is broken on word boundaries', () => {
    const seg = new AdaptiveSegmenter({ minLen: 5, maxLen: 40 });
    const out = seg.push('word '.repeat(40));
    expect(out.length).toBeGreaterThan(1);
    for (const s of out) expect(s.length).toBeLessThanOrEqual(40);
    // no word is ever cut in half
    for (const s of out) expect(s.startsWith('word')).toBe(true);
  });

  it('poll() releases a stalled buffer without waiting for punctuation', () => {
    const seg = new AdaptiveSegmenter({ minLen: 5, softFlushMs: 0 });
    seg.push('a stalled fragment with no ending');
    expect(seg.poll().length).toBeGreaterThan(0);
  });

  it('reset() clears buffered text so a cancelled turn cannot leak into the next', () => {
    const seg = new AdaptiveSegmenter({ minLen: 5 });
    seg.push('this should never be spoken aloud');
    seg.reset();
    expect(seg.pending()).toBe('');
    const out = [...seg.push('fresh answer now. '), ...seg.finish()];
    expect(out.join(' ')).toBe('fresh answer now.');
    expect(out.join(' ')).not.toContain('never be spoken');
  });

  it('recovers when a new generation replaces the old text', () => {
    const seg = new AdaptiveSegmenter({ minLen: 8 });
    seg.push('The old answer was going to be about something else entirely. ');
    const out = [...seg.push('Short new one. '), ...seg.finish()];
    expect(out.join(' ')).toBe('Short new one.');
  });
});
