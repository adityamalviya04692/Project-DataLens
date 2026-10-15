import * as duckdb from '@duckdb/duckdb-wasm';
import { DataType, type Field, type Table } from 'apache-arrow';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { quoteLiteral } from './sql';

// Self-hosted bundles: the engine is served from our own origin, so no data or
// query ever touches a third-party server.
const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

export type Row = Record<string, unknown>;

export interface QueryResult {
  columns: { name: string; type: string }[];
  rows: Row[];
  elapsedMs: number;
}

export type FileFormat = 'csv' | 'parquet' | 'json' | 'xlsx';

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let connPromise: Promise<duckdb.AsyncDuckDBConnection> | null = null;

export function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const bundle = await duckdb.selectBundle(BUNDLES);
      const worker = new Worker(bundle.mainWorker!);
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      return db;
    })();
  }
  return dbPromise;
}

async function getConn(): Promise<duckdb.AsyncDuckDBConnection> {
  if (!connPromise) connPromise = getDb().then((db) => db.connect());
  return connPromise;
}

/** Convert an Arrow value into something JSON/React friendly. */
export function normaliseValue(value: unknown, field?: Field): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (field && (DataType.isTimestamp(field.type) || DataType.isDate(field.type))) {
    const ms = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(ms)) {
      const iso = new Date(ms).toISOString();
      return DataType.isDate(field.type) ? iso.slice(0, 10) : iso.replace('T', ' ').replace('.000Z', '');
    }
  }
  if (field && DataType.isDecimal(field.type)) {
    // Arrow decimals are unscaled big integers; apply the scale ourselves.
    const scale = (field.type as { scale: number }).scale;
    const n = Number(String(value)) / 10 ** scale;
    return Number.isFinite(n) ? n : String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value)) return `<${value.byteLength} bytes>`;
  if (typeof value === 'object') {
    const json = (value as { toJSON?: () => unknown }).toJSON?.() ?? value;
    return JSON.stringify(json, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  }
  return value;
}

function tableToRows(table: Table): Row[] {
  const fields = table.schema.fields;
  const rows: Row[] = [];
  for (let i = 0; i < table.numRows; i++) {
    const raw = table.get(i);
    if (!raw) continue;
    const row: Row = {};
    for (const f of fields) row[f.name] = normaliseValue((raw as unknown as Row)[f.name], f);
    rows.push(row);
  }
  return rows;
}

export async function query(sql: string): Promise<QueryResult> {
  const conn = await getConn();
  const t0 = performance.now();
  const table = await conn.query(sql);
  const elapsedMs = performance.now() - t0;
  return {
    columns: table.schema.fields.map((f) => ({ name: f.name, type: String(f.type) })),
    rows: tableToRows(table),
    elapsedMs,
  };
}

export async function exec(sql: string): Promise<void> {
  const conn = await getConn();
  await conn.query(sql);
}

export function detectFormat(fileName: string): FileFormat | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (['csv', 'tsv', 'txt'].includes(ext)) return 'csv';
  if (['parquet', 'pq'].includes(ext)) return 'parquet';
  if (['json', 'jsonl', 'ndjson'].includes(ext)) return 'json';
  if (ext === 'xlsx') return 'xlsx';
  return null;
}

function readerFor(format: FileFormat, path: string): string {
  const p = quoteLiteral(path);
  switch (format) {
    case 'csv':
      return `read_csv_auto(${p}, sample_size = -1)`;
    case 'parquet':
      return `read_parquet(${p})`;
    case 'json':
      return `read_json_auto(${p})`;
    case 'xlsx':
      return `read_xlsx(${p})`;
  }
}

/**
 * Register raw bytes in DuckDB's virtual filesystem and materialise them as a
 * table. Everything stays in browser memory.
 */
export async function loadBytes(
  bytes: Uint8Array,
  fileName: string,
  tableName = 'data',
): Promise<void> {
  const format = detectFormat(fileName);
  if (!format) throw new Error(`Unsupported file type: ${fileName}`);
  const db = await getDb();
  const virtualPath = `upload_${Date.now()}.${format}`;
  await db.registerFileBuffer(virtualPath, bytes);
  if (format === 'xlsx') await exec('INSTALL excel; LOAD excel;');
  if (format === 'json') await exec('INSTALL json; LOAD json;');
  await exec(`CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM ${readerFor(format, virtualPath)}`);
}

/** Export a table to Parquet or CSV and return the file bytes. */
export async function exportTable(tableName: string, format: 'parquet' | 'csv'): Promise<Uint8Array> {
  const db = await getDb();
  const out = `export_${Date.now()}.${format}`;
  const options = format === 'parquet' ? '(FORMAT PARQUET, COMPRESSION ZSTD)' : '(FORMAT CSV, HEADER)';
  await exec(`COPY ${tableName} TO ${quoteLiteral(out)} ${options}`);
  const buffer = await db.copyFileToBuffer(out);
  await db.dropFile(out);
  return buffer;
}
