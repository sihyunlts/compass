import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import { build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { buildMidiEffectDevice } from '../shared/amxd.mjs';
import { createEmbeddedPatch } from './patch.mjs';
import { addLegacySelectorFallbacks } from './css-compat.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const outputDirectory = resolve(root, 'out/max4live');
const { version, productName } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const fileName = `CompassMax-v${version}.amxd`;

const serviceResult = await build({
  configFile: false,
  root,
  publicDir: false,
  define: { __COMPASS_PRODUCT_NAME__: JSON.stringify(productName) },
  resolve: {
    alias: [
      { find: 'node:fs/promises', replacement: resolve(here, 'fs-promises.ts') },
      { find: 'node:crypto', replacement: resolve(here, 'crypto.ts') },
      { find: /^node:/, replacement: '' },
    ],
  },
  ssr: { noExternal: true },
  build: {
    ssr: resolve(here, 'file-service.ts'),
    write: false,
    target: 'node12.14',
    minify: true,
    rolldownOptions: {
      external: [...builtinModules, 'max-api'],
      output: { format: 'cjs', codeSplitting: false },
    },
  },
});
const serviceOutputs = (Array.isArray(serviceResult) ? serviceResult : [serviceResult]).flatMap((item) => item.output);
if (serviceOutputs.length !== 1 || serviceOutputs[0].type !== 'chunk') throw new Error('The file service must be a single bundled script.');
const serviceBytes = Buffer.from(serviceOutputs[0].code);
const serviceHash = createHash('sha256').update(serviceBytes).digest('hex');

const result = await build({
  configFile: false,
  root,
  publicDir: false,
  plugins: [svelte()],
  define: { __APP_VERSION__: JSON.stringify(version), 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: {
    alias: [
      { find: './generation-worker-factory', replacement: resolve(here, 'worker.ts') },
      { find: 'pretendard-jp/dist/web/static/pretendard-jp.css', replacement: resolve(here, 'fonts.css') },
    ],
  },
  build: {
    write: false,
    target: 'chrome87',
    cssTarget: 'chrome87',
    minify: true,
    lib: { entry: resolve(here, 'entry.ts'), name: 'Compass', formats: ['iife'] },
  },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output);
const script = outputs.filter((item) => item.type === 'chunk');
const styles = outputs.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'));
const unexpected = outputs.filter((item) => item.type === 'asset' && !item.fileName.endsWith('.css'));
if (script.length !== 1 || unexpected.length) throw new Error('The embedded build must contain one script and inline assets.');
const css = addLegacySelectorFallbacks(styles.map((item) => String(item.source)).join('\n'));
const scriptText = script[0].code.replace(/<\/script/gi, '<\\/script');
// This document is generated from trusted project sources. Inline JS is required
// for this self-contained file-based package; external scripts remain disallowed.
const html = `<!doctype html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; worker-src blob: data:; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src data:; object-src 'none'; base-uri 'none'">
<title>Compass</title><style>${css}</style></head>
<body><div id="app"></div><script>${scriptText}</script></body></html>`;
const htmlBytes = Buffer.from(html);
const htmlHash = createHash('sha256').update(htmlBytes).digest('hex');
const extractedFiles = [
  { name: `compass-embedded-${htmlHash}.html`, bytes: htmlBytes },
  { name: `compass_embedded_files_${serviceHash}.js`, bytes: serviceBytes },
];
const payload = extractedFiles.map(({ name, bytes }) => {
  const chunks = [];
  for (let start = 0; start < bytes.length; start += 8192) {
    chunks.push(bytes.subarray(start, start + 8192).toString('latin1'));
  }
  return { name, size: bytes.length, chunks };
});
const payloadLiteral = JSON.stringify(payload).replace(/[\u007f-\uffff]/g,
  (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
for (const [index, file] of JSON.parse(payloadLiteral).entries()) {
  if (!Buffer.from(file.chunks.join(''), 'latin1').equals(extractedFiles[index].bytes)) {
    throw new Error(`Embedded payload does not reconstruct ${file.name} exactly.`);
  }
}
const clipEngine = await readFile(resolve(here, '../shared/clip-engine.js'));
// Max 8 must not resolve an include inside the frozen resource archive at runtime.
// Include only clip operations and this device's web transport.
const directBridge = `${clipEngine.toString('utf8')}\n${await readFile(resolve(here, 'direct-bridge.js'), 'utf8')}`;
const bridgeHash = createHash('sha256').update(directBridge).digest('hex').slice(0, 16);
const bridgeFile = `compass_embedded_bridge_${bridgeHash}.js`;
const installer = (await readFile(resolve(here, 'unpack.js'), 'utf8'))
  .replace('__COMPASS_RESOURCES__', () => payloadLiteral);
const installerHash = createHash('sha256').update(installer).digest('hex').slice(0, 16);
const installerFile = `compass_embedded_unpack_${installerHash}.js`;
const windowLayout = await readFile(resolve(here, 'window-layout.js'));
const windowLayoutHash = createHash('sha256').update(windowLayout).digest('hex').slice(0, 16);
const windowLayoutFile = `compass_embedded_window_layout_${windowLayoutHash}.js`;
const fileHost = await readFile(resolve(here, 'file-host.js'));
const fileHostHash = createHash('sha256').update(fileHost).digest('hex').slice(0, 16);
const fileHostFile = `compass_embedded_file_host_${fileHostHash}.js`;
const patch = createEmbeddedPatch(version, { bridgeFile, installerFile, windowLayoutFile, fileHostFile });

const resources = [
  { name: fileName, type: 'JSON', bytes: Buffer.from(JSON.stringify(patch) + '\0'), flag: 17 },
  { name: bridgeFile, type: 'TEXT', bytes: Buffer.from(directBridge) },
  { name: installerFile, type: 'TEXT', bytes: Buffer.from(installer) },
  { name: windowLayoutFile, type: 'TEXT', bytes: windowLayout },
  { name: fileHostFile, type: 'TEXT', bytes: fileHost },
  { name: 'compass.png', type: 'PNG ', bytes: await readFile(resolve(root, 'assets/compass.png')) },
];
const device = buildMidiEffectDevice(resources);
await mkdir(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, fileName);
await writeFile(outputPath, device);
console.log(`Built ${outputPath} (${(device.length / 1024 / 1024).toFixed(1)} MiB).`);
