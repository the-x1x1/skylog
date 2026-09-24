/**
 * Generates a large synthetic ChatGPT export for performance testing.
 *   npx tsx scripts/make-large-export.ts [conversations=1500] [out=large-chatgpt-export.zip]
 * Not committed: output goes wherever you point it.
 */
import fs from 'node:fs';
import { PNG_1PX } from '../tests/helpers/fixtures';
import { createZip } from './lib/zip-writer';

const count = Number(process.argv[2] ?? 1500);
const out = process.argv[3] ?? 'large-chatgpt-export.zip';
const WORDS = 'walnut pyramid garden trellis sourdough starter lighthouse acrylic budget spreadsheet travel itinerary kyoto recipe bracket shelf cedar soil compost battery solar panel inverter guitar chord melody python script database index migration schema invoice client proposal marathon training interval tempo recovery'.split(' ');

let seed = 42;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = () => WORDS[Math.floor(rand() * WORDS.length)]!;
const sentence = (n: number) => Array.from({ length: n }, pick).join(' ');

const files: Record<string, string | Uint8Array> = {};
const conversations = [];
const t0 = Date.UTC(2024, 0, 1) / 1000;

for (let c = 0; c < count; c++) {
  const id = `perf-${c}`;
  const mapping: Record<string, unknown> = { [`${id}-root`]: { id: `${id}-root`, message: null, parent: null, children: [`${id}-0`] } };
  const turns = 12 + Math.floor(rand() * 24);
  const start = t0 + c * 3600 * 7;
  for (let i = 0; i < turns; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const withImage = role === 'assistant' && c % 5 === 0 && i === 3;
    const parts: unknown[] = withImage
      ? [{ content_type: 'image_asset_pointer', asset_pointer: `file-service://file-Perf${c}`, metadata: { dalle: { prompt: `A picture of ${sentence(8)}` } } }]
      : [role === 'user' ? `${sentence(10 + Math.floor(rand() * 20))}?` : `${sentence(60 + Math.floor(rand() * 200))}.`];
    if (withImage) files[`file-Perf${c}-img.png`] = PNG_1PX;
    mapping[`${id}-${i}`] = {
      id: `${id}-${i}`,
      parent: i === 0 ? `${id}-root` : `${id}-${i - 1}`,
      children: i < turns - 1 ? [`${id}-${i + 1}`] : [],
      message: {
        id: `${id}-${i}`,
        author: { role: withImage ? 'tool' : role },
        create_time: start + i * 30,
        content: { content_type: withImage ? 'multimodal_text' : 'text', parts },
        metadata: {},
        recipient: 'all',
      },
    };
  }
  conversations.push({ id, conversation_id: id, title: `${pick()} ${pick()} ${c}`, create_time: start, update_time: start + turns * 30, mapping, current_node: `${id}-${turns - 1}` });
}

files['conversations.json'] = JSON.stringify(conversations);
files['chat.html'] = '<html></html>';
const zip = await createZip(files);
fs.writeFileSync(out, zip);
console.log(`${count} conversations, ${(files['conversations.json'] as string).length.toLocaleString()} bytes of JSON, ${Object.keys(files).length - 2} images → ${out} (${zip.length.toLocaleString()} bytes zipped)`);
