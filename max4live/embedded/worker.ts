import InlineWorker from '../../src/renderer/features/preview/generation-worker.ts?worker&inline';

export const createPreviewWorker = (): Worker => new InlineWorker();
