import { describe, expect, it } from 'vitest';
import type { ChartSpec } from './charts';
import { buildInsights, correlationStrength, describeSpan, EMPTY_EXTRAS, type InsightExtras } from './insights';
import { assessQuality } from './quality';
import { pearson, slotCounts, takeaway } from './takeaways';
import { col, dataset } from './testUtils';

const profile = dataset(
  [
    col('order_id', 'VARCHAR', { distinct: 100 }),
    col('order_date', 'DATE', { distinct: 90, min: '2024-01-01', max: '2025-12-31' }),
    col('payment', 'VARCHAR', { distinct: 4 }),
    col('price', 'DOUBLE', { distinct: 95, min: '10', max: '900', mean: 150, q50: 80, q25: 50, q75: 120, outliers: 6 }),
    col('quantity', 'BIGINT', { distinct: 9, min: '1', max: '9', mean: 2.5, q50: 2, outliers: 1 }),
    col('discount', 'DOUBLE', { count: 80, distinct: 5 }),
    col('currency', 'VARCHAR', { distinct: 1 }),
  ],
  100,
  4,
);

const extras: InsightExtras = {
  correlations: [{ a: 'price', b: 'quantity', r: 0.72 }],
  skew: { price: 3.4, quantity: 0.4 },
  categories: [{ column: 'payment', distinct: 4, total: 100, top: [{ value: 'UPI', n: 62 }, { value: 'Card', n: 20 }] }],
  time: {
    column: 'order_date',
    min: '2024-01-01',
    max: '2025-12-31',
    spanDays: 730,
    peakMonth: { label: 'Oct 2024', n: 18 },
    busiestDay: { label: 'Saturday', n: 20 },
    quietestDay: { label: 'Tuesday', n: 9 },
  },
};

const insights = buildInsights(profile, assessQuality(profile), extras);
const byId = (id: string) => insights.find((i) => i.id === id);

describe('buildInsights', () => {
  it('summarises shape and the quality score first', () => {
    expect(insights[0].title).toBe('100 rows × 7 columns');
    expect(insights[0].detail).toBe('3 numeric · 3 text · 1 date/time');
    expect(insights[1].id).toBe('score');
  });

  it('describes the time coverage with peak month and weekday', () => {
    const t = byId('time')!;
    expect(t.title).toBe('order_date spans 2.0 years');
    expect(t.detail).toContain('Busiest month: Oct 2024 (18% of rows)');
    expect(t.detail).toContain('Saturday is the busiest weekday');
  });

  it('calls out strong correlations and dominant categories', () => {
    expect(byId('corr')?.title).toBe('price and quantity move together');
    expect(byId('corr')?.detail).toContain('strong positive');
    expect(byId('cat:payment')).toMatchObject({ tone: 'warn', title: '“UPI” dominates payment' });
  });

  it('flags skew, outliers, missing data, duplicates and constants', () => {
    expect(byId('skew:price')?.title).toBe('price is heavily right-skewed');
    expect(byId('skew:price')?.detail).toContain('mean 150 vs median 80');
    // price already has a skew insight, so only the other outlier column is reported.
    expect(byId('out:price')).toBeUndefined();
    expect(byId('out:quantity')?.detail).toContain('1 of 100 values (1.0%)');
    expect(byId('missing')?.title).toBe('discount is 20% missing');
    expect(byId('dups')?.title).toBe('4 duplicate rows (4.0%)');
    expect(byId('constant')?.detail).toContain('currency');
  });

  it('reports a clean bill of health when nothing is wrong', () => {
    const clean = dataset([col('a', 'DOUBLE', { distinct: 50 })]);
    const out = buildInsights(clean, assessQuality(clean), EMPTY_EXTRAS);
    expect(out.map((i) => i.id)).toEqual(['shape', 'score', 'missing', 'dups']);
    expect(out.slice(2).every((i) => i.tone === 'good')).toBe(true);
  });

  it('says so when no relationship is strong', () => {
    const weak = buildInsights(profile, assessQuality(profile), { ...EMPTY_EXTRAS, correlations: [{ a: 'x', b: 'y', r: 0.05 }] });
    expect(weak.find((i) => i.id === 'corr')?.title).toBe('No strong linear relationships');
  });

  it('never returns more than 12 insights', () => {
    expect(insights.length).toBeLessThanOrEqual(12);
  });
});

describe('helpers', () => {
  it('describes spans and correlation strength', () => {
    expect([20, 200, 800].map(describeSpan)).toEqual(['20 days', '7 months', '2.2 years']);
    expect([0.9, 0.65, 0.45, 0.25, 0.05].map(correlationStrength)).toEqual(['very strong', 'strong', 'moderate', 'weak', 'no']);
  });

  it('computes Pearson correlation', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pearson([1, 2], [1, 2])).toBeNull();
  });

  it('zero-fills calendar slots', () => {
    expect(slotCounts([{ dow: 2, n: 5 }, { dow: 7, n: 1 }], 'dow', 7)).toEqual([0, 5, 0, 0, 0, 0, 1]);
  });
});

describe('chart takeaways', () => {
  const spec = (kind: ChartSpec['kind'], columns: string[]): ChartSpec => ({ id: kind, kind, section: 'Trends', columns, title: '', subtitle: '' });

  it('summarises a time series with peak and trend', () => {
    const rows = [10, 12, 11, 30, 14, 40, 42, 45, 44].map((n, i) => ({ period: `2025-0${i + 1}-01`, n }));
    expect(takeaway(spec('timeseries', ['order_date']), rows, profile)).toBe('Peak: 2025-08-01 (45 rows). Up 297% from the first to the last third.');
  });

  it('names the busiest and quietest weekday', () => {
    const rows = [{ dow: 1, n: 10 }, { dow: 2, n: 30 }, { dow: 3, n: 20 }, { dow: 4, n: 20 }, { dow: 5, n: 10 }, { dow: 6, n: 5 }, { dow: 7, n: 5 }];
    expect(takeaway(spec('weekday', ['order_date']), rows, profile)).toBe('Busiest: Tue (30%). Quietest: Sat (5.0%).');
  });

  it('compares groups in a box plot', () => {
    const rows = [{ label: 'Electronics', q50: 2400 }, { label: 'Books', q50: 300 }];
    expect(takeaway(spec('boxplot', ['category', 'price']), rows, profile)).toContain('highest for “Electronics” (2,400) and lowest for “Books” (300) (8.0× gap)');
  });

  it('describes scatter relationships from the sample', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ x: i, y: i * 2 + 1 }));
    expect(takeaway(spec('scatter', ['a', 'b']), rows, profile)).toContain('very strong positive');
  });

  it('finds the strongest pair in a correlation matrix', () => {
    const rows = [{ r_0_1: 0.1, r_0_2: -0.8, r_1_2: 0.3 }];
    expect(takeaway(spec('heatmap', ['a', 'b', 'c']), rows, profile)).toBe('Strongest pair: a ↔ c (r = -0.80).');
  });

  it('flags a right tail in a histogram', () => {
    expect(takeaway(spec('histogram', ['price']), [], profile)).toBe('Median 80, mean 150. A long right tail pulls the mean above the median. 6 outliers fall outside the fences.');
  });
});
