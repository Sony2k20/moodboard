// PGlite (the in-process Postgres of the search integration tests) loads Node built-ins with a
// dynamic `import()`, which Jest's VM only allows with this flag. Set here rather than in the
// target because the Nx Jest plugin owns the target; the test workers inherit it from this process.
// A run Jest decides to do in-band (a single test file) has no workers: start that one with
// `NODE_OPTIONS=--experimental-vm-modules` yourself.
if (!process.env['NODE_OPTIONS']?.includes('--experimental-vm-modules')) {
  process.env['NODE_OPTIONS'] =
    `${process.env['NODE_OPTIONS'] ?? ''} --experimental-vm-modules`.trim();
}

module.exports = {
  displayName: 'api',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/api',
};
