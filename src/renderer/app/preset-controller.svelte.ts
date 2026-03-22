import type { CompassApi } from '../../shared/contracts/ipc/api';
import type {
  PresetBrowserTreeNode,
  ReadPresetEntryResponse,
  SavePresetFileRequest,
} from '../../shared/contracts/ipc/presets';
import { parsePresetFileText } from '../../shared/presets';
import type {
  BrowserTreePresetFolderNode,
  BrowserTreePresetLeafNode,
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
  resolveRackPresetSuggestedName,
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
  load: () => Promise<void>;
};

interface PresetControllerState {
  presetTree: BrowserTreePresetFolderNode[];
  isPresetLoading: boolean;
  presetErrorText: string | null;
  pendingPresetDeleteTarget: PresetEntryTarget | null;
  isPresetDeletePending: boolean;
  pendingRackPresetLoadTarget: PendingRackPresetLoadTarget | null;
  isRackPresetLoadPending: boolean;
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
  };
};

/** Owns renderer-side preset browser state and preset IPC workflows. */
class PresetController {
  public readonly state: PresetControllerState = $state({
    presetTree: [],
    isPresetLoading: false,
    presetErrorText: null,
    pendingPresetDeleteTarget: null,
    isPresetDeletePending: false,
    pendingRackPresetLoadTarget: null,
    isRackPresetLoadPending: false,
  });

  private presetListRequestToken = 0;

  public constructor(private readonly options: PresetControllerOptions) {}

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
        : 'Failed to load presets.';
    } finally {
      if (requestToken === this.presetListRequestToken) {
        this.state.isPresetLoading = false;
      }
    }
  }

  public async handlePresetEntryOpen(entry: BrowserTreePresetLeafNode): Promise<void> {
    if (entry.presetType === 'rack' && this.hasExistingRack()) {
      this.openRackPresetEntryDialog(entry);
      return;
    }

    await this.runPresetAction(async () => {
      await this.loadPresetFromBrowserEntry(entry);
    }, 'Preset load failed.');
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
        this.showMessage(`Preset load failed | ${response.message}`);
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
    }, 'Preset load failed.');
  }

  public openRackPresetDropDialog(source: Extract<BrowserPresetInsertSource, { kind: 'rack-preset' }>): void {
    if (!this.hasExistingRack()) {
      const result = this.options.editorSession.commands.applyRackPreset(source.preset);
      this.showPresetActionMessage(result.message);
      return;
    }

    this.state.pendingRackPresetLoadTarget = {
      label: source.label,
      load: async () => {
        const result = this.options.editorSession.commands.applyRackPreset(source.preset);
        this.showPresetActionMessage(result.message);
      },
    };
    this.state.isRackPresetLoadPending = false;
  }

  public openRackPresetEntryDialog(entry: BrowserTreePresetLeafNode): void {
    this.state.pendingRackPresetLoadTarget = {
      label: entry.label,
      load: async () => {
        await this.loadPresetFromBrowserEntry(entry);
      },
    };
    this.state.isRackPresetLoadPending = false;
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
        this.showMessage(`Preset delete failed | ${response.message}`);
        return;
      }

      await this.loadTree();
      this.state.pendingPresetDeleteTarget = null;
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Preset delete failed.';
      this.showMessage(`Preset delete failed | ${message}`);
    } finally {
      this.state.isPresetDeletePending = false;
    }
  }

  public getPresetDeleteTitle(target: PresetEntryTarget): string {
    return target.entryKind === 'directory'
      ? 'Move folder to Trash?'
      : 'Move preset to Trash?';
  }

  public getPresetDeleteDescription(target: PresetEntryTarget): string {
    const label = target.relativePath[target.relativePath.length - 1]
      ?? PRESET_ROOT_LABELS[target.presetType];
    return target.entryKind === 'directory'
      ? `The folder "${label}" and everything inside it will be moved to the trash.`
      : `The preset "${label}" will be moved to the trash.`;
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
        emptyMessage: 'Unable to build preset from this device.',
        successMessage: 'Device preset saved.',
        errorSummary: 'Preset save failed',
      },
    );
  }

  public async handleSaveGroupPreset(groupId: string): Promise<void> {
    const chain = this.options.editorSession.state.chainState;
    const memberDeviceIds = resolveGroupMemberIds(chain.devices, groupId);
    const payload = buildGroupPresetFile(chain, groupId, memberDeviceIds);
    await this.savePreset(
      payload
        ? {
            suggestedName: resolveGroupPresetSuggestedName(chain, groupId),
            payload,
          }
        : null,
      {
        emptyMessage: 'Unable to build preset from this group.',
        successMessage: 'Group preset saved.',
        errorSummary: 'Preset save failed',
      },
    );
  }

  public async handleSaveRackPreset(): Promise<void> {
    await this.savePreset(
      {
        suggestedName: resolveRackPresetSuggestedName(
          this.options.editorSession.state.chainState,
        ),
        payload: buildRackPresetFile(this.options.editorSession.state.chainState),
      },
      {
        successMessage: 'Rack preset saved.',
        errorSummary: 'Rack preset save failed',
      },
    );
  }

  public closeRackPresetLoadDialog(): void {
    if (this.state.isRackPresetLoadPending) {
      return;
    }

    this.state.pendingRackPresetLoadTarget = null;
  }

  public async confirmRackPresetLoad(): Promise<void> {
    const target = this.state.pendingRackPresetLoadTarget;
    if (!target || this.state.isRackPresetLoadPending) {
      return;
    }

    this.state.isRackPresetLoadPending = true;
    try {
      await this.runPresetAction(async () => {
        await target.load();
        this.state.pendingRackPresetLoadTarget = null;
      }, 'Rack preset load failed.');
    } finally {
      this.state.isRackPresetLoadPending = false;
    }
  }

  public getRackPresetLoadDescription(target: PendingRackPresetLoadTarget): string {
    return `The current rack will be replaced by the rack preset "${target.label}".`;
  }

  public async handlePresetFileDrop(payload: RackPresetFileDrop): Promise<void> {
    if (payload.fileCount !== 1) {
      this.showMessage('Drop a single preset file at a time.');
      return;
    }

    let fileText: string;
    try {
      fileText = await payload.file.text();
    } catch {
      this.showMessage('Preset load failed | Unable to read the dropped file.');
      return;
    }

    const parsed = parsePresetFileText(fileText, {
      fileName: payload.file.name,
      mode: 'recover',
    });
    if (parsed.ok === false) {
      this.showMessage(`Preset load failed | ${parsed.message}`);
      return;
    }

    if (parsed.preset.presetType === 'rack') {
      this.showMessage('Rack presets can only be loaded from the rack header loader.');
      return;
    }

    if (!payload.dropZone) {
      this.showMessage('Drop the preset onto the rack to load it.');
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
    this.showPresetActionMessage(result.message, parsed.warning);
  }

  private hasExistingRack(): boolean {
    return this.options.editorSession.state.chainState.devices.length > 0;
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

  private showPresetActionMessage(message: string, warning?: string): void {
    this.showMessage(warning ? `${message} | ${warning}` : message);
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
      this.showMessage(`Preset load failed | ${response.message}`);
      return;
    }

    if (response.payload.presetType === 'device') {
      const result = this.options.editorSession.commands.insertDevicePreset(
        DEFAULT_PRESET_DROP_ZONE,
        response.payload,
      );
      this.showPresetActionMessage(result.message, response.warning);
      return;
    }

    if (response.payload.presetType === 'group') {
      const result = this.options.editorSession.commands.insertGroupPreset(
        DEFAULT_PRESET_DROP_ZONE,
        response.payload,
      );
      this.showPresetActionMessage(result.message, response.warning);
      return;
    }

    const result = this.options.editorSession.commands.applyRackPreset(response.payload);
    this.showPresetActionMessage(result.message, response.warning);
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
