// Original vector companions for Tableros. Run with node scripts/generate-visual-assets.mjs.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../public/assets/', import.meta.url));
const save = async (folder, name, svg) => { await mkdir(`${root}${folder}`, {recursive:true}); await writeFile(`${root}${folder}/${name}.svg`, svg); };
const icons = {
  layers:'<path d="m12 2 10 5-10 5L2 7Zm-9 9 9 5 9-5v4l-9 5-9-5Zm0 8 9 5 9-5v3l-9 5-9-5Z" transform="translate(0 -2) scale(1 .9)"/>',
  orbit:'<path fill-rule="evenodd" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 3a7 7 0 1 1-7 7 7 7 0 0 1 7-7Z"/><circle cx="12" cy="12" r="3"/><circle cx="19" cy="5" r="3"/>',
  modules:'<rect x="2" y="2" width="9" height="9" rx="2"/><rect x="13" y="2" width="9" height="9" rx="2"/><rect x="2" y="13" width="9" height="9" rx="2"/><path d="m17.5 12 5.5 5.5-5.5 5.5-5.5-5.5Z"/>',
  bridge:'<path d="M2 20V9a5 5 0 0 1 10 0v11H9V9a2 2 0 0 0-4 0v11Zm10 0V9a5 5 0 0 1 10 0v11h-3V9a2 2 0 0 0-4 0v11Z"/>',
  path:'<rect x="2" y="3" width="6" height="6" rx="2"/><rect x="16" y="15" width="6" height="6" rx="2"/><path d="M5 8h3v6a2 2 0 0 0 2 2h7v3h-7a5 5 0 0 1-5-5Z"/><circle cx="18" cy="6" r="3"/>',
  prism:'<path d="m12 2 10 6-10 6L2 8Zm-10 9 8 5v7l-8-5Zm12 5 8-5v7l-8 5Z"/>',
  focus:'<path d="M2 3h7v3H5v4H2Zm13 0h7v7h-3V6h-4ZM2 14h3v4h4v3H2Zm17 0h3v7h-7v-3h4Z"/><rect x="8" y="8" width="8" height="8" rx="3"/>',
  weave:'<path d="M2 4h14a6 6 0 0 1 0 12H8v-3h8a3 3 0 0 0 0-6H2Z"/><path d="M22 20H8a6 6 0 0 1 0-12h8v3H8a3 3 0 0 0 0 6h14Z"/>'
};
for(const [name,shape] of Object.entries(icons)) await save('project-icons',name,`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">${shape}</svg>`);
const scenes = {
  orbit:'<circle cx="460" cy="160" r="115"/><ellipse cx="460" cy="160" rx="180" ry="58" transform="rotate(-32 460 160)"/><ellipse cx="460" cy="160" rx="150" ry="45" transform="rotate(35 460 160)"/><circle cx="460" cy="160" r="45" fill="url(#glass)"/><circle cx="565" cy="75" r="13" fill="var(--pink)"/>',
  modules:'<g transform="translate(305 52) rotate(-15 125 100)"><rect x="0" y="0" width="100" height="100" rx="24" fill="url(#glass)"/><rect x="118" y="0" width="100" height="100" rx="24"/><rect x="0" y="118" width="100" height="100" rx="24"/><rect x="118" y="118" width="100" height="100" rx="24" fill="url(#glass)"/><circle cx="168" cy="168" r="14" fill="var(--pink)"/></g>',
  bridge:'<path d="M285 265V135a70 70 0 0 1 140 0v130h-35V135a35 35 0 0 0-70 0v130Z" fill="url(#glass)"/><path d="M410 265V135a70 70 0 0 1 140 0v130h-35V135a35 35 0 0 0-70 0v130Z"/><circle cx="570" cy="60" r="12" fill="var(--pink)"/>',
  layers:'<path d="m285 180 145-80 145 80-145 80Z" fill="url(#glass)"/><path d="m285 140 145-80 145 80-145 80Z"/><path d="m285 100 145-80 145 80-145 80Z" fill="url(#glass)"/><path d="M430 180v80" stroke-dasharray="5 8"/>',
  trajectory:'<path d="M250 280c90 0 70-200 170-200s70 170 150 170 90-160 160-160"/><path d="M240 250c90 0 70-200 170-200s70 170 150 170 90-160 160-160"/><path d="M230 220c90 0 70-200 170-200s70 170 150 170 90-160 160-160"/><circle cx="410" cy="50" r="14" fill="var(--pink)"/>',
  prism:'<path d="m440 20 145 80-145 85-145-85Z" fill="url(#glass)"/><path d="M295 100v135l145 85V185m0 135 145-85V100"/><path d="m350 130 90-52 90 52-90 52Z"/><circle cx="440" cy="132" r="12" fill="var(--pink)"/>',
  constellation:'<path d="m285 100 105-60 120 80 90-60M285 100l40 140 120-30 65-90 90 140m-210-220 55 170"/><circle cx="285" cy="100" r="22" fill="url(#glass)"/><circle cx="390" cy="40" r="15"/><circle cx="510" cy="120" r="35" fill="url(#glass)"/><circle cx="600" cy="60" r="13" fill="var(--pink)"/><circle cx="325" cy="240" r="20"/><circle cx="445" cy="210" r="16"/><circle cx="600" cy="260" r="23"/>',
  ribbons:'<path d="M260 270c0-240 85-240 85 0S430 510 430 270 515 30 515 270 600 510 600 270"/><path d="M280 270c0-210 45-210 45 0S450 480 450 270 495 60 495 270 620 480 620 270"/><circle cx="410" cy="110" r="15" fill="var(--pink)"/>'
};
for(const [mode,bg,stroke,pink] of [['light','#eeebfa','#a89ad8','#d393bd'],['dark','#242032','#7a6baf','#bb7aab']]) {
 for(const [name,scene] of Object.entries(scenes)) {
  await save('covers',`${name}-${mode}`,`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 320" style="--pink:${pink}"><defs><linearGradient id="glass" x2="1" y2="1"><stop stop-color="${stroke}" stop-opacity=".35"/><stop offset="1" stop-color="${stroke}" stop-opacity=".06"/></linearGradient><radialGradient id="haze"><stop stop-color="${stroke}" stop-opacity=".16"/><stop offset="1" stop-color="${bg}" stop-opacity="0"/></radialGradient></defs><path fill="${bg}" d="M0 0h720v320H0z"/><ellipse cx="470" cy="160" rx="280" ry="220" fill="url(#haze)"/><g fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round">${scene}</g></svg>`);
 }
}
const patterns={
 'orbits':'<ellipse cx="120" cy="100" rx="110" ry="32" transform="rotate(-35 120 100)"/><ellipse cx="120" cy="100" rx="110" ry="32" transform="rotate(35 120 100)"/><circle cx="120" cy="100" r="48"/>',
 'steps':'<path d="M10 180v-40h40v-40h40V60h40V20h40M50 200v-40h40v-40h40V80h40V40h40M90 220v-40h40v-40h40v-40h40V60h40"/>',
 'nodes':'<path d="m20 130 60-80 80 100 60-100M20 130l140 20M80 50l140 0"/><circle cx="20" cy="130" r="9"/><circle cx="80" cy="50" r="9"/><circle cx="160" cy="150" r="9"/><circle cx="220" cy="50" r="9"/>',
 'contours':Array.from({length:7},(_,i)=>`<rect x="${20+i*11}" y="${5+i*11}" width="${200-i*22}" height="${190-i*22}" rx="${65-i*7}" transform="rotate(-20 120 100)"/>`).join('')
};
for(const [name,shape] of Object.entries(patterns)) await save('patterns',name,`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 200"><g fill="none" stroke="#9b8bc5" stroke-width="1.3">${shape}</g></svg>`);
console.log('Created 8 project marks, 16 themed covers and 4 decorative patterns.');
