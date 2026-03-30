# PPL Quiz Trainer

Appka pro přípravu na teoretickou zkoušku PPL (Private Pilot Licence) podle ÚCL ČR.

## Tech stack

- **Framework:** Next.js 16 (App Router, React 19, TypeScript 5)
- **Styling:** Tailwind CSS 4 (dark theme, custom colors in globals.css)
- **AI:** Anthropic SDK — Claude Sonnet pro vysvětlení odpovědí (multimodální — posílá i obrázky)
- **Sync:** Google Sheets přes Apps Script (proxy přes /api/sync)
- **Deploy:** Vercel (auto-deploy z main, projekt `ppl-quiz`, URL: ppl-quiz.vercel.app)

## Struktura projektu

```
app/
  page.tsx                    — Dashboard (přehled okruhů, volba testu)
  quiz/[categoryId]/page.tsx  — Kvízová stránka (otázky, odpovědi, klávesové zkratky)
  results/page.tsx            — Výsledky testu (špatné odpovědi, vysvětlení)
  login/page.tsx              — Přihlašovací stránka (username + password)
  api/auth/route.ts           — POST endpoint pro ověření credentials, nastaví HTTP-only cookie
  api/explain/route.ts        — POST proxy k Claude API pro vysvětlení (posílá i obrázek jako base64)
  api/sync/route.ts           — GET/POST proxy k Google Apps Script
components/
  QuestionImage.tsx           — Obrázek u otázky s lightbox (fullscreen klik)
  ExplanationChat.tsx         — Interaktivní chat s AI pro vysvětlení odpovědí (multi-turn, markdown)
  SyncProvider.tsx            — Pull on mount, push on tab hidden / beforeunload, 30s safety net
lib/
  questions.ts                — Typy Question/Category, načítání z JSON, shuffle
  scoring.ts                  — localStorage skóre (otázky + sessions), export pro sync
  sync.ts                     — Pull/push/merge s Google Sheets, dirty tracking
  prioritization.ts           — Řazení chybných otázek podle závažnosti
data/
  questions.json              — Generovaný soubor s otázkami (NEeditovat ručně)
scripts/
  parse-pdfs.py               — Parser PDF → questions.json (PyMuPDF)
  Code.gs                     — Google Apps Script backend (reference)
middleware.ts                  — Auth guard: kontroluje cookie ppl-auth, redirect na /login
public/
  images/                     — JPG obrázky k otázkám (formát: ALW-011.jpg)
```

## Příkazy

- `npm run dev` — dev server
- `npm run build` — produkční build
- `npm run lint` — ESLint
- `python3 scripts/parse-pdfs.py [cesta_k_pdf]` — přegenerovat questions.json

## Env proměnné

Definované v `.env.local` (na Vercelu nastavené v dashboard):
- `ANTHROPIC_API_KEY` — API klíč pro Claude
- `GOOGLE_SCRIPT_URL` — URL deploynutého Google Apps Script
- `AUTH_USERNAME` — uživatelské jméno pro přihlášení
- `AUTH_PASSWORD` — heslo pro přihlášení

## Konvence

- Jazyk UI: čeština
- Všechny komponenty stránek jsou `"use client"`
- Path alias: `@/*` → root projektu
- Otázky mají ID formát `{categoryId}-{number}` (např. `1-42`)
- Obrázky k otázkám: pattern `(ALW-011)` v textu → pole `image: "ALW-011.jpg"`
- Data v localStorage pod klíčem `ppl-quiz-scores`
- Sync strategie: localStorage = cache, Google Sheet = source of truth
- Sync push po každé odpovědi + konci testu + 30s interval + beforeunload/visibilitychange
- API sync proxy: POST musí ručně sledovat 302 redirect (Apps Script mění POST→GET)

## Známé úskalí

- **Apps Script 302 redirect:** `fetch()` s `redirect: "follow"` mění POST→GET. V `api/sync/route.ts` se používá `redirect: "manual"` + ruční follow s POST.
- **Parser page breaks:** Otázky rozlomené přes dvě stránky PDF — parser detekuje bold text po 4 kompletních odpovědích jako novou otázku.
- **Parser multi-line options:** Každý checkbox v PDF může začít jen jednu odpověď (claimed tracking).

## Důležité

- `data/questions.json` se generuje parserem — needitovat ručně, spustit parser
- Obrázky v `public/images/` pojmenované přesně jako kód v závorce + `.jpg`
- Při přidání nového PDF stačí spustit parser, automaticky detekuje kategorii z názvu souboru
