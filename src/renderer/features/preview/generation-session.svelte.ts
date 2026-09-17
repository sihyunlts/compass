import { scalePlaybackTiming } from '../../../domain/playback-timing';
import type { GeneratorPreview } from '../../../shared/contracts/preview/generator-preview';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';
import { createPreviewGenerationWorkerClient } from './generation-worker-client';

interface PreviewPatternSource {
  sourceChain: GeneratorChain;
  sourceKey: string;
  launchpadModel: LaunchpadModel;
}

export interface PreviewPlaybackRequest extends PreviewPatternSource {
  loopLengthBeats: number;
}

interface CachedNormalizedPreview {
  sourceKey: string;
  launchpadModel: LaunchpadModel;
  preview: GeneratorPreview;
}

type PreviewGenerationPurpose = 'preview' | 'delivery';

const hashPreviewSource = (chain: GeneratorChain): string => {
  const source = JSON.stringify(chain);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16)}-${source.length}`;
};

export const createPreviewSourceKey = (
  sourceRevision: number,
  chain: GeneratorChain,
): string =>
  `chain:${sourceRevision}:${hashPreviewSource(chain)}`;

class PreviewGenerationSession {
  private activePurpose: PreviewGenerationPurpose | null = $state(null);

  private readonly workerClient = createPreviewGenerationWorkerClient();

  private requestId = 0;

  private latestNormalizedPreview: CachedNormalizedPreview | null = null;

  private pendingNormalizedPreview: {
    sourceKey: string;
    launchpadModel: LaunchpadModel;
    promise: Promise<GeneratorPreview>;
  } | null = null;

  public get isGenerating(): boolean {
    return this.activePurpose !== null;
  }

  public get isDeliveryPending(): boolean {
    return this.activePurpose === 'delivery';
  }

  public async resolve(
    input: PreviewPlaybackRequest,
    purpose: PreviewGenerationPurpose,
  ): Promise<GeneratorPreview> {
    let preview = this.resolveCachedNormalizedPreview(input);
    if (preview) {
      this.cancelPending();
    } else {
      let pending = this.pendingNormalizedPreview;
      if (
        !pending
        || pending.sourceKey !== input.sourceKey
        || pending.launchpadModel !== input.launchpadModel
      ) {
        pending = {
          sourceKey: input.sourceKey,
          launchpadModel: input.launchpadModel,
          promise: this.generateNormalizedPreview(input, purpose),
        };
        this.pendingNormalizedPreview = pending;
      } else if (purpose === 'delivery') {
        this.activePurpose = 'delivery';
      }
      preview = await pending.promise;
    }
    return scalePlaybackTiming(preview, input.loopLengthBeats);
  }

  public dispose(): void {
    this.cancelPending();
    this.latestNormalizedPreview = null;
  }

  private async generateNormalizedPreview(
    input: PreviewPatternSource,
    purpose: PreviewGenerationPurpose,
  ): Promise<GeneratorPreview> {
    this.cancelPending();
    const requestId = this.requestId;
    this.activePurpose = purpose;
    try {
      await waitForNextAnimationFrame();
      this.requireCurrentRequest(requestId);
      const preview = await this.workerClient.generate({
        sourceChain: input.sourceChain,
        launchpadModel: input.launchpadModel,
      });
      this.requireCurrentRequest(requestId);
      this.latestNormalizedPreview = {
        sourceKey: input.sourceKey,
        launchpadModel: input.launchpadModel,
        preview,
      };
      return preview;
    } finally {
      if (requestId === this.requestId) {
        this.activePurpose = null;
        this.pendingNormalizedPreview = null;
      }
    }
  }

  private cancelPending(): void {
    this.requestId += 1;
    this.workerClient.cancel();
    this.pendingNormalizedPreview = null;
    this.activePurpose = null;
  }

  private requireCurrentRequest(requestId: number): void {
    if (requestId !== this.requestId) {
      throw new Error('Preview generation cancelled');
    }
  }

  private resolveCachedNormalizedPreview(input: PreviewPatternSource): GeneratorPreview | null {
    const cached = this.latestNormalizedPreview;
    return cached
      && cached.sourceKey === input.sourceKey
      && cached.launchpadModel === input.launchpadModel
      ? cached.preview
      : null;
  }
}

export const createPreviewGenerationSession = (): PreviewGenerationSession =>
  new PreviewGenerationSession();

const waitForNextAnimationFrame = (): Promise<void> =>
  new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

export const isPreviewGenerationCancelled = (error: unknown): boolean =>
  error instanceof Error && error.message === 'Preview generation cancelled';
