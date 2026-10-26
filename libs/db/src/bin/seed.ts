import { config as loadEnv } from 'dotenv';
import { runSeed } from '../lib/seed';

loadEnv();

/** `npm run db:seed`. Safe to run repeatedly — see `seedVocabulary`. */
runSeed()
  .then((report) => {
    console.log(
      `Vocabulary seeded: ${report.facets} facets, ${report.values} values.`,
    );
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('Seeding failed:', error);
    process.exit(1);
  });
