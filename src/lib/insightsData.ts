import { isIdentifierLike, spanDays } from './charts';
import { query, type Row } from './duckdb';
import { EMPTY_EXTRAS, type CategoryFact, type CorrPair, type InsightExtras, type TimeFacts } from './insights';
import { isNumericText } from './quality';
import { quoteIdent } from './sql';
import type { DatasetProfile } from './types';

const MAX_CORR_COLUMNS = 8;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Run an optional query; one failing insight must not break the dataset load. */
async function attempt<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`DataLens: skipped "${label}" insight`, err);
    return fallback;
  }
}

/** The handful of extra aggregate queries that feed the insight engine. */
export async function loadExtras(p: DatasetProfile): Promise<InsightExtras> {
  const usable = p.columns.filter((c) => c.count > 0 && c.distinct > 1 && !isIdentifierLike(c, p.rows));
  const numeric = usable.filter((c) => c.kind === 'numeric');
  const t = p.table;

  const correlations = await attempt<CorrPair[]>('correlations', async () => {
    const cols = numeric.slice(0, MAX_CORR_COLUMNS);
    const parts: string[] = [];
    cols.forEach((a, i) => cols.forEach((b, j) => j > i && parts.push(`corr(${quoteIdent(a.name)}, ${quoteIdent(b.name)})::DOUBLE AS r_${i}_${j}`)));
    if (parts.length === 0) return [];
    const row = (await query(`SELECT ${parts.join(', ')} FROM ${t}`)).rows[0] as Row;
    const pairs: CorrPair[] = [];
    cols.forEach((a, i) =>
      cols.forEach((b, j) => {
        const r = row[`r_${i}_${j}`];
        if (j > i && typeof r === 'number' && Number.isFinite(r)) pairs.push({ a: a.name, b: b.name, r });
      }),
    );
    return pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  }, []);

  const skew = await attempt<Record<string, number>>('skewness', async () => {
    if (numeric.length === 0) return {};
    const sel = numeric.map((c, i) => `skewness(${quoteIdent(c.name)})::DOUBLE AS s${i}`).join(', ');
    const row = (await query(`SELECT ${sel} FROM ${t}`)).rows[0] as Row;
    const out: Record<string, number> = {};
    numeric.forEach((c, i) => {
      const s = row[`s${i}`];
      if (typeof s === 'number' && Number.isFinite(s)) out[c.name] = s;
    });
    return out;
  }, {});

  const categories = await attempt<CategoryFact[]>('categories', async () => {
    const cols = usable
      .filter((c) => (c.kind === 'text' && !isNumericText(c)) || c.kind === 'boolean')
      .filter((c) => c.distinct >= 2 && c.distinct <= 50)
      .sort((a, b) => a.distinct - b.distinct)
      .slice(0, 3);
    const facts: CategoryFact[] = [];
    for (const c of cols) {
      const q = quoteIdent(c.name);
      const res = await query(`SELECT CAST(${q} AS VARCHAR) AS v, count(*)::BIGINT AS n FROM ${t} WHERE ${q} IS NOT NULL GROUP BY 1 ORDER BY n DESC, v LIMIT 3`);
      facts.push({ column: c.name, distinct: c.distinct, total: c.count, top: res.rows.map((r) => ({ value: String(r.v).trim() || '(blank)', n: Number(r.n) })) });
    }
    return facts;
  }, []);

  const time = await attempt<TimeFacts | null>('time', async () => {
    const c = usable.find((x) => x.kind === 'temporal');
    if (!c || !c.min || !c.max) return null;
    const q = quoteIdent(c.name);
    const month = (await query(`SELECT strftime(date_trunc('month', ${q}), '%b %Y') AS label, count(*)::BIGINT AS n FROM ${t} WHERE ${q} IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 1`)).rows[0];
    const days = (await query(`SELECT isodow(${q})::INTEGER AS d, count(*)::BIGINT AS n FROM ${t} WHERE ${q} IS NOT NULL GROUP BY 1 ORDER BY n DESC`)).rows;
    const day = (r: Row | undefined) => (r ? { label: WEEKDAYS[Number(r.d) - 1], n: Number(r.n) } : null);
    return {
      column: c.name,
      min: c.min,
      max: c.max,
      spanDays: spanDays(c.min, c.max),
      peakMonth: month ? { label: String(month.label), n: Number(month.n) } : null,
      busiestDay: day(days[0]),
      quietestDay: day(days[days.length - 1]),
    };
  }, null);

  return { ...EMPTY_EXTRAS, correlations, skew, categories, time };
}
