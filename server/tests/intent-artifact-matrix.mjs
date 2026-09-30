import assert from 'node:assert/strict';
import { resolveIntentCapability } from '../src/core/intentCapabilityResolver.js';
import { buildPptx, validatePptxBytes, extractSlides } from '../src/core/pptx.js';
import { buildDocx, validateDocxBytes } from '../src/core/docx.js';

const presentationCases = [
  'Make a presentation on afforestation.',
  'Create 8 slides on photosynthesis for class.',
  'Prepare a PowerPoint deck about pollution.',
  'afforestation pe presentation bana do',
  'school ke liye ppt bana de on climate change',
  'Turn this into slides about renewable energy.',
];
for (const input of presentationCases) {
  const r = resolveIntentCapability(input);
  assert.equal(r.kind, 'artifact', input);
  assert.equal(r.capability, 'PresentationCreation', input);
  assert.equal(r.artifactKind, 'pptx', input);
}

for (const input of ['Make a report on renewable energy.', 'Create a professional proposal for water conservation.', 'Afforestation report bana do.']) {
  const r = resolveIntentCapability(input);
  assert.equal(r.kind, 'artifact', input);
  assert.equal(r.artifactKind, 'docx', input);
}

const unavailable = resolveIntentCapability('Organize these expenses into an Excel spreadsheet.');
assert.equal(unavailable.kind, 'unavailable_artifact');
assert.equal(unavailable.artifactKind, 'xlsx');
assert.equal(unavailable.supported, false);

const ppt = buildPptx({
  title: 'Afforestation',
  accent: '1F6B3A',
  slides: Array.from({ length: 10 }, (_, index) => ({
    title: index === 0 ? 'Afforestation' : `Afforestation — ${index + 1}`,
    bullets: ['Protect existing forests', 'Restore native tree cover', 'Support local communities'],
  })),
});
const pptCheck = validatePptxBytes(ppt);
assert.equal(pptCheck.ok, true, pptCheck.issues.join('; '));
assert.equal(pptCheck.slideCount, 10);
assert.equal(extractSlides(ppt).length, 10);
assert.ok(pptCheck.bytes > 10_000, 'complete presentation package should include master/layout/theme parts');

const doc = buildDocx({
  title: 'Afforestation report',
  blocks: [
    { h: 1, text: 'Why forests matter' },
    { p: 'Afforestation restores ecosystems, protects soil, and supports climate resilience.' },
    { bullets: ['Choose native species', 'Plan long-term care', 'Measure survival rates'] },
  ],
});
const docCheck = validateDocxBytes(doc);
assert.equal(docCheck.ok, true, docCheck.issues.join('; '));
assert.ok(docCheck.paragraphs >= 5);

console.log('PASS natural-language intent → verified writer selection');
console.log('PASS afforestation 10-slide PPTX → ZIP/OpenXML relationship validation → reopen slide extraction');
console.log('PASS afforestation DOCX → ZIP/OpenXML validation → reopen document XML');
