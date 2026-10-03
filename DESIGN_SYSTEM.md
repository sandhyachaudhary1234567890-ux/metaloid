# MetaIoid Design System

The single reference for how MetaIoid looks, moves, and speaks. If a value is
not in this document, it is not part of the product.

Three files are the source of truth:

| File | Owns |
| --- | --- |
| `src/design/tokens.ts` | colour, type scale, space, radius, elevation, layout, z-index |
| `src/design/motion.ts` | durations, easings, animation variants, the motion language |
| `src/design/assets.ts` | every image in the product, with its intrinsic size |
| `src/index.css` | the CSS mirror of the tokens, plus base and component classes |

Nothing else may define a colour, a duration, a radius, or a font size.

---

## 1. Art direction

**Mood** — quiet intelligence.
**Composition** — minimal, generous negative space, one idea per screen.
**Lighting** — soft and controlled, directional, never neon.
**Palette** — warm neutral greys plus one restrained accent.
**Geometry** — clean and precise, small radii, no blobs, no glass.

MetaIoid should read as an instrument, not as a cockpit. Depth comes from
surface value and hairline borders, not from large shadows or glow.

### What we never do

No random gradients. No neon glow. No excessive glassmorphism. No cheap blur.
No giant rounded cards. No abstract blobs. No stock illustrations. No emoji as
product UI. No decorative backgrounds bigger than the content they sit behind.

---

## 2. Colour

### Neutral ramps

Five modes, all built from the same list of roles, so they read as siblings
rather than as five separate themes.

| Mode | Class | Character |
| --- | --- | --- |
| Obsidian *(default)* | `dark` | warm near-black, ink and bone |
| Graphite | `dark` | cool slate, technical and calm |
| Deep Black | `dark` | maximum depth for OLED |
| Warm Paper | `light` | ivory page, true-white raised surfaces |
| Daylight | `light` | crisp, cool, editorial |

**Light mode is designed as light, not as inverted dark.** It has its own
shadows (shallower — light surfaces carry less ambient occlusion) and its own
ink ramp.

Never pure black as a page background. Never pure white as a page background.

### The accent carries two jobs

This is the rule that fixed the most visual bugs in the product. The accent is
split into a luminous value and a deep value, because one value cannot be both
legible as text *and* legible as a fill under white text.

| Token | Job | Obsidian |
| --- | --- | --- |
| `--accent` | text, icons, indicators, focus rings | `#5CC79A` |
| `--accent-solid` | fills that carry white text | `#146B4E` |
| `--accent-on-solid` | the text colour on those fills | `#F2FFF9` |
| `--accent-subtle` | 8–14% wash for selected rows | `rgba(…, 0.12)` |
| `--accent-ring` | focus halo | `rgba(…, 0.38)` |

Six accents ship in Settings (Jade, Verdigris, Amber, Indigo, Clay,
Graphite). Each is defined as a *pair* in `tokens.ts`, so a user cannot pick a
combination that breaks contrast.

**The accent marks one thing per screen.** It is a signal, not a theme.

### Status

Four semantic colours, declared as channel triplets so Tailwind's opacity
modifier works natively:

```jsx
<span className="text-success" />
<span className="bg-danger/10 border-danger/30" />
```

| Token | Meaning |
| --- | --- |
| `success` | complete, verified, connected |
| `warning` | degraded, needs attention |
| `danger` | failed, destructive |
| `info` | neutral system information |

There is no fifth status colour. Anything needing one is a design error.

---

## 3. Typography

Two families, one mono:

- **Manrope** — display. Headlines and titles only.
- **Inter** — UI and prose. Everything else.
- **JetBrains Mono** — code and keyboard hints. *Nothing else.*

Monospace leaking into prose or metadata is one of the clearest signals of a
developer tool. It is permitted in exactly two places: code blocks, and `.kbd`.

### The scale

Nine steps, named by job rather than by size. There are no other font sizes.

| Class | Size / line | Job |
| --- | --- | --- |
| `.t-hero` | 38 / 44 | the welcome headline — one per product |
| `.t-display` | 26 / 32 | screen headline |
| `.t-heading` | 21 / 28 | section headline |
| `.t-title` | 17 / 24 | panel and dialog title |
| `.t-read` | 15.5 / 26 | **long-form assistant prose** |
| `.t-body` | 14.5 / 22 | default UI text |
| `.t-ui` | 13.5 / 19 | dense controls, list rows |
| `.t-small` | 12.5 / 17 | metadata, captions |
| `.t-micro` | 11.5 / 16 | uppercase labels with tracking |

Weight is a decision, not a default. Headings are `600`, never `700`/`800`.
Body is `400`. Buttons are `500`. If a screen has more than three weights on
it, the hierarchy is being carried by weight instead of by size and space.

---

## 4. Space, radius, elevation

**Space** — an 8px rhythm (`space` in `tokens.ts`), with a 4px half-step
reserved for optical alignment only.

**Radius** — five values, and no more:

| Token | Value | Used for |
| --- | --- | --- |
| `--radius-xs` | 6px | inline code, keycaps |
| `--radius-sm` | 8px | icon buttons, menu items |
| `--radius-md` | 12px | buttons, inputs, chips |
| `--radius-lg` | 16px | cards, panels, composer rows |
| `--radius-xl` | 22px | the composer, dialogs |

Settings offers Sharp / Refined / Soft, which rescale these four steps.

**Elevation** — three steps, warm-tinted and shallow:

| Token | Used for |
| --- | --- |
| `--shadow-raised` | a resting interactive surface |
| `--shadow-pop` | composers, popovers, menus |
| `--shadow-dialog` | dialogs and sheets — the only large blur allowed |

Depth primarily comes from surface value plus a hairline border. A shadow
exists to lift something off the page, not to decorate it.

---

## 5. Motion

Four scales. Every animation picks one; there are no ad-hoc timings.

| Scale | Duration | Used for |
| --- | --- | --- |
| `micro` | 120ms | hover, press, focus ring, icon swap |
| `small` | 180ms | menus, tooltips, chips, state flips |
| `medium` | 260ms | panels, page cross-fades, message arrival |
| `large` | 420ms | boot, welcome entrance, voice overlay |

Easings: `out` (default entrance), `inOut` (symmetric state flips), `exit`
(leaving), `precise` (mechanical — send and tool actions).

### The motion language

| Moment | Behaviour |
| --- | --- |
| **BOOT** | soft reveal — the product fades up, it never slides in |
| **CHAT** | calm arrival — 6px of travel, never more |
| **SEND** | precise — short, mechanical, no bounce |
| **VOICE** | organic pulse — the only motion allowed to breathe |
| **TOOLS** | subtle activity — quiet loops that read as alive |
| **SUCCESS** | quiet confirmation — a settle, not a celebration |
| **ERROR** | restrained interruption — one small horizontal shake |

Use the named variants in `motion.ts` (`rise`, `fade`, `pop`, `dialog`,
`sheet`, `message`, `shake`, `settle`) rather than writing inline objects.

### Reduced motion

Both the OS preference (`prefers-reduced-motion`) and the in-app toggle
(`data-reduced-motion`) collapse every animation and transition to zero.
**No feature may depend on motion to be understandable.**

---

## 6. Components

### Classes (`index.css`)

`surface` · `surface-elevated` · `surface-sunken` · `surface-interactive` ·
`btn-primary` · `btn-ghost` · `btn-quiet` · `btn-danger` · `input-shell` ·
`field` · `chip` · `label-caps` · `icon-btn` · `kbd` · `rule` ·
`scroll-region`

### Primitives (`src/components/ui/`)

| Component | Purpose |
| --- | --- |
| `Artwork` | a piece from the visual library, framed as placed art |
| `EmptyState` | art + one headline + one sentence + at most one action |
| `StatusDot` / `StatusPill` | the only way a state is reported |
| `Activity` / `ToolActivity` | how MetaIoid says it is working |
| `SectionHeader` | the single way a section announces itself |
| `Proactive` | the two things MetaIoid says before you ask |
| `ProviderMark` / `ProviderCard` | normalised third-party provider rows |
| `Sentinel` / `useOnScreen` | defer work that is off-screen |

### Not allowed

- A second way to express something that already has a primitive.
- Buttons that look like three different systems on one screen.
- A control that appears in only one place with bespoke styling.
- Non-functional UI. A toggle that does nothing, or a status that is invented,
  is worse than no control at all.

---

## 7. Asset system

```
art-src/                  masters — source of truth, never served
public/art/
  brand/                  welcome atmosphere
  onboarding/             first-run
  empty-states/           conversations · files · memory · projects
  research/               sources
  system/                 providers · unavailable
```

Rebuild every shipped asset:

```bash
node scripts/optimize-assets.mjs
```

The pipeline crops to the render size, emits 1x and 2x WebP, and nothing else.
The whole library ships in **under 90 KB**.

### The asset brief

Every generated image follows one brief. This is why eight pieces read as one
family.

> **Mood** quiet intelligence — **not** sci-fi, gaming or hacker
> **Subject** a single matte sculptural form, centred, occupying the middle
> third of an otherwise empty frame
> **Composition** minimal; generous negative space on all sides
> **Lighting** one soft directional key from the upper left, gentle falloff
> **Palette** warm bone, greige, soft graphite, and exactly one restrained
> jade note
> **Geometry** clean, smooth, no sharp drama
> **Contrast** extremely low — these must never fight the UI
> **Finish** medium-format look, shallow depth of field, subtle film grain

### Presentation rule

The studio ground in these pieces matches neither the dark nor the light page,
so they are **never alpha-feathered into the background** — that produces a
visible vignette ring. They are framed: an inset tile with a hairline border
and the theme's radius. Honest, and identical in both themes.

### Budgets

- Hero/welcome artwork: ≤ 40 KB (1x + 2x combined)
- Empty-state artwork: ≤ 18 KB (1x + 2x combined)
- Everything below the fold is `loading="lazy"`; only the welcome artwork is
  `priority`.
- Every image carries `width`/`height`. There are no layout shifts.

---

## 8. Writing

The interface speaks like a competent colleague, not like a system monitor.

| Do | Don't |
| --- | --- |
| "Connected" | "ONLINE" |
| "Demo mode" | "SANDBOX" |
| "Thinking…" | "PROCESSING REQUEST" |
| "No conversations yet" | "0 items found" |
| "That reply didn't come through." | "Error: fetch failed (500)" |

**The backend is invisible.** No JWTs, no row-level security, no provider
arbitration in the copy. A person signing in should never be shown a schema.

**Never show a developer log.** `fetch_sources(url=…)` is not an update. Tool
activity is a human phrase; the detail is optional and also human.

**Never invent state.** If a gateway is not reachable, say so — do not display
a green dot because a variable is set.

---

## 9. Accessibility

- Contrast: body text meets WCAG AA against its own surface in all five modes.
- Focus: one visible ring (`:focus-visible`, 2px accent, 2px offset)
  everywhere. Inputs communicate focus through the shell's own ring instead.
- Keyboard: every interactive element is reachable and operable.
- Touch targets: minimum 44×44px on mobile.
- Font scaling: root font-size is respected; layouts use rem-relative space.
- Screen readers: `aria-live` on streaming and status regions; decorative
  artwork is `aria-hidden`; every icon-only button has an `aria-label`.
- Motion: see §5.

---

## 10. Responsive

Recompose, don't just resize.

| Breakpoint | Behaviour |
| --- | --- |
| `< 768px` | bottom navigation, sheets instead of popovers, composer pinned above the safe area, single column |
| `768–1024` | sidebar returns, header appears on non-chat screens |
| `1024–1440` | full composition, chat column fixed at 720px |
| `> 1440` | content does not stretch; whitespace grows instead |

The conversation column is a **fixed reading measure** (~72ch), not a
percentage. Long lines are the single fastest way to make a chat surface feel
cheap.
