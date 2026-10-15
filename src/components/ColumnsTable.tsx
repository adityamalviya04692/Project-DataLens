import type { DatasetProfile, QualityReport } from '../lib/types';

const fmt = (n: number | null, digits = 2) =>
  n === null || !Number.isFinite(n) ? '–' : Math.abs(n) >= 1e6 ? n.toExponential(2) : n.toLocaleString('en-US', { maximumFractionDigits: digits });

export default function ColumnsTable({ profile, quality }: { profile: DatasetProfile; quality: QualityReport }) {
  const issuesByColumn = new Map<string, number>();
  quality.issues.forEach((i) => i.column && issuesByColumn.set(i.column, (issuesByColumn.get(i.column) ?? 0) + 1));

  return (
    <section className="card">
      <div className="card-head">
        <h3>Column profile</h3>
        <span className="muted small">{profile.columns.length} columns · exact distinct counts</span>
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
            {profile.columns.map((c) => {
              const complete = (1 - c.nullPct) * 100;
              const issues = issuesByColumn.get(c.name) ?? 0;
              return (
                <tr key={c.name}>
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
          </tbody>
        </table>
      </div>
    </section>
  );
}
