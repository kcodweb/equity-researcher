# Research reference

## Citation refs

Cite as `[figure](#ref=<ref>)`. The CLI prints the ref next to every figure; `node cli/research.js ref <SYM> <ref>` resolves one.

| Ref | Meaning |
|---|---|
| `quote.price`, `quote.marketCap`, `quote.trailingPE`, `quote.ttm.roe` | Market data / trailing twelve months |
| `fin.FY2025.revenue`, `fin.Q2026-06.netIncome` | Statement line items (keys from `financials`) |
| `ratio.FY2025.operatingMargin`, `ratio.latest.roic` | Ratios (keys from `ratios`) |
| `growth.revenue.5y`, `growth.eps.full` | CAGRs (3y / 5y / 10y / full) |
| `score.piotroski`, `score.altman`, `score.beneish`, `score.value` | Scores |
| `flags.count`, `flags.serious` | Red-flag counts |
| `val.base`, `val.upside`, `val.impliedGrowth`, `val.mc.p50`, `val.mc.probAbove` | Default valuation |
| `val.pe.current`, `val.pe.mean`, `val.pe.percentile`, `val.evEbitda.mean` | Multiples vs own history |
| `val.inputs.growth`, `val.inputs.discountRate` | Default DCF inputs |
| `dcf[g=0.08,r=0.1,tg=0.03,…].perShare` | Your own DCF (copy the exact prefix `dcf` prints); `.growth`, `.discountRate`, `.terminalGrowth` cite its assumptions |
| `risk.beta`, `risk.maxDrawdown`, `risk.ret.3Y`, `risk.bench.3Y`, `risk.tech.rsi14` | Risk and returns |
| `peer[INFY.NS].operatingMargin` | Peer figures from `peers` |
| `holders.insidersPct`, `est.+1y.growth` | Ownership, consensus |
| `TCS.NS:ratio.latest.roe` | Any ref for another company |
| `filing.risk`, `filing.mdna@1` | Verbatim quote from the latest (or Nth previous) 10-K |

Link text must be the figure alone, as printed: `[$416B](#ref=fin.FY2025.revenue)`, not `[revenue of $416B](…)`.

## Report template

```markdown
---
symbol: TCS.NS
name: Tata Consultancy Services Limited
date: 2026-09-24
analyst: Claude (<model>)
depth: standard
price: 2075.00
currency: INR
verdict: Undervalued        # Undervalued | Fairly valued | Overvalued
conviction: medium          # low | medium | high
fair_value: { bear: 1600, base: 2300, bull: 2900 }   # your own scenarios, per share
one_liner: "One sentence a busy reader needs."
monitor:                    # thesis-compatible KPIs (metric keys from `thesis`)
  - { name: "Margins hold", metric: operatingMargin, op: ">=", value: 0.24, why: "..." }
---

## Verdict
2–4 sentences: the view, the key evidence, the price vs your fair-value range.

## The debate
What the market believes (reverse DCF, multiples vs history, consensus) vs what the evidence says. This is the core of the note.

## Business & moat
How it makes money; evidence for/against durable advantage (returns on capital, margin stability, share). Moat: None / Narrow / Wide.

## Financial quality
Growth quality, margins, cash conversion, balance sheet, capital allocation.

## Forensic read
Which flags/scores matter and which are explainable, with evidence.

## Valuation
Your scenarios (cite your `dcf` runs), what each assumes, and why. Cross-check with multiples and peers.

## Bull case / Bear case
Three bullets each, each tied to a measurable driver.

## Key risks
Ranked.

## What to monitor
The KPIs from the frontmatter, with thresholds and why they matter.

## Open questions
What you could not resolve and would check next (deep: questions for management).

## Sources
External links used (filings, annual reports, transcripts, articles).
```
