import type { CompassApi } from '../../shared/contracts/ipc/api';
import type { PresetFile } from '../../shared/presets';
import {
  normalizeAuthoredMetadata,
} from '../../shared/model';
import { resolvePresetNameFromFileName } from '../../shared/presets';
import { getDeviceMessageKey } from '../device-i18n';
import { i18n } from '../i18n.svelte';
import type {
  ContextMenuTarget,
  PresetEntryContextTarget,
} from '../features/context-menu/types';
import type { EditorSession } from '../features/editor/session.svelte';
import {
  resolveCommittedRenameDraft,
  resolveEditableDeviceName,
  resolveEditableGroupName,
} from '../features/rack/rename';
import type { PresetController } from './preset-controller.svelte';

type AuthoredInfoTarget =
  | { kind: 'rack' }
  | { kind: 'device'; deviceId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'preset'; entry: PresetEntryContextTarget };

interface AuthoredInfoControllerState {
  target: AuthoredInfoTarget | null;
  name: string;
  author: string;
  description: string;
  savedAtIso: string | null;
  isPending: boolean;
}

interface AuthoredInfoControllerOptions {
  bridgeClient: CompassApi;
  editorSession: EditorSession;
  presetController: PresetController;
  showMessage: (message: string) => void;
}

const resolvePresetMetadata = (
  preset: PresetFile,
): { author?: string; description?: string } | undefined => {
  if (preset.presetType === 'device') {
    return preset.device.metadata;
  }
  if (preset.presetType === 'group') {
    return preset.group.metadata;
  }
  return preset.chain.metadata;
};

class AuthoredInfoController {
  public readonly state: AuthoredInfoControllerState = $state({
    target: null,
    name: '',
    author: '',
    description: '',
    savedAtIso: null,
    isPending: false,
  });

  private loadToken = 0;

  public constructor(private readonly options: AuthoredInfoControllerOptions) {}

  public get title(): string {
    if (this.state.target?.kind === 'rack') {
      return i18n.t('info.rackTitle');
    }
    if (this.state.target?.kind === 'device') {
      return i18n.t('info.deviceTitle');
    }
    if (this.state.target?.kind === 'group') {
      return i18n.t('info.groupTitle');
    }
    return i18n.t('info.presetTitle');
  }

  public get readOnly(): boolean {
    return this.state.target?.kind === 'preset'
      && this.state.target.entry.source === 'bundled';
  }

  public openRack = (): void => {
    this.loadToken += 1;
    const { presetController, editorSession } = this.options;
    this.assignDraft(
      presetController.state.currentRackDisplayName,
      editorSession.state.chainState.metadata,
      presetController.state.currentRackSavedAtIso,
    );
    this.state.target = { kind: 'rack' };
  };

  public openFromContextTarget = (target: ContextMenuTarget): void => {
    if (target.kind === 'devices' && target.deviceIds.length === 1) {
      this.openDevice(target.deviceIds[0]);
      return;
    }
    if (target.kind === 'group') {
      this.openGroup(target.groupId);
      return;
    }
    if (target.kind === 'preset-entry' && target.entryKind === 'file') {
      void this.openPreset(target);
    }
  };

  public close = (): void => {
    if (this.state.isPending) {
      return;
    }
    this.loadToken += 1;
    this.state.target = null;
  };

  public confirm = async (): Promise<void> => {
    const target = this.state.target;
    if (!target || this.state.isPending) {
      return;
    }
    if (this.readOnly) {
      this.close();
      return;
    }

    this.state.isPending = true;
    try {
      if (target.kind === 'rack') {
        const updated = await this.options.presetController.updateCurrentRackInfo(
          this.state.name,
          normalizeAuthoredMetadata({
            author: this.state.author,
            description: this.state.description,
          }),
        );
        if (!updated) {
          return;
        }
      } else if (target.kind === 'device') {
        this.updateDevice(target.deviceId);
      } else if (target.kind === 'group') {
        this.updateGroup(target.groupId);
      } else if (!await this.updatePreset(target.entry)) {
        return;
      }

      this.state.target = null;
    } catch {
      this.showSaveError();
    } finally {
      this.state.isPending = false;
    }
  };

  private openDevice(deviceId: string): void {
    const device = this.options.editorSession.state.chainState.devices
      .find((item) => item.id === deviceId);
    if (!device) {
      return;
    }

    this.loadToken += 1;
    this.assignDraft(
      resolveEditableDeviceName(
        device,
        (kind) => i18n.t(getDeviceMessageKey(kind)),
      ),
      device.metadata,
      null,
    );
    this.state.target = { kind: 'device', deviceId };
  }

  private openGroup(groupId: string): void {
    const chain = this.options.editorSession.state.chainState;
    const group = chain.groupStateById[groupId];
    if (!group) {
      return;
    }

    this.loadToken += 1;
    this.assignDraft(
      resolveEditableGroupName(
        groupId,
        chain.groupStateById,
        i18n.t('group.defaultTemplate'),
      ),
      group.metadata,
      null,
    );
    this.state.target = { kind: 'group', groupId };
  }

  private async openPreset(entry: PresetEntryContextTarget): Promise<void> {
    const token = ++this.loadToken;
    let response: Awaited<ReturnType<CompassApi['readPresetEntry']>>;
    try {
      response = await this.options.bridgeClient.readPresetEntry({
        presetType: entry.presetType,
        source: entry.source,
        relativePath: [...entry.relativePath],
      });
    } catch {
      if (token === this.loadToken) {
        this.showLoadError();
      }
      return;
    }
    if (token !== this.loadToken) {
      return;
    }
    if (response.status === 'error') {
      this.showLoadError();
      return;
    }
    if (
      response.filePath !== null
      && response.payload.presetType === 'rack'
      && response.filePath === this.options.presetController.state.currentRackFilePath
    ) {
      this.openRack();
      return;
    }

    const fileName = entry.relativePath.at(-1) ?? '';
    this.assignDraft(
      resolvePresetNameFromFileName(fileName, entry.presetType) ?? fileName,
      resolvePresetMetadata(response.payload),
      response.payload.savedAtIso,
    );
    this.state.target = {
      kind: 'preset',
      entry: {
        ...entry,
        relativePath: [...entry.relativePath],
      },
    };
  }

  private updateDevice(deviceId: string): void {
    const chain = this.options.editorSession.state.chainState;
    this.options.editorSession.commands.updateDeviceInfo(deviceId, {
      name: resolveCommittedRenameDraft({
        renameTarget: { kind: 'device', id: deviceId },
        renameDraft: this.state.name,
        devices: chain.devices,
        resolveDefaultDeviceName: (kind) => i18n.t(getDeviceMessageKey(kind)),
      }),
      author: this.state.author,
      description: this.state.description,
    });
  }

  private updateGroup(groupId: string): void {
    const chain = this.options.editorSession.state.chainState;
    this.options.editorSession.commands.updateGroupInfo(groupId, {
      name: resolveCommittedRenameDraft({
        renameTarget: { kind: 'group', id: groupId },
        renameDraft: this.state.name,
        devices: chain.devices,
        resolveDefaultDeviceName: (kind) => i18n.t(getDeviceMessageKey(kind)),
        defaultGroupNameTemplate: i18n.t('group.defaultTemplate'),
      }),
      author: this.state.author,
      description: this.state.description,
    });
  }

  private async updatePreset(entry: PresetEntryContextTarget): Promise<boolean> {
    const metadata = normalizeAuthoredMetadata({
      author: this.state.author,
      description: this.state.description,
    });
    return this.options.presetController.updatePresetInfo(
      entry,
      this.state.name,
      metadata,
    );
  }

  private assignDraft(
    name: string,
    metadata: { author?: string; description?: string } | undefined,
    savedAtIso: string | null,
  ): void {
    this.state.name = name;
    this.state.author = metadata?.author ?? '';
    this.state.description = metadata?.description ?? '';
    this.state.savedAtIso = savedAtIso;
  }

  private showLoadError(): void {
    this.options.showMessage(i18n.t('status.presetInfoLoadFailed'));
  }

  private showSaveError(): void {
    this.options.showMessage(i18n.t('status.presetInfoSaveFailed'));
  }
}

export const createAuthoredInfoController = (
  options: AuthoredInfoControllerOptions,
): AuthoredInfoController => new AuthoredInfoController(options);
