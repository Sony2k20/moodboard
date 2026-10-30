import { AnalysisResult } from '@moodboard/shared';
import { facetAssignments } from './classify.step';

describe('facetAssignments', () => {
  it('turns single- and multi-value facets into one row per value', () => {
    const result = {
      facets: {
        type: 'image',
        theme: 'light',
        style: ['minimal', 'swiss'],
        motion: [],
      },
    } as unknown as AnalysisResult;
    expect(facetAssignments(result)).toEqual([
      { facet: 'type', value: 'image' },
      { facet: 'theme', value: 'light' },
      { facet: 'style', value: 'minimal' },
      { facet: 'style', value: 'swiss' },
    ]);
  });
});
