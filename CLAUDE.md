# IziTravel Quote Generator — CLAUDE.md

> **Live site:** https://izitravelquotes.netlify.app/  
> **GitHub:** https://github.com/jacquesgroen88/quotetool  
> **Last updated:** 2026-05-28

---

## What This Tool Does

IziTravel is a South African travel agency run by **Terri** (contact: terrib@izitravel.co.za, +27 82 967 2060, office +27 16 023 0214). Terri receives raw package documents from multiple suppliers (AFS, Afristay, resort-direct, wholesalers — each in a completely different format). She previously had to manually reformat these into branded IziTravel client-facing Word quotes.

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
│       ├── save-quote.js          ← Save quote → returns shareable URL
│       ├── view-quote.js          ← Serve saved quote as HTML page (client-facing)
│       ├── admin-quotes.js        ← List all quotes (password protected)
│       └── _store.js              ← Storage abstraction: filesystem locally, Netlify Blobs in prod
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
| `ADMIN_PASSWORD` | `.env` locally, Netlify dashboard in prod | Protects `/admin.html` quote list |

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
- **Input:** `{ quoteData: {...}, logoBase64: "data:image/..." }`
- **Output:** `{ quoteId: "uuid", quoteUrl: "https://izitravelquotes.netlify.app/.netlify/functions/view-quote?id=UUID" }`
- **Purpose:** Persists quote, returns shareable client link

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
- **Production (Netlify):** Uses `@netlify/blobs` (requires `NETLIFY=true` and `SITE_ID` env vars, set automatically by Netlify)

Detection: `isNetlify()` checks `process.env.NETLIFY && process.env.SITE_ID`.

---

## Frontend: `app.js`

State machine with 3 views: `view-upload` → `view-generating` → `view-editor`

**State object:**
```javascript
{
  file,           // Uploaded File object
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
- Generate clicked → `runGenerate()` → shows preview + triggers `saveQuoteLink()` in background
- Chat message → `runEdit()` → updates JSON → `refreshPreview()` rebuilds iframe
- Download → `downloadQuote()` → builds HTML, triggers browser download

---

## Frontend: `template.js`

Contains `buildQuoteHTML(data, logoBase64)` — builds the entire client-facing HTML quote as a string. Runs in the browser (no server-side rendering).

**Quote structure generated:**
1. White header (matching izitravel.co.za style) with logo + 4px pink accent bar
2. Hero section: destination Unsplash photo + overlay with client name, dates, occasion, adults/children pills
3. Intro strip: personalNote, quoteValidity, greeting
4. Options grid: each option card with resort name, description, inclusions, added value, price
5. Flight details section
6. Exclusions grid (✕ bullets)
7. CTA strip with "Select This Package" button → posts to Make.com webhook
8. Dark footer with logo (white pill background) + T&C text

**Hardcoded agent details (Terri):**
```javascript
const WEBHOOK_URL  = 'https://hook.eu2.make.com/5it7lfymupsatg8sht6wg536bj35v6jy';
const AGENT_PHONE  = '+27 82 967 2060';
const AGENT_EMAIL  = 'terrib@izitravel.co.za';
const AGENT_OFFICE = '+27 16 023 0214';
const AGENT_WA     = '27829672060';  // WhatsApp number (no +)
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
- [ ] Set `ADMIN_PASSWORD` in Netlify env vars
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
