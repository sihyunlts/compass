import type { CompassApi } from '../../shared/contracts/ipc/api';
import type { MessageKey } from '../../shared/i18n';
import {
  cloneDeviceNode,
  normalizeAuthoredMetadata,
  normalizeCustomName,
  replaceAuthoredMetadata,
  type AuthoredMetadata,
} from '../../shared/model';
import {
  normalizePresetEntrySelection,
  type PresetEntryPath,
  type PresetEntrySelectionItem,
} from '../../shared/preset-entry-selection';
import {
  getDeviceMessageKey,
} from '../device-i18n';
import { i18n } from '../i18n.svelte';
import type {
  CreatePresetFolderRequest,
  DeletedPresetEntry,
  MovedPresetEntry,
  PresetBrowserTreeNode,
  ReadPresetEntryResponse,
  RenamePresetFileRequest,
  RenamePresetFolderRequest,
  SavePresetFileRequest,
} from '../../shared/contracts/ipc/presets';
import {
  parsePresetFileText,
  resolvePresetNameFromFileName,
  type PresetBrowserPreview,
  type RackPresetFile,
} from '../../shared/presets';
import type {
  BrowserTreePresetFolderNode,
  BrowserTreePresetLeafNode,
  PendingPresetFolderDraft,
  PresetEntrySelectionTarget,
} from '../features/browser/types';
import type {
  ContextMenuTarget,
  PresetDeleteContextTarget,
  PresetEntryContextTarget,
} from '../features/context-menu/types';
import type {
  BrowserInsertSource,
  BrowserPresetInsertSource,
  RackPresetFileDrop,
} from '../features/rack/types';
import {
  buildDevicePresetFile,
  buildGroupPresetFile,
  buildRackPresetFile,
  resolveDevicePresetSuggestedName,
  resolveGroupPresetSuggestedName,
  type PresetApplyStatus,
} from '../features/editor/presets';
import { createDefaultChainSettings } from '../features/editor/persistence-storage';
import type { EditorSession } from '../features/editor/session.svelte';
import { resolveGroupMemberIds } from '../features/editor/chain-ops';
import type { RackDropZone } from '../features/rack/drop-ops';

const DEFAULT_PRESET_DROP_ZONE: RackDropZone = {
  kind: 'outside',
  targetId: null,
  placement: 'after',
};

const PRESET_APPLY_MESSAGE_KEY_BY_STATUS = {
  'device-insert-failed': 'status.deviceInsertFailed',
  'device-inserted': 'status.deviceInserted',
  'group-insert-failed': 'status.groupInsertFailed',
  'group-inserted': 'status.groupInserted',
  'rack-load-failed': 'status.rackLoadFailed',
  'rack-loaded': 'status.rackLoaded',
} as const satisfies Readonly<Record<PresetApplyStatus, MessageKey>>;

const resolvePresetApplyMessage = (status: PresetApplyStatus): string =>
  i18n.t(PRESET_APPLY_MESSAGE_KEY_BY_STATUS[status]);

const formatErrorMessage = (
  summaryKey: MessageKey,
  detail?: string | null,
): string => {
  const summary = i18n.t(summaryKey);
  const normalizedDetail = detail?.trim();
  if (!normalizedDetail || normalizedDetail === summary) {
    return summary;
  }

  return i18n.t('status.errorDetail', {
    summary: summary.trim().replace(/[.!?。]+$/u, ''),
    error: normalizedDetail,
  });
};

const resolvePresetDraftErrorMessageKey = (
  draft: PendingPresetFolderDraft,
): MessageKey => {
  if (draft.entryKind === 'file') {
    return draft.mode === 'create'
      ? 'status.presetFileCreateFailed'
      : 'status.presetFileRenameFailed';
  }

  return draft.mode === 'create'
    ? 'status.presetFolderCreateFailed'
    : 'status.presetFolderRenameFailed';
};

type PresetEntryTarget = PresetEntryContextTarget;
type PresetDeleteTarget = PresetDeleteContextTarget;
type PendingRackPresetLoadTarget = {
  label: string;
  description?: string;
  load: () => Promise<void>;
};

type RackOpenTarget = {
  label: string;
  preset: RackPresetFile;
  filePath: string | null;
  needsSave: boolean;
};

interface PresetControllerState {
  presetTree: BrowserTreePresetFolderNode[];
  presetOccupiedPaths: PresetEntryPath[];
  presetErrorText: string | null;
  pendingPresetFolderDraft: PendingPresetFolderDraft | null;
  presetEntrySelectionTarget: PresetEntrySelectionTarget | null;
  pendingPresetDeleteTarget: PresetDeleteTarget | null;
  isPresetDeletePending: boolean;
  pendingRackPresetLoadTarget: PendingRackPresetLoadTarget | null;
  isRackPresetLoadPending: boolean;
  currentRackFilePath: string | null;
  currentRackDisplayName: string;
  currentRackSavedAtIso: string | null;
  isRackDirty: boolean;
  canRevertRack: boolean;
}

interface PresetControllerOptions {
  bridgeClient: CompassApi;
  editorSession: EditorSession;
  showMessage: (message: string) => void;
}

const clonePresetBrowserPreview = (
  preview: PresetBrowserPreview,
): PresetBrowserPreview => {
  if (preview.kind === 'color') {
    return {
      ...preview,
      velocities: [...preview.velocities],
    };
  }
  if (preview.kind === 'generator') {
    return {
      ...preview,
      device: cloneDeviceNode(preview.device),
    };
  }
  if (preview.kind === 'rack') {
    return { ...preview };
  }
  return {
      ...preview,
      curve: {
        divisions: preview.curve.divisions,
        nodes: preview.curve.nodes.map((node) => ({ ...node })),
      },
    };
};

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
    ...(node.preview
      ? {
          preview: clonePresetBrowserPreview(node.preview),
        }
      : {}),
  };
};

const RACK_FILE_EXTENSION = '.compassrack';
const resolveDefaultRackFileDisplayName = (): string => i18n.t('rack.untitled');

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

const resolveRackDisplayName = (filePathOrName: string): string => {
  const name = normalizeCustomName(
    stripRackExtension(resolveFileName(filePathOrName)),
  );
  return name ?? resolveDefaultRackFileDisplayName();
};

const toCollapsedDeviceIdsKey = (ids: readonly string[]): string =>
  [...ids].sort().join('\u0000');

const replaceMovedPathPrefix = (
  currentPath: string,
  sourcePath: string,
  targetPath: string,
): string | null => {
  const currentKey = currentPath.toLocaleLowerCase('en-US');
  const sourceKey = sourcePath.toLocaleLowerCase('en-US');
  const separator = sourcePath.includes('\\') ? '\\' : '/';
  return currentKey === sourceKey
    || currentKey.startsWith(`${sourceKey}${separator}`)
    ? `${targetPath}${currentPath.slice(sourcePath.length)}`
    : null;
};

/** Owns renderer-side preset browser state and preset IPC workflows. */
export class PresetController {
  private defaultRackFileDisplayName = resolveDefaultRackFileDisplayName();

  public readonly state: PresetControllerState = $state({
    presetTree: [],
    presetOccupiedPaths: [],
    presetErrorText: null,
    pendingPresetFolderDraft: null,
    presetEntrySelectionTarget: null,
    pendingPresetDeleteTarget: null,
    isPresetDeletePending: false,
    pendingRackPresetLoadTarget: null,
    isRackPresetLoadPending: false,
    currentRackFilePath: null,
    currentRackDisplayName: this.defaultRackFileDisplayName,
    currentRackSavedAtIso: null,
    isRackDirty: false,
    canRevertRack: false,
  });

  private presetListRequestToken = 0;

  private nextPendingPresetFolderId = 1;

  private nextPresetEntrySelectionToken = 1;

  private cleanRackRevision = 0;

  private cleanCollapsedDeviceIdsKey = '';

  private cleanRackDisplayName = this.defaultRackFileDisplayName;

  private cleanRackPreset: RackPresetFile | null = null;

  private lastMainWindowDocumentEdited: boolean | null = null;

  private lastMainWindowDocumentFilePath: string | null | undefined;

  public constructor(private readonly options: PresetControllerOptions) {
    this.markCurrentRackClean();
  }

  public syncLocaleDependentDefaults(): void {
    const previousDefaultName = this.defaultRackFileDisplayName;
    const nextDefaultName = resolveDefaultRackFileDisplayName();
    this.defaultRackFileDisplayName = nextDefaultName;
    if (
      this.state.currentRackFilePath !== null
      || this.state.currentRackDisplayName !== previousDefaultName
    ) {
      return;
    }

    this.state.currentRackDisplayName = nextDefaultName;
    if (this.cleanRackDisplayName === previousDefaultName) {
      this.cleanRackDisplayName = nextDefaultName;
    }
    if (this.state.pendingRackPresetLoadTarget?.label === previousDefaultName) {
      this.state.pendingRackPresetLoadTarget.label = nextDefaultName;
    }
    this.syncRackDirtyState();
  }

  public syncRackDirtyState(): void {
    const editorState = this.options.editorSession.state;
    this.state.isRackDirty =
      editorState.chainRevision !== this.cleanRackRevision
      || toCollapsedDeviceIdsKey(editorState.collapsedDeviceIds) !== this.cleanCollapsedDeviceIdsKey
      || this.state.currentRackDisplayName !== this.cleanRackDisplayName;
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

  public async handleNewRack(): Promise<void> {
    await this.runPresetAction(async () => {
      await this.requestNewRack();
    }, 'status.newRackFailed');
  }

  public handleRevertRack(): void {
    this.syncRackDirtyState();
    if (!this.state.isRackDirty || !this.cleanRackPreset) {
      return;
    }

    const result = this.options.editorSession.commands.applyRackPreset(this.cleanRackPreset);
    if (!result.ok) {
      this.showMessage(resolvePresetApplyMessage(result.status));
      return;
    }

    this.state.currentRackDisplayName = this.cleanRackDisplayName;
    this.markCurrentRackClean({ captureRevertTarget: true });
    this.showMessage(i18n.t('status.rackReverted'));
  }

  public async updateCurrentRackInfo(
    rawName: string,
    metadata: AuthoredMetadata | undefined,
  ): Promise<boolean> {
    const nextName = resolveRackDisplayName(rawName);
    const normalizedMetadata = normalizeAuthoredMetadata(metadata);

    const filePath = this.state.currentRackFilePath;
    if (!filePath) {
      this.state.currentRackDisplayName = nextName;
      this.options.editorSession.commands.updateRackInfo({
        author: normalizedMetadata?.author ?? '',
        description: normalizedMetadata?.description ?? '',
      });
      this.syncRackDirtyState();
      return true;
    }

    const response = await this.options.bridgeClient.updateRackFileInfo({
      filePath,
      fileName: nextName,
      ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
    });
    if (response.status === 'error') {
      this.showError('status.presetInfoSaveFailed', response.message);
      return false;
    }

    this.options.editorSession.synchronizePersistedRackMetadata(
      normalizedMetadata,
    );
    this.setCurrentRackFile(
      response.filePath,
      resolveRackDisplayName(response.filePath),
      response.savedAtIso,
    );
    this.cleanRackDisplayName = this.state.currentRackDisplayName;
    if (this.cleanRackPreset) {
      this.cleanRackPreset = {
        ...this.cleanRackPreset,
        savedAtIso: response.savedAtIso,
        chain: replaceAuthoredMetadata(
          this.cleanRackPreset.chain,
          normalizedMetadata,
        ),
      };
    }
    this.syncRackDirtyState();
    await this.loadTree();
    return true;
  }

  public async updatePresetInfo(
    entry: PresetEntryContextTarget,
    rawName: string,
    metadata: AuthoredMetadata | undefined,
  ): Promise<boolean> {
    const normalizedMetadata = normalizeAuthoredMetadata(metadata);
    const response = await this.options.bridgeClient.updatePresetFileInfo({
      presetType: entry.presetType,
      relativePath: [...entry.relativePath],
      fileName: rawName,
      ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
    });
    if (response.status === 'error') {
      this.showError('status.presetInfoSaveFailed', response.message);
      return false;
    }

    await this.loadTree();
    if (entry.presetType === 'rack') {
      this.syncCurrentRackAfterPresetEntriesMove([{
        presetType: 'rack',
        entryKind: 'file',
        relativePath: response.relativePath,
        sourcePath: response.sourcePath,
        filePath: response.filePath,
      }]);
    }
    this.setPresetEntrySelectionTarget([{
      presetType: entry.presetType,
      relativePath: response.relativePath,
      entryKind: 'file',
    }]);
    return true;
  }

  private markCurrentRackClean(
    options: { captureRevertTarget?: boolean } = {},
  ): void {
    const editorState = this.options.editorSession.state;
    this.cleanRackRevision = editorState.chainRevision;
    this.cleanCollapsedDeviceIdsKey = toCollapsedDeviceIdsKey(editorState.collapsedDeviceIds);
    if (options.captureRevertTarget) {
      this.captureCurrentRackRevertTarget();
    } else {
      this.cleanRackDisplayName = this.state.currentRackDisplayName;
    }
    this.state.isRackDirty = false;
  }

  private captureCurrentRackRevertTarget(): void {
    this.cleanRackDisplayName = this.state.currentRackDisplayName;
    this.cleanRackPreset = this.buildCurrentRackFile();
    this.state.canRevertRack = true;
  }

  private clearRevertTarget(): void {
    this.cleanRackPreset = null;
    this.state.canRevertRack = false;
  }

  private setCurrentRackFile(
    filePath: string | null,
    displayName: string,
    savedAtIso: string | null = this.state.currentRackSavedAtIso,
  ): void {
    this.state.currentRackFilePath = filePath;
    this.state.currentRackDisplayName = normalizeCustomName(displayName)
      ?? resolveDefaultRackFileDisplayName();
    this.state.currentRackSavedAtIso = filePath ? savedAtIso : null;
  }

  private syncCurrentRackAfterPresetEntriesMove(
    entries: readonly MovedPresetEntry[],
  ): void {
    const currentFilePath = this.state.currentRackFilePath;
    if (!currentFilePath) {
      return;
    }

    for (const entry of entries) {
      if (entry.presetType !== 'rack') {
        continue;
      }
      const nextFilePath = replaceMovedPathPrefix(
        currentFilePath,
        entry.sourcePath,
        entry.filePath,
      );
      if (!nextFilePath || nextFilePath === currentFilePath) {
        continue;
      }

      this.setCurrentRackFile(
        nextFilePath,
        entry.entryKind === 'file'
          ? resolveRackDisplayName(nextFilePath)
          : this.state.currentRackDisplayName,
      );
      if (entry.entryKind === 'file') {
        this.cleanRackDisplayName = this.state.currentRackDisplayName;
        this.syncRackDirtyState();
      }
      return;
    }
  }

  private syncCurrentRackAfterPresetEntriesDelete(
    entries: readonly DeletedPresetEntry[],
  ): void {
    const currentFilePath = this.state.currentRackFilePath;
    const containsCurrentRack = currentFilePath
      && entries.some(
        (entry) =>
          entry.presetType === 'rack'
          && replaceMovedPathPrefix(
            currentFilePath,
            entry.filePath,
            entry.filePath,
          ) !== null,
      );
    if (containsCurrentRack) {
      this.setCurrentRackFile(null, this.state.currentRackDisplayName);
    }
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

    const payload = this.buildCurrentRackFile();
    const response = await this.options.bridgeClient.saveRackFile({
      filePath,
      payload,
    });
    if (response.status === 'saved') {
      this.setCurrentRackFile(
        response.filePath,
        resolveRackDisplayName(response.filePath),
        payload.savedAtIso,
      );
      this.markCurrentRackClean({ captureRevertTarget: true });
      if (options.showSuccessMessage) {
        this.showMessage(i18n.t('status.rackSaved'));
      }
      await this.loadTree();
      return true;
    }

    this.showError('status.rackSaveFailed', response.message);
    return false;
  }

  private async saveRackAs(
    options: { showSuccessMessage: boolean },
  ): Promise<boolean> {
    const request = this.buildRackSaveAsRequest();
    const response = await this.options.bridgeClient.savePresetFile(request);
    if (response.status === 'saved') {
      this.setCurrentRackFile(
        response.filePath,
        resolveRackDisplayName(response.filePath),
        request.payload.savedAtIso,
      );
      this.markCurrentRackClean({ captureRevertTarget: true });
      if (options.showSuccessMessage) {
        this.showMessage(i18n.t('status.rackSaved'));
      }
      await this.loadTree();
      return true;
    }

    if (response.status === 'error') {
      this.showError('status.rackSaveFailed', response.message);
    }
    return false;
  }

  public async loadTree(): Promise<void> {
    const requestToken = ++this.presetListRequestToken;
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
      this.state.presetOccupiedPaths = response.occupiedPaths.map((path) => ({
        ...path,
        relativePath: [...path.relativePath],
      }));
      this.state.presetErrorText = null;
    } catch (error) {
      if (requestToken !== this.presetListRequestToken) {
        return;
      }

      this.state.presetTree = [];
      this.state.presetOccupiedPaths = [];
      this.state.presetErrorText = formatErrorMessage(
        'status.presetsLoadFailed',
        error instanceof Error ? error.message : null,
      );
    }
  }

  public async handlePresetEntryOpen(entry: BrowserTreePresetLeafNode): Promise<void> {
    await this.runPresetAction(async () => {
      await this.loadPresetFromBrowserEntry(entry);
    }, 'status.presetLoadFailed');
  }

  public async loadRackPresetForPreview(
    entry: BrowserTreePresetLeafNode,
  ): Promise<RackPresetFile | null> {
    if (entry.presetType !== 'rack') {
      return null;
    }

    const response = await this.options.bridgeClient.readPresetEntry({
      presetType: 'rack',
      relativePath: [...entry.relativePath],
    });
    return response.status === 'loaded' ? response.payload : null;
  }

  public async handlePresetFilePointerDown(
    entry: BrowserTreePresetLeafNode,
    sourceEvent: PointerEvent,
    itemEl: HTMLElement,
    dragSignal: AbortSignal,
  ): Promise<void> {
    if (sourceEvent.button !== 0 || !sourceEvent.isPrimary) {
      return;
    }

    await this.runPresetAction(async () => {
      const response = await this.options.bridgeClient.readPresetEntry(
        this.toReadPresetEntryRequest(entry),
      );
      if (dragSignal.aborted) {
        return;
      }
      if (response.status === 'error') {
        this.showError('status.presetLoadFailed', response.message);
        return;
      }

      const source = this.resolvePresetInsertSource(response, entry.label);
      if (!source) {
        return;
      }

      this.options.editorSession.commands.handleBrowserPointerDown({
        source,
        badgeLabel: entry.label,
        sourceEvent,
        itemEl,
      });
    }, 'status.presetLoadFailed');
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
          needsSave: source.needsSave === true,
        });
      },
      'status.rackLoadFailed',
    );
  }

  public openPresetDeleteDialog(target: PresetDeleteTarget): void {
    if (target.kind === 'preset-entry') {
      this.state.pendingPresetDeleteTarget = {
        kind: 'preset-entry',
        presetType: target.presetType,
        relativePath: [...target.relativePath],
        entryKind: target.entryKind,
      };
    } else {
      const normalizedEntries = normalizePresetEntrySelection(target.entries);
      this.state.pendingPresetDeleteTarget = normalizedEntries.length === 1
        ? {
            kind: 'preset-entry',
            presetType: normalizedEntries[0].presetType,
            relativePath: [...normalizedEntries[0].relativePath],
            entryKind: normalizedEntries[0].entryKind,
          }
        : {
          kind: 'preset-entries',
          entries: normalizedEntries.map((entry) => ({
            kind: 'preset-entry',
            presetType: entry.presetType,
            relativePath: [...entry.relativePath],
            entryKind: entry.entryKind,
          })),
        };
    }
    this.state.isPresetDeletePending = false;
  }

  public beginPresetFolderCreate(target: ContextMenuTarget): void {
    if (target.kind !== 'preset-entry' || target.entryKind !== 'directory') {
      return;
    }

    this.state.pendingPresetFolderDraft = {
      mode: 'create',
      entryKind: 'directory',
      presetType: target.presetType,
      relativePath: [...target.relativePath],
      draftName: '',
      temporaryId: `pending-preset-folder:${this.nextPendingPresetFolderId}`,
    };
    this.nextPendingPresetFolderId += 1;
    this.state.presetEntrySelectionTarget = null;
  }

  public beginPresetEntryRename(target: ContextMenuTarget): void {
    if (
      target.kind !== 'preset-entry'
      || target.relativePath.length === 0
    ) {
      return;
    }

    this.state.pendingPresetFolderDraft = {
      mode: 'rename',
      entryKind: target.entryKind,
      presetType: target.presetType,
      relativePath: [...target.relativePath],
      draftName: target.entryKind === 'file'
        ? this.resolvePresetFileDraftName(target)
        : target.relativePath[target.relativePath.length - 1] ?? '',
    };
    this.state.presetEntrySelectionTarget = null;
  }

  private resolvePresetFileDraftName(target: PresetEntryTarget): string {
    const fileName = target.relativePath[target.relativePath.length - 1] ?? '';
    return resolvePresetNameFromFileName(fileName, target.presetType) ?? fileName;
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

    const entryName = draft.draftName.trim();
    if (!entryName) {
      this.cancelPendingPresetFolderDraft();
      return;
    }

    const currentName = draft.entryKind === 'file'
      ? this.resolvePresetFileDraftName({
          kind: 'preset-entry',
          presetType: draft.presetType,
          relativePath: draft.relativePath,
          entryKind: 'file',
        })
      : draft.relativePath[draft.relativePath.length - 1] ?? '';
    if (
      draft.mode === 'rename'
      && entryName === currentName
    ) {
      this.cancelPendingPresetFolderDraft();
      return;
    }

    this.state.pendingPresetFolderDraft = null;
    const response = draft.mode === 'create'
      ? await this.options.bridgeClient.createPresetFolder({
          presetType: draft.presetType,
          relativePath: [...draft.relativePath],
          folderName: entryName,
        } satisfies CreatePresetFolderRequest)
      : draft.entryKind === 'file'
        ? await this.options.bridgeClient.renamePresetFile({
            presetType: draft.presetType,
            relativePath: [...draft.relativePath],
            fileName: entryName,
          } satisfies RenamePresetFileRequest)
      : await this.options.bridgeClient.renamePresetFolder({
          presetType: draft.presetType,
          relativePath: [...draft.relativePath],
          folderName: entryName,
        } satisfies RenamePresetFolderRequest);
    if (response.status === 'error') {
      this.showError(
        resolvePresetDraftErrorMessageKey(draft),
        response.message,
      );
      return;
    }

    await this.loadTree();
    if (draft.presetType === 'rack' && 'sourcePath' in response) {
      this.syncCurrentRackAfterPresetEntriesMove([{
        presetType: 'rack',
        entryKind: draft.entryKind,
        relativePath: response.relativePath,
        sourcePath: response.sourcePath,
        filePath: response.filePath,
      }]);
    }
    this.setPresetEntrySelectionTarget([{
      presetType: draft.presetType,
      relativePath: response.relativePath,
      entryKind: draft.entryKind,
    }]);
  }

  public clearPresetEntrySelectionTarget(token: number): void {
    if (this.state.presetEntrySelectionTarget?.token !== token) {
      return;
    }

    this.state.presetEntrySelectionTarget = null;
  }

  private setPresetEntrySelectionTarget(
    entries: readonly PresetEntrySelectionItem[],
  ): void {
    this.state.presetEntrySelectionTarget = {
      token: this.nextPresetEntrySelectionToken,
      entries: entries.map((entry) => ({
        ...entry,
        relativePath: [...entry.relativePath],
      })),
    };
    this.nextPresetEntrySelectionToken += 1;
  }

  public async movePresetEntries(
    entries: readonly PresetEntryContextTarget[],
    destination: {
      presetType: PresetEntryContextTarget['presetType'];
      relativePath: readonly string[];
    },
  ): Promise<void> {
    await this.runPresetAction(async () => {
      const response = await this.options.bridgeClient.movePresetEntries({
        entries: entries.map((entry) => ({
          presetType: entry.presetType,
          relativePath: [...entry.relativePath],
          entryKind: entry.entryKind,
        })),
        destination: {
          presetType: destination.presetType,
          relativePath: [...destination.relativePath],
        },
      });
      if (response.status === 'error') {
        await this.loadTree();
        this.showError('status.presetMoveFailed', response.message);
        return;
      }

      this.syncCurrentRackAfterPresetEntriesMove(response.entries);
      await this.loadTree();
      this.setPresetEntrySelectionTarget(response.entries);
    }, 'status.presetMoveFailed');
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
      const entries = target.kind === 'preset-entry'
        ? [target]
        : target.entries;
      const response = await this.options.bridgeClient.deletePresetEntries({
        entries: entries.map((entry) => ({
          presetType: entry.presetType,
          relativePath: [...entry.relativePath],
          entryKind: entry.entryKind,
        })),
      });
      if (response.status === 'error') {
        await this.loadTree();
        this.state.pendingPresetDeleteTarget = null;
        this.showError('status.moveToTrashFailed', response.message);
        return;
      }

      this.syncCurrentRackAfterPresetEntriesDelete(response.entries);
      await this.loadTree();
      this.state.pendingPresetDeleteTarget = null;
    } catch (error) {
      this.showError(
        'status.moveToTrashFailed',
        error instanceof Error ? error.message : null,
      );
    } finally {
      this.state.isPresetDeletePending = false;
    }
  }

  public getPresetDeleteTitle(target: PresetDeleteTarget): string {
    if (target.kind === 'preset-entries') {
      return i18n.t('preset.moveItemsPrompt');
    }

    return target.entryKind === 'directory'
      ? i18n.t('preset.moveFolderPrompt')
      : i18n.t('preset.moveItemPrompt');
  }

  public getPresetDeleteDescription(target: PresetDeleteTarget): string {
    if (target.kind === 'preset-entries') {
      return i18n.t('preset.moveItemsDescription', {
        count: target.entries.length,
      });
    }

    const label = target.relativePath[target.relativePath.length - 1] ?? '';
    return target.entryKind === 'directory'
      ? i18n.t('preset.moveFolderDescription', { label })
      : i18n.t('preset.moveItemDescription', { label });
  }

  public async handleShowPresetEntryInFolder(target: PresetEntryTarget): Promise<void> {
    const response = await this.options.bridgeClient.showPresetEntryInFolder({
      presetType: target.presetType,
      relativePath: [...target.relativePath],
      entryKind: target.entryKind,
    });
    if (response.status === 'error') {
      this.showError('status.showInFolderFailed', response.message);
    }
  }

  public async handleSaveDevicePreset(deviceId: string): Promise<void> {
    const chain = this.options.editorSession.state.chainState;
    const payload = buildDevicePresetFile(chain, deviceId);
    await this.savePreset(
      payload
        ? {
            suggestedName: resolveDevicePresetSuggestedName(
              chain,
              deviceId,
              (kind) => i18n.t(getDeviceMessageKey(kind)),
            ),
            payload,
          }
        : null,
      {
        emptyMessage: 'status.deviceBuildFailed',
        successMessage: 'status.deviceSaved',
        errorSummary: 'status.deviceSaveFailed',
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
            suggestedName: resolveGroupPresetSuggestedName(
              chain,
              groupId,
              i18n.t('group.defaultTemplate'),
            ),
            payload,
          }
        : null,
      {
        emptyMessage: 'status.groupBuildFailed',
        successMessage: 'status.groupSaved',
        errorSummary: 'status.groupSaveFailed',
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
      description: i18n.t('rack.saveBeforeClose'),
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
      }, 'status.rackLoadFailed');
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
      }, 'status.rackLoadFailed');
    } finally {
      this.state.isRackPresetLoadPending = false;
    }
  }

  public getRackPresetLoadDescription(target: PendingRackPresetLoadTarget): string {
    return target.description ?? i18n.t('rack.saveBeforeOpen', {
      label: target.label,
    });
  }

  public async handlePresetFileDrop(payload: RackPresetFileDrop): Promise<void> {
    if (payload.fileCount !== 1) {
      this.showMessage(i18n.t('status.dropSinglePreset'));
      return;
    }

    let fileText: string;
    try {
      fileText = await payload.file.text();
    } catch {
      this.showError('status.fileLoadFailed', i18n.t('status.fileReadFailed'));
      return;
    }

    const parsed = parsePresetFileText(fileText, {
      fileName: payload.file.name,
    });
    if (parsed.ok === false) {
      this.showError('status.fileLoadFailed', parsed.message);
      return;
    }

    if (parsed.preset.presetType === 'rack') {
      await this.requestRackOpen({
        label: resolveRackDisplayName(payload.file.name),
        preset: parsed.preset,
        filePath: payload.filePath,
        needsSave: parsed.needsSave,
      });
      return;
    }

    if (!payload.dropZone) {
      this.showMessage(i18n.t('status.dropOntoRack'));
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
    this.showMessage(resolvePresetApplyMessage(result.status));
  }

  private showMessage(message: string): void {
    this.options.showMessage(message);
  }

  private showError(summaryKey: MessageKey, detail?: string | null): void {
    this.showMessage(formatErrorMessage(summaryKey, detail));
  }

  private async runPresetAction(
    action: () => Promise<void>,
    fallbackMessageKey: MessageKey,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.showError(
        fallbackMessageKey,
        error instanceof Error ? error.message : null,
      );
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
          needsSave: response.needsSave,
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
      this.showError('status.presetLoadFailed', response.message);
      return;
    }

    if (response.payload.presetType === 'device') {
      const result = this.options.editorSession.commands.insertDevicePreset(
        DEFAULT_PRESET_DROP_ZONE,
        response.payload,
      );
      this.showMessage(resolvePresetApplyMessage(result.status));
      return;
    }

    if (response.payload.presetType === 'group') {
      const result = this.options.editorSession.commands.insertGroupPreset(
        DEFAULT_PRESET_DROP_ZONE,
        response.payload,
      );
      this.showMessage(resolvePresetApplyMessage(result.status));
      return;
    }

    await this.requestRackOpen({
      label: entry.label,
      preset: response.payload,
      filePath: response.filePath,
      needsSave: response.needsSave,
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
      this.showMessage(resolvePresetApplyMessage(result.status));
      return;
    }

    this.setCurrentRackFile(
      target.filePath,
      target.label,
      target.filePath ? target.preset.savedAtIso : null,
    );
    if (target.needsSave) {
      this.captureCurrentRackRevertTarget();
      this.syncRackDirtyState();
      this.showMessage(i18n.t('status.rackLoadedNeedsSave'));
      return;
    }

    this.markCurrentRackClean({ captureRevertTarget: true });
    this.showMessage(i18n.t('status.rackLoaded'));
  }

  private async requestNewRack(): Promise<void> {
    this.syncRackDirtyState();
    const load = async (): Promise<void> => {
      this.loadNewRack();
    };

    if (this.state.isRackDirty) {
      this.state.pendingRackPresetLoadTarget = {
        label: resolveDefaultRackFileDisplayName(),
        description: i18n.t('rack.saveBeforeNew'),
        load,
      };
      this.state.isRackPresetLoadPending = false;
      return;
    }

    await load();
  }

  private loadNewRack(): void {
    const result = this.options.editorSession.commands.applyRackPreset(
      buildRackPresetFile(createDefaultChainSettings(), []),
    );
    if (!result.ok) {
      this.showMessage(resolvePresetApplyMessage(result.status));
      return;
    }

    this.setCurrentRackFile(null, resolveDefaultRackFileDisplayName(), null);
    this.clearRevertTarget();
    this.markCurrentRackClean();
    this.showMessage(i18n.t('status.newRackCreated'));
  }

  private async savePreset(
    request: SavePresetFileRequest | null,
    options: {
      emptyMessage?: MessageKey;
      successMessage: MessageKey;
      errorSummary: MessageKey;
    },
  ): Promise<void> {
    await this.runPresetAction(async () => {
      if (!request) {
        if (options.emptyMessage) {
          this.showMessage(i18n.t(options.emptyMessage));
        }
        return;
      }

      const response = await this.options.bridgeClient.savePresetFile(request);
      if (response.status === 'saved') {
        await this.loadTree();
        this.showMessage(i18n.t(options.successMessage));
        return;
      }

      if (response.status === 'error') {
        this.showError(options.errorSummary, response.message);
      }
    }, options.errorSummary);
  }
}

export const createPresetController = (
  options: PresetControllerOptions,
): PresetController => new PresetController(options);
