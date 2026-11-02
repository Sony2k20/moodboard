import {
  COMPONENT_CSP,
  ComponentCodeSchema,
  componentDocument,
  componentForModel,
  MAX_COMPONENT_CHARS,
} from './component';
import { nextPipelineStep, pipelineKindOf, pipelineQueueOf, CAPTURE_QUEUE } from './pipeline';

describe('componentDocument', () => {
  it('puts the policy before any of the code', () => {
    const doc = componentDocument({ html: '<button>Go</button>', css: 'button{color:red}', js: 'console.log(1)' });
    const policy = doc.indexOf(COMPONENT_CSP);
    expect(policy).toBeGreaterThan(-1);
    expect(policy).toBeLessThan(doc.indexOf('button{color:red}'));
    expect(policy).toBeLessThan(doc.indexOf('<button>'));
    expect(doc).toContain('<script>console.log(1)</script>');
  });

  it('allows no request out and no script by URL', () => {
    expect(COMPONENT_CSP).toContain("connect-src 'none'");
    expect(COMPONENT_CSP).toContain("script-src 'unsafe-inline'");
    expect(COMPONENT_CSP).not.toMatch(/script-src[^;]*https/);
  });

  it('leaves the script out when there is none', () => {
    expect(componentDocument({ html: '<p>x</p>', css: '', js: '  ' })).not.toContain('<script>');
  });
});

describe('ComponentCodeSchema', () => {
  it('needs HTML, defaults the rest, and knows the widths', () => {
    expect(ComponentCodeSchema.parse({ html: '<p>x</p>' })).toEqual({ html: '<p>x</p>', css: '', js: '', width: 1280 });
    expect(ComponentCodeSchema.safeParse({ html: '  ' }).success).toBe(false);
    expect(ComponentCodeSchema.safeParse({ html: 'x', width: 1000 }).success).toBe(false);
    expect(ComponentCodeSchema.safeParse({ html: 'x'.repeat(MAX_COMPONENT_CHARS + 1) }).success).toBe(false);
  });
});

describe('componentForModel', () => {
  it('keeps short code whole and cuts long code to the budget, saying so', () => {
    const text = componentForModel({ html: '<b>hi</b>', css: 'a'.repeat(500), js: '' }, 300);
    expect(text).toContain('--- HTML ---\n<b>hi</b>');
    expect(text).not.toContain('--- JS ---');
    expect(text).toContain('cut, ');
    expect(text.length).toBeLessThan(400);
  });
});

describe('the component pipeline', () => {
  it('renders in the browser queue, then follows the image steps', () => {
    expect(pipelineKindOf('component')).toBe('component');
    expect(pipelineQueueOf('render')).toBe(CAPTURE_QUEUE);
    expect(nextPipelineStep('render', 'component')).toBe('thumbnails');
  });
});
