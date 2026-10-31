import { EMPTY_CSS_TECHNIQUE } from '@moodboard/shared';
import { SYSTEM_PROMPT, userText } from './prompt';

describe('userText', () => {
  it('stays as before for an upload', () => {
    expect(userText({ images: [], context: { title: 'hero.png' } })).toBe(
      'Title: hero.png\n\nClassify this design reference.',
    );
  });

  it('adds the measured technique of a website as text', () => {
    const text = userText({
      images: [],
      context: {
        sourceUrl: 'https://example.com/',
        pageTitle: 'Example Studio',
        captureTech: {
          fonts: ['Inter'],
          libraries: ['GSAP', 'ScrollTrigger'],
          css: EMPTY_CSS_TECHNIQUE,
          tokens: null,
          elements: null,
        },
      },
    });
    expect(text).toContain(
      'Source: https://example.com/\nPage title: Example Studio',
    );
    expect(text).toContain(
      '{"fonts":["Inter"],"libraries":["GSAP","ScrollTrigger"]}',
    );
    expect(text.endsWith('Classify this design reference.')).toBe(true);
  });

  it('says nothing about a technique that measured nothing', () => {
    const text = userText({
      images: [],
      context: {
        captureTech: {
          fonts: [],
          libraries: [],
          css: EMPTY_CSS_TECHNIQUE,
          tokens: null,
          elements: null,
        },
      },
    });
    expect(text).toBe('Classify this design reference.');
  });

  it('keeps everything per asset out of the system prompt', () => {
    expect(SYSTEM_PROMPT).toContain(
      'measured capture technique is given, it outranks the picture',
    );
  });
});
