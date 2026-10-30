# ✦ Utsav — GenAI Event Planning Assistant

**Live demo:** https://utsav-planner-flax.vercel.app

Utsav helps people organise **weddings, birthdays and community events**. Enter a few details and it returns a complete, personalised plan:

| Problem statement asks for | What Utsav delivers |
| --- | --- |
| **Budgets** | Category-by-category split that always sums exactly to your total, boosted for your top priorities, with per-guest cost and a contingency buffer |
| **Timelines** | Dated tasks grouped into phases (6+ months → event day → after). If the event is soon, lead times are compressed and late tasks are flagged **Urgent** |
| **Vendor checklists** | Who to book and by when, questions to ask before paying a deposit, AI tips per vendor, and a “booked” tracker |
| **Personalised ideas** | Google **Gemini** generates ideas, money-saving tips, risks and extra tasks tailored to event type, city, guests, budget, theme, priorities and notes (dietary, accessibility, culture) |

Extras: progress tracking saved in the browser, **export the timeline to Google Calendar / Outlook (.ics)**, print / save as PDF, light & dark mode.

## Chosen vertical

**Challenge 5 — Celebration & Event Planner.** The persona is someone organising a wedding, a birthday or a community event (often for the first time, often in India) who needs to turn a date, a guest count and a budget into a concrete plan: what to spend where, what to do when, whom to book, and ideas that fit their family and city.

## Approach and logic

Utsav is a **hybrid assistant**: a deterministic decision engine produces everything that must be correct (money and dates), and Google Gemini adds what benefits from creativity (ideas, tips, risks). Every decision is driven by the user's context:

| User context | Decision the assistant makes | Where |
| --- | --- | --- |
| Event type (wedding / birthday / community) | Picks a different baseline budget split, task template and vendor list (e.g. permits and safety for community events, cake and entertainer for birthdays) | `constants.js`, `timeline.js`, `checklist.js` |
| Top priorities (up to 3) | Boosts those categories ×1.5 and re-normalises the rest; the contingency share is never reduced; a priority without its own category is redirected (sustainability → decor, guest experience → favours) | `budget.js` |
| Total budget + guest count | Splits the total with largest-remainder rounding so the lines always add up to the exact rupee; reports cost per guest | `budget.js` |
| Days until the event | Uses ideal lead times when there is time; otherwise compresses every task proportionally so nothing is scheduled in the past, and flags tasks and vendors that are already late as **Urgent / Book now** | `timeline.js`, `checklist.js` |
| City, theme, notes (dietary, accessibility, culture) | Sent to Gemini as data to personalise ideas, vendor tips, extra tasks and risks (e.g. "one grandparent uses a wheelchair" → accessible lawn pathways and a venue tip) | `prompt.js` |
| Gemini slow, overloaded or offline | Fails over to a faster backup model within a fixed time budget; if that also fails, returns the full deterministic plan with curated suggestions, so the user is never left without a plan | `gemini.js`, `planner.js` |
| Same request again | Served from cache (identical concurrent requests share one Gemini call) | `planner.js`, `cache.js` |

## How the solution works

1. **Input:** the user fills an accessible form (event type, date, guests, budget, currency, city, theme, up to 3 priorities, free-text notes). The browser validates it, and the server validates it again strictly.
2. **Request:** `POST /api/plan` passes a rate limiter, then a body-size limit, then validation and sanitisation.
3. **Deterministic plan:** `budget.js` computes the budget split, `timeline.js` the phased and dated timeline, and `checklist.js` the vendor list with book-by dates and questions to ask.
4. **Personalisation:** `prompt.js` sends the validated context to Gemini as a delimited JSON block with a strict response schema; the JSON that comes back is re-validated and clamped before use.
5. **Merge:** `planner.js` adds Gemini's extra tasks into the timeline and its vendor tips into the checklist, and attaches the ideas, money-saving tips and risks.
6. **Output:** the UI renders the plan with safe DOM APIs. The user can tick tasks (saved in their browser), export the timeline to a calendar, or print it.

## Assumptions

- Budget weights are planning rules of thumb (e.g. food is the largest share of a wedding), not quotes; Utsav does not know real vendor prices, so it gives shares and tips rather than prices or brand names.
- Ideal lead times reflect typical Indian wedding and event planning (venue about 10 months ahead for weddings, about 6 weeks for birthdays, permits about 2 months for community events).
- Dates are calendar dates (UTC midnight). Events can be planned from today up to 3 years ahead, for 1 to 5,000 guests.
- One currency per plan. Amounts are shown in the chosen currency without conversion.
- AI suggestions can be wrong. The UI says so, and nothing the user must rely on (totals, dates) comes from the model.
- No accounts and no database: plans are not stored on the server. Checklist progress stays in the user's own browser.

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
  server.js        standalone entry point, graceful SIGTERM shutdown (Cloud Run / local)
  container.js     composition root shared by server.js and the Vercel functions
  app.js           request handler: routing, body parsing, errors
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
api/               Vercel serverless functions (plan, health)
public/            accessible UI
  index.html, styles.css
  js/app.js        entry point: submit flow and plan actions
  js/form.js       form reading, accessible error summary, busy state
  js/render.js     renders the plan (budget, timeline, vendors, ideas)
  js/dom.js        safe element builder ($, el) and storage wrapper
  js/format.js     pure helpers shared with tests (money, dates, .ics, validation)
  js/types.js      JSDoc types for the plan payload
tests/             node:test suite (unit + HTTP integration)
```

## How it meets the evaluation criteria

**Code quality**
- Small, single-purpose ES modules on both server and client, with one route function per endpoint.
- Fully typed with JSDoc and checked by the TypeScript compiler in `strict` mode (`npm run typecheck`, zero errors).
- Dependency injection (Gemini client, clock, cache, logger, fetch) keeps every module unit-testable without network or time.
- Named constants instead of magic numbers; a single composition root (`src/container.js`) shared by Cloud Run and Vercel.
- ESLint 10 and Prettier enforced, `.editorconfig` for consistent formatting, and GitHub Actions CI running lint, type check, format check and tests on every push.

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
- No frontend framework or build step; the whole UI is a few KB. A single time budget per plan with automatic failover to a faster backup model and low thinking level, keeping responses well inside serverless limits.
- Tiny Alpine image, fast cold starts on Cloud Run.

**Testing** — 64 tests with Node's built-in runner, ~99% line coverage: validation edge cases, budget maths (sums are exact), timeline compression, checklist, prompt/output sanitisation, Gemini client (model failover, time budget, no failover on 4xx, key never in the URL), cache/dedupe/fallback, and full HTTP integration (headers, 304, traversal, 413/415/422/405/429).

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
npm run lint           # ESLint
npm run typecheck      # TypeScript strict check of the JSDoc types
npm run format:check   # Prettier
npm run check          # all of the above, as run in CI
```

## Deploy to Vercel

The repo is Vercel-ready (`vercel.json`): the UI in `public/` is served from Vercel's CDN with the same security headers, and `api/plan.js` / `api/health.js` run the same request handler as serverless functions.

1. Import the GitHub repo in Vercel (framework preset: **Other**).
2. Add `GEMINI_API_KEY` under *Settings → Environment Variables* (mark it **Sensitive**).
3. Deploy. Every push to `main` redeploys automatically.

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
| `GEMINI_FALLBACK_MODEL` | `gemini-3.5-flash-lite` | Faster backup model used if the primary is overloaded or slow |
| `GEMINI_THINKING_LEVEL` | `low` | Gemini thinking level (`off` to disable) |
| `GEMINI_TIMEOUT_MS` | `22000` | Total time budget for Gemini per plan |
| `RATE_LIMIT_PER_MINUTE` | `10` | Plan requests per IP per minute |
| `PORT` | `8080` | Set automatically by Cloud Run |

## License

MIT
