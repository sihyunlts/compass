import { toGeneratorPreview } from '../../../domain/generator-preview';
import { buildGeneratedFieldResult } from '../../../domain/field-result';
import type { GeneratorPreview } from '../../../shared/contracts/preview/generator-preview';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';

interface PreviewGenerationRequest {
  requestId: number;
  sourceChain: GeneratorChain;
  loopLengthBeats: number;
  launchpadModel: LaunchpadModel;
}

type PreviewGenerationResponse =
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

interface PreviewGenerationWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<PreviewGenerationRequest>) => void,
  ): void;
  postMessage(message: PreviewGenerationResponse): void;
}

const workerScope = self as PreviewGenerationWorkerScope;

workerScope.addEventListener('message', (event: MessageEvent<PreviewGenerationRequest>) => {
  const { requestId, sourceChain, loopLengthBeats, launchpadModel } = event.data;

  try {
    const generated = buildGeneratedFieldResult({
      chain: sourceChain,
      loopLengthBeats,
      launchpadModel,
    });
    const response: PreviewGenerationResponse = {
      requestId,
      ok: true,
      preview: toGeneratorPreview(generated),
    };
    workerScope.postMessage(response);
  } catch (error) {
    const response: PreviewGenerationResponse = {
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown preview generation error',
    };
    workerScope.postMessage(response);
  }
});
