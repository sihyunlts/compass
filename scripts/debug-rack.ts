import { mkdir, readFile, writeFile } from 'node:fs/promises';
import inspector from 'node:inspector';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  getLaunchpadRuntimeMap,
  resolveLaunchpadModel,
} from '../src/domain';
import { TILE_COUNT } from '../src/core/pipeline/constants';
import {
  buildGeneratedFieldResult,
} from '../src/domain/field-result';
import {
  toGeneratorPreview,
} from '../src/domain/generator-preview';
import {
  buildRuntimeMapDataFromButtonIndex,
} from '../src/domain/runtime-map';
import {
  collectActivationSegments,
} from '../src/generation/timeline-analysis';
import {
  toRoundedCoordinateKey,
} from '../src/generation/coordinates';
import {
  buildCanonicalFieldResult,
} from '../src/generation/engine';
import {
  createLaunchpadExecutionRequest,
  createLaunchpadOutputAdapter,
  projectActivePitchesToNotes,
  projectTimelineToActivePitchesBySampleIndex,
  resolveActiveByPitchFromFrameStrokes,
} from '../src/generation/launchpad-projection';
import type { ClipNote, GeneratorChain, LaunchpadButton, LaunchpadModel } from '../src/shared/model';
import { parsePresetFileText } from '../src/shared/presets';
import type {
  RuntimeMapData,
} from '../src/domain/note-generation-types';
import type {
  ButtonIndexGroup,
} from '../src/core/pipeline/types';

interface CliOptions {
  rackPath: string;
  outputDirectory: string;
  beats: number[];
  loopLengthBeats: number;
  launchpadModel: LaunchpadModel;
  profileEnabled: boolean;
  profileIterations: number;
  profileOutputPath: string | null;
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

interface TimingBreakdown {
  canonicalMs: number;
  notesMs: number;
  ledFramesMs: number;
  totalMs: number;
  visibleWindowMs: number;
  activePitchScanMs: number;
  activationSegmentsMs: number;
}

interface CpuProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  hitCount?: number;
}

interface CpuProfile {
  nodes: CpuProfileNode[];
  samples?: number[];
  timeDeltas?: number[];
}

const DEFAULT_BEATS = [0, 0.25, 0.5, 0.75];
const DEFAULT_PROFILE_ITERATIONS = 3;

const printUsage = (): void => {
  process.stdout.write(
    [
      'Usage: npm run debug:rack -- <rack-path> [--out <dir>] [--beats 0,0.25,0.5,0.75] [--loop-length 1] [--model mk3|mk2] [--profile] [--profile-iterations 3] [--profile-out <file>]',
      '',
      'Outputs canonical preview notes and beat snapshots for one rack preset.',
      'When --profile is set, also writes timing and CPU profile artifacts.',
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
  let profileEnabled = false;
  let profileIterations = DEFAULT_PROFILE_ITERATIONS;
  let profileOutputPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      rackPath ??= token;
      continue;
    }

    const nextValue = argv[index + 1];
    if (
      (
        token === '--out'
        || token === '--beats'
        || token === '--loop-length'
        || token === '--model'
        || token === '--profile-iterations'
        || token === '--profile-out'
      )
      && !nextValue
    ) {
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

    if (token === '--profile') {
      profileEnabled = true;
      continue;
    }

    if (token === '--profile-iterations') {
      profileIterations = Number(nextValue);
      if (!Number.isInteger(profileIterations) || profileIterations <= 0) {
        throw new Error('Expected --profile-iterations to be a positive integer.');
      }
      index += 1;
      continue;
    }

    if (token === '--profile-out') {
      profileOutputPath = path.resolve(nextValue);
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
    profileEnabled,
    profileIterations,
    profileOutputPath,
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

const buildLedFramesFromActivePitches = (
  activeByPitchFrames: ReadonlyArray<ReadonlyMap<number, { velocity: number }>>,
): number => {
  let totalActiveEntries = 0;

  for (const frame of activeByPitchFrames) {
    totalActiveEntries += frame.size;
  }

  return totalActiveEntries;
};

const buildCoordinateGroupByKey = (
  buttonIndex: RuntimeMapData['buttonIndex'],
): Map<string, ButtonIndexGroup> => {
  const coordinateGroupByKey = new Map<string, ButtonIndexGroup>();

  for (const group of buttonIndex.groups) {
    const coordinateKey = toRoundedCoordinateKey(group.x, group.y);
    if (!coordinateKey) {
      continue;
    }

    coordinateGroupByKey.set(coordinateKey, group);
  }

  return coordinateGroupByKey;
};

const measureOneGeneration = (
  chain: GeneratorChain,
  loopLengthBeats: number,
  runtimeMap: RuntimeMapData,
): TimingBreakdown => {
  const outputAdapter = createLaunchpadOutputAdapter(runtimeMap);
  const executionRequest = createLaunchpadExecutionRequest();

  const canonicalStart = performance.now();
  const canonical = buildCanonicalFieldResult(
    chain,
    loopLengthBeats,
    outputAdapter,
    executionRequest,
  );
  const canonicalEnd = performance.now();

  const notesStart = performance.now();
  const activeByPitchFrames = projectTimelineToActivePitchesBySampleIndex(
    canonical.timeline,
    runtimeMap,
    canonical.mutedGroupIds,
    canonical.mutedGeneratorIds,
  );
  projectActivePitchesToNotes(activeByPitchFrames, canonical.timeline);
  const notesEnd = performance.now();

  const ledFramesStart = performance.now();
  buildLedFramesFromActivePitches(activeByPitchFrames);
  const ledFramesEnd = performance.now();

  const visibleWindowStart = performance.now();
  outputAdapter.buildVisibleWindowByOriginId(
    canonical.timeline,
    canonical.mutedGroupIds,
    canonical.mutedGeneratorIds,
  );
  const visibleWindowEnd = performance.now();

  const coordinateGroupByKey = buildCoordinateGroupByKey(runtimeMap.buttonIndex);
  const activePitchScanStart = performance.now();
  for (let frameIndex = 0; frameIndex < canonical.timeline.frames.length; frameIndex += 1) {
    resolveActiveByPitchFromFrameStrokes(
      canonical.timeline.frames[frameIndex]?.strokes ?? [],
      coordinateGroupByKey,
      canonical.mutedGroupIds,
      canonical.mutedGeneratorIds,
    );
  }
  const activePitchScanEnd = performance.now();

  const activationSegmentsStart = performance.now();
  collectActivationSegments(canonical.timeline, () => true);
  const activationSegmentsEnd = performance.now();

  return {
    canonicalMs: canonicalEnd - canonicalStart,
    notesMs: notesEnd - notesStart,
    ledFramesMs: ledFramesEnd - ledFramesStart,
    totalMs: ledFramesEnd - canonicalStart,
    visibleWindowMs: visibleWindowEnd - visibleWindowStart,
    activePitchScanMs: activePitchScanEnd - activePitchScanStart,
    activationSegmentsMs: activationSegmentsEnd - activationSegmentsStart,
  };
};

const averageTimings = (
  timings: ReadonlyArray<TimingBreakdown>,
): TimingBreakdown => {
  const total = timings.reduce<TimingBreakdown>(
    (sum, timing) => ({
      canonicalMs: sum.canonicalMs + timing.canonicalMs,
      notesMs: sum.notesMs + timing.notesMs,
      ledFramesMs: sum.ledFramesMs + timing.ledFramesMs,
      totalMs: sum.totalMs + timing.totalMs,
      visibleWindowMs: sum.visibleWindowMs + timing.visibleWindowMs,
      activePitchScanMs: sum.activePitchScanMs + timing.activePitchScanMs,
      activationSegmentsMs: sum.activationSegmentsMs + timing.activationSegmentsMs,
    }),
    {
      canonicalMs: 0,
      notesMs: 0,
      ledFramesMs: 0,
      totalMs: 0,
      visibleWindowMs: 0,
      activePitchScanMs: 0,
      activationSegmentsMs: 0,
    },
  );

  return {
    canonicalMs: total.canonicalMs / timings.length,
    notesMs: total.notesMs / timings.length,
    ledFramesMs: total.ledFramesMs / timings.length,
    totalMs: total.totalMs / timings.length,
    visibleWindowMs: total.visibleWindowMs / timings.length,
    activePitchScanMs: total.activePitchScanMs / timings.length,
    activationSegmentsMs: total.activationSegmentsMs / timings.length,
  };
};

const postAsync = (
  session: inspector.Session,
  method: string,
): Promise<unknown> => new Promise((resolve, reject) => {
  session.post(method, (error, result) => {
    if (error) {
      reject(error);
      return;
    }

    resolve(result);
  });
});

const captureCpuProfile = async (
  work: () => void,
): Promise<CpuProfile> => {
  const session = new inspector.Session();
  session.connect();

  try {
    await postAsync(session, 'Profiler.enable');
    await postAsync(session, 'Profiler.start');
    work();
    const result = await postAsync(session, 'Profiler.stop') as { profile?: CpuProfile };
    if (!result.profile) {
      throw new Error('Profiler.stop returned no profile.');
    }

    return result.profile;
  } finally {
    session.disconnect();
  }
};

const formatProfileLabel = (node: CpuProfileNode): string => {
  const functionName = node.callFrame.functionName || '(anonymous)';
  if (!node.callFrame.url) {
    return functionName;
  }

  return `${functionName} (${node.callFrame.url}:${node.callFrame.lineNumber + 1})`;
};

const summarizeCpuProfile = (
  profile: CpuProfile,
): Array<{ label: string; ms: number }> => {
  const nodesById = new Map(profile.nodes.map((node) => [node.id, node]));
  const totalsByLabel = new Map<string, number>();

  if (
    profile.samples
    && profile.timeDeltas
    && profile.samples.length === profile.timeDeltas.length
  ) {
    for (let index = 0; index < profile.samples.length; index += 1) {
      const node = nodesById.get(profile.samples[index]);
      if (!node) {
        continue;
      }

      const label = formatProfileLabel(node);
      totalsByLabel.set(label, (totalsByLabel.get(label) ?? 0) + (profile.timeDeltas[index] / 1000));
    }
  } else {
    for (const node of profile.nodes) {
      if (!node.hitCount) {
        continue;
      }

      const label = formatProfileLabel(node);
      totalsByLabel.set(label, (totalsByLabel.get(label) ?? 0) + node.hitCount);
    }
  }

  return Array.from(totalsByLabel.entries())
    .map(([label, ms]) => ({ label, ms }))
    .sort((left, right) => right.ms - left.ms);
};

const writeProfileArtifacts = async (
  outputDirectory: string,
  profileOutputPath: string,
  chain: GeneratorChain,
  loopLengthBeats: number,
  launchpadModel: LaunchpadModel,
  preview: ReturnType<typeof toGeneratorPreview>,
  iterations: number,
): Promise<void> => {
  const runtimeMap = buildRuntimeMapDataFromButtonIndex(
    getLaunchpadRuntimeMap(launchpadModel).buttonIndex,
  );
  const timings: TimingBreakdown[] = [];

  for (let index = 0; index < iterations; index += 1) {
    timings.push(measureOneGeneration(chain, loopLengthBeats, runtimeMap));
  }

  const cpuProfile = await captureCpuProfile(() => {
    for (let index = 0; index < iterations; index += 1) {
      buildGeneratedFieldResult({
        chain,
        loopLengthBeats,
        launchpadModel,
      });
    }
  });

  await writeFile(profileOutputPath, `${JSON.stringify(cpuProfile)}\n`, 'utf8');

  const averageTiming = averageTimings(timings);
  await writeJson(path.join(outputDirectory, 'profile-summary.json'), {
    iterations,
    cpuProfilePath: profileOutputPath,
    noteCount: preview.notes.length,
    ledFrameCount: preview.ledFramesBySampleIndex.length,
    averageTimingMs: averageTiming,
    topSampledFunctions: summarizeCpuProfile(cpuProfile).slice(0, 12),
  });
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
  const generated = buildGeneratedFieldResult({
    chain,
    loopLengthBeats: options.loopLengthBeats,
    launchpadModel: options.launchpadModel,
  });
  const preview = toGeneratorPreview(generated);

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

  if (options.profileEnabled) {
    const profileOutputPath = options.profileOutputPath
      ?? path.join(outputDirectory, 'lightshow.cpuprofile');
    await writeProfileArtifacts(
      outputDirectory,
      profileOutputPath,
      chain,
      options.loopLengthBeats,
      options.launchpadModel,
      preview,
      options.profileIterations,
    );
  }

  process.stdout.write(`${outputDirectory}\n`);
};

void main().catch((error: unknown) => {
  const message = error instanceof Error && error.message ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
