import { useEffect, useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { binLabels, chartSql, histogramRange, recommendCharts, type ChartSpec } from '../lib/charts';
import { query, type Row } from '../lib/duckdb';
import type { DatasetProfile } from '../lib/types';
import EChart, { readTheme, useColorScheme, type ThemeColors } from './EChart';

function baseOption(t: ThemeColors) {
  return {
    textStyle: { color: t.muted, fontFamily: 'inherit' },
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', backgroundColor: t.surface, borderColor: t.border, textStyle: { color: t.text } },
  };
}

const axis = (t: ThemeColors) => ({
  axisLine: { lineStyle: { color: t.border } },
  axisTick: { show: false },
  axisLabel: { color: t.muted, hideOverlap: true },
  splitLine: { lineStyle: { color: t.border, type: 'dashed' as const } },
});

function buildOption(spec: ChartSpec, rows: Row[], p: DatasetProfile, t: ThemeColors): EChartsCoreOption {
  const base = baseOption(t);
  switch (spec.kind) {
    case 'timeseries':
      return {
        ...base,
        xAxis: { type: 'category', data: rows.map((r) => String(r.period)), ...axis(t), splitLine: { show: false } },
        yAxis: { type: 'value', ...axis(t) },
        series: [{ type: 'line', data: rows.map((r) => r.n), smooth: 0.25, showSymbol: false, lineStyle: { width: 2, color: t.accent }, areaStyle: { color: t.accentSoft }, itemStyle: { color: t.accent } }],
      };
    case 'histogram': {
      const range = histogramRange(p.columns.find((x) => x.name === spec.columns[0])!);
      const counts = new Array(range.bins).fill(0);
      rows.forEach((r) => (counts[Number(r.bin)] = r.n));
      return {
        ...base,
        xAxis: { type: 'category', data: binLabels(range), ...axis(t), splitLine: { show: false }, axisLabel: { color: t.muted, hideOverlap: true, rotate: range.integer ? 0 : 30 } },
        yAxis: { type: 'value', ...axis(t) },
        series: [{ type: 'bar', data: counts, barCategoryGap: '8%', itemStyle: { color: t.accent, borderRadius: [3, 3, 0, 0] } }],
      };
    }
    case 'bar': {
      const data = [...rows].reverse();
      return {
        ...base,
        tooltip: { ...base.tooltip, axisPointer: { type: 'shadow' } },
        xAxis: { type: 'value', ...axis(t) },
        yAxis: { type: 'category', data: data.map((r) => String(r.label)), ...axis(t), splitLine: { show: false }, axisLabel: { color: t.muted, width: 120, overflow: 'truncate' } },
        series: [{ type: 'bar', data: data.map((r) => r.n), barCategoryGap: '30%', itemStyle: { color: t.accent, borderRadius: [0, 3, 3, 0] }, label: { show: true, position: 'right', color: t.muted } }],
      };
    }
    case 'heatmap': {
      const cols = spec.columns;
      const r0 = rows[0] ?? {};
      const cells: [number, number, number | '-'][] = [];
      cols.forEach((_, i) =>
        cols.forEach((__, j) => {
          const key = i < j ? `r_${i}_${j}` : `r_${j}_${i}`;
          const v = i === j ? 1 : (r0[key] as number | null);
          cells.push([i, j, v === null || v === undefined || Number.isNaN(v) ? '-' : Math.round(v * 100) / 100]);
        }),
      );
      return {
        ...base,
        grid: { left: 8, right: 16, top: 8, bottom: 56, containLabel: true },
        tooltip: { trigger: 'item', backgroundColor: t.surface, borderColor: t.border, textStyle: { color: t.text }, formatter: (x: { value: [number, number, number] }) => `${cols[x.value[0]]} × ${cols[x.value[1]]}<br/>r = ${x.value[2]}` },
        xAxis: { type: 'category', data: cols, ...axis(t), splitLine: { show: false }, axisLabel: { color: t.muted, rotate: 30, width: 90, overflow: 'truncate' } },
        yAxis: { type: 'category', data: cols, inverse: true, ...axis(t), splitLine: { show: false }, axisLabel: { color: t.muted, width: 90, overflow: 'truncate' } },
        visualMap: { min: -1, max: 1, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 140, textStyle: { color: t.muted }, inRange: { color: [t.neg, t.surface, t.pos] } },
        series: [{ type: 'heatmap', data: cells, label: { show: cols.length <= 6, color: t.text }, itemStyle: { borderColor: t.surface, borderWidth: 2 } }],
      };
    }
  }
}

function ChartCard({ spec, profile, scheme }: { spec: ChartSpec; profile: DatasetProfile; scheme: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sql = useMemo(() => chartSql(spec, profile), [spec, profile]);

  useEffect(() => {
    let live = true;
    query(sql)
      .then((r) => live && setRows(r.rows))
      .catch((e) => live && setError(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, [sql]);

  // `scheme` is a dependency so colours are re-read when light/dark mode flips.
  const option = useMemo(() => (rows ? buildOption(spec, rows, profile, readTheme()) : null), [rows, spec, profile, scheme]);

  return (
    <article className={`card chart-card${spec.kind === 'timeseries' ? ' wide' : ''}`}>
      <div className="card-head">
        <div>
          <h3>{spec.title}</h3>
          <p className="muted small">{spec.subtitle}</p>
        </div>
        <details className="sql-peek">
          <summary>SQL</summary>
          <pre>{sql}</pre>
        </details>
      </div>
      {error && <p className="status error">{error}</p>}
      {!error && !option && <div className="chart-skeleton" />}
      {option && <EChart option={option} height={spec.kind === 'heatmap' ? 320 : 260} />}
    </article>
  );
}

export default function ChartsPanel({ profile }: { profile: DatasetProfile }) {
  const specs = useMemo(() => recommendCharts(profile), [profile]);
  const scheme = useColorScheme();
  if (specs.length === 0) return <p className="muted">No chartable columns found. Try the SQL tab.</p>;
  return (
    <div className="charts-grid">
      {specs.map((s) => (
        <ChartCard key={s.id} spec={s} profile={profile} scheme={scheme} />
      ))}
    </div>
  );
}
