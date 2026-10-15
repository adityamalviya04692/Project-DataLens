import { describe, expect, it } from 'vitest';
import { binLabels, chartSql, histogramRange, recommendCharts } from './charts';
import { col, dataset } from './testUtils';

const profile = dataset(
  [
    col('order_id', 'VARCHAR', { distinct: 100 }),
    col('order_date', 'DATE', { distinct: 90, min: '2024-01-01', max: '2025-12-31' }),
    col('city', 'VARCHAR', { distinct: 8 }),
    col('price', 'DOUBLE', { distinct: 95, min: '10', max: '210' }),
    col('quantity', 'BIGINT', { distinct: 9, min: '1', max: '9' }),
    col('currency', 'VARCHAR', { distinct: 1 }),
  ],
  100,
);

describe('chart recommendations', () => {
  const specs = recommendCharts(profile);
  const ids = specs.map((s) => s.id);

  it('picks charts by column type and skips identifiers and constants', () => {
    expect(ids).toEqual(['ts:order_date', 'heatmap', 'hist:price', 'hist:quantity', 'bar:city']);
  });

  it('caps the number of charts', () => {
    expect(recommendCharts(profile, 2)).toHaveLength(2);
  });

  it('chooses the time grain from the date span', () => {
    expect(chartSql(specs[0], profile)).toContain("date_trunc('week', \"order_date\")");
    const longer = dataset([col('d', 'DATE', { distinct: 900, min: '2020-01-01', max: '2025-12-31' })]);
    expect(chartSql(recommendCharts(longer)[0], longer)).toContain("date_trunc('month', \"d\")");
  });

  it('bins histograms into equal widths and clamps the max into the last bin', () => {
    const sql = chartSql(specs.find((s) => s.id === 'hist:price')!, profile);
    expect(sql).toContain('("price" - 10) / 10');
    expect(sql).toContain('LEAST(');
  });

  it('builds only the upper triangle of the correlation matrix', () => {
    const sql = chartSql(specs.find((s) => s.kind === 'heatmap')!, profile);
    expect(sql.match(/corr\(/g)).toHaveLength(1);
  });

  it('uses one bar per value for small integer ranges', () => {
    const r = histogramRange(profile.columns.find((c) => c.name === 'quantity')!);
    expect(r).toMatchObject({ integer: true, lo: 1, bins: 9, width: 1 });
    expect(binLabels(r).slice(0, 3)).toEqual(['1', '2', '3']);
  });

  it('clips to the IQR fences so outliers do not squash the histogram', () => {
    const c = col('price', 'DOUBLE', { min: '0', max: '100000', q25: 100, q75: 200 });
    const r = histogramRange(c);
    expect(r).toMatchObject({ lo: 0, hi: 350, clippedLow: false, clippedHigh: true });
    const labels = binLabels(r);
    expect(labels[0]).toBe('0 – 17.5');
    expect(labels[labels.length - 1]).toBe('≥ 333');
    expect(recommendCharts(dataset([c, col('other', 'DOUBLE', { min: '0', max: '1' })]))[1].subtitle).toContain('outliers grouped');
  });
});
