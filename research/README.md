# AI analyst reports

Reports written by Claude Code with the `research-stock` skill are stored as `reports/<SYMBOL>/<YYYY-MM-DD>.md`.

Each figure in a report is a citation such as `[25.1%](#ref=ratio.FY2026.operatingMargin)`. Running `node cli/research.js verify <report>` checks every citation against the data.
