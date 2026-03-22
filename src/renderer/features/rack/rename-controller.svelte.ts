import { tick } from 'svelte';
import type { GeneratorChain, GeneratorDeviceNode } from '../../../shared/model';
import {
  attachFloatingLayerDismissHandlers,
  resolveAdjacentFloatingLayerPosition,
} from './floating-layer';
import {
  isRenamingDevice,
  isRenamingGroup,
  resolveCommittedRenameDraft,
  resolveDeviceDisplayName,
  resolveDeviceRenameValue,
  resolveEditableDeviceName,
  resolveEditableGroupName,
  resolveGroupDisplayName,
  resolveRenamePopoverTarget,
  type RackRenameTarget,
} from './rename';

type RackRenamePopoverHandle = {
  measure(): { width: number; height: number };
  focusSelect(): void;
  containsTarget(eventTarget: EventTarget | null): boolean;
};

interface RackRenameControllerOptions {
  getChainDevices: () => HTMLElement | null;
  getDevices: () => readonly GeneratorDeviceNode[];
  getGroupStateById: () => GeneratorChain['groupStateById'];
  getOrderedGroupIds: () => readonly string[];
  getCollapsedSet: () => ReadonlySet<string>;
  getDeviceDisplayNameById: () => Record<string, string>;
  getGroupDisplayNameById: () => Record<string, string>;
  closeContextMenu: () => void;
  renameDevice: (deviceId: string, rawName: string) => boolean;
  renameGroup: (groupId: string, rawName: string) => boolean;
}

const RENAME_POPOVER_GAP_PX = 8;
const RENAME_POPOVER_FALLBACK_WIDTH_PX = 164;
const RENAME_POPOVER_FALLBACK_HEIGHT_PX = 42;

/** Owns rename target state and floating popover positioning for the rack. */
export class RackRenameController {
  public target = $state<RackRenameTarget | null>(null);

  public draft = $state('');

  public popoverPosition = $state<{ x: number; y: number } | null>(null);

  private readonly options: RackRenameControllerOptions;

  private popover: RackRenamePopoverHandle | null = null;

  private skipBlur = false;

  public constructor(options: RackRenameControllerOptions) {
    this.options = options;
  }

  public mount(): () => void {
    return attachFloatingLayerDismissHandlers({
      isActive: () => this.getPopoverTarget() !== null,
      containsEventTarget: (eventTarget) => this.popover?.containsTarget(eventTarget) ?? false,
      onPointerDownOutside: () => {
        this.commit();
      },
      onResize: () => {
        this.commit();
      },
    });
  }

  public setPopover(popover: RackRenamePopoverHandle | null): void {
    this.popover = popover;
  }

  public getPopoverTarget(): RackRenameTarget | null {
    return resolveRenamePopoverTarget(this.target, this.options.getCollapsedSet());
  }

  public resolvePopoverAriaLabel(): string {
    const target = this.getPopoverTarget();
    if (!target) {
      return '';
    }

    const label = target.kind === 'device'
      ? resolveDeviceDisplayName(this.options.getDeviceDisplayNameById(), target.id)
      : resolveGroupDisplayName(this.options.getGroupDisplayNameById(), target.id);
    return `Rename ${label}`;
  }

  public isRenamingDevice(deviceId: string): boolean {
    return isRenamingDevice(this.target, deviceId);
  }

  public isRenamingGroup(groupId: string): boolean {
    return isRenamingGroup(this.target, groupId);
  }

  public resolveDeviceRenameValue(deviceId: string): string {
    return resolveDeviceRenameValue(this.target, this.draft, deviceId);
  }

  public handleInput(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    this.draft = target.value;
  }

  public handleInputBlur(): void {
    if (this.skipBlur) {
      return;
    }

    this.commit();
  }

  public handleInputKeyDown(event: KeyboardEvent): void {
    event.stopPropagation();

    if (event.key === 'Enter') {
      event.preventDefault();
      this.commit();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
    }
  }

  public startRenamingDevice(deviceId: string): boolean {
    const device = this.options.getDevices()
      .find((item: GeneratorDeviceNode) => item.id === deviceId);
    if (!device) {
      return false;
    }

    return this.openEditor(
      { kind: 'device', id: deviceId },
      resolveEditableDeviceName(device, this.options.getDeviceDisplayNameById()),
    );
  }

  public startRenamingGroup(groupId: string): boolean {
    if (!this.options.getOrderedGroupIds().includes(groupId)) {
      return false;
    }

    return this.openEditor(
      { kind: 'group', id: groupId },
      resolveEditableGroupName(groupId, this.options.getGroupStateById()),
    );
  }

  public handleRackScroll(): void {
    if (!this.getPopoverTarget()) {
      return;
    }

    this.syncPopoverPosition();
  }

  public reconcileTarget(): void {
    if (!this.target) {
      this.popoverPosition = null;
      return;
    }

    const targetExists = this.target.kind === 'device'
      ? this.options.getDevices()
        .some((device: GeneratorDeviceNode) => device.id === this.target?.id)
      : this.options.getOrderedGroupIds().includes(this.target.id);

    if (!targetExists) {
      this.clearState();
    }
  }

  public syncPopoverTarget(): void {
    const target = this.getPopoverTarget();
    if (!target) {
      this.popoverPosition = null;
      return;
    }

    void tick().then(() => {
      this.syncPopoverPosition(target);
    });
  }

  private clearState(): void {
    this.target = null;
    this.draft = '';
    this.popover = null;
    this.popoverPosition = null;
  }

  private releaseBlurGuard(): void {
    window.setTimeout(() => {
      this.skipBlur = false;
    }, 0);
  }

  private focusInput(): void {
    void tick().then(() => {
      this.popover?.focusSelect();
    });
  }

  private resolvePopoverAnchor(target: RackRenameTarget): HTMLElement | null {
    const chainDevices = this.options.getChainDevices();
    if (!chainDevices) {
      return null;
    }

    return target.kind === 'device'
      ? chainDevices.querySelector<HTMLElement>(
        `.device-card[data-device-id="${target.id}"] .device-head`,
      )
      : chainDevices.querySelector<HTMLElement>(
        `.device-group[data-group-id="${target.id}"] .group-rail-left`,
      );
  }

  private syncPopoverPosition(target: RackRenameTarget | null = this.getPopoverTarget()): void {
    if (!target) {
      this.popoverPosition = null;
      return;
    }

    const anchor = this.resolvePopoverAnchor(target);
    if (!anchor) {
      this.popoverPosition = null;
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const popoverSize = this.popover?.measure();
    this.popoverPosition = resolveAdjacentFloatingLayerPosition(
      anchorRect,
      {
        width: popoverSize?.width || RENAME_POPOVER_FALLBACK_WIDTH_PX,
        height: popoverSize?.height || RENAME_POPOVER_FALLBACK_HEIGHT_PX,
      },
      {
        gapPx: RENAME_POPOVER_GAP_PX,
      },
    );
  }

  private commit(): boolean {
    if (!this.target) {
      return false;
    }

    this.skipBlur = true;
    const committedDraft = resolveCommittedRenameDraft({
      renameTarget: this.target,
      renameDraft: this.draft,
      devices: this.options.getDevices(),
      groupStateById: this.options.getGroupStateById(),
      deviceDisplayNameById: this.options.getDeviceDisplayNameById(),
    });
    const didRename = this.target.kind === 'device'
      ? this.options.renameDevice(this.target.id, committedDraft)
      : this.options.renameGroup(this.target.id, committedDraft);
    this.clearState();
    this.releaseBlurGuard();
    return didRename;
  }

  private cancel(): void {
    if (!this.target) {
      return;
    }

    this.skipBlur = true;
    this.clearState();
    this.releaseBlurGuard();
  }

  private openEditor(target: RackRenameTarget, nextDraft: string): boolean {
    if (
      this.target?.kind === target.kind
      && this.target.id === target.id
      && this.draft === nextDraft
    ) {
      this.focusInput();
      return true;
    }

    if (this.target) {
      this.commit();
    }

    this.target = target;
    this.draft = nextDraft;
    this.options.closeContextMenu();
    this.syncPopoverPosition(resolveRenamePopoverTarget(target, this.options.getCollapsedSet()));
    this.focusInput();
    return true;
  }
}

export const createRackRenameController = (
  options: RackRenameControllerOptions,
): RackRenameController => new RackRenameController(options);
