import type { GeneratorChain } from '../../../shared/model';
import { normalizeOptionalId } from '../../../shared/normalize-id';
import { reconcileGeneratorChainModulators } from '../../../core/modulation/routing';
import type { ChainMutationMeta } from '../../state/chain-history';
import { blurIfTextEditingElement } from '../../features/rack/text-editing';
import { NumericInputInteraction } from '../../features/rack/actions/numeric-input-drag';
import {
  applyCenterPickerPointerMove,
  applyCenterPickerPosition,
  clearCenterPickerPointerState,
  createCenterPickerSessionState,
  isCenterPickerActive,
  isCenterPickerPointer,
  resetCenterPickerToMidpoint,
  resolveCenterPickerSurface,
  startCenterPickerSession,
  syncCenterPickerSelection,
} from '../../features/rack/actions/center-picker';
import {
  applyChainControlChange,
  createChainControlHandlers,
  resetNumericControlToDefault,
} from './controls';
import {
  applyMaskTileFromPoint,
  clearMaskTilePointerState,
  createMaskTilePaintState,
  isMaskTilePaintActive,
  isMaskTilePointer,
  tryStartMaskTilePaint,
} from '../../features/rack/actions/mask-paint';

/**
 * Coordinates non-selection rack interactions in the main renderer.
 * Owns control-edit commits and specialized pointer flows such as numeric drag,
 * center picking, and mask painting.
 */
type ChainDevice = GeneratorChain['devices'][number];

interface DeviceRackControllerOptions {
  chainDevices: HTMLElement;
  getChainState: () => GeneratorChain;
  saveChain: (chain: GeneratorChain, meta: ChainMutationMeta) => void;
  scheduleAutoPreview: (delayMs?: number) => void;
  closeContextMenu: () => void;
}

/** Manages pointer and input interactions that mutate device controls. */
export class DeviceRackController {
  private readonly chainDevices: HTMLElement;

  private readonly getChainState: () => GeneratorChain;

  private readonly saveChain: (chain: GeneratorChain, meta: ChainMutationMeta) => void;

  private readonly scheduleAutoPreview: (delayMs?: number) => void;

  private readonly closeContextMenu: () => void;

  private readonly centerPickerState = createCenterPickerSessionState();

  private readonly maskTileState = createMaskTilePaintState();

  private readonly chainControlHandlers: ReturnType<typeof createChainControlHandlers>;

  private readonly numericInputInteraction: NumericInputInteraction;

  constructor(options: DeviceRackControllerOptions) {
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
    this.numericInputInteraction = new NumericInputInteraction({
      onResetInput: this.tryResetNumericControl.bind(this),
    });
  }

  isCenterPickerActive(): boolean {
    return isCenterPickerActive(this.centerPickerState);
  }

  syncAfterRender(): void {
    const chain = this.getChainState();
    for (const device of chain.devices) {
      this.syncCenterPickerSelection(device.id);
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
      this.syncCenterPickerSelection(id);
    }

    const mergeKey = this.resolveControlMergeKey(event.target);
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
      || isCenterPickerActive(this.centerPickerState)
      || isMaskTilePaintActive(this.maskTileState)
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

    if (this.tryStartMaskTilePaint(event, target)) {
      return true;
    }

    const centerPickerSurface = resolveCenterPickerSurface(target);
    if (!centerPickerSurface) {
      return false;
    }

    this.blurActiveTextEditingElement();
    this.closeContextMenu();
    startCenterPickerSession(this.centerPickerState, event.pointerId, centerPickerSurface);
    if (this.applyCenterPickerPosition(centerPickerSurface, event.clientX, event.clientY)) {
      this.centerPickerState.didChange = true;
      this.scheduleAutoPreview();
    }
    return true;
  }

  handleWindowPointerMove(event: PointerEvent): boolean {
    if (isMaskTilePointer(this.maskTileState, event.pointerId) && this.maskTileState.gridEl) {
      if (applyMaskTileFromPoint(
        this.maskTileState,
        event.clientX,
        event.clientY,
        this.findDeviceById.bind(this),
      )) {
        this.maskTileState.didChange = true;
        this.scheduleAutoPreview();
      }
      return true;
    }

    if (this.numericInputInteraction.isPointer(event.pointerId)) {
      this.numericInputInteraction.handlePointerMove(event.clientX, event.clientY);
      return true;
    }

    if (!isCenterPickerPointer(this.centerPickerState, event.pointerId) || !this.centerPickerState.surfaceEl) {
      return false;
    }

    if (applyCenterPickerPointerMove(
      this.centerPickerState,
      event.pointerId,
      event.clientX,
      event.clientY,
      this.getCenterPickerDeps(),
    )) {
      this.centerPickerState.didChange = true;
      this.scheduleAutoPreview();
    }
    return true;
  }

  handleWindowPointerUp(event: PointerEvent): boolean {
    if (isMaskTilePointer(this.maskTileState, event.pointerId)) {
      this.clearMaskTilePointerState(true);
      return true;
    }

    if (this.numericInputInteraction.isPointer(event.pointerId)) {
      this.numericInputInteraction.handlePointerUp(event.timeStamp);
      return true;
    }

    if (!isCenterPickerPointer(this.centerPickerState, event.pointerId)) {
      return false;
    }

    this.clearCenterPickerPointerState(true);
    return true;
  }

  handleWindowPointerCancel(event: PointerEvent): boolean {
    if (isMaskTilePointer(this.maskTileState, event.pointerId)) {
      this.clearMaskTilePointerState(false);
      return true;
    }

    if (this.numericInputInteraction.isPointer(event.pointerId)) {
      this.numericInputInteraction.handlePointerCancel();
      return true;
    }

    if (!isCenterPickerPointer(this.centerPickerState, event.pointerId)) {
      return false;
    }

    this.clearCenterPickerPointerState(false);
    return true;
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

    return this.tryResetControlFromDoubleClick(event.target);
  }

  private blurActiveTextEditingElement(): void {
    blurIfTextEditingElement(document.activeElement);
  }

  private getCenterPickerDeps() {
    return {
      findDeviceById: this.findDeviceById.bind(this),
      getCardElement: this.getCardElement.bind(this),
    };
  }

  private syncCenterPickerSelection(deviceId: string): void {
    syncCenterPickerSelection(deviceId, this.getCenterPickerDeps());
  }

  private applyCenterPickerPosition(
    surface: HTMLElement,
    clientX: number,
    clientY: number,
  ): boolean {
    return applyCenterPickerPosition(surface, clientX, clientY, this.getCenterPickerDeps());
  }

  private resetCenterPickerToMidpoint(surface: HTMLElement): boolean {
    return resetCenterPickerToMidpoint(surface, this.getCenterPickerDeps());
  }

  private tryStartMaskTilePaint(event: PointerEvent, target: HTMLElement): boolean {
    return tryStartMaskTilePaint(this.maskTileState, event, target, {
      findDeviceById: this.findDeviceById.bind(this),
      blurActiveTextEditingElement: this.blurActiveTextEditingElement.bind(this),
      closeContextMenu: this.closeContextMenu,
      scheduleAutoPreview: this.scheduleAutoPreview,
    });
  }

  private clearMaskTilePointerState(persist: boolean): void {
    clearMaskTilePointerState(this.maskTileState, persist, () => {
      this.saveChain(this.getChainState(), {
        kind: 'mask-tile-edit',
        label: 'Paint mask tiles',
        finalize: true,
      });
    });
  }

  private clearCenterPickerPointerState(persist: boolean): void {
    clearCenterPickerPointerState(this.centerPickerState, persist, () => {
      this.saveChain(this.getChainState(), {
        kind: 'center-picker-edit',
        label: 'Edit center point',
        finalize: true,
      });
    });
  }

  private tryResetControlFromDoubleClick(target: EventTarget | null): boolean {
    return this.numericInputInteraction.tryResetFromDoubleClick(target)
      || this.tryResetCenterPickerSurface(target);
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

  private tryResetCenterPickerSurface(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const centerPickerSurface = resolveCenterPickerSurface(target);
    if (!centerPickerSurface) {
      return false;
    }

    this.blurActiveTextEditingElement();
    this.closeContextMenu();
    if (this.resetCenterPickerToMidpoint(centerPickerSurface)) {
      this.commitChainChange({
        kind: 'center-picker-edit',
        label: 'Edit center point',
        finalize: true,
      });
    }
    return true;
  }

  private applyChainControlChange(target: EventTarget | null): boolean {
    return applyChainControlChange(
      target,
      this.findDeviceById.bind(this),
      this.chainControlHandlers,
    );
  }

  private resolveControlMergeKey(target: EventTarget | null): string | null {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return null;
    }

    const action = target.dataset.action?.trim();
    const id = target.dataset.id?.trim();
    if (!action || !id) {
      return null;
    }

    const param = target.dataset.param?.trim();
    return param
      ? `control|${action}|${id}|${param}`
      : `control|${action}|${id}`;
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
        device.kind === 'waterdrop' || device.kind === 'scanner' || device.kind === 'spiral')
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
