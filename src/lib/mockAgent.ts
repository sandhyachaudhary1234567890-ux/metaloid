import { detectLanguageHint } from './mockStreaming';

export interface MockPlan {
  response: string;
  tool?: { tool: string; label: string; detail: string };
  vision?: boolean;
  navigate?: 'live' | 'memory' | 'chat' | 'history' | 'settings';
  openTools?: boolean;
  remember?: string;
  detectedLang: string;
  speak?: boolean;
}

// Frontend demo conversation engine — no network, no keys.
export function planResponse(input: string): MockPlan {
  const raw = input.trim();
  const t = raw.toLowerCase();
  const detectedLang = detectLanguageHint(raw);

  const has = (...keys: string[]) => keys.some((k) => t.includes(k));

  if (!raw) {
    return { response: 'I’m here. What would you like to do?', detectedLang };
  }

  if (has('open live', 'live mode', 'start live', 'camera mode', 'show camera', 'vision mode')) {
    return {
      response: 'Opening live mode — I’ll keep vision in demo until a provider is connected.',
      navigate: 'live',
      detectedLang,
    };
  }
  if (has('show memory', 'open memory', 'memories', 'what do you remember')) {
    return { response: 'Opening your memory. Everything here is stored locally in this browser.', navigate: 'memory', detectedLang };
  }
  if (has('open tools', 'show tools')) {
    return { response: 'Tools stay contextual — here they are. Pick one and I’ll use it in this conversation.', openTools: true, detectedLang };
  }
  if (has('open settings', 'settings')) {
    return { response: 'Opening settings.', navigate: 'settings', detectedLang };
  }
  if (has('remember that', 'remember this', 'remember:', 'remember ')) {
    const m = raw.replace(/^(please\s+)?remember\s+(that|this|:)?\s*/i, '').trim() || raw;
    return {
      response: `Saved. I’ll remember: “${m.slice(0, 140)}”. You can review it in Memory.`,
      remember: m,
      detectedLang,
    };
  }
  if (has('hello', 'hey', 'hi ', 'hi', 'namaste', 'namaskar', 'good morning', 'good afternoon', 'good evening')) {
    if (/[\u0900-\u097F]/.test(raw) || has('namaste')) {
      return { response: 'नमस्ते। मैं यहाँ हूँ — बताइए, आज क्या करना है?', detectedLang };
    }
    return { response: "Hey. I'm here. What are we working on?", detectedLang };
  }
  if (has('talk in hindi', 'speak hindi', 'hindi me', 'hindi mein', 'hindi bolo', 'switch to hindi')) {
    return { response: 'बिल्कुल। अब मैं हिंदी में जवाब दूँगा। बताइए, क्या करना है?', detectedLang: 'Hindi' };
  }
  if (has('switch to english', 'talk in english', 'english me')) {
    return { response: 'Sure. Switching to English. What should we focus on?', detectedLang: 'English' };
  }
  if (has('what can you do', 'what do you do', 'capabilities', 'features', 'help')) {
    return {
      response:
        'I can chat, help you reason through problems, organize notes, simulate tool calls, and work with voice and camera modes in this prototype.\n\nTry:\n- “Explain AI agents simply”\n- “Remember that I prefer concise answers”\n- “What am I showing you?” (in Live)',
      detectedLang,
    };
  }
  if (has('what are you', 'who are you', 'your name')) {
    return { response: 'I’m metaloid — your private personal AI interface. This build is frontend-only, so everything you see is a local demo until real providers are connected.', detectedLang };
  }
  if (has('weather')) {
    return {
      response: 'Delhi is showing **28°C, light haze** in this demo snapshot.\n\n> Demo data — connect a weather provider later for live values.\n\nWant me to remember your city for next time?',
      tool: { tool: 'Weather', label: 'Using weather tool', detail: 'Searching current data' },
      detectedLang,
    };
  }
  if (has('search', 'google', 'web', 'latest', 'news')) {
    return {
      response: 'Here’s what a connected web search would return — summarized in demo form:\n\n1. **Personal agents** are moving local-first\n2. **Voice + vision** becoming default input\n3. **Memory** is the differentiator\n\nConnect OpenRouter later for live results.',
      tool: { tool: 'Web Search', label: 'Searching web', detail: 'Scanning sources' },
      detectedLang,
    };
  }
  if (has('calculat', 'math', 'solve', '+', '*', '/', '%', '46', '*83', 'derivative', 'integral')) {
    if (has('derivative')) {
      return { response: 'Intuitively, a **derivative** is instantaneous rate of change.\n\n- Position → velocity\n- Velocity → acceleration\n\nIf a function is the journey, the derivative is the speedometer.', detectedLang };
    }
    return {
      response: 'Done — quick calculation in demo mode.\n\n`46 × 83 = 3,818`\n\nI can walk through steps if you want.',
      tool: { tool: 'Calculator', label: 'Calculating', detail: 'Evaluating expression' },
      detectedLang,
    };
  }
  if (has('quantum')) {
    return {
      response: 'Think of a normal computer as working with **switches** — on or off.\n\nA quantum computer works with **qubits** that can be in a blend of states. That lets certain problems — like simulation or optimization — explore many paths at once.\n\n> Simple version: classical = one road at a time. Quantum = many roads in superposition.',
      detectedLang,
    };
  }
  if (has('ai agent')) {
    return {
      response: 'An AI agent is a system that can **understand a goal**, **use tools**, and **act** toward it — not just answer.\n\nCore loop:\n1. Perceive (chat / voice / camera)\n2. Reason (model)\n3. Act (tools)\n4. Remember (memory)\n\nmetaloid is the interface for that loop. Real reasoning plugs in later via OpenRouter.',
      detectedLang,
    };
  }
  if (has('what am i showing', 'what do you see', 'seeing', 'look at this', 'analyze image', 'ye kya hai', 'kya dikh')) {
    return {
      response: 'Demo analysis: I can see a desk setup with a dark laptop and soft overhead light. Vision processing is in **demo mode** — connect a vision model later for real understanding.',
      vision: true,
      detectedLang,
    };
  }
  if (has('note', 'todo', 'remind', 'calendar')) {
    return {
      response: 'Noted. I’ve drafted that locally — you’ll find it under Memory once saved.\n\nWant me to remember it permanently?',
      tool: { tool: 'Notes', label: 'Reading notes', detail: 'Opening local notes' },
      detectedLang,
    };
  }
  if (has('bhai') || detectedLang === 'Hinglish') {
    return {
      response: 'Samajh gaya, bhai. Simple language mein batata hoon — bolo, kis topic se start karein? Main concise ya detailed — jaise tum bolo.',
      detectedLang: 'Hinglish',
    };
  }
  if (detectedLang === 'Hindi') {
    return {
      response: 'बिल्कुल, मैं समझ गया। बताइए — इसे और simple करूँ या example के साथ समझाऊँ?',
      detectedLang,
    };
  }

  // default intelligent fallback
  const fallbacks = [
    `Got it. Here’s how I’d think about “${truncate(raw, 72)}”:\n\n1. **What matters most** — the core goal underneath\n2. **Options** — 2–3 sensible paths\n3. **Next step** — the smallest useful action\n\nTell me which angle you want — concise or detailed — and I’ll go deeper.`,
    `Understood. If we break “${truncate(raw, 72)}” down:\n\n- **Context** — what you already know\n- **Gap** — what’s unclear\n- **Move** — what to do next\n\nWant me to expand, simplify, or give an example?`,
  ];
  return { response: fallbacks[raw.length % fallbacks.length], detectedLang };
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export const mockVoiceTranscripts = [
  'Explain AI agents in simple language',
  'Bhai mujhe ye simple language mein samjha',
  'आज क्या करना है?',
  'What am I showing you?',
  'Remember that I am building an AI agent',
];

export const mockVisionAnswers = [
  'Demo analysis: I can see a desk setup with a dark laptop and soft overhead light.',
  'Demo analysis: I can identify the main object in this image. Vision detail unlocks after provider connection.',
  'I can see the camera feed, but vision processing is currently in demo mode.',
];
