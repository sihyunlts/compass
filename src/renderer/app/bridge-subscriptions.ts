import type { CompassApi } from '../../shared/contracts/ipc/api';
import type { UpdateCheckResponse } from '../../shared/contracts/ipc/releases';
import type { PlaybackSessionController } from './playback-session.svelte';

interface BridgeSubscriptionOptions {
  bridgeClient: CompassApi;
  playbackSession: PlaybackSessionController;
  onVersionResolved?: (version: string) => void;
  onUpdateCheckResolved?: (result: UpdateCheckResponse) => void;
  onAppFocusChange?: (isFocused: boolean) => void;
}

const runBestEffort = (task: Promise<unknown>): void => {
  void task.catch(() => {
    // Non-critical renderer bridge failures should not block the main app shell.
  });
};

/** Mounts renderer-side bridge subscriptions and initial status sync requests. */
export const mountBridgeSubscriptions = (
  options: BridgeSubscriptionOptions,
): (() => void) => {
  let liveTempoUnsubscribe: (() => void) | null =
    options.bridgeClient.subscribeLiveTempo((update) => {
      options.playbackSession.syncPreviewBpm(update.bpm);
    });
  let previewWindowVisibilityUnsubscribe: (() => void) | null =
    options.bridgeClient.subscribePreviewWindowVisibility((isOpen) => {
      options.playbackSession.setPreviewPopoutOpen(isOpen === true);
    });
  let appFocusUnsubscribe: (() => void) | null =
    options.bridgeClient.subscribeAppFocus((isFocused) => {
      options.onAppFocusChange?.(isFocused);
    });

  runBestEffort(
    options.bridgeClient.requestAppFocus().then((isFocused) => {
      options.onAppFocusChange?.(isFocused);
    }),
  );
  runBestEffort(
    options.bridgeClient.requestAppVersion().then((version) => {
      options.onVersionResolved?.(version);
    }),
  );
  runBestEffort(
    options.bridgeClient.checkForUpdates().then((result) => {
      options.onUpdateCheckResolved?.(result);
    }),
  );
  runBestEffort(
    options.bridgeClient.requestPreviewWindowVisibility().then((isOpen) => {
      options.playbackSession.setPreviewPopoutOpen(isOpen === true);
    }),
  );
  runBestEffort(options.playbackSession.requestLiveTempoSync());

  return () => {
    if (liveTempoUnsubscribe) {
      liveTempoUnsubscribe();
      liveTempoUnsubscribe = null;
    }
    if (previewWindowVisibilityUnsubscribe) {
      previewWindowVisibilityUnsubscribe();
      previewWindowVisibilityUnsubscribe = null;
    }
    if (appFocusUnsubscribe) {
      appFocusUnsubscribe();
      appFocusUnsubscribe = null;
    }
  };
};
