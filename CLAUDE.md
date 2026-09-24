# Equity Researcher

Equity research workbench for US and Indian stocks: a shared JS analysis engine, a static React site on GitHub Pages, a daily GitHub Action, and Claude Code as the AI analyst.

## Layout

- `core/`: the engine, pure JS with no Node or browser-only APIs, shared by every entry point
  - `sources/`: Yahoo Finance and SEC EDGAR clients
  - `research.js`: builds one raw dataset per ticker
  - `analysis/`: ratios, forensics (Piotroski/Altman/Beneish/red flags), valuation (DCF, reverse DCF, Monte Carlo, multiples), risk, thesis
  - `refs.js`: citation refs, their resolver and the report fact-checker
- `cli/research.js`: the research CLI, which is Claude's tool layer. Run `node cli/research.js help`.
- `pipeline/build.js`: the daily build. It writes `site/public/data/*.json`, which is generated, so don't hand-edit it.
- `site/`: React + Vite front end with hash routing.
- `worker/`: Cloudflare Worker proxy for live lookups (not deployed yet).
- `theses/<SYM>.yml`: investment theses checked on every build.
- `research/reports/<SYM>/<date>.md`: AI analyst reports.
- `config.yml`: watchlist, peers, valuation defaults.

## Researching stocks

Use the `research-stock` skill (`/research-stock NVDA`, or `/research-stock "hdfc bank" deep`). For quick questions, call the CLI directly:

```bash
node cli/research.js snapshot TCS.NS
node cli/research.js dcf AAPL --growth 0.07 --discount 0.095 --terminal 0.025
node cli/research.js filing NVDA --find "customer concentration"
node cli/research.js compare TCS.NS,INFY.NS,HCLTECH.NS
node cli/research.js verify research/reports/NVDA/2026-09-24.md
```

Rules for any analysis:
- Use only figures from the CLI or cited sources.
- Cite as `[figure](#ref=<ref>)`.
- Run `verify` before calling a report done.

Data is cached for 6 hours in `.cache/`; add `--fresh` to refetch.

## Commands

- `npm run dev`: site at localhost:5173
- `npm run pipeline`: research the whole watchlist
- `npm run refresh -- AAPL,TCS.NS`: refresh only some tickers
- `npm run build`: production build into `dist/`

## Conventions and gotchas

- Write JavaScript only; don't add Python. `core/` must stay runnable in the browser and in the Worker.
- Indian tickers use `.NS`/`.BO` and get about 4 years of annual data from Yahoo. Some companies, such as Infosys, report in USD; `research.js` converts statements and TTM figures to the trading currency.
- Per-share history is restated for splits and bonus issues (`adjustForSplits`, `adjustUnrestatedYahoo`).
- Yahoo's own "free cash flow" and EV multiples can be wrong. Prefer values computed from statements (`ttmFcf`), and use `sanitizeMultiples`.
- Financial companies (`isFinancialCompany`) skip gross margin, ROIC, Altman, Beneish and FCF DCF.
- The daily Action commits data to `main`, so run `git pull --rebase` before pushing.
