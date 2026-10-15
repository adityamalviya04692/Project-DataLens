import type { DatasetProfile, QualityReport } from './types';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** A self-contained HTML data quality report the user can save or share. */
export function buildHtmlReport(fileName: string, p: DatasetProfile, q: QualityReport, generatedAt = new Date()): string {
  const e = escapeHtml;
  const dims = Object.entries(q.dimensions)
    .map(([k, v]) => `<div class="dim"><span>${e(k)}</span><b>${pct(v)}</b></div>`)
    .join('');
  const issues = q.issues.length
    ? q.issues
        .map(
          (i) =>
            `<tr><td><span class="sev ${i.severity}">${i.severity}</span></td><td>${e(i.column ?? '(table)')}</td><td>${e(i.title)}</td><td>${e(i.detail)}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="4">No issues found.</td></tr>';
  const cols = p.columns
    .map(
      (c) =>
        `<tr><td>${e(c.name)}</td><td>${e(c.type)}</td><td>${pct(c.nullPct)}</td><td>${c.distinct.toLocaleString('en-US')}</td><td>${e(c.min ?? '')}</td><td>${e(c.max ?? '')}</td><td>${c.mean === null ? '' : c.mean.toFixed(2)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Data quality report: ${e(fileName)}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:32px 16px;color:#1f2330;background:#f7f7fb}
main{max-width:960px;margin:0 auto}h1{margin:0 0 4px;font-size:24px}p.meta{color:#5b6070;margin:0 0 24px}
.score{display:flex;gap:16px;align-items:center;background:#fff;border:1px solid #e3e4ec;border-radius:12px;padding:20px;margin-bottom:16px}
.score b{font-size:44px}.grade{font-size:20px;font-weight:700;background:#eef0ff;color:#4338ca;border-radius:8px;padding:4px 12px}
.dims{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:24px}
.dim{background:#fff;border:1px solid #e3e4ec;border-radius:10px;padding:12px;display:flex;justify-content:space-between;text-transform:capitalize}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e4ec;border-radius:10px;overflow:hidden;margin-bottom:24px;font-size:14px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top}th{background:#f1f2f7}
.sev{font-size:12px;font-weight:600;padding:2px 8px;border-radius:99px}.error{background:#fde2e2;color:#a61b1b}.warning{background:#fdf0d5;color:#8a5300}.info{background:#e3ecfd;color:#1e4fa8}
</style></head><body><main>
<h1>Data quality report</h1>
<p class="meta">${e(fileName)} · ${p.rows.toLocaleString('en-US')} rows × ${p.columns.length} columns · generated ${e(generatedAt.toISOString().slice(0, 16).replace('T', ' '))} UTC by DataLens</p>
<div class="score"><b>${q.score.toFixed(1)}</b><span>/ 100</span><span class="grade">Grade ${q.grade}</span></div>
<div class="dims">${dims}</div>
<h2>Issues (${q.issues.length})</h2>
<table><thead><tr><th>Severity</th><th>Column</th><th>Check</th><th>Detail</th></tr></thead><tbody>${issues}</tbody></table>
<h2>Column profile</h2>
<table><thead><tr><th>Column</th><th>Type</th><th>Null %</th><th>Distinct</th><th>Min</th><th>Max</th><th>Mean</th></tr></thead><tbody>${cols}</tbody></table>
</main></body></html>`;
}
