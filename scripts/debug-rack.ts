import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  getLaunchpadRuntimeMap,
  generateOverlayFrames,
  generatePreviewNotesData,
  resolveLaunchpadModel,
} from '../src/domain';
import type { OverlayFrameStroke } from '../src/domain';
import {
  compilePipelineEngine,
  computeOriginWindowsWithEngine,
  evaluateMaskDebugAtTime,
  evaluatePolylinesAtTime,
} from '../src/core/pipeline/engine';
import {
  SAMPLES_PER_BEAT,
  TILE_COUNT,
  buildWorldBounds,
} from '../src/core/pipeline/constants';
import type { Polyline } from '../src/core/core-types';
import type { LaunchpadModel, MaskEffectNode } from '../src/shared/model';
import { parsePresetFileText } from '../src/shared/presets';

interface CliOptions {
  rackPath: string;
  outputDirectory: string;
  beats: number[];
  loopLengthBeats: number;
  launchpadModel: LaunchpadModel;
}

interface SerializablePolyline {
  originId: string;
  velocity: number;
  closed: boolean;
  clipCount: number;
  points: Array<{ x: number; y: number }>;
}

interface ActivePreviewNote {
  pitch: number;
  velocity: number;
  channel: number;
}

const DEFAULT_BEATS = [0, 0.25, 0.5, 0.75];

const printUsage = (): void => {
  process.stdout.write(
    [
      'Usage: npm run debug:rack -- <rack-path> [--out <dir>] [--beats 0,0.25,0.5,0.75] [--loop-length 1] [--model mk3|mk2]',
      '',
      'Outputs notes, beat snapshots, and overlay SVGs for one rack preset.',
      '',
    ].join('\n'),
  );
};

const sanitizeFileSegment = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'rack';

const buildDefaultOutputDirectory = (rackPath: string): string => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rackName = sanitizeFileSegment(path.basename(rackPath, path.extname(rackPath)));
  return path.join('/tmp', 'compass-debug', `${rackName}-${stamp}`);
};

const parseBeatList = (value: string): number[] => {
  const beats = value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((beat) => Number.isFinite(beat) && beat >= 0 && beat <= 1);
  if (beats.length === 0) {
    throw new Error('Expected --beats to contain numbers between 0 and 1.');
  }
  return Array.from(new Set(beats)).sort((left, right) => left - right);
};

const parseCliOptions = (argv: string[]): CliOptions | null => {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return null;
  }

  let rackPath: string | null = null;
  let outputDirectory: string | null = null;
  let beats = DEFAULT_BEATS;
  let loopLengthBeats = 1;
  let launchpadModel: LaunchpadModel = 'mk3';

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      rackPath ??= token;
      continue;
    }

    const nextValue = argv[index + 1];
    if ((token === '--out' || token === '--beats' || token === '--loop-length' || token === '--model') && !nextValue) {
      throw new Error(`Missing value for ${token}.`);
    }

    if (token === '--out') {
      outputDirectory = path.resolve(nextValue);
      index += 1;
      continue;
    }

    if (token === '--beats') {
      beats = parseBeatList(nextValue);
      index += 1;
      continue;
    }

    if (token === '--loop-length') {
      loopLengthBeats = Number(nextValue);
      if (!Number.isFinite(loopLengthBeats) || loopLengthBeats <= 0) {
        throw new Error('Expected --loop-length to be a positive number.');
      }
      index += 1;
      continue;
    }

    if (token === '--model') {
      launchpadModel = resolveLaunchpadModel(nextValue as LaunchpadModel);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!rackPath) {
    throw new Error('Missing rack preset path.');
  }

  return {
    rackPath: path.resolve(rackPath),
    outputDirectory: outputDirectory ?? buildDefaultOutputDirectory(rackPath),
    beats,
    loopLengthBeats,
    launchpadModel,
  };
};

const round = (value: number, digits = 4): number => Number(value.toFixed(digits));

const serializePolylines = (
  polylines: ReadonlyArray<Polyline>,
): SerializablePolyline[] => polylines.map((polyline) => ({
  originId: polyline.originId,
  velocity: polyline.velocity,
  closed: polyline.closed,
  clipCount: polyline.clipStack.length,
  points: polyline.points.map((point) => ({
    x: round(point.x, 3),
    y: round(point.y, 3),
  })),
}));

const serializeMap = <T>(
  map: ReadonlyMap<string, T>,
): Record<string, T> => Object.fromEntries(map.entries());

const toTileCoordinates = (tileId: number): { tileId: number; x: number; y: number } => ({
  tileId,
  x: tileId % TILE_COUNT,
  y: Math.floor(tileId / TILE_COUNT),
});

const buildAddressToTileIdMap = (
  launchpadModel: LaunchpadModel,
): Map<string, number> => {
  const runtimeMap = getLaunchpadRuntimeMap(launchpadModel);
  return new Map(runtimeMap.buttons.map((button) => [
    `${button.output.channel}:${button.output.number}`,
    (button.y * TILE_COUNT) + button.x,
  ]));
};

const getActivePreviewNotesAtBeat = (
  notes: ReadonlyArray<{
    pitch: number;
    channel: number;
    velocity: number;
    startBeat: number;
    durationBeats: number;
  }>,
  beat: number,
): ActivePreviewNote[] => notes
  .filter((note) => note.startBeat <= beat && beat < note.startBeat + note.durationBeats)
  .map((note) => ({
    pitch: note.pitch,
    velocity: note.velocity,
    channel: note.channel,
  }));

const toActiveTileIds = (
  notes: ReadonlyArray<ActivePreviewNote>,
  addressToTileId: ReadonlyMap<string, number>,
): number[] => Array.from(
  new Set(
    notes
      .map((note) => addressToTileId.get(`${note.channel}:${note.pitch}`))
      .filter((tileId): tileId is number => tileId !== undefined),
  ),
).sort((left, right) => left - right);

const toSvgPath = (stroke: OverlayFrameStroke): string => {
  const [first, ...rest] = stroke.points;
  if (!first) {
    return '';
  }

  const commands = [`M ${round(first.x, 3)} ${round(first.y, 3)}`];
  for (const point of rest) {
    commands.push(`L ${round(point.x, 3)} ${round(point.y, 3)}`);
  }
  if (stroke.closed) {
    commands.push('Z');
  }
  return commands.join(' ');
};

const buildOverlaySvg = (
  strokes: ReadonlyArray<OverlayFrameStroke>,
  activeTiles: ReadonlyArray<{ tileId: number; x: number; y: number }>,
): string => {
  const bounds = buildWorldBounds();
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const tileRects = activeTiles
    .map((tile) =>
      `<rect x="${tile.x - 0.5}" y="${tile.y - 0.5}" width="1" height="1" fill="#ffd54a" fill-opacity="0.28" stroke="#d89b00" stroke-width="0.04" />`)
    .join('\n');
  const paths = strokes
    .map((stroke) => toSvgPath(stroke))
    .filter((pathValue) => pathValue.length > 0)
    .map((pathValue) => `<path d="${pathValue}" fill="none" stroke="#0f172a" stroke-width="0.08" stroke-linecap="round" stroke-linejoin="round" />`)
    .join('\n');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#fcfcf7" />',
    '<g opacity="0.22" stroke="#94a3b8" stroke-width="0.03">',
    Array.from({ length: TILE_COUNT + 1 }, (_, index) =>
      `<line x1="${index - 0.5}" y1="-0.5" x2="${index - 0.5}" y2="${TILE_COUNT - 0.5}" />`).join('\n'),
    Array.from({ length: TILE_COUNT + 1 }, (_, index) =>
      `<line x1="-0.5" y1="${index - 0.5}" x2="${TILE_COUNT - 0.5}" y2="${index - 0.5}" />`).join('\n'),
    '</g>',
    tileRects,
    paths,
    '</svg>',
    '',
  ].join('\n');
};

const writeJson = async (
  filePath: string,
  value: unknown,
): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const writeMaskDebugBeat = async (
  outputDirectory: string,
  maskDevice: MaskEffectNode,
  beat: number,
  engine: ReturnType<typeof compilePipelineEngine>,
  originWindows: ReadonlyMap<string, { min: number; max: number }>,
): Promise<void> => {
  const snapshot = evaluateMaskDebugAtTime(engine, maskDevice.id, beat, originWindows as Map<string, { min: number; max: number }>);
  if (!snapshot) {
    return;
  }

  const beatDirectory = path.join(
    outputDirectory,
    'masks',
    maskDevice.id,
    `beat-${beat.toFixed(3)}`,
  );
  await mkdir(beatDirectory, { recursive: true });

  const sourceActiveTiles = Array.from(snapshot.sourceActiveTiles)
    .sort((left, right) => left - right)
    .map((tileId) => toTileCoordinates(tileId));

  await writeJson(path.join(beatDirectory, 'meta.json'), {
    maskDeviceId: snapshot.maskDeviceId,
    consumingGroupId: snapshot.consumingGroupId,
    sourceKind: snapshot.sourceKind,
    sourceDomain: snapshot.sourceDomain,
    sourceId: snapshot.sourceId,
    timeKind: snapshot.timeKind,
  });
  await writeJson(path.join(beatDirectory, 'source-polylines.json'), serializePolylines(snapshot.sourcePolylines));
  await writeJson(path.join(beatDirectory, 'source-active-tiles.json'), sourceActiveTiles);
  await writeJson(path.join(beatDirectory, 'consumer-before-mask-polylines.json'), serializePolylines(snapshot.consumerPolylinesBeforeMask));
  await writeJson(path.join(beatDirectory, 'consumer-after-mask-polylines.json'), serializePolylines(snapshot.consumerPolylinesAfterMask));
  await writeFile(
    path.join(beatDirectory, 'source-overlay.svg'),
    buildOverlaySvg(
      snapshot.sourcePolylines.map((polyline) => ({
        points: polyline.points,
        closed: polyline.closed,
      })),
      sourceActiveTiles,
    ),
    'utf8',
  );
  await writeFile(
    path.join(beatDirectory, 'consumer-before-mask.svg'),
    buildOverlaySvg(
      snapshot.consumerPolylinesBeforeMask.map((polyline) => ({
        points: polyline.points,
        closed: polyline.closed,
      })),
      [],
    ),
    'utf8',
  );
  await writeFile(
    path.join(beatDirectory, 'consumer-after-mask.svg'),
    buildOverlaySvg(
      snapshot.consumerPolylinesAfterMask.map((polyline) => ({
        points: polyline.points,
        closed: polyline.closed,
      })),
      [],
    ),
    'utf8',
  );
};

const main = async (): Promise<void> => {
  const options = parseCliOptions(process.argv.slice(2));
  if (!options) {
    return;
  }

  const text = await readFile(options.rackPath, 'utf8');
  const parsed = parsePresetFileText(text, {
    fileName: options.rackPath,
    mode: 'recover',
  });
  if (parsed.ok === false) {
    throw new Error(parsed.message);
  }
  if (parsed.preset.presetType !== 'rack') {
    throw new Error('Expected a rack preset file.');
  }

  const outputDirectory = options.outputDirectory;
  await mkdir(outputDirectory, { recursive: true });

  const chain = parsed.preset.chain;
  const runtimeMap = getLaunchpadRuntimeMap(options.launchpadModel);
  const preview = generatePreviewNotesData({
    chain,
    loopLengthBeats: options.loopLengthBeats,
    launchpadModel: options.launchpadModel,
  });
  const addressToTileId = buildAddressToTileIdMap(options.launchpadModel);
  const overlayFrames = generateOverlayFrames({
    chain,
    beats01: options.beats,
    loopLengthBeats: options.loopLengthBeats,
    launchpadModel: options.launchpadModel,
  });

  const engine = compilePipelineEngine(chain, {
    buttons: runtimeMap.buttons,
    buttonIndex: runtimeMap.buttonIndex,
  });
  const originWindows = computeOriginWindowsWithEngine(
    engine,
    NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  );

  await writeJson(path.join(outputDirectory, 'notes.json'), {
    notes: preview.notes,
    overlayTimingByOriginId: serializeMap(preview.overlayTimingByOriginId),
  });

  const framesDirectory = path.join(outputDirectory, 'frames');
  await mkdir(framesDirectory, { recursive: true });

  const activitySummary: Array<{ beat: number; activeTileCount: number }> = [];
  for (let step = 0; step < SAMPLES_PER_BEAT; step += 1) {
    const beat = step / SAMPLES_PER_BEAT;
    const activeNotes = getActivePreviewNotesAtBeat(preview.notes, beat);
    activitySummary.push({
      beat,
      activeTileCount: toActiveTileIds(activeNotes, addressToTileId).length,
    });
  }
  await writeJson(path.join(outputDirectory, 'activity-summary.json'), {
    samplesPerBeat: SAMPLES_PER_BEAT,
    nonEmptyFrames: activitySummary.filter((frame) => frame.activeTileCount > 0),
  });

  for (let index = 0; index < options.beats.length; index += 1) {
    const beat = options.beats[index];
    const beatKey = beat.toFixed(3);
    const frameDirectory = path.join(framesDirectory, `beat-${beatKey}`);
    await mkdir(frameDirectory, { recursive: true });

    const polylines = evaluatePolylinesAtTime(engine, beat, originWindows);
    const activeNotes = getActivePreviewNotesAtBeat(preview.notes, beat);
    const activeTiles = toActiveTileIds(activeNotes, addressToTileId)
      .map((tileId) => toTileCoordinates(tileId));
    const activePitches = activeNotes
      .map((note) => ({
        pitch: note.pitch,
        velocity: note.velocity,
        channel: note.channel,
      }))
      .sort((left, right) => left.pitch - right.pitch || left.channel - right.channel);

    await writeJson(path.join(frameDirectory, 'active-tiles.json'), activeTiles);
    await writeJson(path.join(frameDirectory, 'active-pitches.json'), activePitches);
    await writeJson(path.join(frameDirectory, 'polylines.json'), serializePolylines(polylines));
    await writeFile(
      path.join(frameDirectory, 'overlay.svg'),
      buildOverlaySvg(overlayFrames[index] ?? [], activeTiles),
      'utf8',
    );
  }

  const maskDevices = chain.devices.filter((device): device is MaskEffectNode =>
    device.kind === 'mask' && device.enabled);
  for (const maskDevice of maskDevices) {
    for (const beat of options.beats) {
      await writeMaskDebugBeat(outputDirectory, maskDevice, beat, engine, originWindows);
    }
  }

  await writeJson(path.join(outputDirectory, 'summary.json'), {
    rackPath: options.rackPath,
    presetName: parsed.preset.chain.name ?? null,
    launchpadModel: options.launchpadModel,
    loopLengthBeats: options.loopLengthBeats,
    beats: options.beats,
    warning: parsed.warning ?? null,
    noteCount: preview.notes.length,
    deviceCount: chain.devices.length,
    groupCount: new Set(chain.devices.map((device) => device.groupId ?? null)).size,
    maskDeviceIds: maskDevices.map((device) => device.id),
    nonEmptyFrameCount: activitySummary.filter((frame) => frame.activeTileCount > 0).length,
    outputDirectory,
    deviceOrder: chain.devices.map((device, deviceIndex) => ({
      index: deviceIndex,
      id: device.id,
      kind: device.kind,
      groupId: device.groupId ?? null,
      enabled: device.enabled,
    })),
  });

  process.stdout.write(`${outputDirectory}\n`);
};

void main().catch((error: unknown) => {
  const message = error instanceof Error && error.message ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
