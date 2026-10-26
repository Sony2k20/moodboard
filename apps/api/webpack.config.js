const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, '../../dist/apps/api'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      // The migration runner ships inside the api image rather than as a fourth image: the
      // PreSync job (§4.11) then runs `node migrate.js` from the same bundle the rollout uses,
      // so the schema and the code that expects it can never come from different builds.
      additionalEntryPoints: [
        { entryName: 'migrate', entryPath: './src/migrate.ts' },
      ],
      tsConfig: './tsconfig.app.json',
      // The SQL lives next to the bundle; `runMigrations` is told where to look.
      assets: [
        './src/assets',
        {
          input: '../../libs/db/migrations',
          glob: '**/*',
          output: 'migrations',
        },
      ],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: true,
      sourceMap: true,
    }),
  ],
};
