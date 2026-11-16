# Money Quest

A phone app (installable PWA) that turns a personal finance Excel workbook into a game: net worth, allocation, spending and income, plus levels, XP, streaks, badges, monthly challenges and a quest map of money milestones.

## Privacy model

- This repository contains **code only**. No workbook, no numbers, no personal data.
- You pick your `.xlsx` on the phone. It is parsed **in the browser** with SheetJS (vendored in `vendor/`, no CDN).
- Parsed data, progress, challenges and the badge log live only in that browser's `localStorage` (`mq:data`, `mq:saved`).
- No analytics, no accounts, no server, no network requests with your data. A Content Security Policy in `index.html` only allows same-origin resources.
- More → Settings → **Reset all data** erases everything on the device. **Export my progress** downloads a JSON with level, badges and challenges (no balances).
- `.gitignore` blocks `*.xlsx`, `*.xls`, `*.xlsm`, `*.csv`, `data/` and `.env`.

## Use it

1. Open the site on your phone and add it to the home screen (Safari: Share → Add to Home Screen; Chrome: Install app).
2. Tap **Choose your Excel file to start** and pick the workbook (`.xlsx`).
3. Each month, update the workbook, then tap **Update from Excel**. New months add XP, unlock badges and check last month's challenges.

The app works offline after the first visit (service worker, cache-first).

### What the workbook needs

Sheets and columns are found **by name**, never by position; missing sheets, columns or blank cells are tolerated and listed under More → Your data.

| Sheet | Used for |
|---|---|
| `NW CF` | `Mês`, the account columns, `NW`, `Me %`, `S&P %`, `Δ%`, `CF`, `Income`, `Saved`, `Spending`, `Savings rate`, `Sav pts`, `Emergency months`, `Emerg pts`, `Alloc pts`, `Score`, `Rating` |
| `BASE` | Income by source (`Avô`, `POD`, `Vinted`, `Rugby`, `Outros`, `Dividendos`, `Prendas`; `Ventures` is a subtotal and is skipped), total `Entrada`, and the helper split (`Available €`, `→ Invest`, ...) |
| `DESPESAS` | Spending by category and `Total despesa` |
| `DASHBOARD` | Monthly allocation shares, `Desvio`, `Liquidity Ratio`, the Current Allocation table, the Milestones table |
| `SETTINGS` | Allocation targets, score rules, rating thresholds, projection inputs and scenarios |

Excel's **cached values** are read (the app never recalculates the workbook's score). Investments = Trading212 + Stake + Robinhood; emergency fund = NI T212; lifestyle = Santander; fun money = Activo. Dates are converted from Excel serial numbers with integer arithmetic, so a month can never shift with the phone's time zone.

## How points work (also in the app)

- **Monthly XP** = Score (0–6) × 100, plus +50 if your monthly change beats the S&P 500, +50 if the savings rate reaches the 2-point level in SETTINGS, +100 if the emergency fund reaches its target months. Every month in the file counts; loading the same file again adds nothing.
- **Challenges**: after each upload, three challenges are set for the month after the latest one (a spending category under its last-3-month average, savings rate at target, emergency fund one month closer or beat the S&P 500). A later upload containing that month checks them: done (+75 XP), missed, or no data.
- **Levels**: level *n* needs `round(300 × n^1.5)` total XP. Titles: Rookie (0–1), Saver (2–3), Investor (4–5), Strategist (6–7), Captain (8–9), Legend (10+).
- **Streaks** (most recent months in a row; a missing month ends a run): savings rate at the 1-point level, score at Building or better, beating the S&P 500, spending at or below the trailing 12-month average.
- **Badges** (16): first upload, 3- and 6-month streaks, beat the market, emergency ready, 5k / 10k / 25k net worth, Strong month, perfect month, frugal month, on target (deviation), comeback, 25k / 50k invested, challenger. Unlock months are worked out from the history.
- **Projections** use the SETTINGS inputs and Excel's cached results by default. The sliders on Quest → Map are a local what-if (not saved): future value with monthly compounding and years-to-goal via `ln((G + C/r) / (P + C/r)) / ln(1 + r)`, r = annual / 12.

## Deploy to GitHub Pages

1. Push this folder to a public repository (it holds code only).
2. Settings → Pages → Deploy from a branch → `main` / root.
3. Open `https://<user>.github.io/<repo>/`. All paths are relative, so a sub-path works.
4. On every release bump `VERSION` in `sw.js` so phones fetch the new files.

## Develop

No build step: plain ES modules. Serve the folder with any static server, e.g. `python3 -m http.server`.

- `node tests/run.mjs` runs parser, date, number-format, projection, level and challenge tests on synthetic data. Run it in other time zones too: `TZ=Pacific/Honolulu node tests/run.mjs` and `TZ=Pacific/Auckland node tests/run.mjs`.
- `python3 tools/make_sample.py /tmp/sample.xlsx` writes a workbook with **invented** numbers and the same sheet/column names. Keep it outside the repo.
- `python3 tools/make_icons.py` redraws the PNG icons (Pillow).
- SheetJS: `npm i xlsx` in a temporary folder and copy `dist/xlsx.full.min.js` to `vendor/`.
- Font: Space Grotesk (SIL OFL, `fonts/OFL-SpaceGrotesk.txt`), used for numbers only.

## Design system

Keep these rules when editing. They apply to every screen.

**Look**
- Dark only, true black background (`#000`), panels `#0e0f12` with 1px hairline borders. No light theme, no theme toggle.
- Accent: ice cyan `#7fe3ff` (actions, focus, the current quest node). Rewards: violet `#b4a2ff` (XP, levels, badges). No gold, pitch green or red as brand colours.
- Status colours have one meaning each and always come with a word or an icon: good `#5bd69e`, attention `#f2b443`, information `#6cb6ff`, critical `#ff6b6b`. Gains and losses show an arrow and "Up"/"Down".
- Chart series use the validated categorical order in `styles.css` (`--s1` … `--s8`), legends for 2+ series, one y-axis, hover and keyboard readouts, and a table view.
- Text in the system face (SF Pro on iPhone); numbers in the vendored Space Grotesk with tabular figures. Fixed type scale: 46 / 28 / 20 / 17 / 15 / 13 px. Light weights; bold only for numbers and headings. Sentence case, no letter-spacing on titles (slight negative tracking only on the big numbers).
- No coloured side stripes, emojis, decorative gradients or heavy shadows. Exceptions: badge shine/shadow and the light sweep on the current quest node.
- One stylesheet with custom properties for spacing, type, radius and timing. No late override blocks.
- Line icons drawn for this app, one stroke style (1.75, round). The app mark is an original shield with a coin and a rising path.

**Structure**
- Five bottom tabs: Home, Wealth, Allocation, Spend, Quest. Home opens the app. Settings sit at the bottom of the More page.
- Every page starts with a summary panel that answers the page's question; details sit in blocks that open and close. Never say the same thing twice: link to it instead. Only show what changes a decision.
- Gamification is first-class where it is relevant (level, XP, streak and score on Home; badge progress on Wealth and Allocation; challenges on Spend; quest map on Quest). Quest → Rewards is the full list.
- One kind of selector (segmented control). Nothing looks tappable unless it is.
- Never dim or disable to show unavailability: locked badges stay fully legible with an outline icon, a progress bar and the unlock condition.
- Long lists are split into small groups (quest levels in leagues of 3, recent challenge history capped at 6).

**Touch and motion**
- Tap targets at least 44px, main buttons 52px, translucent pill buttons with radius 14. `touch-action: manipulation` for instant response.
- Pressed elements shrink and spring back; tab icons stretch and squash on tap. Nothing moves linearly. Progress bars grow with a slight overshoot.
- Timing: press 0.16s, tab slide ~28px with fade (0.28s) in the direction of the tab, pages grow out of the tapped card (0.32s) and close back into it, reveals up to 0.7s, full scenes up to 1.2s. New badges pop 0.55 → 1.22 → 1.
- `prefers-reduced-motion`: no animations at all. `prefers-reduced-transparency`: opaque surfaces instead of blur.
- Never `transition: all`; list the properties.
- Behave like a native app: back gesture closes pages (history API), tapping the current tab scrolls to top, sub-tabs keep their scroll position, the tab bar keeps at least 20px plus the safe-area inset from the screen edges.
- Show "Reading file…" and "Saving…" immediately while a workbook loads.

**Writing and numbers**
- English UI, Portuguese number format everywhere: `12 345 €`, `9,5%`, `7,2`. One date style (`October 2026`, `Oct 2026` where space is short).
- Plain language; explain abbreviations (NW, CF, S&P 500, Desvio) in a sentence or the glossary. One word per thing: "net worth", "savings rate", "emergency fund", "invested assets".
- `~` before every approximate value (averages, projections). Averages say how many months they cover, and compare like with like.
- Empty screens and errors say what to do next ("Choose your Excel file to start").
- Typed numbers accept any format: `9,5`, `9.5`, `9 500`, `95%`.
- One score scale everywhere: the workbook's 0–6 score and its rating names.

**Check before shipping**
- Every screen at 390px and 320px wide (and 375×667, landscape): no sideways scrolling, no clipped text, AA contrast, visible 2px focus ring.
- Displayed numbers match the workbook's cached values and agree between pages.
