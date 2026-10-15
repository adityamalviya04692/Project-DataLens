import { useMemo, useState } from 'react';
import type { Dataset } from '../App';
import { buildCleanSql, DEFAULT_CLEAN_OPTIONS, type CleanOptions } from '../lib/clean';
import { exec, exportTable } from '../lib/duckdb';
import { baseName, downloadFile } from '../lib/download';
import { profileTable } from '../lib/profile';
import { assessQuality, isNumericText } from '../lib/quality';
import type { DatasetProfile, QualityReport } from '../lib/types';
import { DimensionBars, ScoreRing } from './Overview';

const CLEAN_TABLE = 'clean';

interface Result {
  profile: DatasetProfile;
  quality: QualityReport;
  ms: number;
}

const fmt = (n: number) => n.toLocaleString('en-US');

export default function CleanPanel({ dataset }: { dataset: Dataset }) {
  const { profile, quality } = dataset;
  const [opts, setOpts] = useState<CleanOptions>(DEFAULT_CLEAN_OPTIONS);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sql = useMemo(() => buildCleanSql(profile, opts, CLEAN_TABLE), [profile, opts]);

  const facts = useMemo(() => {
    const text = profile.columns.filter((c) => c.kind === 'text');
    return {
      whitespace: text.reduce((s, c) => s + c.whitespace, 0),
      empty: text.reduce((s, c) => s + c.empty, 0),
      numericText: profile.columns.filter(isNumericText).map((c) => c.name),
      emptyCols: profile.columns.filter((c) => c.count === 0).map((c) => c.name),
    };
  }, [profile]);

  const options: { key: keyof CleanOptions; label: string; detail: string }[] = [
    { key: 'dedupe', label: 'Remove duplicate rows', detail: `${fmt(profile.duplicateRows)} exact duplicates (more may appear after trimming)` },
    { key: 'trimText', label: 'Trim whitespace', detail: `${fmt(facts.whitespace)} values with leading/trailing spaces` },
    { key: 'emptyToNull', label: 'Blank strings → NULL', detail: `${fmt(facts.empty)} blank values` },
    { key: 'castNumericText', label: 'Fix numbers stored as text', detail: facts.numericText.length ? `TRY_CAST ${facts.numericText.join(', ')} to DOUBLE (bad values become NULL)` : 'No affected columns' },
    { key: 'dropEmptyColumns', label: 'Drop empty columns', detail: facts.emptyCols.length ? facts.emptyCols.join(', ') : 'No empty columns' },
  ];

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const t0 = performance.now();
      await exec(sql);
      const p = await profileTable(CLEAN_TABLE);
      setResult({ profile: p, quality: assessQuality(p), ms: performance.now() - t0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const download = async (format: 'parquet' | 'csv') => {
    const bytes = await exportTable(CLEAN_TABLE, format);
    downloadFile(bytes, `${baseName(dataset.fileName)}_clean.${format}`, format === 'csv' ? 'text/csv' : 'application/vnd.apache.parquet');
  };

  const delta = result ? result.quality.score - quality.score : 0;

  return (
    <div className="clean">
      <section className="card">
        <div className="card-head">
          <h3>Cleaning rules</h3>
          <span className="muted small">Each rule becomes part of one SQL statement, so the transformation is fully reproducible.</span>
        </div>
        <ul className="options">
          {options.map((o) => (
            <li key={o.key}>
              <label>
                <input
                  type="checkbox"
                  checked={opts[o.key]}
                  onChange={(e) => {
                    setOpts({ ...opts, [o.key]: e.target.checked });
                    setResult(null);
                  }}
                />
                <span>
                  <b>{o.label}</b>
                  <span className="muted small">{o.detail}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <details className="sql-peek open-block" open>
          <summary>Generated SQL</summary>
          <pre>{sql}</pre>
        </details>
        <div className="row">
          <button className="btn" onClick={run} disabled={busy}>
            {busy ? 'Cleaning…' : 'Run cleaning'}
          </button>
          <button className="btn ghost" onClick={() => downloadFile(sql + ';\n', `${baseName(dataset.fileName)}_clean.sql`, 'text/plain')}>
            Save SQL
          </button>
        </div>
      </section>

      {error && <div className="status error" role="alert">{error}</div>}

      {result && (
        <section className="card">
          <div className="card-head">
            <h3>Before → after</h3>
            <span className="muted small">Cleaned and re-profiled in {Math.round(result.ms)} ms</span>
          </div>
          <div className="compare">
            <div className="compare-col">
              <p className="muted small">Original</p>
              <ScoreRing quality={quality} size={120} />
              <p className="small">{fmt(profile.rows)} rows · {quality.issues.length} issues</p>
            </div>
            <div className={`delta ${delta >= 0 ? 'up' : 'down'}`}>
              {delta >= 0 ? '+' : ''}
              {delta.toFixed(1)}
              <span className="small">points</span>
            </div>
            <div className="compare-col">
              <p className="muted small">Cleaned</p>
              <ScoreRing quality={result.quality} size={120} />
              <p className="small">{fmt(result.profile.rows)} rows · {result.quality.issues.length} issues</p>
            </div>
          </div>
          <DimensionBars quality={result.quality} />
          {result.quality.issues.length > 0 && (
            <p className="muted small">
              Remaining: {result.quality.issues.map((i) => `${i.title}${i.column ? ` (${i.column})` : ''}`).slice(0, 6).join(' · ')}
              {result.quality.issues.length > 6 ? ' …' : ''}
            </p>
          )}
          <div className="row">
            <button className="btn" onClick={() => download('parquet')}>Download Parquet</button>
            <button className="btn ghost" onClick={() => download('csv')}>Download CSV</button>
          </div>
        </section>
      )}
    </div>
  );
}
