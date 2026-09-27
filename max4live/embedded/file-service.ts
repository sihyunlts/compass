import { homedir } from 'node:os';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { watch } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PresetStorage } from '../../src/main/services/presets/preset-storage';
import { NativePresetBackend } from '../../src/main/services/presets/native-preset-backend';
import { PresetRepository } from '../../src/shared/preset/repository';
import { parsePresetEntryRequest, parseSavePresetFileRequest, parseSaveRackFileRequest, parseUpdateRackFileInfoRequest } from '../../src/shared/preset/requests';
import type { FileMethod, FileServiceApi } from './file-protocol';
import { decodeMaxPacket, encodeMaxPacket } from './dictionary-transport';
import { PresetDialogs } from '../../src/main/services/presets/preset-dialogs';
import { PresetFileOperations } from '../../src/main/services/presets/preset-file-operations';
import { PRESET_FILE_SPECS } from '../../src/main/services/presets/preset-config';
import { hasPresetExtension } from '../../src/shared/preset/paths';
import { PresetNameConflictError } from '../../src/shared/preset/operation-error';
import { NativeSaveDialog } from './save-dialog';
import { saveMidiFile } from '../../src/main/services/midi-file-service';
import { trashPresetItem } from './trash';

declare const __COMPASS_PRODUCT_NAME__: string;
// Provided by Max's bundled Node runtime; never installed from npm.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Max supplies this CommonJS host module.
const max = require('max-api') as {
  addHandler: (name: string, callback: (...args: string[]) => void) => void;
  getDict: (name: string) => Promise<unknown>;
  setDict: (name: string, value: unknown) => Promise<void>;
  outlet: (...args: unknown[]) => Promise<void>;
};

function userDataDirectory(): string {
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', __COMPASS_PRODUCT_NAME__);
  if (process.platform === 'win32') {
    if (!process.env.APPDATA) throw new Error('Windows APPDATA is unavailable.');
    return path.join(process.env.APPDATA, __COMPASS_PRODUCT_NAME__);
  }
  throw new Error('Compass for Max supports macOS and Windows.');
}

const runFile = promisify(execFile);
const storage = new PresetStorage({
  userDataDirectory,
  trashItem: trashPresetItem,
});
const backend = new NativePresetBackend(storage);
const repository = new PresetRepository(backend);
const files = new PresetFileOperations(storage, backend, repository);
const dialogs = new PresetDialogs(userDataDirectory);
const nativeDialog = new NativeSaveDialog(max);
const chosenExternalPaths = new Set<string>();
const cancelledRequests = new Set<string>();
const runningRequests = new Set<string>();
let lastMidiDirectory = homedir();

process.once('exit', () => {
  for (const id of runningRequests) nativeDialog.cancel(id);
});

const assertRackPathAccess = async (filePath: string): Promise<void> => {
  if (!path.isAbsolute(filePath) || !hasPresetExtension(filePath, PRESET_FILE_SPECS.rack.extension)) {
    throw new Error('Invalid rack file path.');
  }
  if (!chosenExternalPaths.has(path.resolve(filePath)) && !await backend.entryAtPath('rack', filePath)) {
    throw new Error('Use Save As to choose this file in the native dialog first.');
  }
};

type ServiceHandlers = {
  [Method in FileMethod]: (
    request: Parameters<FileServiceApi[Method]>[0],
    requestId: string,
  ) => ReturnType<FileServiceApi[Method]>;
};
const api: ServiceHandlers = {
  saveMidiFile: (request, id) => saveMidiFile(request, async (fileName) => {
    if (cancelledRequests.has(id)) return { canceled: true };
    const result = await nativeDialog.choosePath(id, path.join(lastMidiDirectory, fileName), '.mid');
    if (result.canceled === true || cancelledRequests.has(id)) return { canceled: true };
    lastMidiDirectory = path.dirname(result.filePath);
    return result;
  }),
  savePresetFile: async (request, id) => {
    const parsed = parseSavePresetFileRequest(request);
    if (!parsed) return { status: 'error', message: 'Invalid preset save request.' };
    const spec = PRESET_FILE_SPECS[parsed.payload.presetType];
    const baseDirectory = await storage.resolvePresetDirectory(parsed.payload.presetType);
    if (cancelledRequests.has(id)) return { status: 'canceled' };
    const result = await dialogs.showSavePresetFileDialog(parsed, baseDirectory,
      (options) => nativeDialog.choosePath(id, options.defaultPath, spec.extension));
    if (result.status === 'canceled' || cancelledRequests.has(id)) return { status: 'canceled' };
    const filePath = await files.saveAtPath(result.filePath, parsed.payload);
    chosenExternalPaths.add(path.resolve(filePath));
    await dialogs.rememberSaveDirectory(parsed, filePath);
    return { status: 'saved', filePath };
  },
  saveRackFile: async (request) => {
    const parsed = parseSaveRackFileRequest(request);
    if (!parsed) return { status: 'error', message: 'Invalid rack save request.' };
    await assertRackPathAccess(parsed.filePath);
    return { status: 'saved', filePath: await files.saveAtPath(parsed.filePath, parsed.payload) };
  },
  updateRackFileInfo: async (request) => {
    const parsed = parseUpdateRackFileInfoRequest(request);
    if (!parsed) return { status: 'error', message: 'Invalid rack info request.' };
    await assertRackPathAccess(parsed.filePath);
    try {
      const updated = await files.updatePresetInfoAtPath('rack', parsed.filePath, parsed.fileName, parsed.metadata);
      chosenExternalPaths.delete(path.resolve(parsed.filePath));
      chosenExternalPaths.add(path.resolve(updated.filePath));
      return { status: 'updated', ...updated };
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error),
        ...(error instanceof PresetNameConflictError ? { errorCode: error.code } : {}) };
    }
  },
  renamePresetFile: (request) => repository.renamePresetFile(request),
  updatePresetFileInfo: (request) => repository.updatePresetFileInfo(request),
  createPresetFolder: (request) => repository.createPresetFolder(request),
  renamePresetFolder: (request) => repository.renamePresetFolder(request),
  listPresetBrowserTree: () => repository.listPresetBrowserTree(),
  deletePresetEntries: (request) => repository.deletePresetEntries(request),
  movePresetEntries: (request) => repository.movePresetEntries(request),
  copyPresetEntries: (request) => repository.copyPresetEntries(request),
  readPresetEntry: (request) => repository.readPresetEntry(request),
  showPresetEntryInFolder: async (request) => {
    const parsed = parsePresetEntryRequest(request);
    if (!parsed) return { status: 'error', message: 'Invalid preset item request.' };
    const filePath = await backend.storage.location(parsed);
    const root = await realpath(await storage.resolvePresetsRootDirectory());
    const actualPath = await realpath(filePath);
    if (!actualPath.startsWith(root + path.sep) && actualPath !== root) {
      return { status: 'error', message: 'The item is outside the shared Compass preset folder.' };
    }
    await runFile(process.platform === 'darwin' ? '/usr/bin/open' : 'explorer.exe',
      process.platform === 'darwin' ? ['-R', actualPath] : [`/select,${actualPath}`]);
    return { status: 'ok' };
  },
};

async function start(): Promise<void> {
  const root = await storage.resolvePresetsRootDirectory();
  // Creates the same library roots and applies the existing explicit directory
  // migration. Preset contents still migrate on read, without rewriting files.
  await Promise.all((['device', 'group', 'rack'] as const).map((kind) => storage.resolvePresetDirectory(kind)));
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(root, { recursive: true, persistent: false }, () => {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { void max.outlet('changed'); }, 100);
  });
  watcher.on('error', (error) => { void max.outlet('service_error', error.message); });
  max.addHandler('cancel_request', (id) => {
    if (!runningRequests.has(id)) return;
    cancelledRequests.add(id);
    nativeDialog.cancel(id);
  });
  max.addHandler('request', (dictName, id) => {
    if (runningRequests.has(id)) return;
    runningRequests.add(id);
    void (async () => {
      try {
        const packet = decodeMaxPacket(await max.getDict(dictName));
        if (packet.requestId !== id || typeof packet.method !== 'string'
          || !Object.prototype.hasOwnProperty.call(api, packet.method)) throw new Error('Invalid file operation.');
        const operation = api[packet.method as FileMethod] as (request: unknown, requestId: string) => Promise<unknown>;
        const result = await operation(packet.request, id);
        await max.setDict(dictName, encodeMaxPacket({ requestId: id, result }));
      } catch (error) {
        await max.setDict(dictName, encodeMaxPacket({ requestId: id, error: error instanceof Error ? error.message : String(error) }));
      }
      await max.outlet('response', id);
    })().catch((error: unknown) => { void max.outlet('request_error', id, String(error)); })
      .finally(() => { runningRequests.delete(id); cancelledRequests.delete(id); });
  });
  await max.outlet('service_ready');
}

void start().catch((error: unknown) => { void max.outlet('service_error', String(error)); });
