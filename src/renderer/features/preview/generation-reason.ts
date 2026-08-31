export type PreviewGenerationReason =
  | 'initial'
  | 'rack-load'
  | 'output-change'
  | 'delivery';

export type ScheduledPreviewGenerationReason = Exclude<
  PreviewGenerationReason,
  'delivery'
>;

export const PREVIEW_GENERATION_POLICY = {
  initial: {
    restartPlayback: false,
    previewVisual: 'unchanged',
  },
  'rack-load': {
    restartPlayback: true,
    previewVisual: 'rearm',
  },
  'output-change': {
    restartPlayback: true,
    previewVisual: 'consume',
  },
  delivery: {
    restartPlayback: true,
    previewVisual: 'consume',
  },
} as const satisfies Record<PreviewGenerationReason, {
  restartPlayback: boolean;
  previewVisual: 'unchanged' | 'rearm' | 'consume';
}>;
