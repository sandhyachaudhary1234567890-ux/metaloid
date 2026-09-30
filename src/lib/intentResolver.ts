// Intent Resolver — Recognizes user goals and maps natural language
// into high-level capabilities: Presentation, Document, Spreadsheet, Research, Code.
// Never forces users to learn commands or internal subsystem terminology.

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
}

export function resolveWorkIntent(rawText: string): WorkIntent {
  const text = rawText.trim();
  const lower = text.toLowerCase();

  // 1. Presentation intent
  const presMatch = lower.match(
    /(?:make|create|build|generate|design|draft|prepare)?\s*(?:a|an)?\s*(?:presentation|slides|deck|slide deck|powerpoint|pptx)\s*(?:about|on|for|regarding)?\s*(.+)/i
  );
  if (presMatch && presMatch[1].trim().length > 2) {
    const topic = presMatch[1].trim().replace(/[?.!]+$/, '');
    return {
      kind: 'presentation',
      topic,
      headline: `Presentation: ${topic}`,
      activeLabel: 'Creating your presentation…',
      stages: [
        'Understanding request',
        'Structuring slide outline',
        'Drafting slide content & notes',
        'Validating presentation schema',
        'Checking final PowerPoint file',
      ],
    };
  }

  // 2. Document / Report intent
  const docMatch = lower.match(
    /(?:write|draft|create|generate|prepare)\s*(?:a|an)?\s*(?:report|document|brief|whitepaper|handout|summary|essay|article)\s*(?:about|on|for|regarding)?\s*(.+)/i
  );
  if (docMatch && docMatch[1].trim().length > 2) {
    const topic = docMatch[1].trim().replace(/[?.!]+$/, '');
    return {
      kind: 'document',
      topic,
      headline: `Document: ${topic}`,
      activeLabel: 'Drafting your document…',
      stages: [
        'Understanding request',
        'Organizing document outline',
        'Synthesizing sections & citations',
        'Validating document format',
        'Checking final deliverable',
      ],
    };
  }

  // 3. Spreadsheet / Table intent
  const sheetMatch = lower.match(
    /(?:create|make|build|generate)?\s*(?:a|an)?\s*(?:spreadsheet|sheet|excel|csv|table|financial model|budget table)\s*(?:for|about|on|of)?\s*(.+)/i
  );
  if (sheetMatch && sheetMatch[1].trim().length > 2) {
    const topic = sheetMatch[1].trim().replace(/[?.!]+$/, '');
    return {
      kind: 'spreadsheet',
      topic,
      headline: `Spreadsheet: ${topic}`,
      activeLabel: 'Building your spreadsheet…',
      stages: [
        'Understanding data model',
        'Computing rows & columns',
        'Applying formulas & totals',
        'Validating table structure',
        'Checking final sheet',
      ],
    };
  }

  // 4. Research intent
  const researchMatch = lower.match(
    /(?:research|deep research|investigate|explore deeply|analyze sources on)\s*(?:about|on|for)?\s*(.+)/i
  );
  if (researchMatch && researchMatch[1].trim().length > 2) {
    const topic = researchMatch[1].trim().replace(/[?.!]+$/, '');
    return {
      kind: 'research',
      topic,
      headline: `Research: ${topic}`,
      activeLabel: 'Researching topic deeply…',
      stages: [
        'Searching verified sources',
        'Reviewing relevant information',
        'Validating citations & credibility',
        'Preparing comprehensive synthesis',
        'Checking final report',
      ],
    };
  }

  // 5. Code intent
  const codeMatch = lower.match(
    /(?:write code|build a website|code a|implement a function|write script|create component|debug code)\s*(?:for|to|that)?\s*(.+)/i
  );
  if (codeMatch && codeMatch[1].trim().length > 2) {
    const topic = codeMatch[1].trim().replace(/[?.!]+$/, '');
    return {
      kind: 'code',
      topic,
      headline: `MetaCode: ${topic}`,
      activeLabel: 'Writing and validating code…',
      stages: [
        'Analyzing requirements & architecture',
        'Writing clean code & types',
        'Running syntax verification',
        'Formatting deliverable',
        'Checking final code',
      ],
    };
  }

  // 6. Image intent
  if (lower.startsWith('/imagine') || lower.startsWith('create an image of')) {
    const prompt = text.replace(/^(\/imagine|create an image of:?)\s*/i, '').trim();
    return {
      kind: 'image',
      topic: prompt || 'visual artwork',
      headline: `Image: ${prompt || 'visual artwork'}`,
      activeLabel: 'Painting your image…',
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
