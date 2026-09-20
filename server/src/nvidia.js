// NVIDIA NIM fallback (OpenAI-compatible). Used only when OpenRouter fails
// on a `smart` task. Same streaming contract. Never logs keys.

const BASE = 'https://integrate.api.nvidia.com/v1';
export const NVIDIA_SMART = 'nvidia/llama-3.1-nemotron-70b-instruct';

export async function streamNvidia({ apiKey, model = NVIDIA_SMART, messages, signal, onToken, system }) {
  const sys = system && system.trim()
    ? system
    : 'You are METALOID, a private personal AI assistant. Be concise unless complexity demands detail. Mirror Hindi/Hinglish/English.';
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: 0.6,
      messages: [{ role: 'system', content: sys }, ...messages],
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`nvidia ${res.status} ${text.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const data = s.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content || '';
        if (delta) {
          full += delta;
          onToken(full);
        }
      } catch { /* ignore */ }
    }
  }
  return { text: full, model };
}
