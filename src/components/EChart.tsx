import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, BoxplotChart, HeatmapChart, LineChart, PieChart, RadarChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, RadarComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([
  BarChart,
  BoxplotChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  RadarComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export interface ThemeColors {
  accent: string;
  accentSoft: string;
  text: string;
  muted: string;
  border: string;
  surface: string;
  pos: string;
  neg: string;
  good: string;
  ok: string;
  bad: string;
  /** Categorical series colours, in order. */
  palette: string[];
}

export function readTheme(): ThemeColors {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    accent: v('--accent'),
    accentSoft: v('--accent-soft'),
    text: v('--text'),
    muted: v('--text-muted'),
    border: v('--border'),
    surface: v('--surface'),
    pos: v('--chart-pos'),
    neg: v('--chart-neg'),
    good: v('--good'),
    ok: v('--ok'),
    bad: v('--bad'),
    palette: [1, 2, 3, 4, 5, 6, 7].map((i) => v(`--c${i}`)),
  };
}

/** Re-render charts when the OS switches between light and dark mode. */
export function useColorScheme(): string {
  const [scheme, setScheme] = useState(() => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setScheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return scheme;
}

export default function EChart({ option, height = 280 }: { option: EChartsCoreOption; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const chart = echarts.init(el.current, undefined, { renderer: 'canvas' });
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const render = () => chart.setOption({
      ...option,
      animation: !motion.matches,
      animationDuration: 280,
      animationDurationUpdate: 180,
      animationEasing: 'cubicOut',
      animationEasingUpdate: 'cubicOut',
    });
    render();
    motion.addEventListener('change', render);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      motion.removeEventListener('change', render);
      chart.dispose();
    };
  }, [option]);
  return <div className="chart-canvas" ref={el} style={{ width: '100%', height }} />;
}
