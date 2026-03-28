import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildGeneratorPreview,
  getLaunchpadRuntimeMap,
  resolveLaunchpadModel,
} from '../src/domain';
import { TILE_COUNT } from '../src/core/pipeline/constants';
import type { ClipNote, LaunchpadButton, LaunchpadModel } from '../src/shared/model';
import { parsePresetFileText } from '../src/shared/presets';

interface CliOptions {
  rackPath: string;
  outputDirectory: string;
  beats: number[];
  loopLengthBeats: number;
  launchpadModel: LaunchpadModel;
}

interface ActiveAddressSnapshot {
  address: string;
  pitch: number;
  channel: number;
  velocity: number;
}

interface FrameSnapshot {
  activeTiles: Array<{ tileId: number; x: number; y: number }>;
  activeAddresses: ActiveAddressSnapshot[];
}

const DEFAULT_BEATS = [0, 0.25, 0.5, 0.75];

const printUsage = (): void => {
  process.stdout.write(
    [
      'Usage: npm run debug:rack -- <rack-path> [--out <dir>] [--beats 0,0.25,0.5,0.75] [--loop-length 1] [--model mk3|mk2]',
      '',
      'Outputs canonical preview notes and beat snapshots for one rack preset.',
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

const isNoteActiveAtBeat = (
  note: ClipNote,
  beat: number,
): boolean => note.startBeat <= beat && beat < note.startBeat + note.durationBeats;

const toAddressKey = (channel: number, pitch: number): string => `${channel}:${pitch}`;

const toTileCoordinates = (tileId: number): { tileId: number; x: number; y: number } => ({
  tileId,
  x: tileId % TILE_COUNT,
  y: Math.floor(tileId / TILE_COUNT),
});

const sortAddresses = (
  left: ActiveAddressSnapshot,
  right: ActiveAddressSnapshot,
): number => left.pitch - right.pitch || left.channel - right.channel;

const mapNormalizedBeatToPreviewBeat = (
  normalizedBeat: number,
  sourceTimelineEndBeat: number,
): number => normalizedBeat * sourceTimelineEndBeat;

const buildFrameSnapshotAtBeat = (
  notes: ReadonlyArray<ClipNote>,
  buttons: ReadonlyArray<LaunchpadButton>,
  beat: number,
): FrameSnapshot => {
  const activeTiles = new Set<number>();
  const activeByAddress = new Map<string, ActiveAddressSnapshot>();

  for (const note of notes) {
    if (!isNoteActiveAtBeat(note, beat)) {
      continue;
    }

    const addressKey = toAddressKey(note.channel, note.pitch);
    const previous = activeByAddress.get(addressKey);
    if (!previous || note.velocity > previous.velocity) {
      activeByAddress.set(addressKey, {
        address: addressKey,
        pitch: note.pitch,
        channel: note.channel,
        velocity: note.velocity,
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
    activeAddresses: Array.from(activeByAddress.values()).sort(sortAddresses),
  };
};

const writeJson = async (
  filePath: string,
  value: unknown,
): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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
  const preview = buildGeneratorPreview({
    chain,
    loopLengthBeats: options.loopLengthBeats,
    launchpadModel: options.launchpadModel,
  });

  await writeJson(path.join(outputDirectory, 'notes.json'), {
    notes: preview.notes,
    sourceTimelineEndBeat: preview.sourceTimelineEndBeat,
    sampleStepBeats: preview.sampleStepBeats,
    ledFrameCount: preview.ledFramesBySampleIndex.length,
  });

  const activitySummary = preview.ledFramesBySampleIndex.map((_, frameIndex) => {
    const beat = frameIndex * preview.sampleStepBeats;
    const frame = buildFrameSnapshotAtBeat(preview.notes, runtimeMap.buttons, beat);
    return {
      beat,
      activeTileCount: frame.activeTiles.length,
      activeAddressCount: frame.activeAddresses.length,
    };
  });

  await writeJson(path.join(outputDirectory, 'activity-summary.json'), {
    sourceTimelineEndBeat: preview.sourceTimelineEndBeat,
    sampleStepBeats: preview.sampleStepBeats,
    nonEmptyFrames: activitySummary.filter((frame) => frame.activeTileCount > 0),
  });

  const framesDirectory = path.join(outputDirectory, 'frames');
  await mkdir(framesDirectory, { recursive: true });

  for (const beat of options.beats) {
    const previewBeat = mapNormalizedBeatToPreviewBeat(beat, preview.sourceTimelineEndBeat);
    const frameDirectory = path.join(framesDirectory, `beat-${beat.toFixed(3)}`);
    await mkdir(frameDirectory, { recursive: true });

    const frame = buildFrameSnapshotAtBeat(preview.notes, runtimeMap.buttons, previewBeat);
    await writeJson(path.join(frameDirectory, 'active-tiles.json'), frame.activeTiles);
    await writeJson(path.join(frameDirectory, 'active-pitches.json'), frame.activeAddresses);
    await writeJson(path.join(frameDirectory, 'meta.json'), {
      normalizedBeat: beat,
      previewBeat,
      sourceTimelineEndBeat: preview.sourceTimelineEndBeat,
      sampleStepBeats: preview.sampleStepBeats,
    });
  }

  await writeJson(path.join(outputDirectory, 'summary.json'), {
    rackPath: options.rackPath,
    presetName: parsed.preset.chain.name ?? null,
    launchpadModel: options.launchpadModel,
    loopLengthBeats: options.loopLengthBeats,
    beats: options.beats,
    warning: parsed.warning ?? null,
    noteCount: preview.notes.length,
    ledFrameCount: preview.ledFramesBySampleIndex.length,
    sourceTimelineEndBeat: preview.sourceTimelineEndBeat,
    sampleStepBeats: preview.sampleStepBeats,
    deviceCount: chain.devices.length,
    groupCount: new Set(chain.devices.map((device) => device.groupId ?? null)).size,
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
