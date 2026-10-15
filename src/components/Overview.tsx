import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Dataset } from '../App';
import { query, type QueryResult } from '../lib/duckdb';
import { formatBytes } from '../lib/download';
import type { Insight, InsightIcon } from '../lib/insights';
import { WEIGHTS } from '../lib/quality';
import type { Dimension, QualityReport, Severity } from '../lib/types';
import DataTable from './DataTable';
import { Frame, IssuesByColumn, MissingBars, QualityRadar, TypeDonut } from './Visuals';

const DIMENSION_HELP: Record<Dimension, string> = {
  completeness: 'Share of cells that are not null',
  validity: 'Values free of whitespace, blanks, bad types and impossible negatives',
  uniqueness: 'Rows that are not exact duplicates',
  consistency: 'Columns with a sensible, single type and more than one value',
};

/** Colour band for a 0–100 score. */
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

const fmt = (n: number) => n.toLocaleString('en-US');

function Kpis({ dataset }: { dataset: Dataset }) {
  const { profile, quality, sizeBytes } = dataset;
  const cells = profile.rows * profile.columns.length;
  const missing = profile.columns.reduce((s, c) => s + c.nulls, 0);
  const kinds = profile.columns.reduce<Record<string, number>>((m, c) => ((m[c.kind] = (m[c.kind] ?? 0) + 1), m), {});
  const errors = quality.issues.filter((i) => i.severity === 'error').length;
  const warnings = quality.issues.filter((i) => i.severity === 'warning').length;
  const tiles = [
    { label: 'Rows', value: fmt(profile.rows), sub: formatBytes(sizeBytes), tone: '' },
    { label: 'Columns', value: fmt(profile.columns.length), sub: `${kinds.numeric ?? 0} numeric · ${kinds.text ?? 0} text · ${kinds.temporal ?? 0} date`, tone: '' },
    { label: 'Complete cells', value: `${cells === 0 ? 100 : ((1 - missing / cells) * 100).toFixed(1)}%`, sub: `${fmt(missing)} of ${fmt(cells)} missing`, tone: missing === 0 ? 'good' : '' },
    { label: 'Duplicate rows', value: fmt(profile.duplicateRows), sub: profile.rows ? `${((profile.duplicateRows / profile.rows) * 100).toFixed(1)}% of rows` : '–', tone: profile.duplicateRows === 0 ? 'good' : 'warn' },
    { label: 'Issues found', value: fmt(quality.issues.length), sub: `${errors} errors · ${warnings} warnings`, tone: errors > 0 ? 'bad' : warnings > 0 ? 'warn' : 'good' },
  ];
  return (
    <div className="kpis">
      {tiles.map((t) => (
        <div className={`kpi ${t.tone}`} key={t.label}>
          <span className="kpi-label">{t.label}</span>
          <span className="kpi-value">{t.value}</span>
          <span className="kpi-sub">{t.sub}</span>
        </div>
      ))}
    </div>
  );
}

const ICONS: Record<InsightIcon, ReactNode> = {
  shape: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  score: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  time: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  link: <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />,
  pie: <><path d="M21 12A9 9 0 1 1 12 3v9z" /><path d="M15 3.6A9 9 0 0 1 20.4 9H15z" /></>,
  skew: <path d="M3 20h18M5 20C7 9 10 5 13 5s4 6 6 15" />,
  alert: <><path d="M12 3 2.5 20h19z" /><path d="M12 10v4M12 17.5v.5" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M16 7l3 3" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
};

function InsightIconSvg({ name }: { name: InsightIcon }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function InsightsGrid({ insights }: { insights: Insight[] }) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>Key insights</h3>
          <p className="muted small">Generated from the data itself: profile statistics plus a few extra aggregate queries.</p>
        </div>
      </div>
      <ul className="insights">
        {insights.map((i) => (
          <li key={i.id} className={`insight ${i.tone}`}>
            <span className="insight-icon"><InsightIconSvg name={i.icon} /></span>
            <div>
              <p className="insight-title">{i.title}</p>
              <p className="muted small">{i.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Overview({ dataset }: { dataset: Dataset }) {
  const { quality, profile, insights } = dataset;
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
      <Kpis dataset={dataset} />

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
        <div className="score-radar" aria-label="Quality dimensions radar chart">
          <QualityRadar quality={quality} />
        </div>
      </section>

      <InsightsGrid insights={insights} />

      <div className="visual-grid">
        <Frame title="Column types" hint="What kind of data each column holds">
          <TypeDonut profile={profile} />
        </Frame>
        <Frame title="Missing values" hint="Columns with nulls, worst first">
          <MissingBars profile={profile} />
        </Frame>
        <Frame title="Issues by column" hint="Where the problems concentrate">
          <IssuesByColumn quality={quality} />
        </Frame>
      </div>

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
