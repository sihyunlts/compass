import type { GeneratorChain } from '../../../shared/model';
import { getRendererDeviceGroup } from '../../../devices';
import { normalizeOptionalId } from '../../../shared/normalize-id';
import { reconcileGeneratorChainModulators } from '../../../core/modulation/routing';
import type { ChainMutationMeta } from '../editor/history-core';
import { blurIfTextEditingElement } from './text-editing';
import { CenterPickerController } from './center-picker-controller';
import { MaskTilePaintController } from './mask-paint-controller';
import { NumericInputInteraction } from './actions/numeric-input-drag';
import {
  applyChainControlChange,
  createChainControlHandlers,
  resolveChainControlMergeKey,
  resetNumericControlToDefault,
} from './chain-controls';

/**
 * Coordinates non-selection rack interactions in the main renderer.
 * Owns control-edit commits and specialized pointer flows such as numeric drag,
 * center picking, and mask painting.
 */
type ChainDevice = GeneratorChain['devices'][number];

interface RackInteractionManagerOptions {
  chainDevices: HTMLElement;
  getChainState: () => GeneratorChain;
  saveChain: (chain: GeneratorChain, meta: ChainMutationMeta) => void;
  scheduleAutoPreview: (delayMs?: number) => void;
  closeContextMenu: () => void;
}

/** Manages pointer and input interactions that mutate device controls. */
export class RackInteractionManager {
  private readonly chainDevices: HTMLElement;

  private readonly getChainState: () => GeneratorChain;

  private readonly saveChain: (chain: GeneratorChain, meta: ChainMutationMeta) => void;

  private readonly scheduleAutoPreview: (delayMs?: number) => void;

  private readonly closeContextMenu: () => void;

  private readonly centerPicker: CenterPickerController;

  private readonly maskTilePaint: MaskTilePaintController;

  private readonly chainControlHandlers: ReturnType<typeof createChainControlHandlers>;

  private readonly numericInputInteraction: NumericInputInteraction;

  constructor(options: RackInteractionManagerOptions) {
    this.chainDevices = options.chainDevices;
    this.getChainState = options.getChainState;
    this.saveChain = options.saveChain;
    this.scheduleAutoPreview = options.scheduleAutoPreview;
    this.closeContextMenu = options.closeContextMenu;
    this.chainControlHandlers = createChainControlHandlers({
      findDeviceById: this.findDeviceById.bind(this),
      getMaskSourceGroupIds: this.getMaskSourceGroupIds.bind(this),
      getMaskSourceGeneratorIds: this.getMaskSourceGeneratorIds.bind(this),
    });
    this.centerPicker = new CenterPickerController({
      findDeviceById: this.findDeviceById.bind(this),
      getCardElement: this.getCardElement.bind(this),
      blurActiveTextEditingElement: this.blurActiveTextEditingElement.bind(this),
      closeContextMenu: this.closeContextMenu,
      scheduleAutoPreview: this.scheduleAutoPreview,
      persistChange: () => {
        this.saveChain(this.getChainState(), {
          kind: 'center-picker-edit',
          label: 'Edit center point',
          finalize: true,
        });
      },
      commitReset: () => {
        this.commitChainChange({
          kind: 'center-picker-edit',
          label: 'Edit center point',
          finalize: true,
        });
      },
    });
    this.maskTilePaint = new MaskTilePaintController({
      findDeviceById: this.findDeviceById.bind(this),
      blurActiveTextEditingElement: this.blurActiveTextEditingElement.bind(this),
      closeContextMenu: this.closeContextMenu,
      scheduleAutoPreview: this.scheduleAutoPreview,
      commitChange: () => {
        this.saveChain(this.getChainState(), {
          kind: 'mask-tile-edit',
          label: 'Paint mask tiles',
          finalize: true,
        });
      },
    });
    this.numericInputInteraction = new NumericInputInteraction({
      onResetInput: this.tryResetNumericControl.bind(this),
    });
  }

  isCenterPickerActive(): boolean {
    return this.centerPicker.isActive();
  }

  syncAfterRender(): void {
    const chain = this.getChainState();
    for (const device of chain.devices) {
      this.centerPicker.syncSelection(device.id);
    }
  }

  handleControlInputOrChange(event: Event): boolean {
    const changed = this.applyChainControlChange(event.target);
    if (!changed) {
      return false;
    }

    const id =
      event.target instanceof HTMLInputElement
      || event.target instanceof HTMLSelectElement
        ? event.target.dataset.id
        : undefined;
    if (id) {
      this.centerPicker.syncSelection(id);
    }

    const mergeKey = resolveChainControlMergeKey(event.target);
    this.commitChainChange(
      {
        kind: 'control-edit',
        label: 'Edit parameter',
        mergeKey,
        finalize: event.type === 'change',
      },
    );
    return true;
  }

  handleChainFocusIn(event: FocusEvent): void {
    this.numericInputInteraction.handleFocusIn(event);
  }

  handleChainKeyDown(event: KeyboardEvent): void {
    this.numericInputInteraction.handleKeyDown(event);
  }

  handleChainPointerDown(event: PointerEvent): boolean {
    if (
      event.button !== 0
      || !event.isPrimary
      || this.numericInputInteraction.isActive()
      || this.centerPicker.isActive()
      || this.maskTilePaint.isActive()
    ) {
      return false;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    if (this.numericInputInteraction.tryStart(event, target)) {
      this.closeContextMenu();
      return true;
    }

    if (this.maskTilePaint.handlePointerDown(event, target)) {
      return true;
    }

    return this.centerPicker.handlePointerDown(event, target);
  }

  handleWindowPointerMove(event: PointerEvent): boolean {
    if (this.maskTilePaint.handlePointerMove(event)) {
      return true;
    }

    if (this.numericInputInteraction.isPointer(event.pointerId)) {
      this.numericInputInteraction.handlePointerMove(event.clientX, event.clientY);
      return true;
    }

    return this.centerPicker.handlePointerMove(event);
  }

  handleWindowPointerUp(event: PointerEvent): boolean {
    if (this.maskTilePaint.handlePointerUp(event)) {
      return true;
    }

    if (this.numericInputInteraction.isPointer(event.pointerId)) {
      this.numericInputInteraction.handlePointerUp(event.timeStamp);
      return true;
    }

    return this.centerPicker.handlePointerUp(event);
  }

  handleWindowPointerCancel(event: PointerEvent): boolean {
    if (this.maskTilePaint.handlePointerCancel(event)) {
      return true;
    }

    if (this.numericInputInteraction.isPointer(event.pointerId)) {
      this.numericInputInteraction.handlePointerCancel();
      return true;
    }

    return this.centerPicker.handlePointerCancel(event);
  }

  handleWindowBlur(): void {
    this.numericInputInteraction.handleWindowBlur();
  }

  handleWindowMouseUp(event: MouseEvent): void {
    this.numericInputInteraction.finalizeFromMouseUp(event.timeStamp);
  }

  handlePointerLockChange(): void {
    this.numericInputInteraction.handlePointerLockChange();
  }

  handleLockedMouseMove(event: MouseEvent): void {
    this.numericInputInteraction.handleLockedMouseMove(event);
  }

  handleDoubleClick(event: MouseEvent): boolean {
    if (event.button !== 0) {
      return false;
    }

    return this.numericInputInteraction.tryResetFromDoubleClick(event.target)
      || this.centerPicker.tryResetFromDoubleClick(event.target);
  }

  handleControlClick(event: MouseEvent): boolean {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.closest('button[data-action][data-id]')) {
      return false;
    }

    if (!this.applyChainControlChange(event.target)) {
      return false;
    }

    this.commitChainChange(
      {
        kind: 'control-edit',
        label: 'Edit parameter',
        mergeKey: resolveChainControlMergeKey(event.target),
        finalize: true,
      },
    );
    return true;
  }

  private blurActiveTextEditingElement(): void {
    blurIfTextEditingElement(document.activeElement);
  }

  private tryResetNumericControl(target: EventTarget | null): boolean {
    if (!resetNumericControlToDefault(
      target,
      this.findDeviceById.bind(this),
      this.chainControlHandlers,
    )) {
      return false;
    }

    this.closeContextMenu();
    return true;
  }

  private applyChainControlChange(target: EventTarget | null): boolean {
    return applyChainControlChange(
      target,
      this.findDeviceById.bind(this),
      this.chainControlHandlers,
    );
  }

  private findDeviceById(id: string): ChainDevice | null {
    return this.getChainState().devices.find((item) => item.id === id) ?? null;
  }

  private getMaskSourceGroupIds(): string[] {
    const groupIds: string[] = [];
    const seen = new Set<string>();

    for (const device of this.getChainState().devices) {
      const groupId = normalizeOptionalId(device.groupId);
      if (!groupId || seen.has(groupId)) {
        continue;
      }

      seen.add(groupId);
      groupIds.push(groupId);
    }

    return groupIds;
  }

  private getMaskSourceGeneratorIds(): string[] {
    return this.getChainState().devices
      .filter((device) =>
        getRendererDeviceGroup(device.kind) === 'generator')
      .map((device) => device.id);
  }

  private commitChainChange(meta: ChainMutationMeta, delayMs?: number): void {
    const chain = this.getChainState();
    reconcileGeneratorChainModulators(chain);
    this.saveChain(chain, meta);
    this.scheduleAutoPreview(delayMs);
  }

  private getCardElement(id: string): HTMLElement | null {
    return this.chainDevices.querySelector<HTMLElement>(`.device-card[data-device-id="${id}"]`);
  }
}
