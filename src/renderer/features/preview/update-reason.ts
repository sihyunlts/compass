export type PreviewUpdateReason =
  | 'initial'
  | 'rack-load'
  | 'output-change'
  | 'playback-length-change'
  | 'delivery';

export type ScheduledPreviewUpdateReason = Exclude<
  PreviewUpdateReason,
  'delivery'
>;

export const PREVIEW_UPDATE_POLICY = {
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
  'playback-length-change': {
    restartPlayback: true,
    previewVisual: 'consume',
  },
  delivery: {
    restartPlayback: true,
    previewVisual: 'consume',
  },
} as const satisfies Record<PreviewUpdateReason, {
  restartPlayback: boolean;
  previewVisual: 'unchanged' | 'rearm' | 'consume';
}>;
