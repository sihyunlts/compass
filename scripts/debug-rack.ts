import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  getLaunchpadRuntimeMap,
  generatePreviewNotesData,
  resolveLaunchpadModel,
} from '../src/domain';
import {
  compilePipelineEngine,
  evaluateExactOutputFramesAtTimes,
  evaluateMaskDebugAtTime,
  evaluatePolylinesAtTime,
} from '../src/core/pipeline/engine';
import {
  SAMPLES_PER_BEAT,
  TILE_COUNT,
} from '../src/core/pipeline/constants';
import type { Polyline } from '../src/core/core-types';
import type { ClipNote, LaunchpadButton, LaunchpadModel, MaskEffectNode } from '../src/shared/model';
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

const DEFAULT_BEATS = [0, 0.25, 0.5, 0.75];

const printUsage = (): void => {
  process.stdout.write(
    [
      'Usage: npm run debug:rack -- <rack-path> [--out <dir>] [--beats 0,0.25,0.5,0.75] [--loop-length 1] [--model mk3|mk2]',
      '',
      'Outputs notes and beat snapshots for one rack preset.',
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

const toTileCoordinates = (tileId: number): { tileId: number; x: number; y: number } => ({
  tileId,
  x: tileId % TILE_COUNT,
  y: Math.floor(tileId / TILE_COUNT),
});

const isNoteActiveAtBeat = (
  note: ClipNote,
  beat: number,
): boolean => note.startBeat <= beat && beat < note.startBeat + note.durationBeats;

const resolvePreviewFrameAtBeat = (
  notes: ReadonlyArray<ClipNote>,
  buttons: ReadonlyArray<LaunchpadButton>,
  beat: number,
): {
  activeTiles: Array<{ tileId: number; x: number; y: number }>;
  activePitches: Array<{ pitch: number; velocity: number; channel: number }>;
} => {
  const activeTiles = new Set<number>();
  const activeByAddress = new Map<string, { pitch: number; velocity: number; channel: number }>();

  for (const note of notes) {
    if (!isNoteActiveAtBeat(note, beat)) {
      continue;
    }

    const addressKey = `${note.channel}:${note.pitch}`;
    const previous = activeByAddress.get(addressKey);
    if (!previous || note.velocity > previous.velocity) {
      activeByAddress.set(addressKey, {
        pitch: note.pitch,
        velocity: note.velocity,
        channel: note.channel,
      });
    }
  }

  for (const active of activeByAddress.values()) {
    for (const button of buttons) {
      if (
        button.output.kind === 'note'
        && button.output.number === active.pitch
        && button.output.channel === active.channel
      ) {
        activeTiles.add((button.y * TILE_COUNT) + button.x);
      }
    }
  }

  return {
    activeTiles: Array.from(activeTiles)
      .sort((left, right) => left - right)
      .map((tileId) => toTileCoordinates(tileId)),
    activePitches: Array.from(activeByAddress.values())
      .sort((left, right) => left.pitch - right.pitch || left.channel - right.channel),
  };
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
): Promise<void> => {
  const snapshot = evaluateMaskDebugAtTime(engine, maskDevice.id, beat);
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
  const engine = compilePipelineEngine(chain, {
    buttons: runtimeMap.buttons,
    buttonIndex: runtimeMap.buttonIndex,
  });
  const frameBeats = Array.from({ length: SAMPLES_PER_BEAT }, (_, step) => step / SAMPLES_PER_BEAT);
  const sampledFrames = evaluateExactOutputFramesAtTimes(engine, frameBeats);
  const exactFrames = evaluateExactOutputFramesAtTimes(engine, options.beats);

  await writeJson(path.join(outputDirectory, 'notes.json'), {
    notes: preview.notes,
    sourceTimelineEndBeat: preview.sourceTimelineEndBeat,
  });

  const framesDirectory = path.join(outputDirectory, 'frames');
  await mkdir(framesDirectory, { recursive: true });

  const activitySummary = sampledFrames.map((frame) => ({
    beat: frame.time,
    activeTileCount: frame.activationFrame.activeTiles.size,
  }));
  await writeJson(path.join(outputDirectory, 'activity-summary.json'), {
    samplesPerBeat: SAMPLES_PER_BEAT,
    nonEmptyFrames: activitySummary.filter((frame) => frame.activeTileCount > 0),
  });

  for (let index = 0; index < options.beats.length; index += 1) {
    const beat = options.beats[index];
    const exactFrame = exactFrames[index];
    const beatKey = beat.toFixed(3);
    const frameDirectory = path.join(framesDirectory, `beat-${beatKey}`);
    await mkdir(frameDirectory, { recursive: true });

    const polylines = evaluatePolylinesAtTime(engine, beat);
    const activeTiles = Array.from(exactFrame?.activationFrame.activeTiles ?? [])
      .sort((left, right) => left - right)
      .map((tileId) => toTileCoordinates(tileId));
    const activePitches = Array.from(exactFrame?.activationFrame.activeByPitch.entries() ?? [])
      .map(([pitch, info]) => ({
        pitch,
        velocity: info.velocity,
        channel: info.channel,
      }))
      .sort((left, right) => left.pitch - right.pitch || left.channel - right.channel);

    await writeJson(path.join(frameDirectory, 'active-tiles.json'), activeTiles);
    await writeJson(path.join(frameDirectory, 'active-pitches.json'), activePitches);
    await writeJson(path.join(frameDirectory, 'polylines.json'), serializePolylines(polylines));
  }

  const previewFramesDirectory = path.join(outputDirectory, 'preview-frames');
  await mkdir(previewFramesDirectory, { recursive: true });
  const previewActivitySummary = options.beats.map((beat) => {
    const previewBeat = beat * preview.sourceTimelineEndBeat;
    const frame = resolvePreviewFrameAtBeat(preview.notes, runtimeMap.buttons, previewBeat);
    return {
      beat,
      previewBeat,
      activeTileCount: frame.activeTiles.length,
    };
  });
  await writeJson(path.join(outputDirectory, 'preview-activity-summary.json'), {
    sourceTimelineEndBeat: preview.sourceTimelineEndBeat,
    frames: previewActivitySummary,
  });

  for (const beat of options.beats) {
    const previewBeat = beat * preview.sourceTimelineEndBeat;
    const beatKey = beat.toFixed(3);
    const frameDirectory = path.join(previewFramesDirectory, `beat-${beatKey}`);
    await mkdir(frameDirectory, { recursive: true });

    const frame = resolvePreviewFrameAtBeat(preview.notes, runtimeMap.buttons, previewBeat);
    await writeJson(path.join(frameDirectory, 'active-tiles.json'), frame.activeTiles);
    await writeJson(path.join(frameDirectory, 'active-pitches.json'), frame.activePitches);
  }

  const maskDevices = chain.devices.filter((device): device is MaskEffectNode =>
    device.kind === 'mask' && device.enabled);
  for (const maskDevice of maskDevices) {
    for (const beat of options.beats) {
      await writeMaskDebugBeat(outputDirectory, maskDevice, beat, engine);
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
