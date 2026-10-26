module.exports = {
  displayName: 'classify',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  // No unit tests here yet: the db library's behaviour lives in SQL and is verified against a
  // real Postgres, and classify holds only the port interface.
  passWithNoTests: true,
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/classify',
};
