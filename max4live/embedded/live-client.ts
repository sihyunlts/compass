import { LIVE_BRIDGE_TARGET } from '../../src/shared/bridge/protocol';
import type { LiveBridgeNotesEnvelope, LiveTempoUpdate } from '../../src/shared/bridge/types';
import type { CompassApi } from '../../src/shared/contracts/ipc/api';
import { normalizeCustomName } from '../../src/shared/model';
import { sanitizeBridgeSettings } from '../../src/shared/validation/bridge-settings';
import { encodeMaxPacket, writeMaxPacket } from './dictionary-transport';
import type { MaxWebApi } from './web-api';

type MaxLiveBridge = Pick<CompassApi, 'sendGeneratedPreview' | 'requestLiveTempo' | 'subscribeLiveTempo'>;

interface PendingLiveTransfer {
  id: string;
  envelope: LiveBridgeNotesEnvelope;
  phase: 'preparing' | 'writing' | 'applying';
  finish: (error?: string, cancel?: boolean) => void;
}

export function createMaxLiveBridge(max: MaxWebApi): MaxLiveBridge {
  const tempoListeners = new Set<(update: LiveTempoUpdate) => void>();
  let lastTempo: LiveTempoUpdate | null = null;
  let pending: PendingLiveTransfer | null = null;

  max.bindInlet('compass_transfer_ready', (requestId, dictionaryName) => {
    const transfer = pending;
    if (!transfer || transfer.id !== String(requestId) || transfer.phase !== 'preparing') return;
    const dictName = String(dictionaryName);
    transfer.phase = 'writing';
    const packet = encodeMaxPacket({ requestId: transfer.id, envelope: transfer.envelope });
    void writeMaxPacket(max, dictName, packet)
      .then(() => {
        if (pending !== transfer) return;
        transfer.phase = 'applying';
        max.outlet('compass_send', transfer.id);
      })
      .catch((error: unknown) => transfer.finish(error instanceof Error ? error.message : String(error), true));
  });

  max.bindInlet('compass_tempo', (value) => {
    const bpm = Number(value);
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    const update: LiveTempoUpdate = { bpm, receivedAtIso: new Date().toISOString(), source: 'max-for-live' };
    lastTempo = update;
    tempoListeners.forEach((listener) => listener(update));
  });
  max.bindInlet('compass_result', (id, success, message) => {
    if (pending?.id === String(id)) {
      pending.finish(Number(success) === 1 ? undefined : String(message || 'Live transfer failed.'));
    }
  });

  return {
    sendGeneratedPreview: async (request) => {
      if (pending) throw new Error('A Live transfer is already in progress.');
      const bridge = sanitizeBridgeSettings(request.bridge);
      const clipName = normalizeCustomName(request.clipName);
      if (!clipName) throw new Error('Clip name is required.');
      const envelope: LiveBridgeNotesEnvelope = {
        event: 'clip_notes.replace', source: 'compass', layout: 'drum-rack',
        path: LIVE_BRIDGE_TARGET.path, applyMode: 'replace', clipName,
        targetLengthBeats: request.preview.sourceTimelineEndBeat,
        autoCreateLengthBeats: bridge.autoCreateLengthBeats,
        notes: request.preview.notes.map((note) => ({ ...note, mute: false })),
      };
      const id = `transfer_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          if (pending?.id !== id) return;
          const phase = pending.phase;
          pending.finish(phase === 'preparing'
            ? 'Max did not prepare the Live transfer.'
            : phase === 'writing'
              ? 'Max did not confirm the clip data.'
              : 'Live did not confirm applying the clip notes.', true);
        }, 30_000);
        pending = {
          id,
          envelope,
          phase: 'preparing',
          finish: (error, cancel = false) => {
            if (pending?.id !== id) return;
            window.clearTimeout(timeout);
            pending = null;
            if (error) reject(new Error(error));
            else resolve();
            if (cancel) {
              try { max.outlet('compass_cancel', id); } catch { /* Host unavailable. */ }
            }
          },
        };
        try {
          max.outlet('compass_prepare', id);
        } catch (error) {
          pending.finish(error instanceof Error ? error.message : String(error));
        }
      });
      return { sentAtIso: new Date().toISOString(), target: LIVE_BRIDGE_TARGET, bridge, preview: request.preview };
    },
    requestLiveTempo: async () => {
      max.outlet('compass_request_tempo');
      return { sentAtIso: new Date().toISOString(), target: LIVE_BRIDGE_TARGET };
    },
    subscribeLiveTempo: (listener) => {
      tempoListeners.add(listener);
      if (lastTempo) listener(lastTempo);
      return () => { tempoListeners.delete(listener); };
    },
  };
}
