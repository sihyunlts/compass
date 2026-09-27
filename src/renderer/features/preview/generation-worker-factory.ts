export const createPreviewWorker = (): Worker =>
  new Worker(new URL('./generation-worker.ts', import.meta.url), { type: 'module' });
