import { z } from 'zod';

/**
 * Components as code (0018). The code is the asset; its rendering is the picture. The same
 * document is run by the preview in the browser and rendered by the worker, so both show the same.
 */

/** Preview widths: a phone, a tablet, a laptop. */
export const COMPONENT_WIDTHS = [390, 768, 1280] as const;
export type ComponentWidth = (typeof COMPONENT_WIDTHS)[number];

export const MAX_COMPONENT_CHARS = 100_000;

/** What the model reads of the code, in characters across all three fields. */
export const COMPONENT_MODEL_BUDGET = 12_000;

const code = z.string().max(MAX_COMPONENT_CHARS);

export const ComponentCodeSchema = z
  .object({
    html: code.refine((html) => html.trim().length > 0, 'HTML is required'),
    css: code.default(''),
    js: code.default(''),
    width: z
      .number()
      .int()
      .refine((w): w is ComponentWidth => (COMPONENT_WIDTHS as readonly number[]).includes(w))
      .default(1280),
  })
  .strict();

export type ComponentCode = {
  readonly html: string;
  readonly css: string;
  readonly js: string;
  readonly width: number;
};

/** `POST /api/assets/components`: the code, and a title if the person gives one. */
export const ComponentCreateSchema = ComponentCodeSchema.extend({
  title: z.string().trim().max(200).optional(),
}).strict();

/**
 * The isolation of a component's code (0018), in the document itself: no request can leave it
 * (`connect-src 'none'`), scripts run only inline, styles, images and fonts may come over https.
 * The preview adds the sandbox around it; the worker adds the egress guard.
 */
export const COMPONENT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' https:",
  'img-src https: data: blob:',
  'font-src https: data:',
  'media-src https: data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * The document a component runs in. The policy comes first, before anything of the code: a later
 * `<meta>` policy can only add restrictions, never lift this one.
 */
export function componentDocument(
  code: Pick<ComponentCode, 'html' | 'css' | 'js'>,
  options: { reportHeight?: boolean } = {},
): string {
  // The preview cannot read an opaque-origin frame's height, so the frame tells it. The message
  // carries a number and nothing else; the parent checks it came from its own frame.
  const report = options.reportHeight
    ? `<script>(function(){var last=0;function send(){var h=Math.ceil(document.body.getBoundingClientRect().height);if(h!==last){last=h;parent.postMessage({mbComponentHeight:h},'*');}}new ResizeObserver(send).observe(document.body);addEventListener('load',send);})();</script>`
    : '';
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${COMPONENT_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>html,body{margin:0}body{padding:32px;font-family:system-ui,sans-serif}</style>',
    `<style>${code.css}</style>`,
    '</head><body>',
    code.html,
    code.js.trim() ? `<script>${code.js}</script>` : '',
    report,
    '</body></html>',
  ].join('\n');
}

/** The code as the model reads it: each field cut to its share of the budget, marked if cut. */
export function componentForModel(
  code: Pick<ComponentCode, 'html' | 'css' | 'js'>,
  budget = COMPONENT_MODEL_BUDGET,
): string {
  const fields = (['html', 'css', 'js'] as const).filter((f) => code[f].trim());
  // Short fields keep everything; what they leave over goes to the longer ones.
  let left = budget;
  const sorted = [...fields].sort((a, b) => code[a].length - code[b].length);
  const cut: Partial<Record<'html' | 'css' | 'js', string>> = {};
  sorted.forEach((field, i) => {
    const share = Math.floor(left / (sorted.length - i));
    const text = code[field].trim();
    cut[field] = text.length > share ? `${text.slice(0, share)}\n/* … cut, ${text.length - share} more characters */` : text;
    left -= Math.min(text.length, share);
  });
  return fields.map((f) => `--- ${f.toUpperCase()} ---\n${cut[f]}`).join('\n');
}
