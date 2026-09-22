import { useState } from 'react';
import { useSettings, setSettings, useIndex, workerUrlFrom } from '../lib/store.js';
import { Card, Seg } from '../components/ui.jsx';

export default function Settings() {
  const s = useSettings();
  const index = useIndex();
  const [worker, setWorker] = useState(s.workerUrl);
  const [key, setKey] = useState(s.geminiKey);
  const [model, setModel] = useState(s.geminiModel);
  const [test, setTest] = useState(null);
  const effectiveWorker = workerUrlFrom({ workerUrl: worker }, index);

  const testWorker = async () => {
    setTest('Testing…');
    try {
      const r = await fetch(`${effectiveWorker}/yahoo/v8/finance/chart/AAPL?range=5d&interval=1d`);
      setTest(r.ok ? '✓ Proxy is working' : `✗ Proxy returned HTTP ${r.status}`);
    } catch (e) {
      setTest(`✗ ${e.message}`);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 22 }}>Settings</h1>
      <p className="text2">Stored only in this browser. Nothing here is sent anywhere except the services named.</p>

      <Card title="Appearance">
        <Seg options={[['', 'System'], ['light', 'Light'], ['dark', 'Dark']]} value={s.theme} onChange={(v) => setSettings({ theme: v })} />
      </Card>

      <Card title="Live data proxy" sub="A Cloudflare Worker that lets the site look up any ticker (see README)">
        <div className="stack" style={{ gap: 10 }}>
          <div className="field">
            <label htmlFor="worker">Worker URL</label>
            <input id="worker" type="url" placeholder={index?.workerUrl || 'https://equity-researcher-proxy.<you>.workers.dev'} value={worker} onChange={(e) => setWorker(e.target.value.trim())} />
            <span className="hint">
              {index?.workerUrl ? `Default from config.yml: ${index.workerUrl}. Leave empty to use it.` : 'Set workerUrl in config.yml to make this the default for every visitor.'}
            </span>
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => setSettings({ workerUrl: worker })}>Save</button>
            <button className="btn" onClick={testWorker} disabled={!effectiveWorker}>Test connection</button>
            {test && <span className="text2">{test}</span>}
          </div>
        </div>
      </Card>

      <Card title="Gemini API key" sub="For generating AI research notes on demand in this browser">
        <div className="stack" style={{ gap: 10 }}>
          <div className="field">
            <label htmlFor="gkey">API key</label>
            <input id="gkey" type="password" autoComplete="off" placeholder="AIza…" value={key} onChange={(e) => setKey(e.target.value.trim())} />
            <span className="hint">
              Free key from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>. Sent only to Google's Gemini API, directly from your browser.
            </span>
          </div>
          <div className="field">
            <label htmlFor="gmodel">Model</label>
            <input id="gmodel" type="text" placeholder={index?.ai?.model || 'gemini-3.8-flash'} value={model} onChange={(e) => setModel(e.target.value.trim())} />
            <span className="hint">Flash models are free with daily limits; Flash-Lite allows many more requests per day.</span>
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => setSettings({ geminiKey: key, geminiModel: model })}>Save</button>
            {s.geminiKey && <button className="btn" onClick={() => { setKey(''); setSettings({ geminiKey: '' }); }}>Remove key</button>}
          </div>
        </div>
      </Card>
    </div>
  );
}
