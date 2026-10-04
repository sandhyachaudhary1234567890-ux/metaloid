// Live web research for chat — keyless, parallel, timeout-guarded.
//
// The chat model has no browsing tool of its own, so left alone it *promises*
// fresh answers ("I'll pull the latest") with nothing behind the promise.
// This module closes that gap for the queries that need it: when the message
// looks like it needs the outside world, three independent sources are asked
// at once (Wikipedia, DuckDuckGo web results, Google News RSS) and whatever
// comes back in time is handed to the model as labelled context. Nothing here
// can ever slow or break a normal chat turn: no intent → no fetch; every
// fetch has its own deadline; any failure collapses to "no results".
//
// Source notes (verified live, keep them true):
// - Wikipedia opensearch + REST summaries: reliable, no key.
// - DuckDuckGo answers a form POST but serves bots a shell on GET — do not
//   "simplify" ddgFetch back to a GET.
// - DDG Instant Answer API is deprecated and returns empty: do not use it.
// - Google News RSS needs no key and tolerates query-less top-stories calls.

const FETCH_MS = Number(process.env.METALOID_WEBSEARCH_TIMEOUT_MS || 7000);
const MAX_ITEMS = 8;

/** Does this message plausibly need the outside world to answer well? */
export function needsResearch(message) {
  if (!message || typeof message !== 'string') return false;
  const t = message.toLowerCase();
  if (/(search( the)?( web| news)?|google it|look (it )?up|latest|newest|current(ly)?|today'?s|breaking|price of|release date|news|headlines?|score|stock price|weather|who won|announced|launched|released)/.test(t)) return true;
  const head = t.trim();
  if (/^(who|what|when|where|which|whose|whom)\b/.test(head) && message.length > 25) return true;
  if (/\bvs\.?\b|\bversus\b|\bcompar/.test(t) && message.length > 30) return true;
  return false;
}

/** Strip command framing down to searchable terms. */
export function searchTerms(message) {
  return String(message || '')
    .replace(/^(please\s+)?(search( the)?( web| news)?( for( me)?)?|google|look (it )?up|find|tell me about)\s*[:\-]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Keywords a full question reduces to for entity lookup. */
function wikiTerms(q) {
  const stop = new Set('what,whats,which,who,whom,whose,when,where,why,how,is,are,was,were,the,a,an,of,in,on,for,to,do,does,did,tell,me,about,please,explain,define,meaning,has,have,had,can,could,should,would,will,with,from,that,this,these,those,i,you,we,they,it,its'.split(','));
  return String(q || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w)).slice(0, 6).join(' ');
}

function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(new Error('websearch timeout')), ms);
  if (typeof t.unref === 'function') t.unref();
  return {
    signal: c.signal,
    done() { clearTimeout(t); },
  };
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const API_UA = 'METALOID/1.0 (+https://metaloid.vercel.app; research fetcher)';

async function getText(url, headers = {}, ua = API_UA) {
  const g = withTimeout(FETCH_MS);
  try {
    const r = await fetch(url, {
      signal: g.signal,
      headers: {
        'User-Agent': ua,
        Accept: 'text/html,application/xhtml+xml,application/json,application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...headers,
      },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  } finally {
    g.done();
  }
}

/** Wikipedia: entity summary. Fast, reliable, no key. */
async function wiki(query) {
  try {
    const terms = wikiTerms(query) || query;
    let titles = [];
    const os = await getText(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(terms)}&limit=1&namespace=0&format=json`);
    if (os) {
      try { titles = JSON.parse(os)[1] || []; } catch { /* fall through */ }
    }
    if (!titles.length) {
      // Natural-language questions confuse opensearch; full-text search copes.
      const qs = await getText(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3`);
      if (!qs) return [];
      let hits = [];
      try { hits = (JSON.parse(qs).query || {}).search || []; } catch { /* none */ }
      const good = hits.find((h) => !/disambiguation|list of/i.test(h.title || ''));
      if (good) titles = [good.title];
      else if (hits.length) titles = [hits[0].title];
      else return [];
    }
    const sum = await getText(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titles[0])}`);
    if (!sum) return [];
    const j = JSON.parse(sum);
    if (!j.extract || /may refer to:/i.test(j.extract)) return [];
    return [{
      source: 'Wikipedia',
      title: j.title || titles[0],
      text: String(j.extract).slice(0, 900),
      url: (j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page) || '',
    }];
  } catch {
    return [];
  }
}

// DDG serves bots a shell on GET but answers a form POST: same endpoint, real
// results. Verified live — do not "simplify" this back to a GET.
async function ddgFetch(query) {
  const g = withTimeout(FETCH_MS);
  try {
    const r = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      signal: g.signal,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ q: query }).toString(),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  } finally {
    g.done();
  }
}

/** DuckDuckGo results: general web titles + snippets + links. No key. */
async function ddg(query) {
  const html = await ddgFetch(query);
  if (!html || !html.includes('result__a')) return [];
  const clean = (s) => String(s || '')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const out = [];
  const blocks = html.split('result__a');
  for (let i = 1; i < blocks.length && out.length < 5; i++) {
    const b = blocks[i];
    try {
      const href = (/href="([^"]+)"/.exec(b) || [])[1] || '';
      let url = '';
      const uddg = /[?&]uddg=([^&"]+)/.exec(href);
      if (uddg) {
        try { url = decodeURIComponent(uddg[1]); } catch { /* malformed */ }
      } else if (/^https?:\/\//.test(href)) {
        url = href;
      }
      // Title is the text of the first complete anchor.
      const end = b.indexOf('</a>');
      const anchor = end < 0 ? b.slice(0, 400) : b.slice(0, end);
      const title = clean(anchor.split('>').pop()).slice(0, 140);
      const rest = blocks.slice(i, i + 2).join(' ');
      const snip = (/result__snippet[^>]*>([\s\S]{10,500}?)<\/a>/.exec(rest) || [])[1] || '';
      if (url && title) {
        out.push({ source: 'Web', title, text: clean(snip).slice(0, 400), url });
      }
    } catch {
      /* one bad block never kills the batch */
    }
  }
  return out;
}

/** Google News RSS: fresh headlines, queried with the same terms. No key. */
async function news(query) {
  try {
    const url = query
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`
      : `https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en`;
    const xml = await getText(url);
    if (!xml) return [];
    const items = xml.split('<item>').slice(1, 7);
    return items.map((it) => {
      const pick = (tag) => {
        const m = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(it);
        return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
      };
      const title = pick('title').slice(0, 160);
      const link = pick('link');
      const src = pick('source').slice(0, 60);
      const date = pick('pubDate').slice(0, 31);
      return title ? { source: src ? `News (${src})` : 'News', title, text: date, url: link } : null;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Run every source at once and merge. Total wall time is bounded by the
 * slowest source's deadline, not the sum — that is the whole point.
 */
export async function research(message) {
  const q = searchTerms(message);
  if (!q) {
    // Bare request ("search the news") strips down to nothing — answer with
    // top stories rather than an empty block.
    if (!/(news|headlines?|latest|breaking|today)/i.test(String(message || ''))) return [];
    return news(null);
  }
  const [w, d, n] = await Promise.all([wiki(q), ddg(q), news(q)]);
  const seen = new Set();
  const merged = [];
  for (const r of [...w, ...d, ...n]) {
    const key = (r.url || r.title).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
    if (merged.length >= MAX_ITEMS) break;
  }
  return merged;
}

/** Render merged results as labelled context the model must prefer. */
export function researchBlock(results) {
  if (!results || !results.length) return '';
  const lines = results.map((r) => {
    const head = `[${r.source}${r.title ? `: ${r.title}` : ''}]`;
    const tail = r.url ? ` (${r.url})` : '';
    return `${head} ${r.text || ''}${tail}`;
  });
  return '\n\nLIVE WEB RESULTS (fetched just now — prefer over training memory):\n'
    + lines.map((l) => `- ${l.slice(0, 500)}`).join('\n')
    + '\nAnswer from these; name sources inline. If the results are thin, say what you verified and what you could not.';
}
