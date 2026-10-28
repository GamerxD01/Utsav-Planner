# ✦ Utsav — GenAI Event Planning Assistant

Utsav helps people organise **weddings, birthdays and community events**. Enter a few details and it returns a complete, personalised plan:

| Problem statement asks for | What Utsav delivers |
| --- | --- |
| **Budgets** | Category-by-category split that always sums exactly to your total, boosted for your top priorities, with per-guest cost and a contingency buffer |
| **Timelines** | Dated tasks grouped into phases (6+ months → event day → after). If the event is soon, lead times are compressed and late tasks are flagged **Urgent** |
| **Vendor checklists** | Who to book and by when, questions to ask before paying a deposit, AI tips per vendor, and a “booked” tracker |
| **Personalised ideas** | Google **Gemini** generates ideas, money-saving tips, risks and extra tasks tailored to event type, city, guests, budget, theme, priorities and notes (dietary, accessibility, culture) |

Extras: progress tracking saved in the browser, **export the timeline to Google Calendar / Outlook (.ics)**, print / save as PDF, light & dark mode.

## Architecture

```
Browser (vanilla JS, no framework)
   │  POST /api/plan  (JSON, ≤ 8 KB)
   ▼
node:http server (zero runtime dependencies) ── security headers, rate limit, validation
   │
   ├─ Deterministic engine  → budget.js · timeline.js · checklist.js   (exact, testable)
   └─ Gemini (REST, JSON schema output) → prompt.js · gemini.js        (personalisation)
         ↳ LRU cache + in-flight de-duplication · retry · timeout · curated fallback
```

**Hybrid design:** numbers and dates come from a deterministic engine so totals are never hallucinated; Gemini adds the creative, personalised layer on top. If Gemini is slow or unavailable, the app still returns a full plan with curated suggestions.

```
src/
  server.js        entry point, graceful SIGTERM shutdown (Cloud Run)
  app.js           routing, body parsing, errors
  config.js        env-based config
  lib/
    validation.js  strict input validation + sanitisation
    budget.js      weighted allocation (largest-remainder rounding)
    timeline.js    phased, compressed timeline
    checklist.js   vendor checklist
    prompt.js      system prompt, response schema, output validation
    gemini.js      Gemini REST client (timeout, retry, JSON mode)
    planner.js     orchestration, cache, fallback
    cache.js       LRU + TTL cache
    rateLimiter.js token bucket per IP
    security.js    CSP and security headers
    static.js      in-memory, pre-compressed static assets
public/            accessible UI (index.html, styles.css, js/)
tests/             node:test suite (unit + HTTP integration)
```

## How it meets the evaluation criteria

**Code quality** — small single-purpose ES modules, JSDoc types throughout, dependency injection (Gemini client, clock, cache, logger) for testability, ESLint 10 clean, no dead code.

**Security**
- API key stays server-side, sent in the `x-goog-api-key` header (never in URLs or the browser). On Cloud Run it is read from **Secret Manager**.
- Strict validation and sanitisation of every field; unknown values rejected; 8 KB body limit; `415` for non-JSON.
- Prompt-injection defence: user data is passed as a delimited JSON block with a system instruction to treat it as data; model output is schema-constrained and re-validated/clamped before use.
- XSS-safe rendering: the UI only uses `textContent` / DOM APIs, never `innerHTML`.
- Strict **CSP** (`script-src 'self'`, no inline code), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, Permissions-Policy, COOP/CORP.
- Per-IP **rate limiting** (token bucket, bounded memory) to protect the Gemini quota.
- Static files served from an in-memory whitelist — path traversal is impossible by construction.
- Generic 5xx messages (no stack traces leaked); container runs as non-root; **zero runtime dependencies** (no supply-chain risk, `npm audit`: 0 vulnerabilities).

**Efficiency**
- One Gemini call per plan; identical requests served from an **LRU cache** and concurrent duplicates **coalesced**.
- Static assets pre-compressed with **Brotli/gzip** at startup, with ETags (`304 Not Modified`) and cache headers.
- No frontend framework or build step; the whole UI is a few KB. Timeouts and a single retry with back-off on Gemini.
- Tiny Alpine image, fast cold starts on Cloud Run.

**Testing** — 55 tests with Node's built-in runner, ~99% line coverage: validation edge cases, budget maths (sums are exact), timeline compression, checklist, prompt/output sanitisation, Gemini client (retry, no-retry on 4xx, key not in URL), cache/dedupe/fallback, and full HTTP integration (headers, 304, traversal, 413/415/422/405/429).

**Accessibility** (WCAG 2.2 AA; **0 axe-core violations** in light and dark mode)
- Semantic landmarks, skip link, one `h1`, logical headings, `lang` set.
- Every input has a visible label; radio/checkbox groups use `fieldset`/`legend`; hints linked with `aria-describedby`.
- Error summary that receives focus and links to each field, plus inline errors and `aria-invalid`.
- `role="status"` live region for loading/results; focus moves to the plan heading when ready.
- Budget is a real table with `scope` headers; visual bars are `aria-hidden`; native `<progress>` and checkboxes.
- 44 px touch targets, visible focus rings, high-contrast palette, dark mode, `prefers-reduced-motion`, works at 320 px width, print stylesheet.

## Run locally

Requires Node.js 22+.

```bash
npm install          # dev tools only (eslint); the app has no runtime dependencies
cp .env.example .env # add your GEMINI_API_KEY (from https://aistudio.google.com/apikey)
node --env-file=.env src/server.js
# open http://localhost:8080
```

Without a key the app still works using curated fallback suggestions.

```bash
npm test               # run the test suite
npm run test:coverage  # with coverage
npm run lint
```

## Deploy to Google Cloud Run

```bash
gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com
printf "%s" "YOUR_GEMINI_KEY" | gcloud secrets create gemini-api-key --data-file=-
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding gemini-api-key \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud run deploy utsav-planner --source . --region asia-south1 --allow-unauthenticated \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest \
  --memory 256Mi --max-instances 3
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | – | Gemini API key (optional; fallback mode without it) |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Model ID |
| `GEMINI_TIMEOUT_MS` | `25000` | Per-request timeout |
| `RATE_LIMIT_PER_MINUTE` | `10` | Plan requests per IP per minute |
| `PORT` | `8080` | Set automatically by Cloud Run |

## License

MIT
