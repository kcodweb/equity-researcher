import { useMemo, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { generateNote } from '../../../core/ai/gemini.js';
import { fmtDate } from '../../../core/format.js';
import { Card, Loading } from '../components/ui.jsx';
import { useSettings, useIndex, fetchAnnualReportText, fileKey } from '../lib/store.js';

function loadCached(symbol) {
  try { return JSON.parse(localStorage.getItem(`er:note:${fileKey(symbol)}`) || 'null'); } catch { return null; }
}
function saveCached(symbol, note) {
  try { localStorage.setItem(`er:note:${fileKey(symbol)}`, JSON.stringify(note)); } catch { /* ignore */ }
}

export default function AiNote({ data, a, symbol, thesis, workerUrl }) {
  const settings = useSettings();
  const index = useIndex();
  const [local, setLocal] = useState(() => loadCached(symbol));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // Show whichever note is newer: the daily build's or one generated in this browser.
  const note = [data.aiNote, local].filter(Boolean).sort((x, y) => y.generatedAt.localeCompare(x.generatedAt))[0] || null;
  const html = useMemo(() => (note ? DOMPurify.sanitize(marked.parse(note.markdown)) : ''), [note]);

  const generate = async () => {
    setError('');
    try {
      let filingText = '';
      if (data.market === 'US' && workerUrl) {
        setBusy('Reading the latest 10-K…');
        filingText = await fetchAnnualReportText(workerUrl, data);
      }
      setBusy('Gemini is writing the note — this takes 20–60 seconds…');
      const out = await generateNote({
        data, analysis: a, thesis, filingText,
        apiKey: settings.geminiKey,
        model: settings.geminiModel || index?.ai?.model || 'gemini-3.8-flash',
        fallbackModel: index?.ai?.fallbackModel || 'gemini-3.5-flash-lite',
        googleSearch: true,
      });
      out.local = true;
      saveCached(symbol, out);
      setLocal(out);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="stack">
      <Card
        title="AI research note"
        sub={note ? `${note.local ? 'Generated in this browser' : 'From the daily build'} · ${note.model}${note.grounded ? ' · Google Search grounded' : ''}${note.usedFiling ? ' · read the latest 10-K' : ''} · ${fmtDate(note.generatedAt)}` : 'Written by Gemini from the data on this page'}
        right={(
          <button className="btn primary" onClick={generate} disabled={!!busy || !settings.geminiKey} title={settings.geminiKey ? '' : 'Add a Gemini API key in Settings'}>
            {note ? 'Regenerate' : 'Generate note'}
          </button>
        )}
      >
        {!settings.geminiKey && (
          <div className="notice" style={{ marginBottom: 12 }}>
            To generate notes on demand, add a free Gemini API key in <a href="#/settings">Settings</a>.
            {!data.aiNote && ' Watchlist stocks also get notes automatically from the daily build once the GEMINI_API_KEY secret is set.'}
          </div>
        )}
        {busy && <Loading text={busy} />}
        {error && <div className="notice err" style={{ marginBottom: 12 }}>Gemini error: {error}</div>}
        {!busy && note && <div className="md" dangerouslySetInnerHTML={{ __html: html }} />}
        {!busy && !note && settings.geminiKey && <div className="muted">No note yet — click Generate note.</div>}
        {note?.sources?.length > 0 && (
          <>
            <hr />
            <div className="small">
              <b>Search sources</b>
              <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {note.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a></li>)}
              </ol>
            </div>
          </>
        )}
      </Card>
      <div className="small muted">AI output can be wrong. Every figure it was given is on the other tabs — check claims against them and the filings.</div>
    </div>
  );
}
