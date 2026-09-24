/**
 * Illustrations used as the image files inside the bundled SAMPLE exports. They are
 * fixture data only (the sample journal and tests); nothing in the app renders them directly.
 */

export const HOLO_CONCEPT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800">
<defs>
<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2433"/><stop offset="1" stop-color="#0d131d"/></linearGradient>
<linearGradient id="desk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b4429"/><stop offset="1" stop-color="#3a2415"/></linearGradient>
<radialGradient id="lamp" cx="0.18" cy="0.2" r="0.6"><stop offset="0" stop-color="#ffcf8a" stop-opacity=".55"/><stop offset="1" stop-color="#ffcf8a" stop-opacity="0"/></radialGradient>
<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#8fe3ff" stop-opacity=".9"/><stop offset=".5" stop-color="#4fb6ff" stop-opacity=".35"/><stop offset="1" stop-color="#4fb6ff" stop-opacity="0"/></radialGradient>
<linearGradient id="pane" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe9ff" stop-opacity=".28"/><stop offset="1" stop-color="#cfe9ff" stop-opacity=".06"/></linearGradient>
</defs>
<rect width="1200" height="800" fill="url(#wall)"/>
<rect width="1200" height="800" fill="url(#lamp)"/>
<path d="M0 520 L1200 470 L1200 800 L0 800 Z" fill="url(#desk)"/>
<path d="M0 520 L1200 470" stroke="#8a5a36" stroke-width="3" opacity=".7"/>
<g opacity=".35" stroke="#2a180d" stroke-width="2" fill="none"><path d="M40 600 C300 585 600 610 1150 560"/><path d="M0 680 C350 650 700 700 1200 630"/><path d="M60 750 C420 720 820 770 1200 720"/></g>
<rect x="470" y="560" width="300" height="42" rx="6" fill="#4d311d" stroke="#7a4f30" stroke-width="2"/>
<rect x="490" y="552" width="260" height="10" rx="3" fill="#0b1119"/>
<ellipse cx="620" cy="420" rx="150" ry="150" fill="url(#glow)"/>
<path d="M620 250 L500 556 L620 556 Z" fill="url(#pane)" stroke="#d8efff" stroke-opacity=".55" stroke-width="2"/>
<path d="M620 250 L740 556 L620 556 Z" fill="url(#pane)" stroke="#d8efff" stroke-opacity=".4" stroke-width="2"/>
<path d="M620 250 L620 556" stroke="#eaf6ff" stroke-opacity=".7" stroke-width="2"/>
<g transform="translate(620 405)">
<ellipse cx="0" cy="0" rx="46" ry="30" fill="#aeefff" opacity=".85"/>
<ellipse cx="0" cy="-6" rx="34" ry="18" fill="#e9fbff" opacity=".7"/>
<g stroke="#9fe6ff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".85">
<path d="M-30 22 C-34 50 -22 70 -30 98"/><path d="M-12 26 C-16 60 -2 80 -10 112"/><path d="M8 26 C4 58 18 82 10 110"/><path d="M26 22 C30 50 20 72 28 96"/></g></g>
<g fill="#f3d9a8" opacity=".9"><rect x="150" y="300" width="14" height="230" rx="4" fill="#2a2f38"/><path d="M110 300 L205 300 L180 250 L135 250 Z" fill="#3a404b"/><ellipse cx="157" cy="302" rx="46" ry="6" fill="#ffd89a" opacity=".8"/></g>
<rect x="920" y="360" width="190" height="130" rx="10" fill="#141a24" stroke="#2c3646" stroke-width="3"/>
<rect x="1000" y="490" width="30" height="40" fill="#20283a"/>
</svg>`;

export const USER_DESK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" width="1200" height="900">
<defs>
<linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9e4dc"/><stop offset="1" stop-color="#d9d2c6"/></linearGradient>
<linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b5a37"/><stop offset="1" stop-color="#5e3b22"/></linearGradient>
<linearGradient id="win" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfe4f5"/><stop offset="1" stop-color="#a9c7e2"/></linearGradient>
</defs>
<rect width="1200" height="900" fill="url(#w)"/>
<rect x="80" y="80" width="360" height="300" rx="8" fill="url(#win)" stroke="#f7f4ef" stroke-width="14"/>
<path d="M260 80 V380 M80 230 H440" stroke="#f7f4ef" stroke-width="10"/>
<path d="M0 560 L1200 540 L1200 900 L0 900 Z" fill="url(#d)"/>
<path d="M0 560 L1200 540" stroke="#a06d46" stroke-width="4"/>
<rect x="560" y="230" width="420" height="250" rx="14" fill="#1f242c"/>
<rect x="576" y="246" width="388" height="218" rx="6" fill="#33485e"/>
<path d="M576 420 C660 360 740 400 820 350 C880 312 930 340 964 320 V464 H576 Z" fill="#5d7f9e" opacity=".8"/>
<rect x="740" y="480" width="60" height="50" fill="#2a2f37"/>
<rect x="680" y="528" width="180" height="16" rx="6" fill="#2a2f37"/>
<rect x="600" y="600" width="330" height="60" rx="8" fill="#e8e6e1" stroke="#c9c5bd" stroke-width="3"/>
<g fill="#cfcbc3"><rect x="615" y="612" width="300" height="10" rx="3"/><rect x="615" y="630" width="300" height="10" rx="3"/></g>
<rect x="990" y="590" width="70" height="70" rx="35" fill="#e9e6df" stroke="#c9c5bd" stroke-width="3"/>
<rect x="190" y="600" width="260" height="170" rx="6" fill="none" stroke="#f3c969" stroke-width="5" stroke-dasharray="16 12"/>
<text x="320" y="700" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#f3e2b8" text-anchor="middle">empty spot</text>
<g transform="translate(140 470)"><rect x="0" y="0" width="70" height="90" rx="12" fill="#6f8f6a"/><path d="M35 0 C10 -60 -10 -40 5 -80 M35 0 C40 -70 70 -60 60 -100 M35 0 C60 -40 90 -30 95 -60" stroke="#4f7a4a" stroke-width="10" fill="none" stroke-linecap="round"/></g>
</svg>`;

export const HOLO_NIGHT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070b14"/><stop offset="1" stop-color="#0d1422"/></linearGradient>
<radialGradient id="g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#a6f0ff" stop-opacity=".95"/><stop offset=".45" stop-color="#3ea8ff" stop-opacity=".35"/><stop offset="1" stop-color="#3ea8ff" stop-opacity="0"/></radialGradient>
<linearGradient id="box" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3a24"/><stop offset="1" stop-color="#2e1d11"/></linearGradient>
<linearGradient id="p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d7f2ff" stop-opacity=".3"/><stop offset="1" stop-color="#d7f2ff" stop-opacity=".05"/></linearGradient>
</defs>
<rect width="1200" height="800" fill="url(#bg)"/>
<g fill="#cfe3ff" opacity=".5"><circle cx="120" cy="90" r="1.6"/><circle cx="260" cy="160" r="1.2"/><circle cx="980" cy="120" r="1.8"/><circle cx="1080" cy="220" r="1.1"/><circle cx="820" cy="70" r="1.3"/></g>
<rect x="0" y="560" width="1200" height="240" fill="#120c08"/>
<ellipse cx="600" cy="470" rx="260" ry="220" fill="url(#g)"/>
<path d="M430 540 L770 540 L800 640 L400 640 Z" fill="url(#box)" stroke="#7b5134" stroke-width="3"/>
<rect x="400" y="640" width="400" height="18" fill="#24170e"/>
<path d="M600 300 L470 540 L600 540 Z" fill="url(#p)" stroke="#e2f5ff" stroke-opacity=".6" stroke-width="2"/>
<path d="M600 300 L730 540 L600 540 Z" fill="url(#p)" stroke="#e2f5ff" stroke-opacity=".45" stroke-width="2"/>
<path d="M600 300 L600 540" stroke="#f0fbff" stroke-opacity=".8" stroke-width="2"/>
<g transform="translate(600 440)"><ellipse rx="40" ry="26" fill="#c8f6ff"/><ellipse cy="-5" rx="28" ry="14" fill="#ffffff" opacity=".75"/>
<g stroke="#b4f0ff" stroke-width="3" fill="none" stroke-linecap="round"><path d="M-26 18 C-30 40 -20 58 -26 84"/><path d="M-9 22 C-13 50 -1 68 -7 94"/><path d="M8 22 C4 48 16 70 10 92"/><path d="M24 18 C28 42 18 60 24 82"/></g></g>
<path d="M0 560 H1200" stroke="#2a1b10" stroke-width="3"/>
<ellipse cx="600" cy="700" rx="320" ry="30" fill="#3ea8ff" opacity=".12"/>
</svg>`;

function layoutSvg(withTrellis: boolean): string {
  const tomatoX = withTrellis ? 612 : 60;
  const herbX = withTrellis ? 60 : 612;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 520" width="1000" height="520">
<rect width="1000" height="520" fill="#f6f3ea"/>
<rect x="20" y="20" width="960" height="36" fill="#d8cfbd"/>
<text x="500" y="44" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#5b5140" text-anchor="middle">House wall (north)</text>
<rect x="40" y="90" width="440" height="330" rx="10" fill="#8a6a45"/>
<rect x="520" y="90" width="440" height="330" rx="10" fill="#8a6a45"/>
<rect x="${herbX}" y="110" width="200" height="290" rx="8" fill="#9cc48a"/>
<text x="${herbX + 100}" y="262" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#27401d" text-anchor="middle">Herbs</text>
<rect x="${herbX === 60 ? 280 : 832}" y="110" width="${herbX === 60 ? 180 : 108}" height="290" rx="8" fill="#b7d99c"/>
<text x="${herbX === 60 ? 370 : 886}" y="262" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#2d4a20" text-anchor="middle">Lettuce</text>
<rect x="${tomatoX}" y="110" width="200" height="290" rx="8" fill="#e59a7a"/>
<text x="${tomatoX + 100}" y="262" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#5a2412" text-anchor="middle">Cherry tomatoes</text>
${withTrellis ? `<path d="M612 104 H812" stroke="#5b4630" stroke-width="8" stroke-linecap="round"/><g stroke="#5b4630" stroke-width="3">${[640, 680, 720, 760, 800].map((x) => `<path d="M${x} 104 V400"/>`).join('')}</g><text x="712" y="96" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#5b4630" text-anchor="middle">trellis</text>` : ''}
<rect x="40" y="440" width="920" height="50" rx="6" fill="#d9d2c2"/>
<text x="500" y="471" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#6b604c" text-anchor="middle">Gravel path · 0.5 m</text>
<text x="260" y="80" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#6b604c" text-anchor="middle">Bed A · 1.2 × 0.9 m</text>
<text x="740" y="80" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#6b604c" text-anchor="middle">Bed B · 1.2 × 0.9 m</text>
</svg>`;
}

export const GARDEN_LAYOUT_V1_SVG = layoutSvg(false);
export const GARDEN_LAYOUT_V2_SVG = layoutSvg(true);
