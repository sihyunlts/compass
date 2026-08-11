import type {
  GeneratorPreview,
  GeneratorPreviewLedFrame,
} from '../../../shared/contracts/preview/generator-preview';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';

interface PreviewGenerationRequestBase {
  requestId: number;
  sourceChain: GeneratorChain;
  loopLengthBeats: number;
  launchpadModel: LaunchpadModel;
}

export type PreviewGenerationRequest =
  | PreviewGenerationRequestBase & {
      kind: 'full';
    }
  | PreviewGenerationRequestBase & {
      kind: 'led-frames';
      frameCount: number;
    };

export type PreviewGenerationResponse =
  | {
      requestId: number;
      kind: 'full';
      ok: true;
      preview: GeneratorPreview;
    }
  | {
      requestId: number;
      kind: 'led-frames';
      ok: true;
      ledFrames: ReadonlyArray<GeneratorPreviewLedFrame>;
    }
  | {
      requestId: number;
      kind: PreviewGenerationRequest['kind'];
      ok: false;
      error: string;
    };
