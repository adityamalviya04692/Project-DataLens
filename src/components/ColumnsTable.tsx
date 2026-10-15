import { useState } from 'react';
import { specForColumn } from '../lib/charts';
import type { ColumnProfile, DatasetProfile, QualityReport } from '../lib/types';
import { ChartCard } from './ChartsPanel';

/** Compact number formatting for the profile table. */
const fmt = (n: number | null, digits = 2) =>
  n === null || !Number.isFinite(n) ? '–' : Math.abs(n) >= 1e6 ? n.toExponential(2) : n.toLocaleString('en-US', { maximumFractionDigits: digits });

function statList(c: ColumnProfile): [string, string][] {
  const list: [string, string | null][] = [
    ['Type', c.type],
    ['Non-null', c.count.toLocaleString('en-US')],
    ['Missing', `${c.nulls.toLocaleString('en-US')} (${(c.nullPct * 100).toFixed(1)}%)`],
    ['Distinct', c.distinct.toLocaleString('en-US')],
    ['Min', c.min],
    ['Max', c.max],
    ['Mean', c.mean === null ? null : fmt(c.mean)],
    ['Median', c.q50 === null ? null : fmt(c.q50)],
    ['Std dev', c.std === null ? null : fmt(c.std)],
    ['Q1 – Q3', c.q25 === null || c.q75 === null ? null : `${fmt(c.q25)} – ${fmt(c.q75)}`],
    ['Outliers', c.kind === 'numeric' ? c.outliers.toLocaleString('en-US') : null],
    ['Untrimmed', c.kind === 'text' && c.whitespace > 0 ? c.whitespace.toLocaleString('en-US') : null],
    ['Blank', c.kind === 'text' && c.empty > 0 ? c.empty.toLocaleString('en-US') : null],
  ];
  return list.filter((x): x is [string, string] => x[1] !== null);
}

function ColumnDetail({ column, profile, quality }: { column: ColumnProfile; profile: DatasetProfile; quality: QualityReport }) {
  const spec = specForColumn(column);
  const issues = quality.issues.filter((i) => i.column === column.name);
  return (
    <section className="column-detail">
      <div className="card detail-stats">
        <div className="card-head">
          <h3>{column.name}</h3>
          <span className={`kind ${column.kind}`}>{column.type}</span>
        </div>
        <dl className="stat-grid">
          {statList(column).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd title={v}>{v}</dd>
            </div>
          ))}
        </dl>
        {issues.length > 0 ? (
          <ul className="pill-list">
            {issues.map((i) => (
              <li key={i.id} className={`pill ${i.severity}`} title={i.detail}>{i.title}</li>
            ))}
          </ul>
        ) : (
          <p className="empty-note good">No issues in this column.</p>
        )}
      </div>
      {spec ? <ChartCard spec={spec} profile={profile} /> : <div className="card"><p className="muted">Not enough variation to chart this column.</p></div>}
    </section>
  );
}

export default function ColumnsTable({ profile, quality }: { profile: DatasetProfile; quality: QualityReport }) {
  const [selected, setSelected] = useState<string | null>(profile.columns[0]?.name ?? null);
  const [filter, setFilter] = useState('');

  const issuesByColumn = new Map<string, number>();
  quality.issues.forEach((i) => i.column && issuesByColumn.set(i.column, (issuesByColumn.get(i.column) ?? 0) + 1));

  const current = profile.columns.find((c) => c.name === selected) ?? null;
  const shown = profile.columns.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="columns-tab">
      {current && <ColumnDetail key={current.name} column={current} profile={profile} quality={quality} />}

      <section className="card">
        <div className="card-head">
          <div>
            <h3>All columns</h3>
            <p className="muted small">{profile.columns.length} columns · exact distinct counts · click a row to explore it above</p>
          </div>
          <input className="search" type="search" placeholder="Filter columns…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter columns" />
        </div>
        <div className="table-wrap">
          <table className="data-table profile-table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
                <th>Completeness</th>
                <th className="num">Distinct</th>
                <th>Min</th>
                <th>Max</th>
                <th className="num">Mean</th>
                <th className="num">Median</th>
                <th className="num">Std dev</th>
                <th className="num">Outliers</th>
                <th className="num">Issues</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const complete = (1 - c.nullPct) * 100;
                const issues = issuesByColumn.get(c.name) ?? 0;
                return (
                  <tr
                    key={c.name}
                    className={`clickable${c.name === selected ? ' selected' : ''}`}
                    tabIndex={0}
                    onClick={() => setSelected(c.name)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSelected(c.name))}
                  >
                    <td><b>{c.name}</b></td>
                    <td><span className={`kind ${c.kind}`}>{c.type}</span></td>
                    <td>
                      <div className="mini-bar" title={`${c.nulls.toLocaleString('en-US')} nulls`}>
                        <div style={{ width: `${complete}%` }} />
                      </div>
                      <span className="small">{complete.toFixed(1)}%</span>
                    </td>
                    <td className="num">{c.distinct.toLocaleString('en-US')}</td>
                    <td className="clip" title={c.min ?? ''}>{c.min ?? '–'}</td>
                    <td className="clip" title={c.max ?? ''}>{c.max ?? '–'}</td>
                    <td className="num">{fmt(c.mean)}</td>
                    <td className="num">{fmt(c.q50)}</td>
                    <td className="num">{fmt(c.std)}</td>
                    <td className="num">{c.kind === 'numeric' ? c.outliers.toLocaleString('en-US') : '–'}</td>
                    <td className="num">{issues > 0 ? <span className="badge">{issues}</span> : '–'}</td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={11} className="muted">No columns match “{filter}”.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
