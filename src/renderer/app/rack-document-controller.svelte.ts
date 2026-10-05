import { resolvePresetOperationErrorMessage } from '../features/browser/preset-operation-error';
import type { RendererCompassApi } from './browser-bridge';
import {
  normalizeAuthoredMetadata,
  normalizeCustomName,
  replaceAuthoredMetadata,
  type AuthoredMetadata,
} from '../../shared/model';
import type { DeletedPresetEntry, MovedPresetEntry } from '../../shared/contracts/ipc/presets';
import type { RackPresetFile } from '../../shared/preset/file';
import { buildRackPresetFile } from '../features/editor/presets';
import { createDefaultChainSettings } from '../features/editor/persistence-storage';
import type { EditorSession } from '../features/editor/session.svelte';
import { i18n } from '../i18n.svelte';
import {
  PresetOperationFeedback,
  resolvePresetApplyMessage,
  type PresetInfoUpdateResult,
} from './preset-operation-feedback';

type PendingRackTransition = {
  label: string;
  run: () => Promise<void>;
};

type RackOpenTarget = {
  label: string;
  preset: RackPresetFile;
  filePath: string | null;
  needsSave: boolean;
};

interface RackDocumentState {
  pendingTransition: PendingRackTransition | null;
  isTransitionPending: boolean;
  currentRackFilePath: string | null;
  currentRackDisplayName: string;
  currentRackSavedAtIso: string | null;
  isRackDirty: boolean;
  canRevertRack: boolean;
}

interface RackDocumentOptions {
  bridgeClient: RendererCompassApi;
  editorSession: EditorSession;
  showMessage: (message: string) => void;
  onFileChanged: () => Promise<void>;
}

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

export const resolveRackDisplayName = (filePathOrName: string): string => {
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

/** Owns the current Rack document and its save/discard transitions. */
export class RackDocumentController {
  private defaultRackFileDisplayName = resolveDefaultRackFileDisplayName();

  public readonly state: RackDocumentState = $state({
    pendingTransition: null,
    isTransitionPending: false,
    currentRackFilePath: null,
    currentRackDisplayName: this.defaultRackFileDisplayName,
    currentRackSavedAtIso: null,
    isRackDirty: false,
    canRevertRack: false,
  });

  private readonly feedback: PresetOperationFeedback;

  public constructor(private readonly options: RackDocumentOptions) {
    this.feedback = new PresetOperationFeedback(options.showMessage);
    this.markCurrentRackClean();
  }

  private cleanRackRevision = 0;

  private cleanCollapsedDeviceIdsKey = '';

  private cleanRackDisplayName = this.defaultRackFileDisplayName;

  private cleanRackPreset: RackPresetFile | null = null;

  private lastMainWindowDocumentEdited: boolean | null = null;

  private lastMainWindowDocumentFilePath: string | null | undefined;

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
    if (this.state.pendingTransition?.label === previousDefaultName) {
      this.state.pendingTransition.label = nextDefaultName;
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
    await this.feedback.runPresetAction(async () => {
      await this.requestTransition(async () => this.loadNewRack());
    }, 'status.newRackFailed');
  }

  public handleRevertRack(): void {
    this.syncRackDirtyState();
    if (!this.state.isRackDirty || !this.cleanRackPreset) {
      return;
    }

    const result = this.options.editorSession.commands.applyRackPreset(this.cleanRackPreset);
    if (!result.ok) {
      this.feedback.showMessage(resolvePresetApplyMessage(result.status));
      return;
    }

    this.state.currentRackDisplayName = this.cleanRackDisplayName;
    this.markCurrentRackClean({ captureRevertTarget: true });
    this.feedback.showMessage(i18n.t('status.rackReverted'));
  }

  public async updateCurrentRackInfo(
    rawName: string,
    metadata: AuthoredMetadata | undefined,
  ): Promise<PresetInfoUpdateResult> {
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
      return { status: 'updated' };
    }

    const response = await this.options.bridgeClient.updateRackFileInfo({
      filePath,
      fileName: nextName,
      ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
    });
    if (response.status === 'error') {
      return { status: 'error', message: resolvePresetOperationErrorMessage(response.errorCode, 'status.presetInfoSaveFailed', 'name-edit') };
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
    await this.options.onFileChanged();
    return { status: 'updated' };
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

  public syncCurrentRackAfterPresetEntriesMove(
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

  public syncCurrentRackAfterPresetEntriesDelete(
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
        this.feedback.showMessage(i18n.t('status.rackSaved'));
      }
      await this.options.onFileChanged();
      return true;
    }

    this.feedback.showError('status.rackSaveFailed', response.message);
    return false;
  }

  private async saveRackAs(
    options: { showSuccessMessage: boolean },
  ): Promise<boolean> {
    let savedAtIso: string | null = null;
    const response = await this.options.bridgeClient.savePresetFile(() => {
      const payload = this.buildCurrentRackFile();
      savedAtIso = payload.savedAtIso;
      return { suggestedName: this.state.currentRackDisplayName, payload };
    });
    if (response.status === 'saved') {
      this.setCurrentRackFile(
        response.filePath,
        resolveRackDisplayName(response.filePath),
        savedAtIso,
      );
      this.markCurrentRackClean({ captureRevertTarget: true });
      if (options.showSuccessMessage) {
        this.feedback.showMessage(i18n.t('status.rackSaved'));
      }
      await this.options.onFileChanged();
      return true;
    }

    if (response.status === 'error') {
      this.feedback.showError('status.rackSaveFailed', response.message);
    }
    return false;
  }

  public async handleMainWindowCloseRequest(): Promise<void> {
    await this.requestTransition(async () => {
      await this.options.bridgeClient.confirmMainWindowClose();
    });
  }

  private async requestTransition(run: () => Promise<void>): Promise<void> {
    if (this.state.pendingTransition || this.state.isTransitionPending) return;
    this.syncRackDirtyState();
    if (!this.state.isRackDirty) {
      await run();
      return;
    }
    this.state.pendingTransition = {
      label: this.state.currentRackDisplayName,
      run,
    };
  }

  public cancelTransition(): void {
    if (this.state.isTransitionPending) {
      return;
    }

    this.state.pendingTransition = null;
  }

  public async confirmSaveBeforeTransition(): Promise<void> {
    await this.confirmTransition(true);
  }

  public async confirmDiscardBeforeTransition(): Promise<void> {
    await this.confirmTransition(false);
  }

  private async confirmTransition(saveFirst: boolean): Promise<void> {
    const target = this.state.pendingTransition;
    if (!target || this.state.isTransitionPending) return;

    this.state.isTransitionPending = true;
    try {
      if (saveFirst && !await this.saveCurrentRack({ showSuccessMessage: false })) return;
      await this.feedback.runPresetAction(async () => {
        await target.run();
        this.state.pendingTransition = null;
      }, 'status.rackLoadFailed');
    } finally {
      this.state.isTransitionPending = false;
    }
  }

  public getRackSavePromptTitle(target: PendingRackTransition): string {
    return i18n.t('rack.saveCurrentPrompt', {
      label: target.label,
    });
  }

  public async requestRackOpen(target: RackOpenTarget): Promise<void> {
    await this.requestTransition(() => this.loadRackOpenTarget(target));
  }

  private async loadRackOpenTarget(target: RackOpenTarget): Promise<void> {
    const result = this.options.editorSession.commands.applyRackPreset(target.preset);
    if (!result.ok) {
      this.feedback.showMessage(resolvePresetApplyMessage(result.status));
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
    } else {
      this.markCurrentRackClean({ captureRevertTarget: true });
    }

    this.feedback.showMessage(i18n.t('status.rackLoaded'));
  }

  private loadNewRack(): void {
    const result = this.options.editorSession.commands.applyRackPreset(
      buildRackPresetFile(createDefaultChainSettings(), []),
    );
    if (!result.ok) {
      this.feedback.showMessage(resolvePresetApplyMessage(result.status));
      return;
    }

    this.setCurrentRackFile(null, resolveDefaultRackFileDisplayName(), null);
    this.clearRevertTarget();
    this.markCurrentRackClean();
    this.feedback.showMessage(i18n.t('status.newRackCreated'));
  }
}

export const createRackDocumentController = (options: RackDocumentOptions): RackDocumentController =>
  new RackDocumentController(options);
