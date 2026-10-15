import { describe, expect, it } from 'vitest';
import { assessQuality, dimensionScores, findIssues, grade, invalidCells, isNumericText } from './quality';
import { col, dataset } from './testUtils';

describe('quality checks', () => {
  it('gives a clean dataset a perfect score and no issues', () => {
    const p = dataset([col('amount', 'DOUBLE', { distinct: 80 }), col('city', 'VARCHAR', { distinct: 5 })]);
    const q = assessQuality(p);
    expect(q.score).toBe(100);
    expect(q.grade).toBe('A');
    expect(q.issues).toEqual([]);
  });

  it('flags duplicate rows as an error above 5%', () => {
    const issues = findIssues(dataset([col('a', 'INTEGER')], 100, 10));
    expect(issues[0]).toMatchObject({ title: 'Duplicate rows', severity: 'error', affected: 10 });
  });

  it('grades missing values by severity', () => {
    const p = dataset([
      col('few', 'INTEGER', { count: 99 }),
      col('some', 'INTEGER', { count: 80 }),
      col('most', 'INTEGER', { count: 30 }),
    ]);
    const sev = Object.fromEntries(findIssues(p).filter((i) => i.title === 'Missing values').map((i) => [i.column, i.severity]));
    expect(sev).toEqual({ few: 'info', some: 'warning', most: 'error' });
  });

  it('reports empty columns once and skips other checks for them', () => {
    const issues = findIssues(dataset([col('blank', 'VARCHAR', { count: 0, distinct: 0 })]));
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe('Empty column');
  });

  it('detects numbers stored as text', () => {
    const c = col('delivery_days', 'VARCHAR', { numericLike: 97 });
    expect(isNumericText(c)).toBe(true);
    const issue = findIssues(dataset([c])).find((i) => i.title === 'Numbers stored as text');
    expect(issue?.affected).toBe(3);
    expect(isNumericText(col('city', 'VARCHAR', { numericLike: 10 }))).toBe(false);
  });

  it('only flags negatives where the column name implies a non-negative quantity', () => {
    const p = dataset([col('quantity', 'BIGINT', { negatives: 4 }), col('temperature', 'DOUBLE', { negatives: 30 })]);
    const flagged = findIssues(p).filter((i) => i.title === 'Unexpected negatives').map((i) => i.column);
    expect(flagged).toEqual(['quantity']);
  });

  it('warns about repeated values in key-like columns', () => {
    const issues = findIssues(dataset([col('order_id', 'VARCHAR', { distinct: 95 })]));
    expect(issues.find((i) => i.title === 'Duplicate keys')?.affected).toBe(5);
  });

  it('sorts errors before warnings before info', () => {
    const p = dataset([col('a', 'INTEGER', { count: 99 }), col('b', 'VARCHAR', { whitespace: 3 }), col('c', 'INTEGER', { count: 0, distinct: 0 })]);
    expect(findIssues(p).map((i) => i.severity)).toEqual(['error', 'warning', 'info']);
  });

  it('caps invalid cells at the non-null count', () => {
    expect(invalidCells(col('x', 'VARCHAR', { count: 10, whitespace: 8, empty: 8 }, 10))).toBe(10);
  });

  it('computes dimension scores from the profile', () => {
    const p = dataset([col('a', 'INTEGER', { count: 50 }), col('b', 'VARCHAR', { whitespace: 10 })], 100, 20);
    const d = dimensionScores(p);
    expect(d.completeness).toBeCloseTo(0.75);
    expect(d.uniqueness).toBeCloseTo(0.8);
    expect(d.validity).toBeCloseTo(0.95);
    expect(d.consistency).toBe(1);
  });

  it('handles an empty table without dividing by zero', () => {
    const q = assessQuality(dataset([col('a', 'INTEGER', { count: 0 }, 0)], 0));
    expect(Number.isFinite(q.score)).toBe(true);
  });

  it('maps scores to letter grades', () => {
    expect([95, 85, 75, 65, 10].map(grade)).toEqual(['A', 'B', 'C', 'D', 'F']);
  });
});
