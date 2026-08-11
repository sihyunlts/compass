import { toGeneratorPreview } from '../../../domain/generator-preview';
import { buildGeneratedFieldResult } from '../../../domain/field-result';
import { resolveEvenlySpacedSampleIndices } from '../../../shared/even-sampling';
import type {
  PreviewGenerationRequest,
  PreviewGenerationResponse,
} from './generation-worker-protocol';

interface PreviewGenerationWorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<PreviewGenerationRequest>) => void,
  ): void;
  postMessage(message: PreviewGenerationResponse): void;
}

const workerScope = self as PreviewGenerationWorkerScope;

workerScope.addEventListener('message', (event: MessageEvent<PreviewGenerationRequest>) => {
  const request = event.data;

  try {
    const generated = buildGeneratedFieldResult({
      chain: request.sourceChain,
      loopLengthBeats: request.loopLengthBeats,
      launchpadModel: request.launchpadModel,
    });
    if (request.kind === 'led-frames') {
      const response: PreviewGenerationResponse = {
        requestId: request.requestId,
        kind: request.kind,
        ok: true,
        ledFrames: resolveEvenlySpacedSampleIndices(
          generated.ledFramesBySampleIndex.length,
          request.frameCount,
        ).map((frameIndex) => generated.ledFramesBySampleIndex[frameIndex]),
      };
      workerScope.postMessage(response);
      return;
    }

    const response: PreviewGenerationResponse = {
      requestId: request.requestId,
      kind: request.kind,
      ok: true,
      preview: toGeneratorPreview(generated),
    };
    workerScope.postMessage(response);
  } catch (error) {
    const response: PreviewGenerationResponse = {
      requestId: request.requestId,
      kind: request.kind,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown preview generation error',
    };
    workerScope.postMessage(response);
  }
});
