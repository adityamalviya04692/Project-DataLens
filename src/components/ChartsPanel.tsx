import { useEffect, useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { binLabels, chartSql, histogramRange, recommendCharts, SECTION_BLURB, SECTION_ORDER, type ChartSpec } from '../lib/charts';
import { query, type Row } from '../lib/duckdb';
import { DAYS, MONTHS, slotCounts, takeaway } from '../lib/takeaways';
import type { DatasetProfile } from '../lib/types';
import EChart, { readTheme, useColorScheme, type ThemeColors } from './EChart';

/** Shared grid, tooltip and text defaults. */
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

const noGrid = { splitLine: { show: false } };
const f2 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

function buildOption(spec: ChartSpec, rows: Row[], p: DatasetProfile, t: ThemeColors): EChartsCoreOption {
  const base = baseOption(t);
  switch (spec.kind) {
    case 'timeseries':
      return {
        ...base,
        xAxis: { type: 'category', data: rows.map((r) => String(r.period)), ...axis(t), ...noGrid },
        yAxis: { type: 'value', ...axis(t) },
        series: [{ type: 'line', data: rows.map((r) => r.n), smooth: 0.25, showSymbol: false, lineStyle: { width: 2, color: t.accent }, areaStyle: { color: t.accentSoft }, itemStyle: { color: t.accent } }],
      };
    case 'stacked': {
      const periods = [...new Set(rows.map((r) => String(r.period)))];
      const totals = new Map<string, number>();
      rows.forEach((r) => totals.set(String(r.label), (totals.get(String(r.label)) ?? 0) + Number(r.n)));
      const labels = [...totals.keys()].sort((a, b) => Number(a === 'Other') - Number(b === 'Other') || (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
      const at = new Map(periods.map((x, i) => [x, i]));
      const series = labels.map((label, i) => {
        const data = new Array<number>(periods.length).fill(0);
        rows.forEach((r) => String(r.label) === label && (data[at.get(String(r.period))!] = Number(r.n)));
        const color = label === 'Other' ? t.palette[6] : t.palette[i % 6];
        return { name: label, type: 'line' as const, stack: 'total', data, showSymbol: false, smooth: 0.2, lineStyle: { width: 1, color }, itemStyle: { color }, areaStyle: { color, opacity: 0.85 } };
      });
      return {
        ...base,
        grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
        legend: { top: 0, textStyle: { color: t.muted }, icon: 'circle', itemHeight: 8 },
        xAxis: { type: 'category', boundaryGap: false, data: periods, ...axis(t), ...noGrid },
        yAxis: { type: 'value', ...axis(t) },
        series,
      };
    }
    case 'weekday':
    case 'month': {
      const weekday = spec.kind === 'weekday';
      const labels = weekday ? DAYS : MONTHS;
      const counts = slotCounts(rows, weekday ? 'dow' : 'm', labels.length);
      const peak = Math.max(...counts);
      return {
        ...base,
        xAxis: { type: 'category', data: labels, ...axis(t), ...noGrid },
        yAxis: { type: 'value', ...axis(t) },
        series: [{ type: 'bar', barCategoryGap: '25%', data: counts.map((v) => ({ value: v, itemStyle: { color: v === peak && peak > 0 ? t.palette[3] : t.accent, borderRadius: [3, 3, 0, 0] } })) }],
      };
    }
    case 'histogram': {
      const range = histogramRange(p.columns.find((x) => x.name === spec.columns[0])!);
      const counts = new Array<number>(range.bins).fill(0);
      rows.forEach((r) => (counts[Number(r.bin)] = Number(r.n)));
      return {
        ...base,
        xAxis: { type: 'category', data: binLabels(range), ...axis(t), ...noGrid, axisLabel: { color: t.muted, hideOverlap: true, rotate: range.integer ? 0 : 30 } },
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
        yAxis: { type: 'category', data: data.map((r) => String(r.label)), ...axis(t), ...noGrid, axisLabel: { color: t.muted, width: 120, overflow: 'truncate' } },
        series: [{ type: 'bar', data: data.map((r) => r.n), barCategoryGap: '30%', itemStyle: { color: t.accent, borderRadius: [0, 3, 3, 0] }, label: { show: true, position: 'right', color: t.muted } }],
      };
    }
    case 'boxplot': {
      return {
        ...base,
        grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
        tooltip: {
          trigger: 'item',
          backgroundColor: t.surface,
          borderColor: t.border,
          textStyle: { color: t.text },
          formatter: (x: { name: string; data: number[] }) =>
            `<b>${x.name}</b><br/>95th pct: ${f2(x.data[4])}<br/>Q3: ${f2(x.data[3])}<br/>Median: ${f2(x.data[2])}<br/>Q1: ${f2(x.data[1])}<br/>5th pct: ${f2(x.data[0])}`,
        },
        xAxis: { type: 'category', data: rows.map((r) => String(r.label)), ...axis(t), ...noGrid, axisLabel: { color: t.muted, hideOverlap: true, width: 80, overflow: 'truncate' } },
        yAxis: { type: 'value', ...axis(t) },
        series: [{ type: 'boxplot', data: rows.map((r) => [r.p05, r.q25, r.q50, r.q75, r.p95].map(Number)), itemStyle: { color: t.accentSoft, borderColor: t.accent, borderWidth: 2 } }],
      };
    }
    case 'scatter': {
      const [a, b] = spec.columns;
      return {
        ...base,
        grid: { left: 8, right: 16, top: 16, bottom: 28, containLabel: true },
        tooltip: { trigger: 'item', backgroundColor: t.surface, borderColor: t.border, textStyle: { color: t.text }, formatter: (x: { value: number[] }) => `${a}: ${f2(x.value[0])}<br/>${b}: ${f2(x.value[1])}` },
        xAxis: { type: 'value', scale: true, name: a, nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: t.muted }, ...axis(t) },
        yAxis: { type: 'value', scale: true, name: b, nameTextStyle: { color: t.muted }, ...axis(t) },
        series: [{ type: 'scatter', symbolSize: 5, data: rows.map((r) => [Number(r.x), Number(r.y)]), itemStyle: { color: t.accent, opacity: 0.45 } }],
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
        xAxis: { type: 'category', data: cols, ...axis(t), ...noGrid, axisLabel: { color: t.muted, rotate: 30, width: 90, overflow: 'truncate' } },
        yAxis: { type: 'category', data: cols, inverse: true, ...axis(t), ...noGrid, axisLabel: { color: t.muted, width: 90, overflow: 'truncate' } },
        visualMap: { min: -1, max: 1, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 140, textStyle: { color: t.muted }, inRange: { color: [t.neg, t.surface, t.pos] } },
        series: [{ type: 'heatmap', data: cells, label: { show: cols.length <= 6, color: t.text }, itemStyle: { borderColor: t.surface, borderWidth: 2 } }],
      };
    }
  }
}

const HEIGHT: Partial<Record<ChartSpec['kind'], number>> = { heatmap: 320, scatter: 300, boxplot: 280, stacked: 300 };
const WIDE: ChartSpec['kind'][] = ['timeseries', 'stacked'];

export function ChartCard({ spec, profile }: { spec: ChartSpec; profile: DatasetProfile }) {
  const scheme = useColorScheme();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sql = useMemo(() => chartSql(spec, profile), [spec, profile]);

  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    query(sql)
      .then((r) => live && setRows(r.rows))
      .catch((e) => live && setError(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, [sql]);

  // `scheme` is a dependency so colours are re-read when light/dark mode flips.
  const option = useMemo(() => (rows ? buildOption(spec, rows, profile, readTheme()) : null), [rows, spec, profile, scheme]);
  const tip = useMemo(() => (rows ? takeaway(spec, rows, profile) : null), [rows, spec, profile]);

  return (
    <article className={`card chart-card${WIDE.includes(spec.kind) ? ' wide' : ''}`}>
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
      {option && <EChart option={option} height={HEIGHT[spec.kind] ?? 260} />}
      {tip && <p className="takeaway">{tip}</p>}
    </article>
  );
}

export default function ChartsPanel({ profile, pair }: { profile: DatasetProfile; pair?: [string, string] }) {
  const pairKey = pair ? pair.join('|') : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const specs = useMemo(() => recommendCharts(profile, 16, pair ? { pair } : {}), [profile, pairKey]);
  if (specs.length === 0) return <p className="muted">No chartable columns found. Try the SQL tab.</p>;
  return (
    <div className="charts">
      {SECTION_ORDER.map((section) => {
        const items = specs.filter((s) => s.section === section);
        if (items.length === 0) return null;
        return (
          <section key={section} className="chart-section">
            <div className="section-head">
              <h2>{section}</h2>
              <p className="muted">{SECTION_BLURB[section]}</p>
            </div>
            <div className="charts-grid">
              {items.map((s) => (
                <ChartCard key={s.id} spec={s} profile={profile} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
