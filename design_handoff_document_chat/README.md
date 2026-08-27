# Handoff: Document Chat

## Overview

A small document-chat application. The user uploads a PDF, TXT or Markdown file from inside the conversation; the file is parsed, chunked and embedded; the user then asks questions and gets streamed answers grounded in the document, with citations naming the file, section and line range, plus a rendered structured component (table, timeline, key figures, checklist or evidence cards) chosen by the model per answer.

Target codebase: `rejtg21/chat-app` (Next.js app router, `src/app/`). It is currently the unmodified starter — no product UI exists upstream, so this is a greenfield implementation inside an existing Next.js shell.

Scope, per the brief: no auth, no billing, no admin area, no paid services.

## About the Design Files

`Document Chat.dc.html` in this bundle is a **design reference created in HTML** — a prototype that shows the intended look and behavior. It is not production code to copy. It runs on a streaming-template runtime that does not exist in the target repo, and all data in it is mocked (a hard-coded corpus, a fake vector search, a simulated stream).

The task is to **recreate this design in the target codebase's own environment**: React 19 / Next.js app router with TypeScript, using the repo's existing conventions. Read the HTML for exact layout, tokens, copy and state transitions; write idiomatic Next.js components.

Note on the repo: `chat-app/AGENTS.md` warns that this Next.js version has breaking changes versus training data and instructs you to read the relevant guide in `node_modules/next/dist/docs/` before writing code. Do that first — especially for route handlers, streaming responses and Server Actions.

## Fidelity

**High-fidelity.** Colors, typography, spacing, borders, interaction states and copy are final. Recreate pixel-for-pixel. Every value comes from the Industry design system (`design-system/styles.css` in this bundle) — link or port that stylesheet and consume the CSS custom properties rather than re-typing hex values.

The design system's rules that matter here:
- Square corners, hairline borders, no filled card surfaces. Cards and figures are line drawings.
- Every framed object gets `.blueprint` plus four `<i class="corner tl|tr|bl|br">` children (the `+` registration marks). Do not drop them.
- The only solid accent fill in the layout is the primary button (the send button).
- Barlow Condensed for headings, Barlow for body. Uppercase 10–11px labels with 0.08–0.14em letter-spacing carry all metadata.
- Lucide icons at `stroke-width: 1.5`.
- No decorative color beyond the steel accent.

## Screens / Views

There is one screen with several states. Full viewport, no page scroll.

### Root layout

`height: 100dvh; max-height: 100dvh; overflow: hidden; display: flex; flex-direction: column`. Background `var(--color-bg)`, text `var(--color-text)`, font `var(--font-body)`.

Three rows: header (fixed), `main` (fills), and inside the left pane a composer (fixed to the bottom of that pane).

`main`: `flex: 1; min-height: 0; overflow: hidden; display: grid; grid-template-columns: minmax(0, 1fr) 400px; grid-template-rows: minmax(0, 1fr); align-items: stretch`. Both panes get `height: 100%; min-height: 0; overflow: hidden; display: flex; flex-direction: column`.

The `grid-template-rows: minmax(0, 1fr)` and the `min-height: 0` on the panes are load-bearing — without them the panes grow to content height and the whole page scrolls instead of the inner lists.

### 1. Header (fixed, full width)

`display: flex; align-items: center; justify-content: space-between; gap: var(--space-6); padding: var(--space-3) var(--space-6); border-bottom: 1px solid var(--color-divider); flex: none`.

Left: `DOCDESK` — `var(--font-heading)`, 700, 19px, `letter-spacing: 0.02em`, uppercase. Beside it `Document chat` — 11px, `letter-spacing: 0.14em`, uppercase, `var(--color-neutral-600)`.

Right, in order:
- Connection indicator: a 6×6px solid `var(--color-accent)` square, then `Neon · connected` (11px, 0.08em, uppercase, `var(--color-neutral-700)`). Once a document is loaded the second half becomes `conversation persisted`.
- A demo control cluster separated by `border-left: 1px solid var(--color-divider); padding-left: var(--space-4)`: label `Demo` (10px, 0.12em, uppercase, neutral-500), then `Bad file` and `Retrieval error` as `.btn.btn-secondary` at `height: 28px; font-size: 12px`, then `Reset` as `.btn.btn-ghost`. `Retrieval error` is a toggle — when armed its border becomes `var(--color-accent)`.

These demo controls exist to make the error states reachable in a prototype. **Ship them behind a dev-only flag or drop them** — they are not product surface.

### 2. Left pane — document bar (only when a document is loaded)

`flex: none; display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-6); border-bottom: 1px solid var(--color-divider)`.

`Grounded in` (10px, 0.12em, uppercase, `var(--color-accent)`) · filename (`var(--font-heading)`, 16px) · `Markdown · 42 KB · 9 chunks` (11px, neutral-600) · spacer · `Replace` as `.btn.btn-ghost` at 28px/12px, which reopens the file picker.

### 3. Left pane — message scroller

`id="chat-scroll"`, `flex: 1; min-height: 0; overflow-y: auto; padding: var(--space-8) var(--space-6)`. Message column is `max-width: 660px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-8)`.

Auto-scroll: on every message-list change set `scrollTop = scrollHeight`, then repeat inside a double `requestAnimationFrame` so it lands after layout. This runs on each streaming tick, so the view follows the answer as it writes.

#### 3a. Empty state (no document)

A `.blueprint` panel, `max-width: 520px; margin: var(--space-8) auto; padding: var(--space-8); text-align: center`:
- Lucide upload icon, 34×34, stroke `var(--color-accent)`, width 1.5, centered with `margin: 0 auto var(--space-4)`.
- H2 `No document loaded` — 26px, `var(--font-heading)`.
- Body, `max-width: 340px`, 14px, neutral-700: "Upload a PDF, TXT or Markdown file. It is parsed, chunked, embedded and stored in Neon, so this conversation survives a reload."
- Two buttons, `gap: var(--space-3)`, centered: `Upload document` (`.btn.btn-primary`), `Use the sample` (`.btn.btn-secondary`).
- Footnote: `PDF · TXT · MD — up to 20 MB` (11px, 0.08em, uppercase, neutral-500).

#### 3b. Suggestions (document loaded, no user message yet)

`max-width: 660px`. H2 `Ask about <filename>` (24px). Sub: `9 chunks indexed · answers cite the section and lines they came from.` (14px, neutral-700).

Then a vertical stack (`gap: var(--space-2)`) of six `.blueprint` buttons, each `display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4)`, transparent background, 14px, left-aligned. Each has a fixed 74px-wide kind label (10px, 0.1em, uppercase, `var(--color-accent)`) then the question. Hover: `background: color-mix(in srgb, var(--color-accent) 8%, transparent); border-color: var(--color-accent)`.

Exact copy:

| Kind | Question |
| --- | --- |
| Table | Which post format performed best? |
| Timeline | How did the posting cadence change over the quarter? |
| Figures | Give me the headline numbers. |
| Checklist | What should we do next quarter? |
| Evidence | What is the evidence on video dwell time? |
| No answer | What did the CEO say about pricing? |

Clicking one sends it as the user's question.

#### 3c. User message

Right-aligned. `max-width: 78%; padding: var(--space-3) var(--space-4); background: var(--color-accent-900); color: var(--color-bg); font-size: 14px; line-height: 1.5`. Square corners.

#### 3d. System note (after indexing)

A centered uppercase rule: two 1px `var(--color-divider)` lines flexing on either side of 11px/0.08em uppercase neutral-600 text. Copy: `Indexed 9 chunks · 1536-d embeddings · stored in Neon`.

#### 3e. Retrieval shimmer (loading)

Header row: a 5×5px `var(--color-accent)` square animating `blink 1s steps(1) infinite`, then `Searching 9 chunks` (10px, 0.12em, uppercase, neutral-600).

Below, three bars at `gap: 9px`, `height: 11px`, widths 96% / 88% / 62%, each:
```css
background: linear-gradient(90deg, var(--color-neutral-200) 0%, var(--color-neutral-300) 45%, var(--color-neutral-200) 90%);
background-size: 200% 100%;
animation: sh 1.4s linear infinite;
```
```css
@keyframes sh { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
@keyframes blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
```

#### 3f. Answer

Meta row above the text: `Answer` · a 26×1px divider line · `3 chunks retrieved · cosine 0.71–0.91` — all 10px, 0.12em, uppercase, neutral-600. When nothing was retrieved the right half reads `no passage above threshold`.

Body: 15px, `line-height: 1.62`, paragraphs `margin: 0 0 var(--space-3)`. While streaming, a caret follows the text: `display: inline-block; width: 8px; height: 16px; background: var(--color-accent); vertical-align: -3px; animation: blink 1s steps(1) infinite`.

Citation markers appear inline in the answer prose as plain `[1]` `[2]` text. The structured component and the citation block render only once streaming has finished.

#### 3g. Citations block

`margin-top: var(--space-6); padding-top: var(--space-3); border-top: 1px solid var(--color-divider)`. Label `Citations` (10px, 0.12em, uppercase, neutral-600).

Each citation is a full-width button, `display: grid; grid-template-columns: 22px 1fr; gap: var(--space-3); padding: var(--space-2) var(--space-3); border: 1px solid var(--color-divider)`, transparent background, left-aligned. Hover: `border-color: var(--color-accent); background: color-mix(in srgb, var(--color-accent) 7%, transparent)`.

Column 1: the number in `var(--font-heading)` 13px `var(--color-accent)`. Column 2: source line `linkedin-posts-q3.md · §3 Engagement by format · L44–52` (12px, neutral-700), then the excerpt in curly quotes (13px, `line-height: 1.5`).

Clicking a citation switches the right pane to the Chunks tab, highlights that chunk and scrolls it into view.

Excerpts are shown in full, not behind a tooltip — verifiability is the product, so evidence is visible by default.

#### 3h. Error card

`.blueprint` with `border-color: var(--color-accent-700)`, `padding: var(--space-4)`.
- Kind label (10px, 0.1em, uppercase, `var(--color-accent-700)`).
- Message, 14px.
- Error code, 12px, `ui-monospace`, neutral-600.
- A `.btn.btn-secondary` at 30px/12px.

Two instances:

**Retrieval failed** — kind `Retrieval failed`; body "The vector search did not come back. Your document and this conversation are safe in Neon — only the lookup failed."; code `ERR_NEON_TIMEOUT · pgvector query exceeded 8s`; button `Retry question` re-runs the same question in place (remove the error message, re-ask).

**Unsupported file** — kind `Unsupported file`; body `"q3-deck.pptx" is a PPTX file. This app reads PDF, TXT and Markdown.`; code `ERR_UNSUPPORTED_TYPE · nothing was written to Neon`; button `Choose another file` reopens the picker. Nothing is uploaded and no message thread is disturbed.

### 4. Left pane — composer (fixed to pane bottom)

`flex: none; padding: var(--space-4) var(--space-6) var(--space-6); border-top: 1px solid var(--color-divider)`. Inner `max-width: 660px; margin: 0 auto`.

The input row is a `.blueprint`: `display: flex; align-items: flex-end; gap: var(--space-2); padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3)`.
- Attach button: `.btn.btn-ghost.btn-icon` 32×32, neutral-700, Lucide plus icon at 17px.
- Textarea: `flex: 1; min-height: 32px; max-height: 120px; padding: 6px 0`, no border, transparent, `resize: none`, 14px, inherits font, `outline: none`. Placeholder `Ask about linkedin-posts-q3.md`, or `Upload a document to start asking` with no document.
- Send: `.btn.btn-primary.btn-icon` 32×32, Lucide arrow-up at 16px. Disabled when there's no document or the input is empty (the system drops disabled controls to 45% opacity).

Below the row, `margin-top: var(--space-2)`, 11px neutral-600, space-between: `Enter to send · Shift+Enter for a new line` on the left, `Chat 3f2a · Neon` on the right. With no document the left reads `PDF, TXT or Markdown` and the right is empty.

Enter sends; Shift+Enter inserts a newline.

### 5. Right pane — source viewer (400px)

`background: color-mix(in srgb, var(--color-text) 3%, transparent)`.

Header: `flex: none; display: flex; align-items: center; justify-content: space-between; padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--color-divider)`. Label `Source` (11px, 0.14em, uppercase, neutral-700) and, when a document is loaded, a `.seg` segmented control with `.seg-opt` radios: `Outline` and `Chunks 9`.

Body: `id="src-scroll"`, `flex: 1; min-height: 0; overflow-y: auto; padding: var(--space-4)`.

Footer (document loaded): `padding: var(--space-3) var(--space-4); border-top: 1px solid var(--color-divider)`, 11px neutral-600: `documents · chunks · embeddings · chats · messages — 5 tables in Neon`.

#### 5a. Empty

Centered. A 220×130px placeholder plate: `border: 1px solid var(--color-divider)` filled with `repeating-linear-gradient(135deg, transparent 0 7px, color-mix(in srgb, var(--color-text) 6%, transparent) 7px 8px)`. Under it `document preview` in 12px `ui-monospace` neutral-600, then `Sections and chunks appear here once a file is indexed.` in 12px neutral-600, `max-width: 220px`.

#### 5b. Parsing (upload in progress)

A `.blueprint` panel: filename (`var(--font-heading)` 16px), `<size> · parsing` (11px neutral-600), then a progress bar — 3px track `var(--color-neutral-300)` with a `var(--color-accent)` fill at `transition: width 220ms linear`.

Below it a stage list (`gap: 5px`, 12px), each row a 5×5px square plus a label. Stages, ~620ms apart:
1. `Uploading file`
2. `Extracting text`
3. `Chunking (9 chunks)`
4. `Embedding · 1536-d`
5. `Writing to Neon`

Completed stages: dot `var(--color-accent)`, text `var(--color-text)`. Current: dot `var(--color-accent-400)`. Pending: dot `var(--color-neutral-300)`, text `var(--color-neutral-500)`.

Under the panel, four skeleton groups (`gap: var(--space-4)`), each three 9px shimmer bars (`gap: 7px`, same shimmer gradient) at widths 94/78/88, 86/92/64, 72/88/80, 90/68/84 percent.

#### 5c. Outline tab

Header line: `<filename> · Markdown · 42 KB · 9 chunks` (12px neutral-700). Then section buttons (`gap: var(--space-2)`), each `display: flex; align-items: baseline; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--color-divider)`, transparent, hover `border-color: var(--color-accent)`. Number in `var(--font-heading)` 12px accent, `min-width: 16px`; title 14px; meta 11px neutral-600.

Sections: `1 Scope` L1–12, 1 chunk · `2 Posting cadence` L14–40, 2 chunks · `3 Engagement by format` L42–78, 3 chunks · `4 Top posts` L80–120, 1 chunk · `5 Audience notes` L122–150, 1 chunk · `6 Recommendations` L152–178, 1 chunk.

Clicking a section jumps to its first chunk in the Chunks tab.

#### 5d. Chunks tab

A stack (`gap: var(--space-3)`) of chunk cards, `padding: var(--space-3); border: 1px solid var(--color-divider)`, id `src-<chunkId>`.
- Top row, space-between, 10px/0.08em uppercase neutral-600: chunk id on the left in `ui-monospace` (`letter-spacing: 0`), source location on the right.
- Text, 13px, `line-height: 1.55`.
- Footer, 10px `ui-monospace` neutral-500: `vector[1536] · 142 tokens`.

Active (targeted by a citation): `border: 1px solid var(--color-accent)`, `background: color-mix(in srgb, var(--color-accent) 12%, transparent)`.

Scroll-to-target: `box.scrollTop = max(0, target.offsetTop - box.offsetTop - 12)`, re-run when either the active chunk or the tab changes.

Exposing chunk ids, token counts and vector dimensions is deliberate — the retrieval pipeline is what makes the answers credible, so it is inspectable rather than hidden.

## Structured components (in-chat)

All five share one grammar: a small uppercase accent kicker (10px, 0.12em) above a `.blueprint` plate, `margin-top: var(--space-6)`. The model picks one per answer. In production this is the tool-calling / structured-output surface: define one tool per component and render on the discriminated union of its arguments. Validate with Zod (or equivalent) before rendering and fall back to plain prose if validation fails.

### Comparison table — kicker `Format comparison`

`.blueprint` at `padding: var(--space-4) var(--space-4) var(--space-2)`, containing a `.table` at `width: 100%; border-collapse: collapse; font-size: 13px`. Header cells: 10px, 0.1em, uppercase, weight 600, neutral-600, `border-bottom: 1px solid var(--color-divider)`, `padding: 0 var(--space-3) var(--space-2) 0`. Body cells: `padding: var(--space-2) var(--space-3) var(--space-2) 0`, `border-bottom: 1px solid color-mix(in srgb, var(--color-text) 8%, transparent)`, `font-variant-numeric: tabular-nums`. First column and all cells of a highlighted row are weight 600. Numeric columns right-aligned. The winning row carries `background: color-mix(in srgb, var(--color-accent) 10%, transparent)` — the highlight replaces chart color.

Columns: Format · Posts · Avg engagement · New followers · Median dwell.

| Format | Posts | Avg engagement | New followers | Median dwell |
| --- | --- | --- | --- | --- |
| Carousel (highlighted) | 14 | 6.8% | 310 | 48s |
| Video | 9 | 5.2% | 727 | 31s |
| Text-only | 22 | 3.4% | 188 | 22s |
| Single image | 11 | 2.9% | 96 | 18s |

### Timeline — kicker `Cadence changes`

Each event: `display: grid; grid-template-columns: 76px 1fr; gap: var(--space-4); padding-bottom: var(--space-6)`. Left column the date (12px, 0.06em, uppercase, neutral-600, `padding-top: 2px`). Right column `padding-left: var(--space-6); border-left: 1px solid var(--color-divider)` with an absolutely positioned 7×7px `var(--color-accent)` square node at `left: -4px; top: 5px`; title `var(--font-heading)` 17px, detail 13px neutral-700.

Events: `Jul — Ad-hoc, 3× per week` / `8 Aug — Fixed Tue/Thu 09:00` / `Aug — 18 posts` / `2 Sep — Friday carousel added` / `Sep — 26 posts`.

### Key figures — kicker `Key figures`

`display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--space-4)`. Each cell a `.blueprint` at `padding: var(--space-4)`: value in `var(--font-heading)` 30px, `line-height: 1`, `var(--color-accent-800)`; label 14px→12px at `margin-top: 7px`; note 11px neutral-600 at `margin-top: 3px`.

Figures: `56` Posts published (1 Jul – 30 Sep) · `4.6%` Avg engagement (all formats) · `+1,321` New followers (727 from video) · `2` Posts over 10k (both carousels).

### Checklist — kicker `Recommended actions` + progress `2 of 5 planned`

`.blueprint` at `padding: var(--space-2) var(--space-4)`. Each item a full-width button, `display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-3) 0; border-bottom: 1px solid color-mix(in srgb, var(--color-text) 8%, transparent)`.

The box: 17×17px, `margin-top: 2px`, `border: 1.5px solid var(--color-divider)`, transparent. Checked: border and background `var(--color-accent)`, with an 11px Lucide check in `var(--color-bg)` at `stroke-width: 2.5`. Checked label gets `text-decoration: line-through` and `color: var(--color-neutral-700)`. Source line under each label, 11px neutral-600.

Items: hold the Tuesday/Thursday 09:00 cadence (§6 · L156) · keep one carousel per week (§6 · L160) · cap video length at 45 seconds (§6 · L164) · test a text-only Friday post before adding a fourth slot (§6 · L168) · re-check director-and-above engagement in October (§5 · L132).

Ticks are user state and must persist per message — recommendations are things you act on.

### Evidence cards — kicker `Retrieved evidence`

Stack, `gap: var(--space-3)`. Each card a `.blueprint` at `padding: 0`, collapsed by default.

Header button: `display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4)`, transparent, hover `background: color-mix(in srgb, var(--color-accent) 7%, transparent)`. Rank `01`/`02`/`03` in `var(--font-heading)` 13px accent, 20px wide; label 13px flexing; score 11px `ui-monospace` neutral-600; Lucide chevron-down 14px that rotates 180° with `transition: transform 140ms ease`.

Expanded body: `padding: 0 var(--space-4) var(--space-4)`. Excerpt paragraph `padding-left: var(--space-4); border-left: 2px solid var(--color-accent)`, 13px, `line-height: 1.6`, `var(--color-neutral-800)`. Under it a row (11px neutral-600) with the source location and an `Open in source` `.btn.btn-ghost` at 24px/11px that focuses that chunk in the right pane.

Cards: `Dwell time by format` 0.91 → chunk_06 · `Engagement and follower gain by format` 0.84 → chunk_04 · `Top posts above 10k impressions` 0.71 → chunk_07.

## Interactions & Behavior

**Upload.** Attach button, `Upload document`, and `Replace` all open a hidden `<input type="file" accept=".pdf,.txt,.md,.markdown">`. Extension is validated client-side; anything else produces the unsupported-file error card and no upload. Valid files run the five parsing stages in the right pane, then the document bar appears and the `Indexed …` note is appended.

`Use the sample` loads a bundled sample document without a file dialog. Keep it — it makes the app demoable with no file on hand.

**Ask.** Question is appended as a user message; an assistant placeholder enters the retrieving state (shimmer); the answer then streams in. In the prototype the stream is 4 characters per 18ms tick; in production stream real tokens from the model. The structured component and citations mount only when the stream completes. Sending a new question cancels any in-flight stream.

**Citations.** Clicking a citation card, or `Open in source` on an evidence card, sets the right pane to the Chunks tab, marks that chunk active and scrolls it to the top of the pane.

**Errors.** Retrieval failure replaces the pending answer with the error card; `Retry question` removes it and re-asks the same question. The document and conversation are never lost — say so in the copy.

**No answer found.** When no chunk clears the similarity threshold, return a normal answer with the meta label `no passage above threshold`, no citations and no structured component. Copy used: "Nothing in this document answers that. The closest passages are about posting cadence and format performance, none of which mention it." / "If it should be in here, the source file may be an older export." Treat this as a first-class answer, not an apology or a toast.

**Responsive.** Designed for desktop at 1440×900 and up. Below roughly 1100px the 400px source pane should become a slide-over or a tab rather than compressing; the design does not specify a mobile layout.

## State Management

Prototype state (all client-side):

- `doc` — `{ name, kind, size } | null`
- `msgs` — ordered array of `{ id, role: 'user' | 'assistant' | 'note' | 'error', … }`. Assistant messages carry `status: 'retrieving' | 'streaming' | 'done'`, the answer payload, and `shown` (characters revealed).
- `input` — composer text
- `tab` — `'outline' | 'chunks'`
- `active` — highlighted chunk id
- `open` — expanded evidence cards, keyed `<messageId>:ev<index>`
- `checked` — ticked checklist items, keyed `<messageId>:<index>`
- `up` — `{ name, size, stage } | null` during parsing
- `forceError` — demo only

The prototype persists `{ doc, msgs, open, checked, active }` to `localStorage` under `docdesk.chat.v1` and, on load, downgrades any interrupted `retrieving`/`streaming` message to `done`. **In production replace this entirely with Neon.** Reload durability is a stated requirement and belongs in the database, not the browser.

### Production data model (Neon + pgvector)

Five tables, as named in the source-pane footer:

- `documents` — id, filename, mime/kind, size_bytes, page_count or line_count, status (`parsing` | `ready` | `failed`), created_at
- `chunks` — id, document_id, ordinal, section_label, page or line_start/line_end, token_count, text
- `embeddings` — chunk_id, `vector(1536)`, model — or a `vector` column directly on `chunks`; index with HNSW or IVFFlat for cosine distance
- `chats` — id, document_id, created_at
- `messages` — id, chat_id, role, content, structured payload (jsonb), citations (jsonb), created_at

Suggested flow: upload → store document row as `parsing` → extract text server-side (`pdf-parse` or `unpdf` for PDF; plain read for TXT/MD) → chunk on section boundaries with overlap, recording section label and page/line range so citations can name them → embed → mark `ready`. Question → embed the query → cosine top-k against `embeddings` → pass chunks as context with their ids → stream the answer → persist the message with its citations and structured payload. Load a chat by `document_id`, which is what makes reload survivable.

Citations must be model-produced references to chunk ids, resolved server-side to filename + section + line range. Never let the model invent a location; if a cited chunk id doesn't exist, drop the citation.

Free embeddings/inference options that satisfy "no paid services": a local model via Transformers.js / `gte-small` for embeddings, or any provider tier already available to the project. Neon has a free tier and ships `pgvector`.

## Design Tokens

From `design-system/styles.css` — consume the variables, don't retype the values.

Colors: `--color-bg` #f2f2f3 · `--color-surface` #e9e9ea · `--color-text` #1d1f20 · `--color-accent` #5980a6 · `--color-divider` `color-mix(in srgb, #1d1f20 16%, transparent)`.

Neutral ramp 100→900: #f5f5f8, #e7e7ea, #d4d4d7, #b7b7ba, #98989b, #7a7a7d, #5d5d60, #424244, #2b2b2d.

Accent ramp 100→900: #eef6ff, #d6ebff, #b5d9fd, #94bce3, #749dc4, #597ea3, #416180, #2c455d, #1d2d3d.

Used in this design: accent for kickers, nodes, active borders and the primary fill; accent-400 for the in-progress stage dot; accent-700 for error borders and accent-colored body text; accent-800 for figure values; accent-900 for the user's message ground; neutral-200/300 for shimmer; neutral-500/600/700 for metadata; neutral-800 for evidence excerpts.

Spacing: `--space-1` 3.4px · `-2` 6.8px · `-3` 10.2px · `-4` 13.6px · `-6` 20.4px · `-8` 27.2px.

Radius: `--radius-sm` 2px · `--radius-md` 4px · `--radius-lg` 7px. This design is square throughout; only `.btn` and `.input` carry the 4px the system gives them.

Type: `--font-heading` "Barlow Condensed" (weight 600, and 700 for the wordmark) · `--font-body` "Barlow". Base 15px / 1.55. Sizes used: 30, 26, 24, 19, 17, 16, 15, 14, 13, 12, 11, 10. `ui-monospace` for chunk ids, vector labels and error codes.

Shadows: `--shadow-sm/md/lg` exist but this design uses none — hairlines only.

Contrast note from the system: the accent-on-ground pair is ~3:1, fine for chrome and large text but not body copy. Paragraph text in accent uses `--color-accent-700` or darker.

## Assets

None. No images, no photographs, no logos. Icons are Lucide at `stroke-width: 1.5` — install `lucide-react` and use: `upload` (empty state), `plus` (attach), `arrow-up` (send), `check` (checklist), `chevron-down` (evidence cards). Fonts are Barlow and Barlow Condensed from Google Fonts; in Next.js load them via `next/font/google` rather than a `<link>`.

## Content

The sample document (`linkedin-posts-q3.md`) and every figure, quote, chunk and answer in this prototype are **invented placeholder content** for a quarterly LinkedIn content review. Do not ship them as real data. Replace the sample with a real document, or drop the sample path entirely.

## Files

- `Document Chat.dc.html` — the design reference. Layout, exact copy, all states, the five structured components, and the mocked corpus/answers (`DOC`, `ANSWERS`, `NOT_FOUND`, `STAGES` near the top of its script block).
- `design-system/styles.css` — the Industry design system stylesheet: tokens plus the `.btn`, `.input`, `.seg`, `.table`, `.card`, `.blueprint` component layer. Port or link this.
- `design-system/readme.md` — the design system's own guide: direction, color, type, icon and interaction-state rules.
