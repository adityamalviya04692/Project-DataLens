import { useCallback, useEffect, useState } from 'react';
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
  { id: 'overview', label: 'Overview' },
  { id: 'columns', label: 'Columns' },
  { id: 'charts', label: 'Charts' },
  { id: 'sql', label: 'SQL' },
  { id: 'clean', label: 'Clean & export' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Bundled demo file, served from public/sample/. */
const SAMPLE_FILE = 'orders.csv';

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [tab, setTab] = useState<TabId>('overview');

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
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
            <circle cx="14" cy="14" r="7" fill="none" stroke="white" strokeWidth="3" />
            <path d="M19 19l6 6" stroke="white" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span>DataLens</span>
        </button>
        <span className="privacy" title="Files are processed by DuckDB compiled to WebAssembly, inside this tab. Nothing is uploaded.">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.9-4.9 1.4 1.4-6.3 6.3Z" /></svg>
          <span>100% in-browser · nothing is uploaded</span>
        </span>
        <a className="gh" href="https://github.com/adityamalviya04692/datalens" target="_blank" rel="noreferrer">
          GitHub
        </a>
      </header>

      {!showWorkspace && (
        <main className="landing">
          <section className="hero">
            <h1>Drop a dataset. Get answers in seconds.</h1>
            <p>
              Instant profiling, a data quality score, plain-English insights, a dozen auto-generated charts, a SQL
              console and one-click cleaning, powered by DuckDB running inside your browser.
            </p>
          </section>
          <Dropzone onFile={onFile} onSample={onSample} busy={phase.kind === 'loading'} />
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
          <ul className="features">
            <li><b>Profile</b><span>Types, nulls, cardinality, quartiles and outliers for every column.</span></li>
            <li><b>Score</b><span>Completeness, uniqueness, validity and consistency, rolled into a 0–100 score.</span></li>
            <li><b>Insights</b><span>Skew, seasonality, correlations and dominant values, in plain English.</span></li>
            <li><b>Visualise</b><span>Trends, box plots, scatter and stacked charts chosen from the column types.</span></li>
            <li><b>Clean</b><span>Dedupe, trim, fix types, then export to Parquet or CSV.</span></li>
          </ul>
        </main>
      )}

      {showWorkspace && (
        <main className="workspace">
          <section className="summary">
            <div className="file">
              <h2 title={dataset.fileName}>{dataset.fileName}</h2>
              <p>
                {dataset.profile.rows.toLocaleString('en-US')} rows · {dataset.profile.columns.length} columns ·{' '}
                {formatBytes(dataset.sizeBytes)} · loaded in {Math.round(dataset.loadMs)} ms, profiled in{' '}
                {Math.round(dataset.profile.elapsedMs)} ms
              </p>
            </div>
            <div className="actions">
              <button className="btn" onClick={downloadReport}>Download report</button>
              <button className="btn ghost" onClick={reset}>New file</button>
            </div>
          </section>

          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                {t.label}
                {t.id === 'overview' && dataset.quality.issues.length > 0 && <span className="count">{dataset.quality.issues.length}</span>}
              </button>
            ))}
          </nav>

          <div className="panel">
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
        Built with DuckDB-WASM, React and ECharts · <a href="https://github.com/adityamalviya04692" target="_blank" rel="noreferrer">Aditya Malviya</a>
      </footer>
    </div>
  );
}
