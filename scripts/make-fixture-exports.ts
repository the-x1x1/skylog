/**
 * Writes representative export archives to fixtures/exports/ for manual testing and the
 * end-to-end tests. Run: npm run fixtures
 */
import fs from 'node:fs';
import path from 'node:path';
import { sampleChatGptExportFiles, sampleClaudeExportFiles } from '../src/fixtures/sample-exports';
import { chatgptEdgeCaseFiles, claudeEdgeCaseFiles } from '../tests/helpers/fixtures';
import { ROOT } from './lib/bundle';
import { createZip } from '../src/utils/zip-writer';

const out = path.join(ROOT, 'fixtures/exports');
fs.mkdirSync(out, { recursive: true });

const archives: Record<string, Promise<Uint8Array>> = {
  'chatgpt-sample-export.zip': createZip(sampleChatGptExportFiles()),
  'claude-sample-export.zip': createZip(sampleClaudeExportFiles()),
  'chatgpt-edge-cases.zip': createZip(chatgptEdgeCaseFiles()),
  'claude-edge-cases.zip': createZip(claudeEdgeCaseFiles()),
  // Re-zipped with an enclosing folder, as happens when a user unzips and re-compresses.
  'chatgpt-nested-folder.zip': createZip(Object.fromEntries(Object.entries(sampleChatGptExportFiles()).map(([k, v]) => [`my-export/${k}`, v]))),
  'not-an-export.zip': createZip({ 'readme.txt': 'Just a zip with no conversations.json' }),
  'truncated-json.zip': createZip({ 'conversations.json': '[{"id":"a","mapping":{', 'chat.html': '<html></html>' }),
};

for (const [name, data] of Object.entries(archives)) {
  const bytes = await data;
  fs.writeFileSync(path.join(out, name), bytes);
  console.log(`${name.padEnd(28)} ${bytes.length.toLocaleString()} bytes`);
}
fs.writeFileSync(path.join(out, 'corrupt.zip'), 'PK\u0003\u0004 this is not really a zip file');
console.log('corrupt.zip');
