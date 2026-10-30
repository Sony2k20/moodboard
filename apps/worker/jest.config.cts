// PGlite (the in-process Postgres of the purge integration test) loads Node built-ins with a
// dynamic `import()`, which Jest's VM only allows with this flag. Same setup as the api's
// jest.config.cts, which explains why it lives here; single-file runs need it set by hand.
if (!process.env['NODE_OPTIONS']?.includes('--experimental-vm-modules')) {
  process.env['NODE_OPTIONS'] =
    `${process.env['NODE_OPTIONS'] ?? ''} --experimental-vm-modules`.trim();
}

module.exports = {
  displayName: 'worker',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/worker',
};
