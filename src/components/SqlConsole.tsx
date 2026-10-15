import { useMemo, useState, type KeyboardEvent } from 'react';
import { query, type QueryResult } from '../lib/duckdb';
import { quoteIdent } from '../lib/sql';
import type { DatasetProfile } from '../lib/types';
import DataTable from './DataTable';

function examples(p: DatasetProfile): { label: string; sql: string }[] {
  const t = p.table;
  const list = [
    { label: 'Preview', sql: `SELECT * FROM ${t} LIMIT 100;` },
    { label: 'Schema', sql: `DESCRIBE ${t};` },
    { label: 'Summary stats', sql: `SUMMARIZE ${t};` },
  ];
  const dim = p.columns.find((c) => c.kind === 'text' && c.distinct > 1 && c.distinct <= 50);
  const measure = p.columns.find((c) => c.kind === 'numeric' && !/(^id$|_id$)/i.test(c.name));
  if (dim && measure) {
    const d = quoteIdent(dim.name);
    const m = quoteIdent(measure.name);
    list.push({
      label: `${measure.name} by ${dim.name}`,
      sql: `SELECT ${d},\n       count(*)            AS rows,\n       round(sum(${m}), 2)  AS total_${measure.name},\n       round(avg(${m}), 2)  AS avg_${measure.name}\nFROM ${t}\nGROUP BY ${d}\nORDER BY rows DESC;`,
    });
  }
  return list;
}

export default function SqlConsole({ profile }: { profile: DatasetProfile }) {
  const presets = useMemo(() => examples(profile), [profile]);
  const [sql, setSql] = useState(presets[presets.length - 1].sql);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = async (text = sql) => {
    setRunning(true);
    setError(null);
    try {
      setResult(await query(text));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
    }
  };

  return (
    <div className="sql">
      <section className="card">
        <div className="card-head">
          <h3>SQL console</h3>
          <span className="muted small">
            DuckDB SQL · your file is the table <code>{profile.table}</code> · ⌘/Ctrl + Enter to run
          </span>
        </div>
        <div className="chips">
          {presets.map((p) => (
            <button key={p.label} className="chip" onClick={() => { setSql(p.sql); run(p.sql); }}>
              {p.label}
            </button>
          ))}
        </div>
        <textarea className="editor" value={sql} onChange={(e) => setSql(e.target.value)} onKeyDown={onKey} spellCheck={false} rows={7} aria-label="SQL query" />
        <div className="row">
          <button className="btn" onClick={() => run()} disabled={running}>
            {running ? 'Running…' : 'Run query'}
          </button>
          {result && (
            <span className="muted small">
              {result.rows.length.toLocaleString('en-US')} rows in {result.elapsedMs.toFixed(1)} ms
            </span>
          )}
        </div>
      </section>
      {error && <div className="status error" role="alert">{error}</div>}
      {result && (
        <section className="card">
          <DataTable result={result} />
        </section>
      )}
    </div>
  );
}
