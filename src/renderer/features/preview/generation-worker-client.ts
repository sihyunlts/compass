import type {
  GeneratorPreview,
  GeneratorPreviewLedFrame,
} from '../../../shared/contracts/preview/generator-preview';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';
import type {
  PreviewGenerationRequest,
  PreviewGenerationResponse,
} from './generation-worker-protocol';

interface PreviewGenerationInput {
  sourceChain: GeneratorChain;
  loopLengthBeats: number;
  launchpadModel: LaunchpadModel;
}

interface LedFrameGenerationInput extends PreviewGenerationInput {
  frameCount: number;
}

class PreviewGenerationWorkerClient {
  private worker: Worker | null = null;

  private activeReject: ((error: Error) => void) | null = null;

  private nextRequestId = 1;

  public generate(input: PreviewGenerationInput): Promise<GeneratorPreview> {
    return this.request(
      (requestId) => ({
        kind: 'full',
        requestId,
        ...input,
      }),
      (response) => {
        if (response.ok === false) {
          throw new Error(response.error);
        }
        if (response.kind !== 'full') {
          throw new Error('Preview worker returned an unexpected response');
        }
        return response.preview;
      },
    );
  }

  public generateLedFrames(
    input: LedFrameGenerationInput,
  ): Promise<ReadonlyArray<GeneratorPreviewLedFrame>> {
    return this.request(
      (requestId) => ({
        kind: 'led-frames',
        requestId,
        ...input,
      }),
      (response) => {
        if (response.ok === false) {
          throw new Error(response.error);
        }
        if (response.kind !== 'led-frames') {
          throw new Error('Preview worker returned an unexpected response');
        }
        return response.ledFrames;
      },
    );
  }

  public cancel(): void {
    this.cancelActive();
  }

  public dispose(): void {
    this.cancelActive();
  }

  private request<T>(
    createRequest: (requestId: number) => PreviewGenerationRequest,
    resolveResponse: (response: PreviewGenerationResponse) => T,
  ): Promise<T> {
    this.cancelActive();

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const worker = new Worker(new URL('./generation-worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;

    return new Promise<T>((resolve, reject) => {
      this.activeReject = reject;

      worker.onmessage = (event: MessageEvent<PreviewGenerationResponse>): void => {
        const response = event.data;
        if (response.requestId !== requestId) {
          return;
        }

        this.clearWorker(worker);
        try {
          resolve(resolveResponse(response));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      worker.onerror = (event): void => {
        this.clearWorker(worker);
        reject(new Error(event.message || 'Preview worker failed'));
      };

      worker.postMessage(createRequest(requestId));
    });
  }

  private cancelActive(): void {
    const worker = this.worker;
    if (!worker) {
      return;
    }

    const reject = this.activeReject;
    this.clearWorker(worker);
    reject?.(new Error('Preview generation cancelled'));
  }

  private clearWorker(worker: Worker): void {
    if (this.worker !== worker) {
      return;
    }

    worker.terminate();
    this.worker = null;
    this.activeReject = null;
  }
}

export const createPreviewGenerationWorkerClient = (): PreviewGenerationWorkerClient =>
  new PreviewGenerationWorkerClient();
