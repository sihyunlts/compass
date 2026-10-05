import {
  PresetOperationFeedback,
  formatPresetErrorMessage,
  resolvePresetApplyMessage,
  type PresetInfoUpdateResult,
} from './preset-operation-feedback';
import { resolveRackDisplayName, type RackDocumentController } from './rack-document-controller.svelte';
import { resolvePresetOperationErrorMessage } from '../features/browser/preset-operation-error';
import type { CompassApi } from '../../shared/contracts/ipc/api';
import type { RendererCompassApi } from './browser-bridge';
import type { MessageKey } from '../../shared/i18n';
import {
  cloneDeviceNode,
  normalizeAuthoredMetadata,
  type AuthoredMetadata,
} from '../../shared/model';
import {
  normalizePresetEntrySelection,
  type PresetEntrySelectionItem,
} from '../../shared/preset/entry-selection';
import {
  getDeviceMessageKey,
} from '../device-i18n';
import { i18n } from '../i18n.svelte';
import type {
  CopyPresetEntriesRequest,
  CreatePresetFolderRequest,
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
} from '../../shared/preset/file';
import type {
  BrowserTreePresetFolderNode,
  BrowserTreePresetLeafNode,
  PendingPresetFolderDraft,
  PresetEntrySelectionTarget,
} from '../features/browser/types';
import { resolvePresetFileErrorMessage } from '../features/browser/preset-file-error';
import {
  canCopyPresetContextTarget,
  type ContextMenuTarget,
  type PresetBrowserContextTarget,
  type PresetDeleteContextTarget,
  type PresetEntryContextTarget,
} from '../features/context-menu/types';
import type {
  BrowserInsertSource,
  BrowserPresetInsertSource,
  RackPresetFileDrop,
} from '../features/rack/types';
import {
  buildDevicePresetFile,
  buildGroupPresetFile,
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

const PRESET_DELETE_MESSAGE_KEYS = {
  desktop: {
    folderPrompt: 'preset.moveFolderPrompt',
    itemPrompt: 'preset.moveItemPrompt',
    itemsPrompt: 'preset.moveItemsPrompt',
    folderDescription: 'preset.moveFolderDescription',
    itemDescription: 'preset.moveItemDescription',
    itemsDescription: 'preset.moveItemsDescription',
    failed: 'status.moveToTrashFailed',
  },
  web: {
    folderPrompt: 'preset.deleteFolderPrompt',
    itemPrompt: 'preset.deleteItemPrompt',
    itemsPrompt: 'preset.deleteItemsPrompt',
    folderDescription: 'preset.deleteFolderDescription',
    itemDescription: 'preset.deleteItemDescription',
    itemsDescription: 'preset.deleteItemsDescription',
    failed: 'status.presetDeleteFailed',
  },
} as const;

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
interface PresetBrowserControllerState {
  browserClipboardEntries: PresetEntryContextTarget[];
  presetTree: BrowserTreePresetFolderNode[];
  presetErrorText: string | null;
  pendingPresetFolderDraft: PendingPresetFolderDraft | null;
  presetEntrySelectionTarget: PresetEntrySelectionTarget | null;
  pendingPresetDeleteTarget: PresetDeleteTarget | null;
  isPresetDeletePending: boolean;
}

interface PresetBrowserControllerOptions {
  bridgeClient: RendererCompassApi;
  editorSession: EditorSession;
  showMessage: (message: string) => void;
  isWebFallback: boolean;
  rackDocument: RackDocumentController;
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
      source: node.source,
      ...(node.icon ? { icon: node.icon } : {}),
      relativePath: [...node.relativePath],
      children: node.children.map((child) => mapPresetTreeNode(child)),
    };
  }

  if (node.loadStatus === 'error') {
    return {
      kind: 'preset',
      id: node.id,
      label: node.label,
      presetType: node.presetType,
      source: node.source,
      relativePath: [...node.relativePath],
      loadStatus: 'error',
      loadErrorCode: node.loadErrorCode,
    };
  }

  return {
    kind: 'preset',
    id: node.id,
    label: node.label,
    presetType: node.presetType,
    source: node.source,
    relativePath: [...node.relativePath],
    loadStatus: 'loaded',
    savedAtIso: node.savedAtIso,
    deviceKind: node.deviceKind,
    ...(node.preview
      ? {
          preview: clonePresetBrowserPreview(node.preview),
        }
      : {}),
  };
};

/** Owns preset library state, file operations, and insertion into the Rack. */
export class PresetBrowserController {
  public readonly state: PresetBrowserControllerState = $state({
    browserClipboardEntries: [],
    presetTree: [],
    presetErrorText: null,
    pendingPresetFolderDraft: null,
    presetEntrySelectionTarget: null,
    pendingPresetDeleteTarget: null,
    isPresetDeletePending: false,
  });

  private readonly feedback: PresetOperationFeedback;

  public constructor(private readonly options: PresetBrowserControllerOptions) {
    this.feedback = new PresetOperationFeedback(options.showMessage);
  }

  private presetListRequestToken = 0;

  private nextPendingPresetFolderId = 1;

  private nextPresetEntrySelectionToken = 1;

  public async updatePresetInfo(
    entry: PresetEntryContextTarget,
    rawName: string,
    metadata: AuthoredMetadata | undefined,
  ): Promise<PresetInfoUpdateResult> {
    if (entry.source !== 'user') {
      return { status: 'error', message: i18n.t('status.presetInfoSaveFailed') };
    }

    const normalizedMetadata = normalizeAuthoredMetadata(metadata);
    const response = await this.options.bridgeClient.updatePresetFileInfo({
      presetType: entry.presetType,
      source: entry.source,
      relativePath: [...entry.relativePath],
      fileName: rawName,
      ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
    });
    if (response.status === 'error') {
      return { status: 'error', message: resolvePresetOperationErrorMessage(response.errorCode, 'status.presetInfoSaveFailed', 'name-edit') };
    }

    await this.loadTree();
    if (entry.presetType === 'rack') {
      this.options.rackDocument.syncCurrentRackAfterPresetEntriesMove([{
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
    return { status: 'updated' };
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
      this.state.presetErrorText = null;
    } catch (error) {
      if (requestToken !== this.presetListRequestToken) {
        return;
      }

      this.state.presetTree = [];
      this.state.presetErrorText = formatPresetErrorMessage(
        'status.presetsLoadFailed',
        error instanceof Error ? error.message : null,
      );
    }
  }

  public async handlePresetEntryOpen(entry: BrowserTreePresetLeafNode): Promise<void> {
    if (entry.loadStatus === 'error') {
      return;
    }

    await this.feedback.runPresetAction(async () => {
      await this.loadPresetFromBrowserEntry(entry);
    }, 'status.presetLoadFailed');
  }

  public async loadRackPresetForPreview(
    entry: BrowserTreePresetLeafNode,
  ): Promise<RackPresetFile | null> {
    if (entry.loadStatus === 'error' || entry.presetType !== 'rack') {
      return null;
    }

    const response = await this.options.bridgeClient.readPresetEntry({
      presetType: 'rack',
      source: entry.source,
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
    if (
      entry.loadStatus === 'error'
      || sourceEvent.button !== 0
      || !sourceEvent.isPrimary
    ) {
      return;
    }

    await this.feedback.runPresetAction(async () => {
      const response = await this.options.bridgeClient.readPresetEntry(
        this.toReadPresetEntryRequest(entry),
      );
      if (dragSignal.aborted) {
        return;
      }
      if (response.status === 'error') {
        this.feedback.showError(
          'status.presetLoadFailed',
          resolvePresetFileErrorMessage(response.errorCode),
        );
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
    void this.feedback.runPresetAction(
      async () => {
        await this.options.rackDocument.requestRackOpen({
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
    if (
      target.kind === 'preset-entry'
        ? target.source !== 'user'
        : target.entries.some((entry) => entry.source !== 'user')
    ) {
      return;
    }

    if (target.kind === 'preset-entry') {
      this.state.pendingPresetDeleteTarget = {
        kind: 'preset-entry',
        presetType: target.presetType,
        source: target.source,
        relativePath: [...target.relativePath],
        entryKind: target.entryKind,
      };
    } else {
      const normalizedEntries = normalizePresetEntrySelection(target.entries);
      this.state.pendingPresetDeleteTarget = normalizedEntries.length === 1
        ? {
            kind: 'preset-entry',
            presetType: normalizedEntries[0].presetType,
            source: normalizedEntries[0].source,
            relativePath: [...normalizedEntries[0].relativePath],
            entryKind: normalizedEntries[0].entryKind,
          }
        : {
          kind: 'preset-entries',
          entries: normalizedEntries.map((entry) => ({
            kind: 'preset-entry',
            presetType: entry.presetType,
            source: entry.source,
            relativePath: [...entry.relativePath],
            entryKind: entry.entryKind,
          })),
        };
    }
    this.state.isPresetDeletePending = false;
  }

  public beginPresetFolderCreate(target: ContextMenuTarget): void {
    if (
      target.kind !== 'preset-entry'
      || target.entryKind !== 'directory'
      || target.source !== 'user'
    ) {
      return;
    }

    this.state.pendingPresetFolderDraft = {
      mode: 'create',
      entryKind: 'directory',
      presetType: target.presetType,
      source: target.source,
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
      || target.source !== 'user'
    ) {
      return;
    }

    this.state.pendingPresetFolderDraft = {
      mode: 'rename',
      entryKind: target.entryKind,
      presetType: target.presetType,
      source: target.source,
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
          source: draft.source,
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
    const response = await this.commitPresetEntryDraft(draft);
    if (response.status === 'error') {
      this.feedback.showMessage(resolvePresetOperationErrorMessage(
        response.errorCode,
        resolvePresetDraftErrorMessageKey(draft),
        'name-edit',
      ));
      return;
    }

    this.setPresetEntrySelectionTarget([{
      presetType: draft.presetType,
      relativePath: response.relativePath,
      entryKind: draft.entryKind,
    }]);
  }

  public async commitPresetEntryDraft(draft: PendingPresetFolderDraft) {
    const entryName = draft.draftName.trim();
    const response = draft.mode === 'create'
      ? await this.options.bridgeClient.createPresetFolder({
          presetType: draft.presetType,
          source: draft.source,
          relativePath: [...draft.relativePath],
          folderName: entryName,
        } satisfies CreatePresetFolderRequest)
      : draft.entryKind === 'file'
        ? await this.options.bridgeClient.renamePresetFile({
            presetType: draft.presetType,
            source: draft.source,
            relativePath: [...draft.relativePath],
            fileName: entryName,
          } satisfies RenamePresetFileRequest)
      : await this.options.bridgeClient.renamePresetFolder({
          presetType: draft.presetType,
          source: draft.source,
          relativePath: [...draft.relativePath],
          folderName: entryName,
        } satisfies RenamePresetFolderRequest);
    if (response.status !== 'error') {
      await this.loadTree();
      if (draft.presetType === 'rack' && 'sourcePath' in response) {
        this.options.rackDocument.syncCurrentRackAfterPresetEntriesMove([{
          presetType: 'rack',
          entryKind: draft.entryKind,
          relativePath: response.relativePath,
          sourcePath: response.sourcePath,
          filePath: response.filePath,
        }]);
      }
    }
    return response;
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
      source: PresetEntryContextTarget['source'];
      relativePath: readonly string[];
    },
  ): Promise<void> {
    if (
      destination.source !== 'user'
      || entries.some((entry) => entry.source !== 'user')
    ) {
      return;
    }

    await this.feedback.runPresetAction(async () => {
      const response = await this.options.bridgeClient.movePresetEntries({
        entries: entries.map((entry) => ({
          presetType: entry.presetType,
          source: 'user',
          relativePath: [...entry.relativePath],
          entryKind: entry.entryKind,
        })),
        destination: {
          presetType: destination.presetType,
          source: 'user',
          relativePath: [...destination.relativePath],
        },
      });
      if (response.status === 'error') {
        await this.loadTree();
        this.feedback.showMessage(resolvePresetOperationErrorMessage(response.errorCode, 'status.presetMoveFailed', 'move'));
        return;
      }

      this.options.rackDocument.syncCurrentRackAfterPresetEntriesMove(response.entries);
      await this.loadTree();
      this.setPresetEntrySelectionTarget(response.entries);
    }, 'status.presetMoveFailed');
  }

  public copyBrowserEntries(target: PresetBrowserContextTarget): void {
    if (!canCopyPresetContextTarget(target)) {
      return;
    }

    const entries = target.kind === 'preset-entry' ? [target] : target.entries;
    this.state.browserClipboardEntries = entries.map((entry) => ({
      ...entry,
      relativePath: [...entry.relativePath],
    }));
  }

  public async duplicateBrowserEntries(target: PresetBrowserContextTarget): Promise<void> {
    const entries = target.kind === 'preset-entry' ? [target] : target.entries;
    await this.copyBrowserEntriesTo(entries);
  }

  public async pasteBrowserEntries(target: PresetEntryContextTarget): Promise<void> {
    const entries = this.state.browserClipboardEntries;
    if (
      entries.length === 0
      || target.source !== 'user'
      || target.presetType !== entries[0].presetType
    ) {
      return;
    }

    const relativePath = target.entryKind === 'directory'
      ? target.relativePath
      : target.relativePath.slice(0, -1);
    await this.copyBrowserEntriesTo(entries, {
      presetType: target.presetType,
      source: 'user',
      relativePath: [...relativePath],
    });
  }

  private async copyBrowserEntriesTo(
    entries: readonly PresetEntryContextTarget[],
    destination?: CopyPresetEntriesRequest['destination'],
  ): Promise<void> {
    if (!canCopyPresetContextTarget({ kind: 'preset-entries', entries })) {
      return;
    }

    await this.feedback.runPresetAction(async () => {
      const response = await this.options.bridgeClient.copyPresetEntries({
        entries: entries.map((entry) => ({
          presetType: entry.presetType,
          source: 'user',
          relativePath: [...entry.relativePath],
          entryKind: entry.entryKind,
        })),
        ...(destination ? { destination } : {}),
      });
      if (response.status === 'error') {
        await this.loadTree();
        this.feedback.showMessage(resolvePresetOperationErrorMessage(response.errorCode, 'status.presetCopyFailed', 'copy'));
        return;
      }

      await this.loadTree();
      this.setPresetEntrySelectionTarget(response.entries);
    }, 'status.presetCopyFailed');
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
          source: 'user',
          relativePath: [...entry.relativePath],
          entryKind: entry.entryKind,
        })),
      });
      if (response.status === 'error') {
        await this.loadTree();
        this.state.pendingPresetDeleteTarget = null;
        this.feedback.showMessage(resolvePresetOperationErrorMessage(response.errorCode, this.presetDeleteMessageKeys.failed));
        return;
      }

      this.options.rackDocument.syncCurrentRackAfterPresetEntriesDelete(response.entries);
      await this.loadTree();
      this.state.pendingPresetDeleteTarget = null;
    } catch (error) {
      this.feedback.showError(
        this.presetDeleteMessageKeys.failed,
        error instanceof Error ? error.message : null,
      );
    } finally {
      this.state.isPresetDeletePending = false;
    }
  }

  public getPresetDeleteTitle(target: PresetDeleteTarget): string {
    const keys = this.presetDeleteMessageKeys;
    if (target.kind === 'preset-entries') {
      return i18n.t(keys.itemsPrompt, {
        count: target.entries.length,
      });
    }

    const entryName = target.relativePath[target.relativePath.length - 1] ?? '';
    const label = target.entryKind === 'file'
      ? resolvePresetNameFromFileName(entryName, target.presetType) ?? entryName
      : entryName;
    return target.entryKind === 'directory'
      ? i18n.t(keys.folderPrompt, { label })
      : i18n.t(keys.itemPrompt, { label });
  }

  public getPresetDeleteDescription(target: PresetDeleteTarget): string {
    const keys = this.presetDeleteMessageKeys;
    if (target.kind === 'preset-entries') {
      return i18n.t(keys.itemsDescription);
    }

    return target.entryKind === 'directory'
      ? i18n.t(keys.folderDescription)
      : i18n.t(keys.itemDescription);
  }

  private get presetDeleteMessageKeys() {
    return PRESET_DELETE_MESSAGE_KEYS[this.options.isWebFallback ? 'web' : 'desktop'];
  }

  public async handleShowPresetEntryInFolder(target: PresetEntryTarget): Promise<void> {
    if (target.source !== 'user') {
      return;
    }

    const response = await this.options.bridgeClient.showPresetEntryInFolder({
      presetType: target.presetType,
      source: target.source,
      relativePath: [...target.relativePath],
      entryKind: target.entryKind,
    });
    if (response.status === 'error') {
      this.feedback.showError('status.showInFolderFailed', response.message);
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

  public async handlePresetFileDrop(payload: RackPresetFileDrop): Promise<void> {
    if (payload.fileCount !== 1) {
      this.feedback.showMessage(i18n.t('status.dropSinglePreset'));
      return;
    }

    let fileText: string;
    try {
      fileText = await payload.file.text();
    } catch {
      this.feedback.showError('status.fileLoadFailed', i18n.t('status.fileReadFailed'));
      return;
    }

    const parsed = parsePresetFileText(fileText, {
      fileName: payload.file.name,
    });
    if (parsed.ok === false) {
      this.feedback.showError(
        'status.fileLoadFailed',
        resolvePresetFileErrorMessage(parsed.errorCode),
      );
      return;
    }

    if (parsed.preset.presetType === 'rack') {
      await this.options.rackDocument.requestRackOpen({
        label: resolveRackDisplayName(payload.file.name),
        preset: parsed.preset,
        filePath: payload.filePath,
        needsSave: parsed.needsSave,
      });
      return;
    }

    if (!payload.dropZone) {
      this.feedback.showMessage(i18n.t('status.dropOntoRack'));
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
    this.feedback.showMessage(resolvePresetApplyMessage(result.status));
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
      source: entry.source,
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
      this.feedback.showError(
        'status.presetLoadFailed',
        resolvePresetFileErrorMessage(response.errorCode),
      );
      return;
    }

    if (response.payload.presetType === 'device') {
      const result = this.options.editorSession.commands.insertDevicePreset(
        DEFAULT_PRESET_DROP_ZONE,
        response.payload,
      );
      this.feedback.showMessage(resolvePresetApplyMessage(result.status));
      return;
    }

    if (response.payload.presetType === 'group') {
      const result = this.options.editorSession.commands.insertGroupPreset(
        DEFAULT_PRESET_DROP_ZONE,
        response.payload,
      );
      this.feedback.showMessage(resolvePresetApplyMessage(result.status));
      return;
    }

    await this.options.rackDocument.requestRackOpen({
      label: entry.label,
      preset: response.payload,
      filePath: response.filePath,
      needsSave: response.needsSave,
    });
  }

  private async savePreset(
    request: SavePresetFileRequest | null,
    options: {
      emptyMessage?: MessageKey;
      successMessage: MessageKey;
      errorSummary: MessageKey;
    },
  ): Promise<void> {
    await this.feedback.runPresetAction(async () => {
      if (!request) {
        if (options.emptyMessage) {
          this.feedback.showMessage(i18n.t(options.emptyMessage));
        }
        return;
      }

      const response = await this.options.bridgeClient.savePresetFile(request);
      if (response.status === 'saved') {
        await this.loadTree();
        this.feedback.showMessage(i18n.t(options.successMessage));
        return;
      }

      if (response.status === 'error') {
        this.feedback.showError(options.errorSummary, response.message);
      }
    }, options.errorSummary);
  }}

export const createPresetBrowserController = (options: PresetBrowserControllerOptions): PresetBrowserController =>
  new PresetBrowserController(options);
