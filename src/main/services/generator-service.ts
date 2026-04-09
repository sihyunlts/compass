import {
  launchpadLayout,
  type LaunchpadLayout,
} from '../../core/launchpad-map';
import {
  toGeneratorPreview,
  resolveLaunchpadModel,
} from '../../domain';
import {
  buildGeneratedFieldResult,
} from '../../domain/field-result';
import { LIVE_BRIDGE_TARGET } from '../../shared/bridge/protocol';
import { sanitizeBridgeSettings } from '../../shared/validation/bridge-settings';
import type { ClipNote, LaunchpadModel } from '../../shared/model';
import type {
  GenerateAndSendRequest,
  GenerateAndSendResponse,
  RequestLiveTempoResponse,
} from '../../shared/contracts/ipc/generator';
import { LatestSourceKeyFamilyCache } from '../../shared/source-key-family';
import type {
  BridgeSettings,
  LiveBridgeNotesEnvelope,
  LiveBridgeTempoRequestEnvelope,
} from '../../shared/bridge/types';
import { UdpLiveBridge } from '../bridge/udp-live-bridge';

const LAUNCHPAD_LAYOUT: LaunchpadLayout = launchpadLayout;

interface SendResultCacheEntry {
  key: string;
  preview: GenerateAndSendResponse['preview'];
}

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

/** Coordinates domain note generation and UDP bridge delivery for the renderer. */
export class GeneratorService {
  private readonly resultsByKey = new Map<string, SendResultCacheEntry>();

  private readonly latestSourceKeyByFamily = new LatestSourceKeyFamilyCache();

  public constructor(private readonly bridge = new UdpLiveBridge()) {}

  public async generateAndSend(
    request: GenerateAndSendRequest,
  ): Promise<GenerateAndSendResponse> {
    const bridgeSettings = sanitizeBridgeSettings(request.bridge);
    const launchpadModel = resolveLaunchpadModel(request.launchpadModel);
    const preview = this.resolveGeneratedPreview(
      request.sourceKey,
      request.chain,
      bridgeSettings.autoCreateLengthBeats,
      launchpadModel,
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

  private resolveGeneratedPreview(
    sourceKey: string | undefined,
    chain: GenerateAndSendRequest['chain'],
    loopLengthBeats: number,
    launchpadModel: LaunchpadModel,
  ): GenerateAndSendResponse['preview'] {
    if (!sourceKey) {
      return toGeneratorPreview(buildGeneratedFieldResult({
        chain,
        loopLengthBeats,
        launchpadModel,
      }));
    }

    const key = this.toSendResultKey(sourceKey, loopLengthBeats, launchpadModel);
    const cached = this.resultsByKey.get(key);
    if (cached) {
      return cached.preview;
    }

    const generated = buildGeneratedFieldResult({
      chain,
      loopLengthBeats,
      launchpadModel,
    });
    const preview = toGeneratorPreview(generated);
    this.resultsByKey.set(key, {
      key,
      preview,
    });
    this.evictStaleSourceFamilyEntries(sourceKey);
    return preview;
  }

  private toSendResultKey(
    sourceKey: string,
    loopLengthBeats: number,
    launchpadModel: string,
  ): string {
    return `${sourceKey}:${loopLengthBeats}:${launchpadModel}`;
  }

  private evictStaleSourceFamilyEntries(sourceKey: string): void {
    const staleSourceKey = this.latestSourceKeyByFamily.replaceLatestSourceKey(sourceKey);
    if (!staleSourceKey) {
      return;
    }

    const stalePrefix = `${staleSourceKey}:`;
    for (const key of this.resultsByKey.keys()) {
      if (key.startsWith(stalePrefix)) {
        this.resultsByKey.delete(key);
      }
    }
  }
}
