// Intent Resolver — Recognizes user goals and maps natural language
// into high-level capabilities: Presentation, Document, Spreadsheet, Research, Code.
// Tolerant to typos (e.g. "presetation", "resech"), colloquial phrasing, and compound formats (PPTX + PDF).

export type WorkIntentKind =
  | 'presentation'
  | 'document'
  | 'spreadsheet'
  | 'research'
  | 'code'
  | 'image'
  | 'general';

export interface WorkIntent {
  kind: WorkIntentKind;
  topic: string;
  headline: string;
  activeLabel: string;
  stages: string[];
  exportPdf?: boolean;
}

// Tolerant regex helpers
const PRES_KEYWORDS = /\b(presentation|presetation|presenation|presentaion|prez|power\s*point|pptx?|slides?|slids|slide\s*deck|pitch\s*deck)\b|\b(?:presentation|presetation|ppt|slides?)\s*(?:bana|banao|banade|bana do|chahiye)\b|\biske?\s+slides?\s+bana/i;
const DOC_KEYWORDS = /\b(document|doc|docx|report|essay|proposal|resume|résumé|invoice|letter|meeting notes|worksheet|formal document|word doc|school project|whitepaper|handout)\b|\b(?:report|document|essay)\s*(?:bana|banao|banade|bana do|ready kar)\b/i;
const SHEET_KEYWORDS = /\b(spreadsheet|sheet|excel|xlsx?|csv|comparison\s*table|financial model|budget table|data sheet)\b|\b(?:excel|sheet)\s*(?:bana|banao)\b/i;
const RESEARCH_KEYWORDS = /\b(research|resech|deep research|investigate|explore deeply|search the web|find out about|analyze sources)\b/i;
const CODE_KEYWORDS = /\b(write code|build a website|code a|implement a function|write script|create component|debug code|fix this bug|metacode)\b/i;
const PDF_KEYWORDS = /\b(pdf|printable|convert (?:to|in(?:to)?) (?:that )?pdf|export (?:to|as) pdf|make (?:it )?pdf)\b/i;

export function resolveWorkIntent(rawText: string): WorkIntent {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const wantsPdf = PDF_KEYWORDS.test(lower);

  // 1. Presentation intent (checks typos like presetation)
  if (PRES_KEYWORDS.test(lower)) {
    // Extract topic cleanly
    let topic = text
      .replace(PRES_KEYWORDS, '')
      .replace(/(?:make|create|build|generate|design|draft|prepare|bana|banao|about|on|for|regarding|chapter|and convert.*|and make.*)/gi, '')
      .replace(/[?.!]+$/, '')
      .trim();

    // Fallback topic extraction if cleaned is too short
    if (!topic || topic.length < 2) {
      const match = text.match(/(?:for|about|on|regarding)\s+([^.?!]+)/i);
      topic = match ? match[1].replace(/and convert.*$/i, '').trim() : 'Overview';
    }

    return {
      kind: 'presentation',
      topic,
      headline: `Presentation: ${topic}${wantsPdf ? ' (+ PDF)' : ''}`,
      activeLabel: wantsPdf ? 'Creating presentation & PDF…' : 'Creating your presentation…',
      exportPdf: wantsPdf,
      stages: [
        'Understanding request & structure',
        'Outlining core slide narrative',
        'Drafting content & speaker notes',
        'Validating OpenXML presentation',
        wantsPdf ? 'Preparing printable PDF deliverable' : 'Finalizing slides',
      ],
    };
  }

  // 2. Document / Report intent
  if (DOC_KEYWORDS.test(lower)) {
    let topic = text
      .replace(DOC_KEYWORDS, '')
      .replace(/(?:write|draft|create|generate|prepare|about|on|for|regarding)/gi, '')
      .replace(/[?.!]+$/, '')
      .trim();

    if (!topic || topic.length < 2) {
      const match = text.match(/(?:for|about|on|regarding)\s+([^.?!]+)/i);
      topic = match ? match[1].trim() : 'Document';
    }

    return {
      kind: 'document',
      topic,
      headline: `Document: ${topic}`,
      activeLabel: wantsPdf ? 'Drafting document & PDF…' : 'Drafting your document…',
      exportPdf: wantsPdf,
      stages: [
        'Understanding requirements',
        'Structuring document outline',
        'Synthesizing sections & citations',
        'Validating formatting & layout',
        'Finalizing deliverable',
      ],
    };
  }

  // 3. Spreadsheet / Table intent
  if (SHEET_KEYWORDS.test(lower)) {
    let topic = text
      .replace(SHEET_KEYWORDS, '')
      .replace(/(?:create|make|build|generate|for|about|on|of)/gi, '')
      .replace(/[?.!]+$/, '')
      .trim();

    if (!topic || topic.length < 2) {
      const match = text.match(/(?:for|about|on|of)\s+([^.?!]+)/i);
      topic = match ? match[1].trim() : 'Dataset';
    }

    return {
      kind: 'spreadsheet',
      topic,
      headline: `Spreadsheet: ${topic}`,
      activeLabel: 'Building your spreadsheet…',
      stages: [
        'Understanding data structure',
        'Computing columns & rows',
        'Applying formulas & totals',
        'Validating table integrity',
        'Checking final sheet',
      ],
    };
  }

  // 4. Research intent
  if (RESEARCH_KEYWORDS.test(lower)) {
    let topic = text
      .replace(RESEARCH_KEYWORDS, '')
      .replace(/(?:about|on|for|regarding|anything on internet|on internet)/gi, '')
      .replace(/[?.!]+$/, '')
      .trim();

    return {
      kind: 'research',
      topic: topic || 'Inquiry',
      headline: `Research: ${topic || 'Inquiry'}`,
      activeLabel: 'Researching topic deeply…',
      stages: [
        'Searching verified sources',
        'Reviewing relevant findings',
        'Cross-checking facts & citations',
        'Synthesizing comprehensive analysis',
        'Preparing structured report',
      ],
    };
  }

  // 5. Code intent
  if (CODE_KEYWORDS.test(lower)) {
    let topic = text
      .replace(CODE_KEYWORDS, '')
      .replace(/(?:for|to|that)/gi, '')
      .replace(/[?.!]+$/, '')
      .trim();

    return {
      kind: 'code',
      topic: topic || 'Task',
      headline: `MetaCode: ${topic || 'Task'}`,
      activeLabel: 'Writing and validating code…',
      stages: [
        'Analyzing code requirements',
        'Drafting clean implementation',
        'Running syntax verification',
        'Formatting deliverable',
      ],
    };
  }

  // 6. Image intent
  if (lower.startsWith('/imagine') || lower.startsWith('create an image') || lower.startsWith('generate an image')) {
    const prompt = text.replace(/^(\/imagine|create an image of:?|generate an image of:?)\s*/i, '').trim();
    return {
      kind: 'image',
      topic: prompt || 'visual artwork',
      headline: `Image: ${prompt || 'visual artwork'}`,
      activeLabel: 'Generating image…',
      stages: [
        'Interpreting visual description',
        'Composing aesthetics & lighting',
        'Synthesizing canvas',
        'Finalizing render',
      ],
    };
  }

  // Default: Conversational inquiry
  return {
    kind: 'general',
    topic: text.slice(0, 40),
    headline: 'Conversation',
    activeLabel: 'Thinking…',
    stages: ['Understanding inquiry', 'Synthesizing response'],
  };
}
