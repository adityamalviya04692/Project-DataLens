import { useCallback, useEffect, useRef, useState } from 'react';
import { getDb, loadBytes } from './lib/duckdb';
import { strongestContinuousPair } from './lib/charts';
import { profileTable } from './lib/profile';
import { buildInsights, type Insight, type InsightExtras } from './lib/insights';
import { loadExtras } from './lib/insightsData';
import { assessQuality } from './lib/quality';
import { buildHtmlReport } from './lib/report';
import { baseName, downloadFile, formatBytes } from './lib/download';
import type { DatasetProfile, QualityReport } from './lib/types';
import Dropzone from './components/Dropzone';
import Overview from './components/Overview';
import ColumnsTable from './components/ColumnsTable';
import ChartsPanel from './components/ChartsPanel';
import SqlConsole from './components/SqlConsole';
import CleanPanel from './components/CleanPanel';

export interface Dataset {
  fileName: string;
  sizeBytes: number;
  loadMs: number;
  profile: DatasetProfile;
  quality: QualityReport;
  extras: InsightExtras;
  insights: Insight[];
}

type Phase = { kind: 'idle' } | { kind: 'loading'; message: string } | { kind: 'ready' } | { kind: 'error'; message: string };

const TABS = [
  { id: 'overview', label: 'Overview & health', icon: 'overview' },
  { id: 'columns', label: 'Column profiler', icon: 'columns' },
  { id: 'charts', label: 'Visualizations', icon: 'charts' },
  { id: 'sql', label: 'SQL console', icon: 'sql' },
  { id: 'clean', label: 'Transform & clean', icon: 'clean' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Bundled demo file, served from public/sample/. */
const SAMPLE_FILE = 'orders.csv';

function BrandLogo({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-logo" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" fill="#6c35f4" stroke="#000" strokeWidth="2" />
      <circle cx="14" cy="14" r="6.25" fill="none" stroke="#fff" strokeWidth="2.5" />
      <path d="m18.5 18.5 7 7" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="square" />
      <path d="M11.5 14h5M14 11.5v5" stroke="#efe904" strokeWidth="1.5" />
    </svg>
  );
}

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const panel = useRef<HTMLDivElement>(null);
  const panelMotion = useRef<Animation | null>(null);

  useEffect(() => () => panelMotion.current?.cancel(), []);

  function selectTab(next: TabId, pointerInitiated: boolean) {
    if (next === tab) return;
    panelMotion.current?.cancel();
    setTab(next);
    if (pointerInitiated && panel.current && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      panelMotion.current = panel.current.animate(
        [{ opacity: 0.6, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 180, easing: getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim() },
      );
    }
  }

  // Warm up the engine while the user is choosing a file.
  useEffect(() => {
    getDb().catch(() => undefined);
  }, []);

  const load = useCallback(async (fileName: string, read: () => Promise<Uint8Array>) => {
    try {
      setPhase({ kind: 'loading', message: 'Starting DuckDB engine…' });
      await getDb();
      setPhase({ kind: 'loading', message: `Reading ${fileName}…` });
      const t0 = performance.now();
      const bytes = await read();
      // Read the size first: registering the buffer transfers it to the worker.
      const sizeBytes = bytes.byteLength;
      await loadBytes(bytes, fileName);
      const loadMs = performance.now() - t0;
      setPhase({ kind: 'loading', message: 'Profiling columns and running quality checks…' });
      const profile = await profileTable('data');
      const quality = assessQuality(profile);
      setPhase({ kind: 'loading', message: 'Finding insights…' });
      const extras = await loadExtras(profile);
      setDataset({ fileName, sizeBytes, loadMs, profile, quality, extras, insights: buildInsights(profile, quality, extras) });
      setTab('overview');
      setPhase({ kind: 'ready' });
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const onFile = (file: File) => load(file.name, async () => new Uint8Array(await file.arrayBuffer()));

  const onSample = () =>
    load(SAMPLE_FILE, async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}sample/${SAMPLE_FILE}`);
      if (!res.ok) throw new Error(`Could not fetch sample (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    });

  const reset = () => {
    setDataset(null);
    setPhase({ kind: 'idle' });
  };

  const downloadReport = () => {
    if (!dataset) return;
    const html = buildHtmlReport(dataset.fileName, dataset.profile, dataset.quality, new Date(), dataset.insights);
    downloadFile(html, `${baseName(dataset.fileName)}_quality_report.html`, 'text/html');
  };

  const showWorkspace = dataset && phase.kind === 'ready';

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={reset} aria-label="DataLens home">
          <BrandLogo />
          <span>DATALENS</span>
        </button>
        <span className="privacy" title="Files are processed by DuckDB compiled to WebAssembly, inside this tab. Nothing is uploaded.">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.9-4.9 1.4 1.4-6.3 6.3Z" /></svg>
          <span>100% IN-BROWSER · DUCKDB-WASM</span>
        </span>
        <nav className="topnav" aria-label="Primary navigation">
          <button className="topnav-active" onClick={reset}>Overview</button>
          <a href="#capabilities">Profiler results</a>
          <a href="#capabilities">Sample datasets</a>
          <a href="#capabilities">SQL &amp; visualizations</a>
          <a href="https://github.com/adityamalviya04692/datalens#readme" target="_blank" rel="noreferrer">Docs &amp; architecture</a>
        </nav>
        <a className="gh" href="https://github.com/adityamalviya04692/datalens" target="_blank" rel="noreferrer">
          <span aria-hidden="true">&lt;&gt;</span> GITHUB
        </a>
      </header>

      {!showWorkspace && (
        <main className="landing">
          <section className="hero">
            <div className="trust-row" aria-label="Privacy and performance guarantees">
              <span><i />100% in-browser</span>
              <span>◈ No telemetry</span>
              <span>ϟ Zero cloud latency</span>
              <span>▧ Files stay on your machine</span>
            </div>
            <h1><span>Drop a dataset.</span> <em>Get answers in seconds.</em></h1>
            <p>
              Instant profiling, a data quality score, plain-English insights, a dozen auto-generated charts, a SQL
              console and one-click cleaning, powered by DuckDB running inside your browser.
            </p>
          </section>
          <section className="upload-card" aria-label="Upload a dataset">
            <Dropzone onFile={onFile} onSample={onSample} busy={phase.kind === 'loading'} />
          </section>
          <div className="engine-strip" aria-label="Local engine capabilities">
            <span><i />DuckDB-WASM 1.1 <small>· Multi-threaded SIMD execution</small></span>
            <span><i />Up to 50M rows in-memory</span>
            <span><b>0</b> network egress</span>
          </div>
          {phase.kind === 'loading' && (
            <div className="status" role="status">
              <span className="spinner" aria-hidden="true" /> {phase.message}
            </div>
          )}
          {phase.kind === 'error' && (
            <div className="status error" role="alert">
              {phase.message}
            </div>
          )}
          <section className="capabilities" id="capabilities">
            <div className="section-kicker">Zero setup analytics</div>
            <div className="section-title-row">
              <h2>Everything computed automatically on ingest</h2>
              <code>SELECT * FROM dataset</code>
            </div>
            <ul className="features">
              <li className="feature-profile"><span className="feature-icon">▥</span><code>schema_eval</code><b>Profile</b><span>Types, nulls, cardinality, quartiles and outliers for every column.</span><div className="feature-preview mini-schema"><i /><i /><i /></div></li>
              <li className="feature-score"><span className="feature-icon">◎</span><code>Grade A</code><b>Score</b><span>Completeness, uniqueness, validity and consistency, rolled into a 0–100 score.</span><div className="feature-preview score-preview"><strong>94<small>/100</small></strong><i /></div></li>
              <li className="feature-insights"><span className="feature-icon">◉</span><code>auto-heuristics</code><b>Insights</b><span>Skew, seasonality, correlations and dominant values, in plain English.</span><div className="feature-preview">↗ Strong positive correlation <small>(r = 0.87)</small></div></li>
              <li className="feature-visual"><span className="feature-icon">▥</span><code>12 charts ready</code><b>Visualise</b><span>Trends, box plots, scatter and stacked charts chosen from the column types.</span><div className="feature-preview sparkline"><i /></div></li>
              <li className="feature-clean"><span className="feature-icon">✣</span><code>1-click recipes</code><b>Clean</b><span>Dedupe, trim, fix types, then export to Parquet or CSV.</span><div className="feature-preview clean-preview"><span>✓ dedupe()</span><span>✓ trim()</span><span>✓ cast()</span></div></li>
            </ul>
          </section>
          <section className="guarantee">
            <div>
              <h2><span aria-hidden="true">♢</span> The Zero-Cloud Guarantee</h2>
              <p>DataLens loads DuckDB compiled to WebAssembly directly in your browser. Your raw data never reaches our servers, third-party APIs or logging pipelines.</p>
            </div>
            <a className="btn ghost" href="https://github.com/adityamalviya04692/datalens#privacy" target="_blank" rel="noreferrer">Architecture notes</a>
          </section>
        </main>
      )}

      {showWorkspace && (
        <main className="workspace">
          <section className="summary">
            <span className="summary-icon" aria-hidden="true">▤</span>
            <div className="file">
              <div className="file-title-row">
                <h2 title={dataset.fileName}>{dataset.fileName}</h2>
                <span className="file-type">{dataset.fileName.split('.').pop()?.toUpperCase() ?? 'DATA'}</span>
                <span className={`quality-pill ${dataset.quality.score >= 85 ? 'good' : dataset.quality.score >= 65 ? 'ok' : 'bad'}`}>
                  <i />Grade {dataset.quality.grade} · {dataset.quality.score.toFixed(0)}/100 quality
                </span>
              </div>
              <p>
                {dataset.profile.rows.toLocaleString('en-US')} rows · {dataset.profile.columns.length} columns ·{' '}
                {formatBytes(dataset.sizeBytes)} · loaded in {Math.round(dataset.loadMs)} ms, profiled in{' '}
                {Math.round(dataset.profile.elapsedMs)} ms
              </p>
            </div>
            <div className="actions">
              <button className="btn ghost" onClick={reset}>＋ New dataset</button>
              <button className="btn" onClick={downloadReport}>↓ Export report</button>
            </div>
          </section>

          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={(event) => selectTab(t.id, event.detail > 0)}>
                <span className={`tab-icon ${t.icon}`} aria-hidden="true" />
                {t.label}
                {t.id === 'overview' && dataset.quality.issues.length > 0 && <span className="count">{dataset.quality.issues.length}</span>}
              </button>
            ))}
          </nav>

          <div className="panel" ref={panel}>
            {tab === 'overview' && <Overview dataset={dataset} />}
            {tab === 'columns' && <ColumnsTable profile={dataset.profile} quality={dataset.quality} />}
            {tab === 'charts' && (
              <ChartsPanel
                profile={dataset.profile}
                pair={strongestContinuousPair(dataset.profile, dataset.extras.correlations)}
              />
            )}
            {tab === 'sql' && <SqlConsole profile={dataset.profile} />}
            {tab === 'clean' && <CleanPanel dataset={dataset} />}
          </div>
        </main>
      )}

      <footer className="footer">
        <span>♢ &nbsp;Built with DuckDB-WASM, React and Apache ECharts · <a href="https://github.com/adityamalviya04692" target="_blank" rel="noreferrer">Aditya Malviya</a></span>
        <span><a href="https://github.com/adityamalviya04692/datalens#readme" target="_blank" rel="noreferrer">Documentation</a> · <a href="https://github.com/adityamalviya04692/datalens" target="_blank" rel="noreferrer">GitHub repository</a> · Zero-cloud by design</span>
      </footer>
    </div>
  );
}
