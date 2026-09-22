import { Card } from '../components/ui.jsx';

export default function About() {
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 22 }}>Method</h1>
      <p className="text2">How every number on this site is produced, so you can audit it.</p>

      <Card title="Data sources">
        <ul className="text2" style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>US companies:</b> annual statements come from SEC EDGAR XBRL “company facts” (10+ years). Every figure links to the filing it came from. Per-share values are restated for later stock splits. Yahoo Finance fills gaps and supplies quarterly data, prices, estimates and ownership.</li>
          <li><b>Indian companies (.NS / .BO):</b> Yahoo Finance — about 4 years of annual and 5 quarters of results. Bonus issues and splits are detected and restated automatically.</li>
          <li><b>Promoter / insider holding trend</b> is built up by the daily job (Yahoo only provides a snapshot), so it gets richer over time.</li>
          <li>Prices are daily; returns use dividend-adjusted closes; benchmarks are the S&amp;P 500 and Nifty 50.</li>
        </ul>
      </Card>

      <Card title="Quality & forensic scores">
        <dl className="text2" style={{ margin: 0 }}>
          <dt><b>Piotroski F-score (0–9)</b></dt>
          <dd style={{ margin: '0 0 10px' }}>Nine pass/fail tests on profitability (ROA, cash flow, ΔROA, accruals), balance sheet (leverage, liquidity, dilution) and efficiency (gross margin, asset turnover). 7+ strong, 3 or less weak. Banks skip the liquidity and gross-margin tests.</dd>
          <dt><b>Altman Z-score</b></dt>
          <dd style={{ margin: '0 0 10px' }}>1.2·WC/TA + 1.4·RE/TA + 3.3·EBIT/TA + 0.6·MVE/TL + 1.0·Sales/TA. Above 2.99 safe, 1.81–2.99 grey, below 1.81 distress. Not meaningful for banks.</dd>
          <dt><b>Beneish M-score</b></dt>
          <dd style={{ margin: '0 0 10px' }}>Eight-variable model of earnings manipulation (receivables, margins, asset quality, sales growth, depreciation, SG&amp;A, leverage, accruals). Above −1.78 flags likely manipulation; hypergrowth companies trip it often, so that case is downgraded to a warning.</dd>
          <dt><b>Red-flag scan</b></dt>
          <dd style={{ margin: 0 }}>Rules for cash conversion, accruals, receivables and inventory vs. sales, leverage, interest cover, dilution, stock-comp, payouts above FCF, tax-rate swings, goodwill, margin erosion and falling promoter/insider holding. Severity: critical, serious, warning.</dd>
        </dl>
      </Card>

      <Card title="Valuation lab">
        <ul className="text2" style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>DCF:</b> starting free cash flow (or net income for banks and cash-burning firms) grows at the chosen rate for 5 years, fades linearly to terminal growth over 5 more, then a Gordon-growth terminal value. Discount rate = risk-free + β × equity risk premium (β measured vs. the index, clamped 0.6–2).</li>
          <li><b>Reverse DCF:</b> solves for the growth rate that makes the DCF equal today's price — what the market is assuming.</li>
          <li><b>Monte Carlo:</b> thousands of DCF runs with growth, discount rate, terminal growth and the starting cash flow drawn from normal distributions around your inputs.</li>
          <li><b>Multiple bands:</b> month-end P/E, P/S, P/B, P/FCF and EV/EBITDA using the latest annual report available at each date (60-day lag to avoid look-ahead); mean ±1σ after trimming outliers.</li>
          <li><b>Also:</b> Graham number √(22.5·EPS·BVPS), justified P/B = (ROE − g)/(r − g), value at the historical mean P/E, and analyst targets.</li>
        </ul>
      </Card>

      <Card title="Thesis tracker">
        <p className="text2">Write your thesis and the measurable KPIs that would prove it wrong. Every build (and every page view) checks them: <b>intact</b> when all hold, <b>at risk</b> when some break, <b>broken</b> when half or more break. Commit theses to <code>theses/SYMBOL.yml</code> for the daily job, or keep drafts in this browser from the Thesis tab.</p>
      </Card>

      <Card title="AI notes">
        <p className="text2" style={{ margin: 0 }}>Gemini receives a data pack with the figures on this site (and, for US companies, the Business, Risk Factors and MD&amp;A sections of the latest 10-K). It is instructed to use only those figures, to cite any search results, and to say when data is missing. Treat notes as a starting point for your own work.</p>
      </Card>
    </div>
  );
}
