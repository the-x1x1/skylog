import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../server/env';
import { createAppServer } from '../server/http';
import { getLlmStatus } from '../server/llm-adapter';
import { ROOT } from './lib/bundle';

const env = loadEnv(ROOT);
const root = path.join(ROOT, 'dist');
const port = Number(env.PORT ?? 4173);

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

createAppServer({ root, env }).listen(port, '127.0.0.1', () => {
  const llm = getLlmStatus(env);
  console.log(`${env.PUBLIC_APP_NAME ?? 'App'} running at http://localhost:${port}`);
  console.log(llm.available ? `Summaries: local adapter ready (${llm.vendor}, ${llm.model})` : `Summaries: local adapter off — ${llm.reason}`);
});
