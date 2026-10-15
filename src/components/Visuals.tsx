import { useMemo, type ReactNode } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { WEIGHTS } from '../lib/quality';
import type { DatasetProfile, Dimension, QualityReport } from '../lib/types';
import EChart, { readTheme, useColorScheme, type ThemeColors } from './EChart';

/** Build a themed ECharts option that re-computes when the colour scheme flips. */
function useOption(build: (t: ThemeColors) => EChartsCoreOption, deps: unknown[]): EChartsCoreOption {
  const scheme = useColorScheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => build(readTheme()), [...deps, scheme]);
}

const tooltip = (t: ThemeColors) => ({ backgroundColor: t.surface, borderColor: t.border, textStyle: { color: t.text } });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Frame({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card visual">
      <div className="card-head">
        <div>
          <h3>{title}</h3>
          {hint && <p className="muted small">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function QualityRadar({ quality }: { quality: QualityReport }) {
  const dims = Object.keys(WEIGHTS) as Dimension[];
  const option = useOption(
    (t) => ({
      textStyle: { color: t.muted },
      tooltip: { trigger: 'item', ...tooltip(t) },
      radar: {
        radius: '60%',
        indicator: dims.map((d) => ({ name: cap(d), max: 100 })),
        axisName: { color: t.muted, fontSize: 12 },
        splitNumber: 4,
        axisLine: { lineStyle: { color: t.border } },
        splitLine: { lineStyle: { color: t.border } },
        splitArea: { show: false },
      },
      series: [
        {
          type: 'radar',
          data: [{ name: 'Quality', value: dims.map((d) => Math.round(quality.dimensions[d] * 1000) / 10) }],
          symbolSize: 6,
          lineStyle: { color: t.accent, width: 2 },
          itemStyle: { color: t.accent },
          areaStyle: { color: t.accentSoft },
        },
      ],
    }),
    [quality],
  );
  return <EChart option={option} height={220} />;
}

const KIND_LABEL: Record<string, string> = { numeric: 'Numeric', text: 'Text', temporal: 'Date / time', boolean: 'Boolean', other: 'Other' };

export function TypeDonut({ profile }: { profile: DatasetProfile }) {
  const option = useOption(
    (t) => {
      const counts = new Map<string, number>();
      profile.columns.forEach((c) => counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1));
      return {
        color: t.palette,
        textStyle: { color: t.muted },
        tooltip: { trigger: 'item', ...tooltip(t), formatter: '{b}: {c} column(s) ({d}%)' },
        legend: { bottom: 0, textStyle: { color: t.muted }, icon: 'circle', itemHeight: 8 },
        series: [
          {
            type: 'pie',
            radius: ['52%', '76%'],
            center: ['50%', '44%'],
            avoidLabelOverlap: true,
            itemStyle: { borderColor: t.surface, borderWidth: 3, borderRadius: 4 },
            label: { show: true, position: 'center', formatter: `${profile.columns.length}\ncolumns`, color: t.text, fontSize: 15, fontWeight: 600, lineHeight: 20 },
            emphasis: { label: { show: true } },
            data: [...counts].map(([kind, n]) => ({ name: KIND_LABEL[kind] ?? kind, value: n })),
          },
        ],
      };
    },
    [profile],
  );
  return <EChart option={option} height={230} />;
}

export function MissingBars({ profile }: { profile: DatasetProfile }) {
  const cols = useMemo(() => profile.columns.filter((c) => c.nulls > 0).sort((a, b) => b.nullPct - a.nullPct).slice(0, 10), [profile]);
  const option = useOption(
    (t) => {
      const data = [...cols].reverse();
      return {
        textStyle: { color: t.muted },
        grid: { left: 8, right: 36, top: 8, bottom: 8, containLabel: true },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...tooltip(t), valueFormatter: (v: number) => `${v}%` },
        xAxis: { type: 'value', axisLabel: { color: t.muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: t.border, type: 'dashed' } } },
        yAxis: { type: 'category', data: data.map((c) => c.name), axisTick: { show: false }, axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.muted, width: 110, overflow: 'truncate' } },
        series: [
          {
            type: 'bar',
            barMaxWidth: 24,
            barCategoryGap: '35%',
            label: { show: true, position: 'right', color: t.muted, formatter: (x: { value: number }) => `${x.value}%` },
            data: data.map((c) => ({ value: Math.round(c.nullPct * 1000) / 10, itemStyle: { color: c.nullPct > 0.5 ? t.bad : c.nullPct > 0.05 ? t.ok : t.accent, borderRadius: [0, 3, 3, 0] } })),
          },
        ],
      };
    },
    [cols],
  );
  if (cols.length === 0) return <p className="empty-note good">No missing values in any column.</p>;
  return <EChart option={option} height={Math.max(150, cols.length * 30 + 40)} />;
}

export function IssuesByColumn({ quality }: { quality: QualityReport }) {
  const rows = useMemo(() => {
    const m = new Map<string, { error: number; warning: number; info: number }>();
    quality.issues.forEach((i) => {
      const key = i.column ?? '(whole table)';
      const r = m.get(key) ?? { error: 0, warning: 0, info: 0 };
      r[i.severity]++;
      m.set(key, r);
    });
    return [...m]
      .map(([name, r]) => ({ name, ...r, total: r.error + r.warning + r.info }))
      .sort((a, b) => b.error - a.error || b.warning - a.warning || b.total - a.total)
      .slice(0, 8);
  }, [quality]);

  const option = useOption(
    (t) => {
      const data = [...rows].reverse();
      const series = (key: 'error' | 'warning' | 'info', name: string, color: string) => ({
        name,
        type: 'bar' as const,
        stack: 'issues',
        barMaxWidth: 24,
        barCategoryGap: '35%',
        itemStyle: { color },
        data: data.map((r) => r[key]),
      });
      return {
        textStyle: { color: t.muted },
        grid: { left: 8, right: 16, top: 8, bottom: 30, containLabel: true },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...tooltip(t) },
        legend: { bottom: 0, textStyle: { color: t.muted }, icon: 'circle', itemHeight: 8 },
        xAxis: { type: 'value', minInterval: 1, axisLabel: { color: t.muted }, splitLine: { lineStyle: { color: t.border, type: 'dashed' } } },
        yAxis: { type: 'category', data: data.map((r) => r.name), axisTick: { show: false }, axisLine: { lineStyle: { color: t.border } }, axisLabel: { color: t.muted, width: 110, overflow: 'truncate' } },
        series: [series('error', 'Error', t.bad), series('warning', 'Warning', t.ok), series('info', 'Note', t.accent)],
      };
    },
    [rows],
  );
  if (rows.length === 0) return <p className="empty-note good">No issues found.</p>;
  return <EChart option={option} height={Math.max(170, rows.length * 32 + 70)} />;
}
