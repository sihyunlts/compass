import {
  launchpadLayout,
  type LaunchpadLayout,
} from '../../core/launchpad-map';
import {
  generateNotes,
  generatePreviewStats,
} from '../../domain';
import { LIVE_BRIDGE_TARGET } from '../../shared/bridge/protocol';
import { sanitizeBridgeSettings } from '../../shared/validation/bridge-settings';
import type { ClipNote, GeneratorChain, LaunchpadModel } from '../../shared/model';
import type {
  GenerateAndSendRequest,
  GenerateAndSendResponse,
  RequestLiveTempoResponse,
} from '../../shared/contracts/ipc/generator';
import type {
  BridgeSettings,
  LiveBridgeNotesEnvelope,
  LiveBridgeTempoRequestEnvelope,
} from '../../shared/bridge/types';
import { UdpLiveBridge } from '../bridge/udp-live-bridge';

const DEFAULT_LAUNCHPAD_MODEL: LaunchpadModel = 'mk3';
const SUPPORTED_LAUNCHPAD_MODELS: ReadonlyArray<LaunchpadModel> = ['mk3', 'mk2'];
const LAUNCHPAD_LAYOUT: LaunchpadLayout = launchpadLayout;

const resolveSourceLengthBeats = (
  notes: ReadonlyArray<ClipNote>,
): number => {
  let maxEndBeat = 1;
  for (const note of notes) {
    const startBeat = Number.isFinite(note.startBeat) ? note.startBeat : 0;
    const durationBeats = Number.isFinite(note.durationBeats) ? note.durationBeats : 0;
    const endBeat = Math.max(0, startBeat + Math.max(durationBeats, 0));
    if (endBeat > maxEndBeat) {
      maxEndBeat = endBeat;
    }
  }

  return Number.isFinite(maxEndBeat) && maxEndBeat >= 1 ? maxEndBeat : 1;
};

const toEnvelope = (
  bridge: BridgeSettings,
  notes: ReadonlyArray<ClipNote>,
  sourceLengthBeats: number,
): LiveBridgeNotesEnvelope => ({
  event: 'clip_notes.replace',
  source: 'compass',
  layout: LAUNCHPAD_LAYOUT,
  path: LIVE_BRIDGE_TARGET.path,
  applyMode: 'replace',
  targetLengthBeats: sourceLengthBeats,
  autoCreateLengthBeats: bridge.autoCreateLengthBeats,
  notes: notes.map((note) => ({
    pitch: note.pitch,
    channel: note.channel,
    startBeat: note.startBeat,
    durationBeats: note.durationBeats,
    velocity: note.velocity,
    mute: false,
  })),
});

const toTempoRequestEnvelope = (): LiveBridgeTempoRequestEnvelope => ({
  event: 'live_tempo.request',
  source: 'compass',
  layout: LAUNCHPAD_LAYOUT,
  path: LIVE_BRIDGE_TARGET.path,
});

const createPipelineNotes = (
  chain: GeneratorChain,
  loopLengthBeats: number,
  launchpadModel: LaunchpadModel | undefined,
): ClipNote[] => {
  return generateNotes({
    chain,
    loopLengthBeats,
    launchpadModel: resolveLaunchpadModel(launchpadModel),
  });
};

const resolveLaunchpadModel = (
  requestedModel: LaunchpadModel | undefined,
): LaunchpadModel => (
  requestedModel && SUPPORTED_LAUNCHPAD_MODELS.includes(requestedModel)
    ? requestedModel
    : DEFAULT_LAUNCHPAD_MODEL
);

/** Coordinates domain note generation and UDP bridge delivery for the renderer. */
export class GeneratorService {
  public constructor(private readonly bridge = new UdpLiveBridge()) {}

  public async generateAndSend(
    request: GenerateAndSendRequest,
  ): Promise<GenerateAndSendResponse> {
    const bridgeSettings = sanitizeBridgeSettings(request.bridge);
    const notes = createPipelineNotes(
      request.chain,
      bridgeSettings.autoCreateLengthBeats,
      request.launchpadModel,
    );
    const sourceLengthBeats = resolveSourceLengthBeats(notes);
    const envelope = toEnvelope(bridgeSettings, notes, sourceLengthBeats);

    await this.bridge.send(envelope, LIVE_BRIDGE_TARGET);

    return {
      sentAtIso: new Date().toISOString(),
      target: LIVE_BRIDGE_TARGET,
      bridge: bridgeSettings,
      preview: {
        ...generatePreviewStats(notes),
        notes,
      },
    };
  }

  public async requestLiveTempo(): Promise<RequestLiveTempoResponse> {
    const envelope = toTempoRequestEnvelope();

    await this.bridge.send(envelope, LIVE_BRIDGE_TARGET);

    return {
      sentAtIso: new Date().toISOString(),
      target: LIVE_BRIDGE_TARGET,
    };
  }
}
