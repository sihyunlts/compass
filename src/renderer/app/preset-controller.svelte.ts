import type { CompassApi } from '../../shared/contracts/ipc/api';
import type {
  CreatePresetFolderRequest,
  PresetBrowserTreeNode,
  ReadPresetEntryResponse,
  RenamePresetFolderRequest,
  SavePresetFileRequest,
} from '../../shared/contracts/ipc/presets';
import { parsePresetFileText, type RackPresetFile } from '../../shared/presets';
import type {
  BrowserTreePresetFolderNode,
  BrowserTreePresetLeafNode,
  PendingPresetFolderDraft,
  PresetFolderSelectionTarget,
} from '../components/browser-tree-types';
import type { ContextMenuTarget } from '../components/context-menu-types';
import type {
  BrowserInsertSource,
  BrowserPresetInsertSource,
  RackPresetFileDrop,
} from '../components/device-rack-types';
import {
  buildDevicePresetFile,
  buildGroupPresetFile,
  buildRackPresetFile,
  resolveDevicePresetSuggestedName,
  resolveGroupPresetSuggestedName,
} from '../features/editor/presets';
import type { EditorSession } from '../features/editor/session.svelte';
import { resolveGroupMemberIds } from '../features/editor/chain-ops';
import type { RackDropZone } from '../features/rack/drop-ops';

const DEFAULT_PRESET_DROP_ZONE: RackDropZone = {
  kind: 'outside',
  targetId: null,
  placement: 'after',
};

const PRESET_ROOT_LABELS = {
  device: 'Devices',
  group: 'Groups',
  rack: 'Racks',
} as const;

type PresetEntryTarget = Extract<ContextMenuTarget, { kind: 'preset-entry' }>;
type PresetsRootTarget = Extract<ContextMenuTarget, { kind: 'presets-root' }>;
type ShowInFolderTarget = PresetEntryTarget | PresetsRootTarget;
type PendingRackPresetLoadTarget = {
  label: string;
  description?: string;
  load: () => Promise<void>;
};

type RackOpenTarget = {
  label: string;
  preset: RackPresetFile;
  filePath: string | null;
};

interface PresetControllerState {
  presetTree: BrowserTreePresetFolderNode[];
  isPresetLoading: boolean;
  presetErrorText: string | null;
  pendingPresetFolderDraft: PendingPresetFolderDraft | null;
  presetFolderSelectionTarget: PresetFolderSelectionTarget | null;
  pendingPresetDeleteTarget: PresetEntryTarget | null;
  isPresetDeletePending: boolean;
  pendingRackPresetLoadTarget: PendingRackPresetLoadTarget | null;
  isRackPresetLoadPending: boolean;
  currentRackFilePath: string | null;
  currentRackDisplayName: string;
  isRackDirty: boolean;
}

interface PresetControllerOptions {
  bridgeClient: CompassApi;
  editorSession: EditorSession;
  showMessage: (message: string) => void;
}

const mapPresetTreeNode = (
  node: PresetBrowserTreeNode,
): BrowserTreePresetFolderNode | BrowserTreePresetLeafNode => {
  if (node.kind === 'folder') {
    return {
      kind: 'folder',
      treeKind: 'preset',
      id: node.id,
      label: node.label,
      presetType: node.presetType,
      relativePath: [...node.relativePath],
      children: node.children.map((child) => mapPresetTreeNode(child)),
    };
  }

  return {
    kind: 'preset',
    id: node.id,
    label: node.label,
    presetType: node.presetType,
    relativePath: [...node.relativePath],
    savedAtIso: node.savedAtIso,
    deviceKind: node.deviceKind,
  };
};

const DEFAULT_RACK_FILE_DISPLAY_NAME = 'Untitled';
const RACK_FILE_EXTENSION = '.compassrack';

const resolveFileName = (filePath: string): string => {
  const separatorIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return separatorIndex === -1 ? filePath : filePath.slice(separatorIndex + 1);
};

const stripRackExtension = (fileName: string): string => {
  const lowerFileName = fileName.toLowerCase();
  return lowerFileName.endsWith(RACK_FILE_EXTENSION)
    ? fileName.slice(0, -RACK_FILE_EXTENSION.length)
    : fileName;
};

const resolveRackDisplayNameFromPath = (filePath: string): string => {
  const name = stripRackExtension(resolveFileName(filePath)).trim();
  return name || DEFAULT_RACK_FILE_DISPLAY_NAME;
};

const resolveRackDisplayNameFromFileName = (fileName: string): string => {
  const name = stripRackExtension(resolveFileName(fileName)).trim();
  return name || DEFAULT_RACK_FILE_DISPLAY_NAME;
};

const toCollapsedDeviceIdsKey = (ids: readonly string[]): string =>
  [...ids].sort().join('\u0000');

/** Owns renderer-side preset browser state and preset IPC workflows. */
class PresetController {
  public readonly state: PresetControllerState = $state({
    presetTree: [],
    isPresetLoading: false,
    presetErrorText: null,
    pendingPresetFolderDraft: null,
    presetFolderSelectionTarget: null,
    pendingPresetDeleteTarget: null,
    isPresetDeletePending: false,
    pendingRackPresetLoadTarget: null,
    isRackPresetLoadPending: false,
    currentRackFilePath: null,
    currentRackDisplayName: DEFAULT_RACK_FILE_DISPLAY_NAME,
    isRackDirty: false,
  });

  private presetListRequestToken = 0;

  private nextPendingPresetFolderId = 1;

  private nextPresetFolderSelectionToken = 1;

  private cleanRackRevision = 0;

  private cleanCollapsedDeviceIdsKey = '';

  private lastMainWindowDocumentEdited: boolean | null = null;

  private lastMainWindowDocumentFilePath: string | null | undefined;

  public constructor(private readonly options: PresetControllerOptions) {
    this.markCurrentRackClean();
  }

  public syncRackDirtyState(): void {
    const editorState = this.options.editorSession.state;
    this.state.isRackDirty =
      editorState.chainRevision !== this.cleanRackRevision
      || toCollapsedDeviceIdsKey(editorState.collapsedDeviceIds) !== this.cleanCollapsedDeviceIdsKey;
  }

  public syncMainWindowDocumentState(): void {
    this.syncRackDirtyState();
    const edited = this.state.isRackDirty;
    const filePath = this.state.currentRackFilePath;
    if (
      edited === this.lastMainWindowDocumentEdited
      && filePath === this.lastMainWindowDocumentFilePath
    ) {
      return;
    }

    this.lastMainWindowDocumentEdited = edited;
    this.lastMainWindowDocumentFilePath = filePath;
    this.options.bridgeClient.pushMainWindowDocumentState({
      edited,
      filePath,
    });
  }

  public async handleSaveRack(): Promise<void> {
    await this.saveCurrentRack({ showSuccessMessage: true });
  }

  public async handleSaveRackAs(): Promise<void> {
    await this.saveRackAs({ showSuccessMessage: true });
  }

  private markCurrentRackClean(): void {
    const editorState = this.options.editorSession.state;
    this.cleanRackRevision = editorState.chainRevision;
    this.cleanCollapsedDeviceIdsKey = toCollapsedDeviceIdsKey(editorState.collapsedDeviceIds);
    this.state.isRackDirty = false;
  }

  private setCurrentRackFile(filePath: string | null, displayName: string): void {
    this.state.currentRackFilePath = filePath;
    this.state.currentRackDisplayName = displayName.trim() || DEFAULT_RACK_FILE_DISPLAY_NAME;
  }

  private buildCurrentRackFile(): RackPresetFile {
    return buildRackPresetFile(
      this.options.editorSession.state.chainState,
      this.options.editorSession.state.collapsedDeviceIds,
    );
  }

  private buildRackSaveAsRequest(): SavePresetFileRequest {
    return {
      suggestedName: this.state.currentRackDisplayName,
      payload: this.buildCurrentRackFile(),
    };
  }

  private async saveCurrentRack(
    options: { showSuccessMessage: boolean },
  ): Promise<boolean> {
    this.syncRackDirtyState();
    const filePath = this.state.currentRackFilePath;
    if (!filePath) {
      return this.saveRackAs(options);
    }

    const response = await this.options.bridgeClient.saveRackFile({
      filePath,
      payload: this.buildCurrentRackFile(),
    });
    if (response.status === 'saved') {
      this.setCurrentRackFile(response.filePath, resolveRackDisplayNameFromPath(response.filePath));
      this.markCurrentRackClean();
      if (options.showSuccessMessage) {
        this.showMessage('Rack saved.');
      }
      await this.loadTree();
      return true;
    }

    this.showMessage(`Rack save failed | ${response.message}`);
    return false;
  }

  private async saveRackAs(
    options: { showSuccessMessage: boolean },
  ): Promise<boolean> {
    const response = await this.options.bridgeClient.savePresetFile(this.buildRackSaveAsRequest());
    if (response.status === 'saved') {
      this.setCurrentRackFile(response.filePath, resolveRackDisplayNameFromPath(response.filePath));
      this.markCurrentRackClean();
      if (options.showSuccessMessage) {
        this.showMessage('Rack saved.');
      }
      await this.loadTree();
      return true;
    }

    if (response.status === 'error') {
      this.showMessage(`Rack save failed | ${response.message}`);
    }
    return false;
  }

  public async loadTree(): Promise<void> {
    const requestToken = ++this.presetListRequestToken;
    this.state.isPresetLoading = true;
    this.state.presetErrorText = null;

    try {
      const response = await this.options.bridgeClient.listPresetBrowserTree();
      if (response.status === 'error') {
        throw new Error(response.message);
      }
      if (requestToken !== this.presetListRequestToken) {
        return;
      }

      this.state.presetTree = response.tree.map(
        (node) => mapPresetTreeNode(node) as BrowserTreePresetFolderNode,
      );
      this.state.presetErrorText = null;
    } catch (error) {
      if (requestToken !== this.presetListRequestToken) {
        return;
      }

      this.state.presetTree = [];
      this.state.presetErrorText = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Failed to load library.';
    } finally {
      if (requestToken === this.presetListRequestToken) {
        this.state.isPresetLoading = false;
      }
    }
  }

  public async handlePresetEntryOpen(entry: BrowserTreePresetLeafNode): Promise<void> {
    await this.runPresetAction(async () => {
      await this.loadPresetFromBrowserEntry(entry);
    }, 'Library item load failed.');
  }

  public async handlePresetFilePointerDown(
    entry: BrowserTreePresetLeafNode,
    sourceEvent: PointerEvent,
    itemEl: HTMLElement,
  ): Promise<void> {
    if (sourceEvent.button !== 0 || !sourceEvent.isPrimary) {
      return;
    }

    await this.runPresetAction(async () => {
      const response = await this.options.bridgeClient.readPresetEntry(
        this.toReadPresetEntryRequest(entry),
      );
      if (response.status === 'error') {
        this.showMessage(`Library item load failed | ${response.message}`);
        return;
      }

      const source = this.resolvePresetInsertSource(response, entry.label);
      if (!source) {
        return;
      }

      this.options.editorSession.commands.handleBrowserPointerDown({
        source,
        badgeLabel: `+ ${entry.label}`,
        sourceEvent,
        itemEl,
      });
    }, 'Library item load failed.');
  }

  public openRackPresetDropDialog(
    source: Extract<BrowserPresetInsertSource, { kind: 'rack-preset' }>,
  ): void {
    void this.runPresetAction(
      async () => {
        await this.requestRackOpen({
          label: source.label,
          preset: source.preset,
          filePath: source.filePath ?? null,
        });
      },
      'Rack load failed.',
    );
  }

  public openPresetDeleteDialog(target: PresetEntryTarget): void {
    this.state.pendingPresetDeleteTarget = {
      kind: 'preset-entry',
      presetType: target.presetType,
      relativePath: [...target.relativePath],
      entryKind: target.entryKind,
    };
    this.state.isPresetDeletePending = false;
  }

  public beginPresetFolderCreate(target: ContextMenuTarget): void {
    if (target.kind !== 'preset-entry' || target.entryKind !== 'directory') {
      return;
    }

    this.state.pendingPresetFolderDraft = {
      mode: 'create',
      presetType: target.presetType,
      relativePath: [...target.relativePath],
      draftName: '',
      temporaryId: `pending-preset-folder:${this.nextPendingPresetFolderId}`,
    };
    this.nextPendingPresetFolderId += 1;
    this.state.presetFolderSelectionTarget = null;
  }

  public beginPresetFolderRename(target: ContextMenuTarget): void {
    if (
      target.kind !== 'preset-entry'
      || target.entryKind !== 'directory'
      || target.relativePath.length === 0
    ) {
      return;
    }

    this.state.pendingPresetFolderDraft = {
      mode: 'rename',
      presetType: target.presetType,
      relativePath: [...target.relativePath],
      draftName: target.relativePath[target.relativePath.length - 1] ?? '',
    };
    this.state.presetFolderSelectionTarget = null;
  }

  public updatePendingPresetFolderDraftName(nextName: string): void {
    const draft = this.state.pendingPresetFolderDraft;
    if (!draft) {
      return;
    }

    this.state.pendingPresetFolderDraft = {
      ...draft,
      draftName: nextName,
    };
  }

  public cancelPendingPresetFolderDraft(): void {
    this.state.pendingPresetFolderDraft = null;
  }

  public async commitPendingPresetFolderDraft(): Promise<void> {
    const draft = this.state.pendingPresetFolderDraft;
    if (!draft) {
      return;
    }

    const folderName = draft.draftName.trim();
    if (!folderName) {
      this.cancelPendingPresetFolderDraft();
      return;
    }

    if (
      draft.mode === 'rename'
      && folderName === (draft.relativePath[draft.relativePath.length - 1] ?? '')
    ) {
      this.cancelPendingPresetFolderDraft();
      return;
    }

    this.state.pendingPresetFolderDraft = null;
    const response = draft.mode === 'create'
      ? await this.options.bridgeClient.createPresetFolder({
          presetType: draft.presetType,
          relativePath: [...draft.relativePath],
          folderName,
        } satisfies CreatePresetFolderRequest)
      : await this.options.bridgeClient.renamePresetFolder({
          presetType: draft.presetType,
          relativePath: [...draft.relativePath],
          folderName,
        } satisfies RenamePresetFolderRequest);
    if (response.status === 'error') {
      this.showMessage(`Folder ${draft.mode} failed | ${response.message}`);
      return;
    }

    await this.loadTree();
    this.state.presetFolderSelectionTarget = {
      token: this.nextPresetFolderSelectionToken,
      presetType: draft.presetType,
      relativePath: [...response.relativePath],
    };
    this.nextPresetFolderSelectionToken += 1;
  }

  public clearPresetFolderSelectionTarget(token: number): void {
    if (this.state.presetFolderSelectionTarget?.token !== token) {
      return;
    }

    this.state.presetFolderSelectionTarget = null;
  }

  public closePresetDeleteDialog(): void {
    if (this.state.isPresetDeletePending) {
      return;
    }

    this.state.pendingPresetDeleteTarget = null;
  }

  public async confirmPresetBrowserDelete(): Promise<void> {
    const target = this.state.pendingPresetDeleteTarget;
    if (!target || this.state.isPresetDeletePending) {
      return;
    }

    this.state.isPresetDeletePending = true;
    try {
      const response = await this.options.bridgeClient.deletePresetEntry({
        presetType: target.presetType,
        relativePath: [...target.relativePath],
        entryKind: target.entryKind,
      });
      if (response.status === 'error') {
        this.state.pendingPresetDeleteTarget = null;
        this.showMessage(`Delete failed | ${response.message}`);
        return;
      }

      await this.loadTree();
      this.state.pendingPresetDeleteTarget = null;
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Delete failed.';
      this.showMessage(`Delete failed | ${message}`);
    } finally {
      this.state.isPresetDeletePending = false;
    }
  }

  public getPresetDeleteTitle(target: PresetEntryTarget): string {
    return target.entryKind === 'directory'
      ? 'Move folder to Trash?'
      : 'Move item to Trash?';
  }

  public getPresetDeleteDescription(target: PresetEntryTarget): string {
    const label = target.relativePath[target.relativePath.length - 1]
      ?? PRESET_ROOT_LABELS[target.presetType];
    return target.entryKind === 'directory'
      ? `The folder "${label}" and everything inside it will be moved to the trash.`
      : `The item "${label}" will be moved to the trash.`;
  }

  public async handleShowPresetEntryInFolder(target: ShowInFolderTarget): Promise<void> {
    if (target.kind === 'presets-root') {
      const response = await this.options.bridgeClient.showPresetsRootInFolder();
      if (response.status === 'error') {
        this.showMessage(`Show in Folder failed | ${response.message}`);
      }
      return;
    }

    const response = await this.options.bridgeClient.showPresetEntryInFolder({
      presetType: target.presetType,
      relativePath: [...target.relativePath],
      entryKind: target.entryKind,
    });
    if (response.status === 'error') {
      this.showMessage(`Show in Folder failed | ${response.message}`);
    }
  }

  public async handleSaveDevicePreset(deviceId: string): Promise<void> {
    const chain = this.options.editorSession.state.chainState;
    const payload = buildDevicePresetFile(chain, deviceId);
    await this.savePreset(
      payload
        ? {
            suggestedName: resolveDevicePresetSuggestedName(chain, deviceId),
            payload,
          }
        : null,
      {
        emptyMessage: 'Unable to build device.',
        successMessage: 'Device saved.',
        errorSummary: 'Device save failed',
      },
    );
  }

  public async handleSaveGroupPreset(groupId: string): Promise<void> {
    const chain = this.options.editorSession.state.chainState;
    const memberDeviceIds = resolveGroupMemberIds(chain.devices, groupId);
    const payload = buildGroupPresetFile(
      chain,
      groupId,
      memberDeviceIds,
      this.options.editorSession.state.collapsedDeviceIds,
    );
    await this.savePreset(
      payload
        ? {
            suggestedName: resolveGroupPresetSuggestedName(chain, groupId),
            payload,
          }
        : null,
      {
        emptyMessage: 'Unable to build group.',
        successMessage: 'Group saved.',
        errorSummary: 'Group save failed',
      },
    );
  }

  public async handleMainWindowCloseRequest(): Promise<void> {
    if (this.state.pendingRackPresetLoadTarget || this.state.isRackPresetLoadPending) {
      return;
    }

    this.syncRackDirtyState();
    if (!this.state.isRackDirty) {
      await this.options.bridgeClient.confirmMainWindowClose();
      return;
    }

    this.state.pendingRackPresetLoadTarget = {
      label: 'Compass',
      description: 'Save changes to the current rack before closing Compass?',
      load: async () => {
        await this.options.bridgeClient.confirmMainWindowClose();
      },
    };
    this.state.isRackPresetLoadPending = false;
  }

  public closeRackPresetLoadDialog(): void {
    if (this.state.isRackPresetLoadPending) {
      return;
    }

    this.state.pendingRackPresetLoadTarget = null;
  }

  public async confirmRackSaveBeforeLoad(): Promise<void> {
    const target = this.state.pendingRackPresetLoadTarget;
    if (!target || this.state.isRackPresetLoadPending) {
      return;
    }

    this.state.isRackPresetLoadPending = true;
    try {
      const saved = await this.saveCurrentRack({ showSuccessMessage: false });
      if (!saved) {
        return;
      }

      await this.runPresetAction(async () => {
        await target.load();
        this.state.pendingRackPresetLoadTarget = null;
      }, 'Rack load failed.');
    } finally {
      this.state.isRackPresetLoadPending = false;
    }
  }

  public async confirmRackDiscardBeforeLoad(): Promise<void> {
    const target = this.state.pendingRackPresetLoadTarget;
    if (!target || this.state.isRackPresetLoadPending) {
      return;
    }

    this.state.isRackPresetLoadPending = true;
    try {
      await this.runPresetAction(async () => {
        await target.load();
        this.state.pendingRackPresetLoadTarget = null;
      }, 'Rack load failed.');
    } finally {
      this.state.isRackPresetLoadPending = false;
    }
  }

  public getRackPresetLoadDescription(target: PendingRackPresetLoadTarget): string {
    return target.description ?? `Save changes to the current rack before opening "${target.label}"?`;
  }

  public async handlePresetFileDrop(payload: RackPresetFileDrop): Promise<void> {
    if (payload.fileCount !== 1) {
      this.showMessage('Drop a single library file at a time.');
      return;
    }

    let fileText: string;
    try {
      fileText = await payload.file.text();
    } catch {
      this.showMessage('File load failed | Unable to read the dropped file.');
      return;
    }

    const parsed = parsePresetFileText(fileText, {
      fileName: payload.file.name,
    });
    if (parsed.ok === false) {
      this.showMessage(`File load failed | ${parsed.message}`);
      return;
    }

    if (parsed.preset.presetType === 'rack') {
      await this.requestRackOpen({
        label: resolveRackDisplayNameFromFileName(payload.file.name),
        preset: parsed.preset,
        filePath: null,
      });
      return;
    }

    if (!payload.dropZone) {
      this.showMessage('Drop the item onto the rack to load it.');
      return;
    }

    const result = parsed.preset.presetType === 'device'
      ? this.options.editorSession.commands.insertDevicePreset(
          payload.dropZone,
          parsed.preset,
        )
      : this.options.editorSession.commands.insertGroupPreset(
          payload.dropZone,
          parsed.preset,
        );
    this.showMessage(result.message);
  }

  private showMessage(message: string): void {
    this.options.showMessage(message);
  }

  private async runPresetAction(
    action: () => Promise<void>,
    fallbackMessage: string,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : fallbackMessage;
      this.showMessage(message);
    }
  }

  private resolvePresetInsertSource(
    response: ReadPresetEntryResponse,
    entryLabel?: string,
  ): BrowserInsertSource | null {
    if (response.status !== 'loaded') {
      return null;
    }

    if (response.payload.presetType === 'device') {
      return {
        kind: 'device-preset',
        preset: response.payload,
      };
    }

    if (response.payload.presetType === 'group') {
      return {
        kind: 'group-preset',
        preset: response.payload,
      };
    }

    return entryLabel
      ? {
          kind: 'rack-preset',
          preset: response.payload,
          label: entryLabel,
          filePath: response.filePath,
        }
      : null;
  }

  private toReadPresetEntryRequest(
    entry: BrowserTreePresetLeafNode,
  ): Parameters<CompassApi['readPresetEntry']>[0] {
    return {
      presetType: entry.presetType,
      relativePath: [...entry.relativePath],
    };
  }

  private async loadPresetFromBrowserEntry(
    entry: BrowserTreePresetLeafNode,
  ): Promise<void> {
    const response = await this.options.bridgeClient.readPresetEntry(
      this.toReadPresetEntryRequest(entry),
    );
    if (response.status === 'error') {
      this.showMessage(`Library item load failed | ${response.message}`);
      return;
    }

    if (response.payload.presetType === 'device') {
      const result = this.options.editorSession.commands.insertDevicePreset(
        DEFAULT_PRESET_DROP_ZONE,
        response.payload,
      );
      this.showMessage(result.message);
      return;
    }

    if (response.payload.presetType === 'group') {
      const result = this.options.editorSession.commands.insertGroupPreset(
        DEFAULT_PRESET_DROP_ZONE,
        response.payload,
      );
      this.showMessage(result.message);
      return;
    }

    await this.requestRackOpen({
      label: entry.label,
      preset: response.payload,
      filePath: response.filePath,
    });
  }

  private async requestRackOpen(target: RackOpenTarget): Promise<void> {
    this.syncRackDirtyState();
    const load = async (): Promise<void> => {
      await this.loadRackOpenTarget(target);
    };

    if (this.state.isRackDirty) {
      this.state.pendingRackPresetLoadTarget = {
        label: target.label,
        load,
      };
      this.state.isRackPresetLoadPending = false;
      return;
    }

    await load();
  }

  private async loadRackOpenTarget(target: RackOpenTarget): Promise<void> {
    const result = this.options.editorSession.commands.applyRackPreset(target.preset);
    if (!result.ok) {
      this.showMessage(result.message);
      return;
    }

    this.setCurrentRackFile(target.filePath, target.label);
    this.markCurrentRackClean();
    this.showMessage('Rack loaded.');
  }

  private async savePreset(
    request: SavePresetFileRequest | null,
    options: {
      emptyMessage?: string;
      successMessage: string;
      errorSummary: string;
    },
  ): Promise<void> {
    await this.runPresetAction(async () => {
      if (!request) {
        if (options.emptyMessage) {
          this.showMessage(options.emptyMessage);
        }
        return;
      }

      const response = await this.options.bridgeClient.savePresetFile(request);
      if (response.status === 'saved') {
        this.showMessage(options.successMessage);
        return;
      }

      if (response.status === 'error') {
        this.showMessage(`${options.errorSummary} | ${response.message}`);
      }
    }, `${options.errorSummary}.`);
  }
}

export const createPresetController = (
  options: PresetControllerOptions,
): PresetController => new PresetController(options);
