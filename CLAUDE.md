# IziTravel Quote Generator — CLAUDE.md

> **Live site:** https://izitravelquotes.netlify.app/  
> **GitHub:** https://github.com/jacquesgroen88/quotetool  
> **Last updated:** 2026-05-31

---

## What This Tool Does

IziTravel is a South African travel agency run by **Terri** (contact: terrib@izitravel.co.za, +27 60 806 6589, office +27 16 023 0214). Terri receives raw package documents from multiple suppliers (AFS, Afristay, resort-direct, wholesalers — each in a completely different format). She previously had to manually reformat these into branded IziTravel client-facing Word quotes.

This tool automates the entire process:

1. Upload supplier PDF or DOCX
2. Fill in client details (name, occasion, destination, dates, adults/children)
3. AI extracts all package options, prices, inclusions, flights, exclusions
4. Branded HTML quote is generated instantly in a live preview
5. Chat editor lets Terri make natural-language changes ("remove option 3", "change price on option 1 to R45,000 pp")
6. One-click download as a self-contained HTML file OR copy a shareable link to send directly to the client
7. Admin dashboard at `/admin.html` shows every quote generated with client links

---

## Architecture

```
izitravel-quote-tool/
├── public/                        ← Static frontend (served by Netlify)
│   ├── index.html                 ← Single-page app (3 views: upload, generating, editor)
│   ├── admin.html                 ← Password-protected quote dashboard
│   ├── assets/
│   │   └── izilogo.jpg            ← Official IziTravel logo (copied from main website repo)
│   └── js/
│       ├── app.js                 ← App logic: state machine, API calls, UI events
│       └── template.js            ← Client-side HTML quote builder (buildQuoteHTML)
├── netlify/
│   └── functions/                 ← Netlify Functions v1 (CommonJS exports.handler)
│       ├── detect.js              ← Auto-detect client details from supplier doc
│       ├── generate.js            ← Extract + structure full quote data via AI
│       ├── edit.js                ← Apply natural-language changes to quote JSON
│       ├── quote-accepted.js      ← Proxy for quote acceptance → forwards to Make.com server-side
│       ├── save-quote.js          ← Save quote → returns shareable URL
│       ├── view-quote.js          ← Serve saved quote as HTML page (client-facing)
│       ├── admin-quotes.js        ← List all quotes (password protected)
│       └── _store.js              ← Storage abstraction: filesystem locally, GitHub Gist API in prod
├── netlify.toml                   ← Build config, functions dir, dev port 3002
├── package.json                   ← Dependencies: pdf-parse, mammoth, @netlify/blobs, uuid
├── .env                           ← Local secrets (gitignored — see Environment Variables below)
├── .gitignore                     ← Excludes node_modules, .netlify/, .env, *.log
└── CLAUDE.md                      ← This file
```

---

## How to Run Locally

```bash
cd C:\Users\User\Desktop\IziTravel\izitravel-quote-tool

# First time only
npm install

# Start dev server (port 3002)
node_modules\.bin\netlify dev --port 3002
```

Open http://localhost:3002

**Requirements:** `.env` file must exist with:
```
OPENROUTER_API_KEY=sk-or-v1-...
ADMIN_PASSWORD=your_password
```

The `.env` is gitignored and auto-loaded by the functions via a built-in loader at the top of each function file (no dotenv dependency needed).

---

## Environment Variables

| Variable | Where to set | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | `.env` locally, Netlify dashboard in prod | AI API calls via OpenRouter |
| `ADMIN_PASSWORD` | `.env` locally, Netlify dashboard in prod | Protects `/admin.html` quote list — currently set to `Reviewtap` |

**In Netlify dashboard:** Site configuration → Environment variables → Add variable

---

## Netlify Functions Reference

All functions are CommonJS v1 (`exports.handler = async (event) => {}`). They self-load `.env` locally via an fs-based reader at the top of each file.

### `POST /.netlify/functions/detect`
- **Input:** `{ fileData: "data:...;base64,...", filename: "file.pdf" }`
- **Output:** `{ clientName, destination, dates, adults, occasion }` (empty strings if not found)
- **Model:** `anthropic/claude-haiku-4.5` via OpenRouter
- **Speed:** ~3 seconds
- **Purpose:** Auto-fills the form when a file is dropped

### `POST /.netlify/functions/generate`
- **Input:** `{ fileData, filename, clientDetails: { clientName, clientTitle, occasion, destination, dates, adults, children, personalNote, quoteValidity } }`
- **Output:** `{ result: quoteData }` — full structured JSON
- **Model:** `anthropic/claude-sonnet-4.5` via OpenRouter
- **Speed:** ~25 seconds
- **Purpose:** Main extraction — reads the supplier doc, returns all options as JSON
- **Important:** Prompt explicitly instructs AI NOT to mention supplier/wholesaler names (AFS, Afristay, Tourvest, etc.)

### `POST /.netlify/functions/edit`
- **Input:** `{ quoteData: {...}, message: "change client to Mrs Ferreira" }`
- **Output:** `{ quoteData: {...updated...}, changes: "Changed client name from X to Y" }`
- **Model:** `anthropic/claude-haiku-4.5` via OpenRouter
- **Speed:** ~2 seconds
- **Purpose:** Chat-based editing — natural language → modified JSON

### `POST /.netlify/functions/save-quote`
- **Input:** `{ quoteData: {...}, logoBase64: "data:image/...", quoteId?: "existing-uuid" }`
- **Output:** `{ quoteId: "uuid", quoteUrl: "...", updated: bool }`
- **Purpose:** Creates a new quote (no quoteId) or updates an existing one (quoteId provided). Auto-called after every AI edit to keep the client link current.

### `GET /.netlify/functions/load-quote?id=UUID`
- **Output:** `{ quoteId, quoteData, logoBase64, createdAt, clientName, destination }`
- **Purpose:** Returns raw quote JSON for loading back into the editor. Used by `?edit=UUID` flow.

### `GET /.netlify/functions/view-quote?id=UUID`
- **Output:** Full branded HTML page (served to client's browser)
- **Purpose:** The URL Terri sends to her client — opens the complete interactive quote

### `POST /.netlify/functions/admin-quotes`
- **Input:** `{ password: "..." }`
- **Output:** `{ quotes: [{ quoteId, clientName, destination, dates, createdAt, quoteUrl, optionCount }] }` sorted newest first
- **Auth:** Returns 401 if wrong password

---

## Storage: `_store.js`

Abstracts quote persistence:
- **Local dev:** Saves JSON files to `.netlify/blobs-local/[uuid].json`
- **Production (Netlify):** Uses GitHub Gist API via Node's built-in `https` module (requires `GITHUB_TOKEN` env var)
  - Each quote = one **secret** gist containing a single file `quote.json`
  - Gist ID is used as the `quoteId` (replaces UUID in prod)
  - Logo is NOT stored in the gist — served from `/assets/izilogo.jpg`

Detection: `isProduction()` checks `!!process.env.GITHUB_TOKEN`. **Do NOT use `process.env.NETLIFY`** — it is only available during the build step, not at Lambda function runtime.

**Required env vars for production:**
- `GITHUB_TOKEN` — Personal Access Token with **gist** scope. Create at https://github.com/settings/tokens → New classic token → check "gist". Set in Netlify dashboard → Site configuration → Environment variables.

---

## Frontend: `app.js`

State machine with 3 views: `view-upload` → `view-generating` → `view-editor`

**State object:**
```javascript
{
  file,           // Uploaded File object
  editQuoteId,    // UUID of saved quote being edited (null for new quotes)
  quoteData,      // Current structured JSON
  logoBase64,     // Logo preloaded as base64 (fetched from /assets/izilogo.jpg)
  chatMessages,   // [{role:'agent'|'ai', text}]
  currentBlobUrl, // Active iframe Blob URL (revoked on refresh)
  isEditing,      // Lock during AI edit call
  quoteUrl,       // Shareable link from save-quote
}
```

**Key flows:**
- File dropped → `runDetect()` → auto-fills form fields
- Generate clicked → `runGenerate()` → shows preview + triggers `saveQuoteLink()` in background → sets `state.editQuoteId`
- Chat message → `runEdit()` → updates JSON → `refreshPreview()` → auto-saves silently via `saveQuoteLink(quoteData, silent=true)` if `editQuoteId` set
- Download → `downloadQuote()` → builds HTML, triggers browser download
- `?edit=UUID` in URL → `loadQuoteForEdit(UUID)` → fetches from `load-quote` function → populates editor with existing quote → sets `state.editQuoteId`
- Edit link (for Terri to come back) shown in the link card as `/?edit=UUID`

---

## Frontend: `template.js`

Contains `buildQuoteHTML(data, logoBase64)` — builds the entire client-facing HTML quote as a string. Runs in the browser (no server-side rendering).

**Quote structure generated:**
1. White header (matching izitravel.co.za style) with logo + 4px pink accent bar
2. Hero section: destination Unsplash photo + overlay with client name, dates, occasion, adults/children pills
3. Intro strip: personalNote, quoteValidity, greeting
4. Options grid: each option card — resort name (large) → key facts (nights/board/room as colored pills) → price prominent → inclusions → description (collapsible `<details>`) → CTA button
5. Flight details section
6. Exclusions grid (✕ bullets)
7. CTA strip with "Select This Package" button → posts to Make.com webhook
8. Dark footer with logo (white pill background) + T&C text

**Hardcoded agent details (Terri):**
```javascript
const WEBHOOK_URL  = 'https://hook.eu2.make.com/5it7lfymupsatg8sht6wg536bj35v6jy';
const AGENT_PHONE  = '+27 60 806 6589';
const AGENT_EMAIL  = 'terrib@izitravel.co.za';
const AGENT_OFFICE = '+27 16 023 0214';
const AGENT_WA     = '27608066589';  // WhatsApp number (no +)
```

**Destination hero images:** Unsplash CDN map in `getHeroImage(destination)` — covers Zanzibar, Mauritius, Maldives, Seychelles, Bali, Dubai, Kenya, Cape Town, Egypt, Thailand, Morocco + fallback.

---

## Brand Guidelines

| Token | Value |
|---|---|
| Primary pink/red | `#e63946` |
| Dark primary | `#b91c1c` |
| Font | Inter (Google Fonts) |
| Logo | `/assets/izilogo.jpg` (from main website repo `izitravel/src/components/logo/izilogo.jpg`) |
| Header style | White background (matches izitravel.co.za — NOT pink) |
| Footer logo | Wrapped in `rgba(255,255,255,.92)` pill (JPG can't use CSS invert trick) |

**Website repo** (for reference): `C:\Users\User\Desktop\IziTravel\izitravel\` (GitHub: jacquesgroen88/izitravel)

---

## Admin Dashboard

**URL:** https://izitravelquotes.netlify.app/admin.html  
**Default password:** Set via `ADMIN_PASSWORD` env var

Shows all generated quotes in a table:
- Client name, destination, dates, option count, timestamp
- "View ↗" link (opens quote in browser)
- "Copy Link" button (copies client-shareable URL to clipboard)
- Stats bar: total quotes, today's count, unique destinations

---

## Generating Screen

Shows:
- Spinner + "Generating your quote…"
- Status text (updates: "Reading document…" → "Analysing options with AI — this takes about 20 seconds…")
- Explanation note about timing
- "Proudly powered by [Reviewtap](https://reviewtap.co.za)"

---

## Known Constraints & Notes

| Item | Detail |
|---|---|
| File size limit | 8 MB (enforced client-side before upload) |
| Supported formats | PDF, DOCX only |
| AI timeout | Sonnet takes ~25s. Netlify free tier has 10s timeout — **upgrade to Pro** or use Netlify's background functions. The site works on Pro plan (26s timeout). |
| Quote links locally | Use localhost:3002 URLs — only usable on local machine |
| Quote links in prod | Full https://izitravelquotes.netlify.app/ URLs — shareable anywhere |
| Supplier stripping | AI prompt tells it to remove AFS, Afristay, Tourvest, Thompsons, Club Travel etc. Add more supplier names to the prompt in `generate.js` as needed |
| Multiple agents | Currently hardcoded to Terri only — if other agents need their own details, update constants in `template.js` |
| Make.com webhook | `https://hook.eu2.make.com/5it7lfymupsatg8sht6wg536bj35v6jy` — fires when client clicks "Select This Package" in the quote |

---

## OpenRouter API Details

- **URL:** `https://openrouter.ai/api/v1/chat/completions`
- **Referer:** `https://izitravel.co.za`
- **App title:** `IziTravel Quote Generator`
- **Models used:**
  - Generate: `anthropic/claude-sonnet-4.5`
  - Detect + Edit: `anthropic/claude-haiku-4.5`

---

## Common Edits & Where to Make Them

| What to change | File | What to look for |
|---|---|---|
| Agent contact details | `public/js/template.js` | `AGENT_PHONE`, `AGENT_EMAIL`, `AGENT_OFFICE`, `AGENT_WA`, `WEBHOOK_URL` constants at top |
| Quote HTML design | `public/js/template.js` | `buildQuoteHTML()` function — CSS is inline in the template string |
| Add destination hero image | `public/js/template.js` | `getHeroImage()` function — add to the `map` object |
| Extraction prompt | `netlify/functions/generate.js` | The `prompt` template literal — adjust JSON structure or rules |
| Add supplier name to strip | `netlify/functions/generate.js` | The "IMPORTANT: Do NOT mention the supplier" rules line |
| Edit chat prompt | `netlify/functions/edit.js` | `systemPrompt` constant |
| Admin password | `.env` + Netlify dashboard | `ADMIN_PASSWORD` |
| Quick-edit chips | `public/index.html` | `data-chip` attributes on `.chip` spans |
| Generating screen text | `public/index.html` | `#view-generating` section |
| Form fields | `public/index.html` | `#view-upload` section |

---

## Deployment Checklist (Netlify)

- [x] Repo: https://github.com/jacquesgroen88/quotetool
- [x] Netlify site: https://izitravelquotes.netlify.app/
- [ ] Set `OPENROUTER_API_KEY` in Netlify env vars
- [ ] Set `ADMIN_PASSWORD=Reviewtap` in Netlify env vars
- [ ] Upgrade to Netlify Pro for 26s function timeout (Sonnet needs ~25s)

**Auto-deploy:** Every `git push` to `main` triggers a Netlify deploy automatically.

---

## Test Files

Supplier PDFs for testing live at:
- `C:\Users\User\Desktop\IziTravel\Quote inputs\AFS-2026-ccbe47d4_Zanzibar.pdf` (10 options, AFS format)
- `C:\Users\User\Desktop\IziTravel\Quote inputs\Zanzibar Quote - Michiel Eloff - September 2026.pdf`

---

## Session History Summary

### Session 1 — Initial build (quote-generator/ — OLD, do not use)
- Built Express server at `C:\Users\User\Desktop\IziTravel\quote-generator/`
- Local only, generated `.docx` output
- Confirmed working with Zanzibar PDF (610KB HTML, 10 options)
- **Superseded by the Netlify version**

### Session 2 — Netlify rebuild
- Analyzed main IziTravel website repo (jacquesgroen88/izitravel) for correct logo and branding
- Built new repo `izitravel-quote-tool` → deployed to Netlify
- Switched from ESM v2 functions (.mjs) to CommonJS v1 (.js) — ESM caused 404 locally
- Key insight: `node_bundler = "esbuild"` in netlify.toml broke function loading — removed it
- Added `functions = "netlify/functions"` to `[dev]` section — that fixed loading
- Client-side HTML generation (not server-side) for logo embedding and preview
- WhatsApp-style chat editor with AI edits applied to JSON → preview rebuilds

### Session 3 — Features added
- **Fixed:** `buildQuoteHTML is not defined` — caused by `'\2715'` octal escape in template literal CSS. Fixed to `'\\2715'`
- **Fixed:** Footer logo invisible — `filter:brightness(0) invert(1)` doesn't work on JPG. Fixed with white pill container
- **Added:** Strip supplier names from AI output (prompt update in generate.js)
- **Added:** "Proudly powered by Reviewtap" on generating screen
- **Added:** Shareable quote links — `save-quote.js` + `view-quote.js` functions
- **Added:** Admin dashboard at `/admin.html` — password protected, lists all quotes
- **Added:** `_store.js` — filesystem fallback for local dev, Netlify Blobs in production
- **Fixed:** `.env` not loaded by netlify dev — added inline fs-based env loader to each function

### Session 4 — Option card redesign + edit-later architecture
- **Redesigned:** Option cards now lead with resort name (large, 21px/900wt) → key differentiator pills (nights dark, board green, room slate) → price prominently before inclusions → description collapsed in `<details>` element
- **Added:** `save-quote.js` accepts optional `quoteId` to update existing records (not just create new)
- **Added:** `load-quote.js` — GET endpoint returning raw JSON for loading a saved quote into the editor
- **Added:** `?edit=UUID` URL param handling in `app.js` — opens saved quote directly in editor
- **Added:** `state.editQuoteId` — tracks UUID of current quote; auto-saves silently after every AI edit
- **Added:** Edit Link shown in the link card (for Terri's own bookmarking)
- **Added:** Admin table now shows Edit ✏ link alongside View ↗ button
- **Fixed:** `_store.js` production detection bug — now uses `NETLIFY && !NETLIFY_DEV`

### Session 4b — GitHub Gist storage + critical production fixes
> **Root cause of all 502 errors:** Netlify Blobs v10 `getStore()` returns empty context `{}` when `event.blobs` is absent (Lambda runtime), causing all HTTP calls to hang → 502. Replaced entirely with GitHub Gist API.

**Critical bugs found & fixed (must not repeat):**

| Bug | Root cause | Fix |
|---|---|---|
| `require('uuid')` → 502 | `uuid` v14 is ESM-only — crashes CommonJS module at load time | Use `const { randomUUID } = require('crypto')` (Node built-in) |
| `process.env.NETLIFY` → ENOENT | `NETLIFY` env var only present during BUILD, not at Lambda runtime | Use `!!process.env.GITHUB_TOKEN` to detect production |
| `fs.readFileSync('/public/js/template.js')` → ENOENT | `public/` is NOT on the Lambda filesystem | Load template via `<script src="...">` URL |
| `fetch` to `api.github.com` → "fetch failed" | Node 18 `fetch` (undici) has reliability issues from some Lambda IPs | Use Node's built-in `https` module directly |
| CSS `content:'&#9660;'` → literal text | HTML entities in CSS `content:` render as literal characters | Use actual Unicode chars: `▼`, `▶` |
| CSS `content:'\25BC'` → SyntaxError | Octal/hex escapes in JS template literals are illegal | Double-escape: `'\\25BC'` or use literal Unicode char |
| Logo stored in gist → slow/oversized | 80KB base64 in every gist payload | Serve logo from `/assets/izilogo.jpg` static site, pass as URL |
| `@netlify/blobs` → 502 | `connectLambda` throws when `event.blobs` absent; `getStore()` silently returns empty context → HTTP calls hang | Replaced with GitHub Gist + `https` module |

**Storage architecture (production):**
- GitHub Gist API: each quote = one secret gist with `quote.json` file
- Detection: `!!process.env.GITHUB_TOKEN` (set in Netlify dashboard, never hardcode)
- Gist ID (20-40 hex chars) is used as the `quoteId` — returned from `setJSON()`, stored in `state.editQuoteId`
- Logo served from `/assets/izilogo.jpg` — NOT stored in gist (80KB savings per quote)
- Local dev: filesystem at `.netlify/blobs-local/`

### Session 6 — Make.com quote acceptance integration + proxy fix

**What was built:**
- Dedicated Make.com webhook + scenario "IziTravel — Quote Accepted" (scenario ID: 9315233)
- Webhook URL: `https://hook.eu2.make.com/bjdc1oe65zcqw7k5fckx592fssqh5upv` (hook ID: 4164932)
- Scenario: Gmail notification to Terri with full quote details + GHL Create Contact
- GHL connection used: ID 14135168 (Location: Izi Travel)
- Gmail connection used: ID 13437969 (jacques@jcemedia.com)

**Critical finding — browser CORS kills Make.com JSON parsing:**

| Approach | Result |
|---|---|
| `mode:'no-cors'` + `Content-Type: application/json` | Browser downgrades to `text/plain` → Make.com wraps entire body in `{{1.value}}` → all template variables empty |
| `mode:'cors'` + `Content-Type: application/json` | Works in Chrome extension tests but unpredictable from real quote pages (CDN caching, browser behaviour) |
| **Server-side proxy (FINAL FIX)** | **Browser posts to `/.netlify/functions/quote-accepted` (same-origin, no CORS) → function forwards to Make.com via Node `https` with proper `application/json` → Make.com always receives structured JSON** |

**New file: `netlify/functions/quote-accepted.js`**
- Receives the form submission from the quote page (same-origin POST)
- Forwards to Make.com webhook using Node `https` module (no CORS restrictions server-side)
- Make.com always receives `Content-Type: application/json` → fields available as `{{1.quoteRef}}`, `{{1.email}}` etc. directly
- `WEBHOOK_URL` in `template.js` is now `/.netlify/functions/quote-accepted` (NOT the Make.com URL directly)

**Make.com data structure:** ID 586843 ("IziTravel Quote Accepted Payload") — defines all webhook fields
**Make.com hook udt:** Set to 586843 on hook 4164932 — tells Make.com the schema of incoming data

**GHL "Prevent Duplicate Contacts" issue:**
- GHL location has this setting ON — rejects `createAContact` API calls when contact already exists
- Fix: Turn OFF in GHL → Settings → Business Profile, OR the Make.com scenario just emails Terri (GHL contact creation is optional)
- GHL workflow "Quote Accepted Internal Notification" already built — triggers on tag "quote accepted" added to contact

**Make.com API limitations discovered:**
- `scenarios_create` → always 500 Internal Server Error (bug in Make.com MCP) — must create scenarios in UI
- `scenarios_update` with `json:ParseJSON` module → marks scenario `isinvalid: true` (tags field also causes this)
- `isinvalid: true` scenarios still execute but run a cached/corrupted blueprint — variables don't resolve
- Solution: Build complex scenarios in Make.com UI, use API only for simple webhook + email + GHL modules without tags

### Session 5 — Admin improvements + productivity features
- **Added:** Phone and email fields to the quote form (collected in `clientDetails`, stored in quoteData + gist record, shown in admin)
- **Added:** Admin collapsible "Details ▾" row — expands to show phone (tel: link), email (mailto: link), occasion, adults, children
- **Added:** Admin search bar — live filter by client name or destination
- **Added:** Admin period filter — All time / Today / This week / This month
- **Added:** Admin sort order — Newest first / Oldest first / Client A–Z
- **Added:** Filter count indicator ("Showing X of Y")
- **Added:** CSV export button — downloads all quotes including phone/email as `.csv`
- **Added:** "Duplicate ⧉" button in admin — opens `/?duplicate=UUID` which loads quote into editor as new (no `editQuoteId` set, saves fresh gist)
- **Added:** WhatsApp send button (green, `wa.me/?text=...`) — appears in link card after quote is saved
- **Added:** Price markup tool in editor panel — enter % → applies to all `pricePerPerson` and `totalPrice` fields, auto-saves
- **Added:** Quote validity options extended to 14 days (336h) and 30 days (720h)
- **Fixed:** New-quote reset now clears phone/email fields and hides WhatsApp button
