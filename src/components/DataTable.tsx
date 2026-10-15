import type { QueryResult } from '../lib/duckdb';

interface Props {
  result: QueryResult;
  maxRows?: number;
}

function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <td className="null">null</td>;
  if (typeof value === 'number') return <td className="num">{Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>;
  if (typeof value === 'boolean') return <td>{String(value)}</td>;
  const s = String(value);
  // Make leading/trailing whitespace visible, which is a common data issue.
  const shown = s.replace(/^\s+|\s+$/g, (m) => '·'.repeat(m.length));
  return <td title={s}>{shown}</td>;
}

export default function DataTable({ result, maxRows = 500 }: Props) {
  const rows = result.rows.slice(0, maxRows);
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th className="rownum">#</th>
            {result.columns.map((c) => (
              <th key={c.name}>{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="rownum">{i + 1}</td>
              {result.columns.map((c) => (
                <Cell key={c.name} value={r[c.name]} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length > maxRows && <p className="muted small">Showing first {maxRows} of {result.rows.length.toLocaleString('en-US')} rows.</p>}
    </div>
  );
}
