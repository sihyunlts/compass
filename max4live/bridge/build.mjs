import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBridgePatch } from './patch.mjs';
import { buildMidiEffectDevice } from '../shared/amxd.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const outputDirectory = resolve(root, 'out/max4live');
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/, 'Invalid package version');
assert.equal(lock.version, version, 'Lockfile version must match package.json');
assert.equal(lock.packages[''].version, version, 'Lockfile root version must match package.json');

const patch = createBridgePatch(version);
const bridge = await readFile(resolve(here, '../shared/live-bridge.js'));
const icon = await readFile(resolve(root, 'assets/compass.png'));
const bridgeVersion = bridge.toString('utf8').match(/\bvar BRIDGE_VERSION = "([^"]+)";/)?.[1];
assert.equal(bridgeVersion, `v${version}`, 'BRIDGE_VERSION must match package.json before building');
assert.ok(icon.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Invalid bridge PNG');

const boxes = patch.patcher.boxes.map(({ box }) => box);
const versionLabels = boxes.filter((box) => box.varname === 'compass_bridge_version');
assert.equal(versionLabels.length, 1, 'Patch must have one compass_bridge_version label');
assert.equal(versionLabels[0].text, `v${version}`, 'Patch version must match package.json');
assert.ok(boxes.some((box) => box.text === 'js live-bridge.js'), 'Missing bridge script object');
assert.ok(boxes.some((box) => box.pic === 'compass.png'), 'Missing bridge image');
const boxesById = new Map(boxes.map((box) => [box.id, box]));
assert.equal(boxesById.size, boxes.length, 'Duplicate patch object IDs');
for (const { patchline } of patch.patcher.lines) {
  const [source, outlet] = patchline.source;
  const [destination, inlet] = patchline.destination;
  assert.ok(outlet >= 0 && outlet < boxesById.get(source)?.numoutlets, `Invalid source ${source}:${outlet}`);
  assert.ok(inlet >= 0 && inlet < boxesById.get(destination)?.numinlets, `Invalid destination ${destination}:${inlet}`);
}

const fileName = `CompassBridge-v${version}.amxd`;
const resources = [
  { name: fileName, type: 'JSON', bytes: Buffer.from(`${JSON.stringify(patch, null, '\t')}\0`), flag: 17 },
  { name: 'live-bridge.js', type: 'TEXT', bytes: bridge, flag: 0 },
  { name: 'compass.png', type: 'PNG ', bytes: icon, flag: 0 },
];

const device = buildMidiEffectDevice(resources);

const outputPath = resolve(outputDirectory, fileName);
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, device);
assert.ok((await readFile(outputPath)).equals(device), 'Written AMXD differs from validated bytes');
console.log(`Built ${outputPath} (${device.length} bytes).`);
