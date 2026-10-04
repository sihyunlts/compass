import type { CompassApi } from '../../src/shared/contracts/ipc/api';
import type { FileMethod, FileServiceApi } from './file-protocol';
import { decodeMaxPacket, encodeMaxPacket, readMaxDictionary, writeMaxPacket, type MaxPacketDictionary } from './dictionary-transport';
import type { MaxWebApi } from './web-api';

interface PendingFileRequest {
  packet: MaxPacketDictionary;
  complete: (result?: unknown, error?: string) => void;
  setDialogOpen: (open: boolean) => void;
  submitted: boolean;
}

export function createMaxFileBridge(max: MaxWebApi) {
  const listeners = new Set<() => void>();
  const pending = new Map<string, PendingFileRequest>();
  let savingPreset = false;
  let serviceReady = false;
  let serviceError = '';

  max.bindInlet('compass_files_status', (ready, error) => {
    serviceReady = Number(ready) === 1;
    serviceError = serviceReady ? '' : String(error || 'The file service could not start.');
    for (const [id, call] of pending) {
      if (serviceReady) {
        if (!call.submitted) prepare(id, call);
      } else {
        call.complete(undefined, serviceError);
      }
    }
  });
  max.bindInlet('compass_files_prepared', (requestId, dictionaryName) => {
    const id = String(requestId);
    const call = pending.get(id);
    if (!call) {
      max.outlet('compass_files', 'release', id);
      return;
    }
    if (call.submitted) return;
    call.submitted = true;
    void writeMaxPacket(max, String(dictionaryName), call.packet)
      .then(() => {
        if (pending.get(id) !== call) return;
        max.outlet('compass_files', 'request', id);
      })
      .catch((error: unknown) => call.complete(undefined, String(error)));
  });
  max.bindInlet('compass_files_result', (requestId, dictionaryName) => {
    const id = String(requestId);
    const call = pending.get(id);
    if (!call) {
      max.outlet('compass_files', 'release', id);
      return;
    }
    void readMaxDictionary(max, String(dictionaryName)).then((value) => {
      if (pending.get(id) !== call) return;
      const packet = decodeMaxPacket(value);
      if (packet.requestId !== id || (!('result' in packet) && typeof packet.error !== 'string')) {
        throw new Error('Invalid file response.');
      }
      call.complete(packet.result, typeof packet.error === 'string' ? packet.error : undefined);
    }).catch((error: unknown) => call.complete(undefined, String(error)));
  });
  max.bindInlet('compass_files_dialog', (id, open) => {
    pending.get(String(id))?.setDialogOpen(Number(open) === 1);
  });
  window.addEventListener('pagehide', () => {
    for (const call of pending.values()) call.complete(undefined, 'The Max page closed.');
  });
  max.bindInlet('compass_files_error', (id, message) => pending.get(String(id))?.complete(undefined, String(message)));
  max.bindInlet('compass_files_changed', () => listeners.forEach((listener) => listener()));
  max.outlet('compass_files', 'status');

  function prepare(id: string, request: PendingFileRequest): void {
    try {
      max.outlet('compass_files', 'prepare', id);
    } catch (error) {
      request.complete(undefined, String(error));
    }
  }

  function call<K extends FileMethod>(method: K, request?: unknown): ReturnType<FileServiceApi[K]> {
    const failure = (message: string) => ({
      status: 'error',
      message,
      ...(method === 'readPresetEntry' ? { errorCode: 'file-read-failed' } : {}),
    });
    return new Promise<unknown>((resolve) => {
      if (serviceError) {
        resolve(failure(serviceError));
        return;
      }
      const id = `file_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const startTimeout = () => window.setTimeout(() => pending.get(id)?.complete(undefined,
        'The file service did not respond. Check the Max console. A submitted save may still finish.'), 30_000);
      let timeout = startTimeout();
      pending.set(id, {
        packet: encodeMaxPacket({ requestId: id, method, request: request ?? null }),
        submitted: false,
        setDialogOpen: (open) => {
          window.clearTimeout(timeout);
          // Native dialogs can stay open indefinitely; resume the service timer
          // only after the user chooses a destination or cancels.
          if (!open) timeout = startTimeout();
        },
        complete: (result, error) => {
          if (!pending.has(id)) return;
          window.clearTimeout(timeout);
          pending.delete(id);
          resolve(error ? failure(error) : result);
          // Cleanup must not prevent completion if the host has disconnected.
          try { max.outlet('compass_files', 'release', id); } catch { /* Host unavailable. */ }
        },
      });
      if (serviceReady) prepare(id, pending.get(id)!);
    }) as ReturnType<FileServiceApi[K]>;
  }

  return {
    saveMidiFile: (request) => call('saveMidiFile', request),
    savePresetFile: async (request) => {
      if (savingPreset) return { status: 'canceled' };
      savingPreset = true;
      try {
        return await call('savePresetFile', request);
      } finally {
        savingPreset = false;
      }
    },
    saveRackFile: (request) => call('saveRackFile', request),
    updateRackFileInfo: (request) => call('updateRackFileInfo', request),
    renamePresetFile: (request) => call('renamePresetFile', request),
    updatePresetFileInfo: (request) => call('updatePresetFileInfo', request),
    createPresetFolder: (request) => call('createPresetFolder', request),
    renamePresetFolder: (request) => call('renamePresetFolder', request),
    listPresetBrowserTree: () => call('listPresetBrowserTree'),
    deletePresetEntries: (request) => call('deletePresetEntries', request),
    movePresetEntries: (request) => call('movePresetEntries', request),
    copyPresetEntries: (request) => call('copyPresetEntries', request),
    readPresetEntry: ((request) => call('readPresetEntry', request)) as CompassApi['readPresetEntry'],
    showPresetEntryInFolder: (request) => call('showPresetEntryInFolder', request),
    subscribePresetBrowserTreeChanged: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  } satisfies FileServiceApi & Pick<CompassApi, 'subscribePresetBrowserTreeChanged'>;
}
