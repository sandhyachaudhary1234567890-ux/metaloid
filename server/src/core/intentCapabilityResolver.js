// IntentCapabilityResolver — outcome-first routing for the capabilities this
// gateway can actually execute. It has no side effects and never claims an
// unavailable writer is usable. Explicit formats always win over inference.

const CATALOG = Object.freeze([
  {
    id: 'presentation.create', capability: 'PresentationCreation', kind: 'pptx', format: 'PPTX',
    description: 'A verified, editable slide presentation.',
    signals: /\b(presentation|power\s*point|powerpoint|pptx?|slide\s*deck|slides?|pitch\s*deck|class\s*deck|present\s+(?:tomorrow|in class))\b|\b(?:presentation|ppt|slides?)\s*(?:bana|banao|banade|bana do|chahiye)\b|\biske?\s+slides?\s+bana/i,
  },
  {
    id: 'document.create', capability: 'DocumentCreation', kind: 'docx', format: 'DOCX',
    description: 'An editable Word-compatible document.',
    signals: /\b(report|essay|proposal|resume|résumé|invoice|letter|meeting notes|worksheet|formal document|word document|docx|school project)\b|\b(?:report|document|essay)\s*(?:bana|banao|banade|bana do|ready kar)\b/i,
  },
  {
    id: 'spreadsheet.create', capability: 'SpreadsheetCreation', kind: 'xlsx', format: 'XLSX',
    description: 'A spreadsheet workbook.',
    signals: /\b(spreadsheet|excel|xlsx|marksheet|budget|inventory|expense tracker|data sheet)\b|\b(?:excel|sheet)\s*(?:mein|me|bana)/i,
  },
  {
    id: 'pdf.create', capability: 'PdfCreation', kind: 'pdf', format: 'PDF',
    description: 'A print-ready PDF.',
    signals: /\b(pdf|printable|print[- ]ready|handout)\b|\bprint\s+karne\s+layak/i,
  },
]);

const WRITERS = new Set(['pptx', 'docx']);

function explicitFormat(text) {
  if (/\b(pptx?|powerpoint)\b/i.test(text)) return 'pptx';
  if (/\b(docx|word document|word doc)\b/i.test(text)) return 'docx';
  if (/\b(xlsx|excel)\b/i.test(text)) return 'xlsx';
  if (/\bpdf\b/i.test(text)) return 'pdf';
  return null;
}

function topicFrom(text, kind) {
  const noun = kind === 'pptx'
    ? '(?:presentation|power\\s*point|powerpoint|pptx?|slide\\s*deck|slides?|pitch\\s*deck|ppt)'
    : '(?:report|essay|proposal|resume|résumé|invoice|letter|document|docx|word document|school project)';
  const afterNoun = new RegExp(`${noun}\\s+(?:on|about|for|of|pe|par|ke\\s+liye)\\s+([^.!?]{2,140})`, 'i').exec(text)?.[1];
  const afterVerb = /(?:make|create|prepare|write|build|generate|turn|bana(?:\s+do)?|banade)\s+(?:me\s+)?(?:an?\s+|the\s+)?(?:\d+\s*(?:slide|page)s?\s+)?(?:presentation|slides?|pptx?|powerpoint|report|essay|document|proposal)?\s*(?:on|about|for|of|pe|par)\s+([^.!?]{2,140})/i.exec(text)?.[1];
  return String(afterNoun || afterVerb || '').replace(/\s+/g, ' ').trim().replace(/\s+(?:please|plz)$/i, '').slice(0, 120);
}

export function resolveIntentCapability(input = '', context = {}) {
  const text = String(input || '').trim();
  const explicit = explicitFormat(text);
  const candidate = explicit ? CATALOG.find((c) => c.kind === explicit) : CATALOG.find((c) => c.signals.test(text));
  if (!candidate) return { kind: 'chat', confidence: 0.15, reason: 'No artifact deliverable inferred.' };
  const supported = WRITERS.has(candidate.kind);
  const count = candidate.kind === 'pptx'
    ? Number(/\b(\d{1,2})\s*-?\s*slides?\b/i.exec(text)?.[1] || 0) || undefined
    : Number(/\b(\d{1,2})\s*-?\s*pages?\b/i.exec(text)?.[1] || 0) || undefined;
  const topic = topicFrom(text, candidate.kind) || String(context.topic || '').trim().slice(0, 120);
  return {
    kind: supported ? 'artifact' : 'unavailable_artifact',
    capability: candidate.capability,
    skill: candidate.id,
    artifactKind: candidate.kind,
    format: candidate.format,
    deliverable: candidate.description,
    supported,
    confidence: explicit ? 0.99 : topic ? 0.94 : 0.8,
    topic: topic || null,
    count,
    clarification: !topic ? `What should the ${candidate.kind === 'pptx' ? 'presentation' : 'document'} be about?` : null,
    reason: explicit ? 'Explicit format request.' : 'Natural-language deliverable inferred.',
  };
}

export const capabilityCatalog = CATALOG.map(({ signals, ...entry }) => ({
  ...entry,
  supported: WRITERS.has(entry.kind),
  verification: entry.kind === 'pptx' || entry.kind === 'docx' ? 'OpenXML package and relationship validation' : 'No writer installed',
}));
