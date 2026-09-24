/**
 * SAMPLE export data, shaped exactly like real ChatGPT and Claude exports. Used by
 * "Use sample journal" (imported through the real importers), by the fixture-zip script, and by
 * tests. Never shown as real user content: entries created from it carry an isSample flag.
 */
import { GARDEN_LAYOUT_V1_SVG, GARDEN_LAYOUT_V2_SVG, HOLO_CONCEPT_SVG, HOLO_NIGHT_SVG, USER_DESK_SVG } from './sample-images';

const t = (iso: string) => Date.parse(iso) / 1000;

interface GptTurn {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  time: string;
  text?: string;
  parts?: unknown[];
  contentType?: string;
  recipient?: string;
  authorName?: string;
  metadata?: Record<string, unknown>;
}

/** Builds a ChatGPT "mapping" tree for a linear conversation (root → system → turns). */
function gptMapping(conversationId: string, turns: GptTurn[]) {
  const mapping: Record<string, unknown> = {};
  const rootId = `${conversationId}-root`;
  mapping[rootId] = { id: rootId, message: null, parent: null, children: [`${conversationId}-sys`] };
  mapping[`${conversationId}-sys`] = {
    id: `${conversationId}-sys`,
    message: {
      id: `${conversationId}-sys`,
      author: { role: 'system', name: null, metadata: {} },
      create_time: null,
      content: { content_type: 'text', parts: [''] },
      metadata: { is_visually_hidden_from_conversation: true },
      recipient: 'all',
    },
    parent: rootId,
    children: turns[0] ? [turns[0].id] : [],
  };
  let parent = `${conversationId}-sys`;
  turns.forEach((turn, i) => {
    const next = turns[i + 1];
    mapping[turn.id] = {
      id: turn.id,
      message: {
        id: turn.id,
        author: { role: turn.role, name: turn.authorName ?? null, metadata: {} },
        create_time: t(turn.time),
        update_time: null,
        content: turn.parts
          ? { content_type: turn.contentType ?? 'multimodal_text', parts: turn.parts }
          : { content_type: turn.contentType ?? 'text', parts: [turn.text ?? ''] },
        status: 'finished_successfully',
        end_turn: turn.role === 'assistant' ? true : null,
        weight: 1,
        metadata: turn.metadata ?? {},
        recipient: turn.recipient ?? 'all',
      },
      parent,
      children: next ? [next.id] : [],
    };
    parent = turn.id;
  });
  return { mapping, current_node: turns.at(-1)?.id ?? rootId };
}

const HOLO_PROMPT_1 =
  'A small clear PETG pyramid hologram display on a walnut desk in a dim room, a glowing blue jellyfish floating inside the pyramid, the tablet hidden beneath a slim walnut base, warm desk lamp in the background, product photography.';
const HOLO_PROMPT_2 =
  'The same walnut hologram box at night, lid closed, only the clear pyramid visible on top with the jellyfish glowing bright cyan, dark room, soft reflection on the desk.';

export const HOLOGRAM_ID = 'sample-6f1c2a9e-hologram';
export const SOURDOUGH_ID = 'sample-2b7d51c4-sourdough';
export const GARDEN_ID = 'sample-9a4e7b10-garden';

function hologramConversation() {
  const turns: GptTurn[] = [
    {
      id: 'holo-m00',
      role: 'user',
      time: '2026-09-12T05:04:00Z',
      text: 'I want to build a tabletop hologram display for my desk — the kind where a floating image appears inside a clear pyramid. Is that realistic with a tablet?',
    },
    {
      id: 'holo-m01',
      role: 'assistant',
      time: '2026-09-12T05:04:20Z',
      text: "Yes — that's a Pepper's ghost pyramid, and a tablet works well for it.\n\nHow it works: four transparent panels form an upside-down pyramid over the screen. The tablet plays a video with the same subject repeated four times, rotated to face each edge. Each panel reflects one copy at 45°, so the image appears to float in the middle.\n\nWhat matters most:\n1. Panel angle — the faces must sit at 45° to the screen.\n2. A black background in the video, and a dim room.\n3. Clean, thin, very clear sheet material so the reflection stays sharp.",
    },
    {
      id: 'holo-m02',
      role: 'user',
      time: '2026-09-12T05:06:10Z',
      text: "Let's plan it for my 11-inch iPad. What size should the pyramid be, and should I use acrylic or PETG?",
    },
    {
      id: 'holo-m03',
      role: 'assistant',
      time: '2026-09-12T05:06:40Z',
      text: 'For an 11-inch iPad the usable screen is about 16 × 23 cm, so a pyramid with a 15 cm base fits comfortably.\n\nPanel template (cut 4): trapezoid, bottom edge 15 cm, top edge 1.5 cm, height 8.5 cm.\n\nMaterial:\n- 1 mm clear PETG: cuts with a craft knife and a ruler, forgiving, slightly softer reflection.\n- 2 mm acrylic: sharper reflection, but needs scoring and snapping and chips easily.\n\nFor a first build, PETG is the safer choice.',
    },
    {
      id: 'holo-m04',
      role: 'user',
      time: '2026-09-12T05:08:02Z',
      text: 'Go with 1 mm PETG. Can you make me a concept image of the finished piece on a walnut desk?',
    },
    {
      id: 'holo-m05',
      role: 'assistant',
      time: '2026-09-12T05:08:10Z',
      recipient: 'dalle.text2im',
      contentType: 'code',
      text: JSON.stringify({ size: '1792x1024', prompt: HOLO_PROMPT_1 }),
    },
    {
      id: 'holo-m06',
      role: 'tool',
      authorName: 'dalle.text2im',
      time: '2026-09-12T05:08:40Z',
      parts: [
        {
          content_type: 'image_asset_pointer',
          asset_pointer: 'file-service://file-HoloConcept01',
          size_bytes: 412330,
          width: 1792,
          height: 1024,
          metadata: { dalle: { gen_id: 'gen-holo-01', prompt: HOLO_PROMPT_1, seed: 1337 } },
        },
      ],
    },
    {
      id: 'holo-m07',
      role: 'assistant',
      time: '2026-09-12T05:08:55Z',
      text: 'Here is a concept: the pyramid sits on a slim walnut base that hides the iPad, with the jellyfish loop floating inside.',
    },
    {
      id: 'holo-m08',
      role: 'user',
      time: '2026-09-12T05:11:30Z',
      text: "Love it. Let's hide the iPad inside a walnut box so only the pyramid shows. What parts do I need?",
    },
    {
      id: 'holo-m09',
      role: 'assistant',
      time: '2026-09-12T05:12:05Z',
      text: 'Parts list for the walnut-box version:\n\n- 1 mm clear PETG sheet, A4 — 1 sheet (enough for two pyramids)\n- Walnut board, 12 × 300 × 300 mm — 1\n- Clear UV-cure glue — 1 tube\n- Black matte vinyl, 20 × 30 cm — 1 (lines the box so no light leaks)\n- Neodymium magnets, 6 × 2 mm — 4 (hold the lid)\n- Felt pads — 4\n\nTools: craft knife, steel ruler, fine sandpaper (400 grit), and a small square for the 45° check.',
    },
    {
      id: 'holo-m10',
      role: 'user',
      time: '2026-09-12T05:14:20Z',
      parts: [
        {
          content_type: 'image_asset_pointer',
          asset_pointer: 'file-service://file-UserDesk02',
          size_bytes: 238112,
          width: 1200,
          height: 900,
          metadata: null,
        },
        "Here's my desk. Would a 20 cm wide box fit next to the monitor stand?",
      ],
      metadata: { attachments: [{ id: 'file-UserDesk02', name: 'desk-photo.jpg', size: 238112, mime_type: 'image/jpeg', width: 1200, height: 900 }] },
    },
    {
      id: 'holo-m11',
      role: 'assistant',
      time: '2026-09-12T05:14:50Z',
      text: 'Yes. The open area to the left of the monitor stand looks like roughly 26 × 17 cm, so a box with a 20 × 20 cm footprint fits with a little margin. Keep it about 10 cm from the window side so daylight does not wash out the reflection.',
    },
    {
      id: 'holo-m12',
      role: 'user',
      time: '2026-09-12T05:17:00Z',
      text: 'Make one more render: box closed, pyramid glowing, nighttime.',
    },
    {
      id: 'holo-m13',
      role: 'assistant',
      time: '2026-09-12T05:17:05Z',
      recipient: 't2uay3k.sj1i4kz',
      contentType: 'code',
      text: JSON.stringify({ prompt: HOLO_PROMPT_2, size: '1536x1024', n: 1 }),
    },
    {
      id: 'holo-m14',
      role: 'tool',
      authorName: 't2uay3k.sj1i4kz',
      time: '2026-09-12T05:17:50Z',
      parts: [
        {
          content_type: 'image_asset_pointer',
          asset_pointer: 'sediment://file_00000000HoloNight03',
          size_bytes: 356004,
          width: 1536,
          height: 1024,
          metadata: { dalle: null, generation: { gen_id: 'gen-holo-03' } },
        },
      ],
      metadata: { image_gen_title: 'Walnut hologram box at night' },
    },
    {
      id: 'holo-m15',
      role: 'assistant',
      time: '2026-09-12T05:18:10Z',
      text: 'Here is the night version. Before gluing anything: print the trapezoid template, cut one test panel, and check the 45° angle against the iPad with a looping four-way video.',
    },
    {
      id: 'holo-m16',
      role: 'user',
      time: '2026-09-12T05:19:30Z',
      text: "Great. I'll cut the template this weekend and find a four-way jellyfish video to test with.",
    },
  ];
  const { mapping, current_node } = gptMapping(HOLOGRAM_ID, turns);
  return {
    title: 'Tabletop hologram display',
    create_time: t('2026-09-12T05:04:00Z'),
    update_time: t('2026-09-12T05:19:30Z'),
    mapping,
    moderation_results: [],
    current_node,
    plugin_ids: null,
    conversation_id: HOLOGRAM_ID,
    conversation_template_id: null,
    gizmo_id: null,
    is_archived: false,
    safe_urls: [],
    default_model_slug: 'gpt-4o',
    id: HOLOGRAM_ID,
  };
}

function sourdoughConversation() {
  const turns: GptTurn[] = [
    {
      id: 'sour-m00',
      role: 'user',
      time: '2026-08-14T16:20:00Z',
      text: 'My sourdough starter doubles in about 10 hours but smells like nail polish by the evening. I feed it 1:1:1 once a day with all-purpose flour. What am I doing wrong?',
    },
    {
      id: 'sour-m01',
      role: 'assistant',
      time: '2026-08-14T16:20:30Z',
      text: 'An acetone smell means the starter is hungry — it ran out of food hours before the next feeding. Two fixes:\n\n1. Feed at a higher ratio, like 1:3:3 (starter:flour:water by weight), so it takes longer to peak.\n2. Add 10–20% whole-wheat or rye flour for more food and a more stable culture.\n\nKeep it somewhere around 24–26 °C and feed when it has just peaked and started to fall.',
    },
    {
      id: 'sour-m02',
      role: 'user',
      time: '2026-08-14T16:25:10Z',
      text: 'If I switch to 1:3:3 with 20% rye, when would I bake? I want to mix dough at 8am on Saturday.',
    },
    {
      id: 'sour-m03',
      role: 'assistant',
      time: '2026-08-14T16:25:40Z',
      text: 'At 1:3:3 it should peak in roughly 12 hours at 24 °C. Feed it Friday at 8pm and it will be ready for an 8am mix on Saturday. Do a float test or check for a domed top with lots of bubbles before you mix.',
    },
    { id: 'sour-m04', role: 'user', time: '2026-08-14T16:27:00Z', text: 'Thanks!' },
  ];
  const { mapping, current_node } = gptMapping(SOURDOUGH_ID, turns);
  return {
    title: 'Sourdough starter smells like acetone',
    create_time: t('2026-08-14T16:20:00Z'),
    update_time: t('2026-08-14T16:27:00Z'),
    mapping,
    current_node,
    conversation_id: SOURDOUGH_ID,
    id: SOURDOUGH_ID,
    is_archived: false,
    default_model_slug: 'gpt-4o',
  };
}

export function sampleChatGptConversations() {
  return [hologramConversation(), sourdoughConversation()];
}

function artifactBlock(command: 'create' | 'rewrite', content: string) {
  return {
    type: 'tool_use',
    name: 'artifacts',
    input: { id: 'side-yard-layout', command, type: 'image/svg+xml', title: 'Side-yard bed layout', content },
  };
}

export function sampleClaudeConversations() {
  return [
    {
      uuid: GARDEN_ID,
      name: 'Raised beds for the side yard',
      summary: '',
      created_at: '2026-09-06T18:02:11.000000Z',
      updated_at: '2026-09-06T18:31:45.000000Z',
      account: { uuid: 'sample-account' },
      chat_messages: [
        {
          uuid: 'garden-m00',
          text: '',
          content: [
            {
              type: 'text',
              text: "I have a 3 m × 1.2 m strip along the side of my house that gets about 6 hours of morning sun. I'd like to grow herbs, cherry tomatoes and lettuce. Here's a photo of the space.",
            },
          ],
          sender: 'human',
          created_at: '2026-09-06T18:02:11.000000Z',
          updated_at: '2026-09-06T18:02:11.000000Z',
          attachments: [],
          files: [{ file_name: 'side-yard.jpg', file_uuid: 'f3a1c2d4-side-yard', file_kind: 'image' }],
        },
        {
          uuid: 'garden-m01',
          text: '',
          content: [
            {
              type: 'text',
              text: "Six hours of morning sun is enough for all three. I'd split the strip into two 1.2 × 0.9 m beds with a 0.5 m gravel path between them so you can reach every plant without stepping on soil.\n\nPut the tomatoes where they won't shade the rest as they grow, keep herbs closest to the kitchen door, and give lettuce the spot that gets afternoon shade from the wall.\n\nFor soil, a 60/30/10 mix of topsoil, compost and perlite drains well and holds enough water.",
            },
          ],
          sender: 'assistant',
          created_at: '2026-09-06T18:02:40.000000Z',
          attachments: [],
          files: [],
        },
        {
          uuid: 'garden-m02',
          text: 'Can you draw a simple top-down layout?',
          content: [{ type: 'text', text: 'Can you draw a simple top-down layout?' }],
          sender: 'human',
          created_at: '2026-09-06T18:05:02.000000Z',
          attachments: [],
          files: [],
        },
        {
          uuid: 'garden-m03',
          text: '',
          content: [
            { type: 'text', text: "Here's a first layout with herbs in the far bed and tomatoes nearest the door." },
            artifactBlock('create', GARDEN_LAYOUT_V1_SVG),
            { type: 'text', text: 'Each bed is 1.2 × 0.9 m, 30 cm deep.' },
          ],
          sender: 'assistant',
          created_at: '2026-09-06T18:05:30.000000Z',
          attachments: [],
          files: [],
        },
        {
          uuid: 'garden-m04',
          text: 'Move the tomatoes to the far end and add a trellis behind them.',
          content: [{ type: 'text', text: 'Move the tomatoes to the far end and add a trellis behind them.' }],
          sender: 'human',
          created_at: '2026-09-06T18:09:12.000000Z',
          attachments: [],
          files: [],
        },
        {
          uuid: 'garden-m05',
          text: '',
          content: [
            { type: 'thinking', thinking: 'Swap the tomato and herb zones, then draw a trellis along the back edge of bed B.' },
            artifactBlock('rewrite', GARDEN_LAYOUT_V2_SVG),
            { type: 'text', text: 'Updated: tomatoes now sit at the far end of bed B with a trellis along the wall side, and herbs moved next to the door.' },
          ],
          sender: 'assistant',
          created_at: '2026-09-06T18:09:40.000000Z',
          attachments: [],
          files: [],
        },
        {
          uuid: 'garden-m06',
          text: 'How much soil do I need to fill both beds?',
          content: [{ type: 'text', text: 'How much soil do I need to fill both beds?' }],
          sender: 'human',
          created_at: '2026-09-06T18:20:00.000000Z',
          attachments: [],
          files: [],
        },
        {
          uuid: 'garden-m07',
          text: '',
          content: [
            {
              type: 'text',
              text: 'Each bed holds 1.2 × 0.9 × 0.3 m = 0.324 m³, so both together need about 0.65 m³ (650 litres).\n\nWith the 60/30/10 mix:\n- Topsoil: 390 L\n- Compost: 195 L\n- Perlite: 65 L\n\nBuy about 10% extra — the soil settles after the first few waterings.',
            },
          ],
          sender: 'assistant',
          created_at: '2026-09-06T18:20:30.000000Z',
          attachments: [],
          files: [],
        },
        {
          uuid: 'garden-m08',
          text: "OK — I'll build the beds from untreated cedar. Remind me what to plant first.",
          content: [{ type: 'text', text: "OK — I'll build the beds from untreated cedar. Remind me what to plant first." }],
          sender: 'human',
          created_at: '2026-09-06T18:30:10.000000Z',
          attachments: [],
          files: [],
        },
        {
          uuid: 'garden-m09',
          text: '',
          content: [
            {
              type: 'text',
              text: 'Start with lettuce as soon as the beds are filled — it likes the cooler weeks. Plant herbs next (basil once nights stay above 10 °C), and transplant the tomatoes last, when the soil has warmed. Put the trellis in before the tomatoes so you do not disturb their roots later.',
            },
          ],
          sender: 'assistant',
          created_at: '2026-09-06T18:31:45.000000Z',
          attachments: [],
          files: [],
        },
      ],
    },
  ];
}

/** Files for a sample ChatGPT export archive (paths as they appear in a real export). */
export function sampleChatGptExportFiles(): Record<string, string> {
  return {
    'conversations.json': JSON.stringify(sampleChatGptConversations()),
    'user.json': JSON.stringify({ id: 'user-sample', email: 'sample@example.com', chatgpt_plus_user: false }),
    'message_feedback.json': '[]',
    'chat.html': '<!doctype html><title>ChatGPT Data Export</title><p>Sample export.</p>',
    'file-HoloConcept01-9d2b3c1e-concept.svg': HOLO_CONCEPT_SVG,
    'file-UserDesk02-desk-photo.svg': USER_DESK_SVG,
    'file_00000000HoloNight03-7b1d42aa.svg': HOLO_NIGHT_SVG,
  };
}

/** Files for a sample Claude export archive. Note: Claude exports do not include uploaded images. */
export function sampleClaudeExportFiles(): Record<string, string> {
  return {
    'conversations.json': JSON.stringify(sampleClaudeConversations()),
    'users.json': JSON.stringify([{ uuid: 'sample-account', full_name: 'Sample User', email_address: 'sample@example.com' }]),
    'projects.json': '[]',
  };
}
