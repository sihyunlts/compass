import type { GeneratorPreviewLedFrame } from '../../../shared/contracts/preview/generator-preview';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';
import { createPreviewGenerationWorkerClient } from '../preview/generation-worker-client';

export type PresetPreviewLedFrames = ReadonlyArray<GeneratorPreviewLedFrame>;

interface PresetPreviewGenerationInput {
  cacheKey: string;
  sourceChain: GeneratorChain;
  frameCount: number;
  launchpadModel: LaunchpadModel;
}

const MAX_CACHE_ENTRY_COUNT = 64;

class PresetPreviewGenerationClient {
  private readonly cache = new Map<string, PresetPreviewLedFrames>();

  private readonly workerClient = createPreviewGenerationWorkerClient();

  public getCached(cacheKey: string): PresetPreviewLedFrames | null {
    const cached = this.cache.get(cacheKey);
    if (!cached) {
      return null;
    }

    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, cached);
    return cached;
  }

  public generate(input: PresetPreviewGenerationInput): Promise<PresetPreviewLedFrames> {
    const cached = this.getCached(input.cacheKey);
    if (cached) {
      return Promise.resolve(cached);
    }

    return this.workerClient.generateLedFrames({
      sourceChain: input.sourceChain,
      loopLengthBeats: 1,
      frameCount: input.frameCount,
      launchpadModel: input.launchpadModel,
    }).then((ledFrames) => {
      this.cacheResult(input.cacheKey, ledFrames);
      return ledFrames;
    });
  }

  public cancel(): void {
    this.workerClient.cancel();
  }

  public dispose(): void {
    this.workerClient.dispose();
    this.cache.clear();
  }

  private cacheResult(
    cacheKey: string,
    ledFrames: PresetPreviewLedFrames,
  ): void {
    this.cache.set(cacheKey, ledFrames);
    while (this.cache.size > MAX_CACHE_ENTRY_COUNT) {
      const oldestKey = this.cache.keys().next().value;
      if (typeof oldestKey !== 'string') {
        break;
      }
      this.cache.delete(oldestKey);
    }
  }
}

export const createPresetPreviewGenerationClient =
  (): PresetPreviewGenerationClient => new PresetPreviewGenerationClient();
