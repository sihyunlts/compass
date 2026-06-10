import type { GeneratorPreview } from '../../../shared/contracts/preview/generator-preview';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';

interface PreviewGenerationInput {
  sourceChain: GeneratorChain;
  loopLengthBeats: number;
  launchpadModel: LaunchpadModel;
}

type PreviewGenerationWorkerResponse =
  | {
    requestId: number;
    ok: true;
    preview: GeneratorPreview;
  }
  | {
    requestId: number;
    ok: false;
    error: string;
  };

class PreviewGenerationWorkerClient {
  private worker: Worker | null = null;

  private activeReject: ((error: Error) => void) | null = null;

  private nextRequestId = 1;

  public generate(input: PreviewGenerationInput): Promise<GeneratorPreview> {
    this.cancelActive();

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const worker = new Worker(new URL('./generation-worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;

    return new Promise<GeneratorPreview>((resolve, reject) => {
      this.activeReject = reject;

      worker.onmessage = (event: MessageEvent<PreviewGenerationWorkerResponse>): void => {
        const response = event.data;
        if (response.requestId !== requestId) {
          return;
        }

        this.clearWorker(worker);
        if (response.ok === true) {
          resolve(response.preview);
          return;
        }

        reject(new Error(response.error));
      };

      worker.onerror = (event): void => {
        this.clearWorker(worker);
        reject(new Error(event.message || 'Preview worker failed'));
      };

      worker.postMessage({
        requestId,
        ...input,
      });
    });
  }

  public dispose(): void {
    this.cancelActive();
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
