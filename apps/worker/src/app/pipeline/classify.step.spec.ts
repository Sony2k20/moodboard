import { AnalysisResult } from '@moodboard/shared';
import { facetAssignments } from './classify.step';

describe('facetAssignments', () => {
  it("turns single- and multi-value facets into one row per value, with the facet's confidence", () => {
    const result = {
      facets: {
        type: 'image',
        theme: 'light',
        style: ['minimal', 'swiss'],
        motion: [],
      },
      facet_confidence: { type: 0.95, theme: 0.9, style: 0.55, motion: 0.8 },
    } as unknown as AnalysisResult;
    expect(facetAssignments(result)).toEqual([
      { facet: 'type', value: 'image', confidence: 0.95 },
      { facet: 'theme', value: 'light', confidence: 0.9 },
      { facet: 'style', value: 'minimal', confidence: 0.55 },
      { facet: 'style', value: 'swiss', confidence: 0.55 },
    ]);
  });
});
