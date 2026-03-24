import {
  launchpadLayout,
  type LaunchpadLayout,
} from '../../core/launchpad-map';
import {
  generatePreviewNotesData,
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
import type { GeneratorPreview } from '../../shared/contracts/preview/generator-preview';
import type {
  BridgeSettings,
  LiveBridgeNotesEnvelope,
  LiveBridgeTempoRequestEnvelope,
} from '../../shared/bridge/types';
import { UdpLiveBridge } from '../bridge/udp-live-bridge';

const DEFAULT_LAUNCHPAD_MODEL: LaunchpadModel = 'mk3';
const SUPPORTED_LAUNCHPAD_MODELS: ReadonlyArray<LaunchpadModel> = ['mk3', 'mk2'];
const LAUNCHPAD_LAYOUT: LaunchpadLayout = launchpadLayout;

const toEnvelope = (
  bridge: BridgeSettings,
  notes: ReadonlyArray<ClipNote>,
  sourceTimelineEndBeat: number,
): LiveBridgeNotesEnvelope => ({
  event: 'clip_notes.replace',
  source: 'compass',
  layout: LAUNCHPAD_LAYOUT,
  path: LIVE_BRIDGE_TARGET.path,
  applyMode: 'replace',
  targetLengthBeats: sourceTimelineEndBeat,
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
): GeneratorPreview => {
  const preview = generatePreviewNotesData({
    chain,
    loopLengthBeats,
    launchpadModel: resolveLaunchpadModel(launchpadModel),
  });

  return {
    ...generatePreviewStats(preview.notes),
    notes: preview.notes,
    sourceTimelineEndBeat: preview.sourceTimelineEndBeat,
  };
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
    const preview = createPipelineNotes(
      request.chain,
      bridgeSettings.autoCreateLengthBeats,
      request.launchpadModel,
    );
    const envelope = toEnvelope(
      bridgeSettings,
      preview.notes,
      preview.sourceTimelineEndBeat,
    );

    await this.bridge.send(envelope, LIVE_BRIDGE_TARGET);

    return {
      sentAtIso: new Date().toISOString(),
      target: LIVE_BRIDGE_TARGET,
      bridge: bridgeSettings,
      preview,
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
