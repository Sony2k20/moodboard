#!/usr/bin/env node
/**
 * Compares the key sets of the Transloco translation files.
 *
 * Transloco gives up compile-time key checking in exchange for switching language at runtime
 * (concept §13.1); this is the mitigation named there. It runs in CI and, while the files do not
 * exist yet, passes with a note rather than failing — so the check is in place before the first
 * key is written instead of after the two files have drifted.
 */
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const I18N_DIR = 'apps/web/public/i18n';
const LOCALES = ['en', 'de'];

/** Flattens `{a: {b: 1}}` to `['a.b']`, because nesting is where silent drift hides. */
function keysOf(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, nested]) =>
    keysOf(nested, prefix ? `${prefix}.${key}` : key),
  );
}

const files = LOCALES.map((locale) => ({
  locale,
  path: join(I18N_DIR, `${locale}.json`),
}));

const missingFiles = [];
for (const file of files) {
  try {
    await access(file.path);
  } catch {
    missingFiles.push(file.path);
  }
}

if (missingFiles.length === files.length) {
  console.log(
    `No translation files yet (${I18N_DIR}). Nothing to compare — the check is in place for ` +
      'when Transloco is set up.',
  );
  process.exit(0);
}

if (missingFiles.length > 0) {
  console.error(`Missing translation file(s): ${missingFiles.join(', ')}`);
  process.exit(1);
}

const loaded = await Promise.all(
  files.map(async (file) => ({
    locale: file.locale,
    keys: new Set(keysOf(JSON.parse(await readFile(file.path, 'utf8')))),
  })),
);

const [reference, ...others] = loaded;
let failed = false;

for (const other of others) {
  const missing = [...reference.keys].filter((key) => !other.keys.has(key));
  const extra = [...other.keys].filter((key) => !reference.keys.has(key));

  for (const key of missing) {
    console.error(`${other.locale}.json is missing: ${key}`);
    failed = true;
  }
  for (const key of extra) {
    console.error(`${other.locale}.json has a key ${reference.locale}.json does not: ${key}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  `Translation keys match across ${loaded.map((l) => l.locale).join(', ')} ` +
    `(${reference.keys.size} keys).`,
);
