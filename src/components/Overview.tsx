import { useEffect, useMemo, useState } from 'react';
import type { Dataset } from '../App';
import { query, type QueryResult } from '../lib/duckdb';
import { WEIGHTS } from '../lib/quality';
import type { Dimension, QualityReport, Severity } from '../lib/types';
import DataTable from './DataTable';

const DIMENSION_HELP: Record<Dimension, string> = {
  completeness: 'Share of cells that are not null',
  validity: 'Values free of whitespace, blanks, bad types and impossible negatives',
  uniqueness: 'Rows that are not exact duplicates',
  consistency: 'Columns with a sensible, single type and more than one value',
};

export function scoreTone(score: number): 'good' | 'ok' | 'bad' {
  return score >= 85 ? 'good' : score >= 65 ? 'ok' : 'bad';
}

export function ScoreRing({ quality, size = 140 }: { quality: QualityReport; size?: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(quality.score);
  return (
    <svg className={`ring ${tone}`} viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`Quality score ${quality.score} out of 100, grade ${quality.grade}`}>
      <circle cx="50" cy="50" r={r} className="ring-track" />
      <circle cx="50" cy="50" r={r} className="ring-value" strokeDasharray={`${(quality.score / 100) * c} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="49" textAnchor="middle" className="ring-score">{quality.score.toFixed(1)}</text>
      <text x="50" y="65" textAnchor="middle" className="ring-grade">Grade {quality.grade}</text>
    </svg>
  );
}

export function DimensionBars({ quality }: { quality: QualityReport }) {
  return (
    <div className="dims">
      {(Object.keys(WEIGHTS) as Dimension[]).map((d) => {
        const v = quality.dimensions[d] * 100;
        return (
          <div className="dim" key={d}>
            <div className="dim-head">
              <span className="dim-name">{d}</span>
              <span className="dim-val">{v.toFixed(1)}%</span>
            </div>
            <div className="bar"><div className={`bar-fill ${scoreTone(v)}`} style={{ width: `${v}%` }} /></div>
            <p className="muted small">{DIMENSION_HELP[d]} · weight {Math.round(WEIGHTS[d] * 100)}%</p>
          </div>
        );
      })}
    </div>
  );
}

export default function Overview({ dataset }: { dataset: Dataset }) {
  const { quality, profile } = dataset;
  const [filter, setFilter] = useState<Severity | 'all'>('all');
  const [preview, setPreview] = useState<QueryResult | null>(null);

  useEffect(() => {
    let live = true;
    query(`SELECT * FROM ${profile.table} LIMIT 100`).then((r) => live && setPreview(r));
    return () => {
      live = false;
    };
  }, [profile.table]);

  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 };
    quality.issues.forEach((i) => c[i.severity]++);
    return c;
  }, [quality.issues]);

  const shown = quality.issues.filter((i) => filter === 'all' || i.severity === filter);

  return (
    <div className="overview">
      <section className="card score-card">
        <ScoreRing quality={quality} />
        <div className="score-copy">
          <h3>Data quality score</h3>
          <p className="muted">
            Weighted across four dimensions. {counts.error} errors, {counts.warning} warnings and {counts.info} notes were found
            in {profile.rows.toLocaleString('en-US')} rows.
          </p>
          <DimensionBars quality={quality} />
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Issues</h3>
          <div className="chips" role="group" aria-label="Filter by severity">
            {(['all', 'error', 'warning', 'info'] as const).map((s) => (
              <button key={s} className={`chip ${s}${filter === s ? ' on' : ''}`} onClick={() => setFilter(s)}>
                {s === 'all' ? `All ${quality.issues.length}` : `${s} ${counts[s]}`}
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="muted">No issues in this category.</p>
        ) : (
          <ul className="issues">
            {shown.map((i) => (
              <li key={i.id} className={`issue ${i.severity}`}>
                <span className={`sev ${i.severity}`}>{i.severity}</span>
                <div>
                  <p className="issue-title">
                    {i.title}
                    {i.column && <code className="col">{i.column}</code>}
                    <span className="dim-tag">{i.dimension}</span>
                  </p>
                  <p className="muted small">{i.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Preview</h3>
          <span className="muted small">First 100 rows · leading/trailing spaces shown as ·</span>
        </div>
        {preview ? <DataTable result={preview} /> : <p className="muted">Loading…</p>}
      </section>
    </div>
  );
}
