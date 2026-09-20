import { memo, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

// Metaloid markdown: GFM (tables, fences, task lists) + premium code blocks.
// Streaming-safe: partial fences render as plain text until closed; the
// parent reconciles to this same renderer at completion, so no layout jump.

const KEYWORDS: Record<string, string[]> = {
  js: 'const let var function return if else for while new class extends import export from default await async try catch finally throw typeof instanceof in of this super switch case break continue do void delete'.split(' '),
  ts: 'const let var function return if else for while new class extends implements import export from default await async try catch finally throw typeof instanceof in of this super switch case break continue do void delete interface type enum namespace declare abstract readonly private protected public static as satisfies'.split(' '),
  py: 'def return if elif else for while import from as class try except finally raise with lambda yield pass break continue in is not and or None True False async await global nonlocal del'.split(' '),
};
KEYWORDS.tsx = KEYWORDS.ts;
KEYWORDS.jsx = KEYWORDS.js;
KEYWORDS.javascript = KEYWORDS.js;
KEYWORDS.typescript = KEYWORDS.ts;
KEYWORDS.go = 'func return if else for range var const type struct interface map package import defer go select case default break continue fallthrough'.split(' ');
KEYWORDS.rust = 'fn return if else for while loop let mut const struct enum impl trait use mod pub crate self Self match where use async await move in ref static'.split(' ');
KEYWORDS.java = 'public private protected class interface extends implements return if else for while new import package try catch finally throw throws static void int long double float boolean String var switch case break continue do this super'.split(' ');
KEYWORDS.kt = KEYWORDS.java;
KEYWORDS.cs = KEYWORDS.java;
KEYWORDS.swift = 'func return if else for while let var class struct enum import guard switch case break continue in as is try catch throw throws do self Self'.split(' ');
KEYWORDS.php = 'function return if else elseif for foreach while new class extends echo print include require try catch finally throw use namespace '.split(' ');
KEYWORDS.rb = 'def end if else elsif for while do class module return require include attr yield self true false nil and or not in'.split(' ');
KEYWORDS.sh = 'if then else elif fi for while do done function return exit echo export local in case esac shift set'.split(' ');
KEYWORDS.bash = KEYWORDS.sh;

interface Tok {
  t: string;
  c?: string;
}

/** Tiny tokenizer: strings → comments → keywords → numbers → calls. Line-based with block-comment carry. */
export function highlight(code: string, lang: string): Tok[][] {
  const key = KEYWORDS[lang.toLowerCase()] || [];
  const keySet = new Set(key);
  const lines = code.split('\n');
  let inBlock = false;
  return lines.map((line) => {
    const toks: Tok[] = [];
    let i = 0;
    const push = (t: string, c?: string) => {
      if (!t) return;
      const last = toks[toks.length - 1];
      if (last && last.c === c) last.t += t;
      else toks.push({ t, c });
    };
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) {
        push(line, 'tok-com');
        return toks;
      }
      push(line.slice(0, end + 2), 'tok-com');
      i = end + 2;
      inBlock = false;
    }
    while (i < line.length) {
      const rest = line.slice(i);
      // strings
      const sq = rest.match(/^(["'`])(?:\\.|(?!\1).)*\1/);
      if (sq) {
        push(sq[0], 'tok-str');
        i += sq[0].length;
        continue;
      }
      // line comments (# // --)
      const lc = rest.match(/^(\/\/|#|--).*$/);
      if (lc && (lang === 'py' || lang === 'rb' || lang === 'sh' || lang === 'bash' || lang === 'yaml' ? rest.startsWith('#') : true)) {
        if (/^(\/\/|#|--)/.test(rest)) {
          push(rest, 'tok-com');
          break;
        }
      }
      // block comment open
      if (rest.startsWith('/*')) {
        const end = rest.indexOf('*/', 2);
        if (end < 0) {
          push(rest, 'tok-com');
          inBlock = true;
          break;
        }
        push(rest.slice(0, end + 2), 'tok-com');
        i += end + 2;
        continue;
      }
      // number
      const num = rest.match(/^\b\d[\d_]*(?:\.\d+)?\b/);
      if (num) {
        push(num[0], 'tok-num');
        i += num[0].length;
        continue;
      }
      // identifier / keyword / call
      const id = rest.match(/^[A-Za-z_$][\w$]*/);
      if (id) {
        const w = id[0];
        const after = line.slice(i + w.length);
        if (keySet.has(w)) push(w, 'tok-kw');
        else if (/^\s*\(/.test(after)) push(w, 'tok-fn');
        else if (/^[A-Z][\w$]*$/.test(w) && w.length > 1) push(w, 'tok-type');
        else push(w);
        i += w.length;
        continue;
      }
      push(rest[0]);
      i += 1;
    }
    return toks;
  });
}

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const label = (lang || 'text').toLowerCase();
  const lines = useMemo(() => highlight(code.replace(/\n$/, ''), label), [code, label]);
  const long = code.split('\n').length > 28;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="ml-code my-3 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)]">
      <div className="flex items-center gap-2 px-3.5 h-9 border-b border-[var(--border-subtle)] bg-[var(--surface)]">
        <span className="text-[11px] font-mono font-medium text-[var(--fg-muted)]">{label}</span>
        <span className="ml-auto flex items-center gap-1">
          {long && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)] transition-all"
              aria-expanded={expanded}
            >
              <ChevronDown size={13} className={cn('transition-transform', expanded && 'rotate-180')} />
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[11.5px] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--surface-hover)] transition-all"
            aria-label={copied ? 'Copied' : `Copy ${label} code`}
            title={copied ? 'Copied' : 'Copy code'}
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {copied ? <span className="text-emerald-400">Copied</span> : 'Copy'}
          </button>
        </span>
      </div>
      <div className={cn('relative', !expanded && long && 'max-h-[420px]')}>
        <pre className="overflow-x-auto p-3.5 text-[13px] leading-[1.65] font-mono">
          <code>
            {lines.map((toks, li) => (
              <span key={li} className="block whitespace-pre">
                {toks.map((tk, ti) => (
                  <span key={ti} className={tk.c}>{tk.t || ' '}</span>
                ))}
                {toks.length === 0 ? ' ' : null}
              </span>
            ))}
          </code>
        </pre>
        {!expanded && long && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--surface-sunken)] to-transparent" />
        )}
      </div>
    </div>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  const copy = async (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    const text = e.currentTarget.innerText || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <code onClick={copy} title="Click to copy">
      {children}
    </code>
  );
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children } = props as { className?: string; children?: React.ReactNode };
            const match = /language-(\w+)/.exec(className || '');
            const raw = String(children ?? '').replace(/\n$/, '');
            if (match) return <CodeBlock code={raw} lang={match[1]} />;
            return <InlineCode>{children}</InlineCode>;
          },
          pre({ children }) {
            // fences handled in `code`; bare <pre> (indented blocks) passes through
            return <>{children}</>;
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          img({ src, alt }) {
            return (
              <img
                src={src}
                alt={alt || 'image'}
                loading="lazy"
                className="rounded-xl border border-[var(--border)] max-w-full max-h-[420px] object-contain my-2"
              />
            );
          },
          table({ children }) {
            return (
              <div className="my-3 overflow-x-auto rounded-xl border border-[var(--border)]">
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
