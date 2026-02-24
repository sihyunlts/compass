export const IPC_CHANNELS = {
  generateAndSend: 'bridge:generate-and-send',
  requestLiveTempo: 'bridge:request-live-tempo',
  liveTempoUpdate: 'live:tempo-update',
  openPreviewWindow: 'preview:open-window',
  pushPreviewWindowState: 'preview:push-state',
  previewWindowStateUpdate: 'preview:state-update',
  requestPreviewWindowState: 'preview:request-state',
  requestPreviewWindowVisibility: 'preview:request-window-visibility',
  previewWindowVisibilityUpdate: 'preview:window-visibility-update',
  requestPreviewGuideEnabledUpdate: 'preview:request-guide-enabled-update',
  previewGuideEnabledUpdate: 'preview:guide-enabled-update',
} as const;
