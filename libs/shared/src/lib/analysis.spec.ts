import { AnalysisRequestSchema, analysisState, MAX_FAILED_RUNS } from './analysis';

describe('analysisState', () => {
  it('is current at or above the current version, failures or not', () => {
    expect(analysisState(5, 0, 5)).toBe('current');
    expect(analysisState(5, MAX_FAILED_RUNS, 5)).toBe('current');
  });

  it('is outdated with only an older success', () => {
    expect(analysisState(4, 0, 5)).toBe('outdated');
    expect(analysisState(4, MAX_FAILED_RUNS - 1, 5)).toBe('outdated');
  });

  it('is unclassified without any success', () => {
    expect(analysisState(null, 0, 5)).toBe('unclassified');
  });

  it('is stuck once the reconciler gave up, whatever older result exists', () => {
    expect(analysisState(null, MAX_FAILED_RUNS, 5)).toBe('stuck');
    expect(analysisState(3, MAX_FAILED_RUNS + 2, 5)).toBe('stuck');
  });
});

describe('AnalysisRequestSchema', () => {
  it('takes a selection or a scope, not both', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect(AnalysisRequestSchema.safeParse({ ids: [id] }).success).toBe(true);
    expect(AnalysisRequestSchema.safeParse({ scope: 'stuck' }).success).toBe(true);
    expect(AnalysisRequestSchema.safeParse({ ids: [id], scope: 'stuck' }).success).toBe(false);
    expect(AnalysisRequestSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(AnalysisRequestSchema.safeParse({ scope: 'all' }).success).toBe(false);
  });
});
