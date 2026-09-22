# Equity Researcher

A deep-dive equity research workbench for US and Indian stocks. It runs as a static site on GitHub Pages, and a GitHub Action refreshes the research every weekday.

**What it does for each stock**

- **Financials:** 10+ years of SEC-sourced statements for US companies, with every figure linked to the filing it came from. Indian companies get 4 years plus quarterly results. Statements download as CSV.
- **Quality and forensics:** Piotroski F-score, Altman Z-score, Beneish M-score, a scan of about 20 red-flag rules, DuPont analysis, and about 45 ratios over time.
- **Valuation lab:** bear/base/bull DCF with sliders, reverse DCF (the growth rate the current price implies), two sensitivity grids, a Monte Carlo simulation, P/E and EV/EBITDA bands against the stock's own history, and a chart comparing every valuation method.
- **Risk:** beta, volatility, drawdowns, VaR, Sharpe and Sortino ratios, up/down capture, calendar-year returns against the S&P 500 or Nifty 50, and technical indicators.
- **Peers, ownership and analysts:** peer percentiles, institutional and insider holdings, promoter-holding trend (India), earnings surprises, consensus estimates and rating changes.
- **Thesis tracker:** you write measurable KPIs, and every build checks them. Each thesis shows as intact, at risk or broken.
- **AI note:** Gemini writes an analyst-style initiation note. For US companies it also reads the Business, Risk Factors and MD&A sections of the latest 10-K.
- **Live lookup:** any other ticker can be researched on demand through a free Cloudflare Worker.

## Architecture

```
core/        Shared JS engine, used by the pipeline, the browser and the worker
  sources/   Yahoo Finance and SEC EDGAR clients
  analysis/  Ratios, forensics, valuation, risk, thesis
  ai/        Gemini prompt and client
pipeline/    Daily build: researches the watchlist and writes site/public/data/*.json
site/        React + Vite front end (hash routing, so it works at any Pages path)
worker/      Cloudflare Worker: a narrow, cached CORS proxy for Yahoo and SEC
theses/      Your theses, one YAML file per ticker
config.yml   Watchlist, peer lists, valuation defaults, AI settings
```

## Run locally

```bash
npm install
npm run pipeline            # research the watchlist (add GEMINI_API_KEY to the environment for AI notes)
npm run dev                 # http://localhost:5173
```

To refresh only some tickers: `node pipeline/build.js --only AAPL,TCS.NS`. Add `--no-ai` to skip Gemini.

## Deploy on GitHub Pages

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages → Source** and choose **GitHub Actions**.
3. Under **Settings → Secrets and variables → Actions**, add:
   - `GEMINI_API_KEY`: a free key from https://aistudio.google.com/apikey (optional; turns on AI notes)
   - `SEC_USER_AGENT`: for example `YourName your@email.com`. The SEC asks automated clients to identify themselves.
4. Open **Actions → Daily research → Run workflow**. Once the first run finishes, the site is live at `https://<user>.github.io/<repo>/`.

## Live lookup: deploy the Cloudflare Worker (free)

```bash
cd worker
npx wrangler login          # one-time browser sign-in to Cloudflare
npx wrangler deploy
```

Then:

1. Put the printed `https://equity-researcher-proxy.<you>.workers.dev` URL in `config.yml` as `workerUrl`.
2. In `worker/wrangler.toml`, set `ALLOWED_ORIGINS` to your Pages origin (for example `https://<user>.github.io`) and `SEC_USER_AGENT` to your contact.
3. Run `npx wrangler deploy` again.

The free plan allows 100,000 requests a day, and responses are cached at the edge.

## Add stocks and theses

- **Add a stock:** add it under `watchlist:` in `config.yml`. Use `.NS` for NSE and `.BO` for BSE, and add optional `peers:`.
- **Add a thesis:** create `theses/SYMBOL.yml`; see `theses/AAPL.yml`. The site's Thesis tab has an editor that produces this YAML for you.

## Data notes and limits

- Yahoo Finance is an unofficial source. Endpoints occasionally change or rate-limit, and every data source degrades on its own without breaking the page.
- Indian data covers about 4 years. The promoter-holding trend starts building from the first daily run.
- Statements reported in another currency (for example Infosys in USD) are converted at the current FX rate.
- Per-share history is restated for splits and bonus issues.
- This is a research tool, not investment advice. Verify figures against the filings.
