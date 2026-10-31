import { analyseStylesheets } from './css-text';
import { ACCEPT_BUTTON_NAME } from './consent';

describe('analyseStylesheets', () => {
  const css = `
    /* a comment with { braces } */
    :root, html { --accent: #ff4f00; --radius: 16px; color: red }
    .card { border-radius: var(--radius) }
    .card:hover, .card:focus-visible { transform: translateY(-4px); box-shadow: 0 12px 32px rgba(0,0,0,.2); cursor: pointer }
    @media (min-width: 800px) {
      .button:hover { background-color: #000 !important }
      .tile:hover { transform: translateY(-4px); box-shadow: 0 12px 32px rgba(0,0,0,.2) }
    }
    @import url("x.css");
    @font-face { font-family: X; src: url("x.woff2") }
    @keyframes rise { from { opacity: 0; transform: translateY(40px) } to { opacity: 1 } }
    .quote::before { content: "{" }
  `;
  const found = analyseStylesheets([css]);

  it('counts the hover rules that change transform, shadow or colour', () => {
    expect(found.hover).toEqual([
      {
        value:
          'transform: translateY(-4px); box-shadow: 0 12px 32px rgba(0,0,0,.2)',
        count: 2,
      },
      { value: 'background-color: #000', count: 1 },
    ]);
  });

  it('keeps the keyframes, compacted', () => {
    expect(found.keyframes.get('rise')).toBe(
      '{from{opacity:0;transform:translateY(40px)}to{opacity:1}}',
    );
  });

  it('lists the custom properties declared on :root', () => {
    expect(found.rootProperties).toEqual(['--accent', '--radius']);
  });
});

describe('ACCEPT_BUTTON_NAME', () => {
  it.each([
    'Accept all',
    'Alle akzeptieren',
    'Zustimmen',
    'Accept all cookies',
    'OK',
    'Got it!',
  ])('matches %s', (name) => expect(ACCEPT_BUTTON_NAME.test(name)).toBe(true));
  it.each(['Reject all', 'Accept and pay', 'Settings', 'Alle ablehnen'])(
    'ignores %s',
    (name) => expect(ACCEPT_BUTTON_NAME.test(name)).toBe(false),
  );
});
