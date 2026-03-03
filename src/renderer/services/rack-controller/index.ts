import type { GeneratorChain } from '../../../shared/types';
import { normalizeOptionalId } from '../../../shared/normalize-id';
import { reconcileGeneratorChainModulators } from '../../../core/modulation/routing';
import type { ContextMenuTarget } from '../../state/context-menu';
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
} from './center-picker';
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
} from './mask-tiles';

/**
 * Coordinates rack interactions in the main renderer.
 * Owns selection, context-menu targeting, center-picker/mask pointer flows,
 * and change commits for chain persistence and preview refresh.
 */
type ChainDevice = GeneratorChain['devices'][number];

interface SelectionState {
  selectedDeviceIds: Set<string>;
  lastSelectedDeviceId: string | null;
  selectedGroupIds: Set<string>;
  lastSelectedGroupId: string | null;
}

interface NumberDragState {
  pointerId: number | null;
  inputEl: HTMLInputElement | null;
  lastPointerX: number;
  lastPointerY: number;
  didMove: boolean;
  dragRawValue: number;
  step: number;
  min: number | null;
  max: number | null;
  decimals: number;
  sensitivity: number;
  wrapMode: boolean;
  isPointerLocked: boolean;
}

interface DeviceRackControllerOptions {
  chainDevices: HTMLElement;
  interactiveElementSelector: string;
  getChainState: () => GeneratorChain;
  saveChain: (chain: GeneratorChain) => void;
  scheduleAutoPreview: (delayMs?: number) => void;
  openContextMenu: (clientX: number, clientY: number, target: ContextMenuTarget) => void;
  closeContextMenu: () => void;
}

/** Selected group metadata used by group-level actions. */
export interface GroupSelectionContext {
  groupId: string;
  memberDeviceIds: string[];
}

type PointerDownSelectionTarget =
  | { kind: 'device'; id: string }
  | { kind: 'group'; id: string };

const createSelectionState = (): SelectionState => ({
  selectedDeviceIds: new Set<string>(),
  lastSelectedDeviceId: null,
  selectedGroupIds: new Set<string>(),
  lastSelectedGroupId: null,
});

const createNumberDragState = (): NumberDragState => ({
  pointerId: null,
  inputEl: null,
  lastPointerX: 0,
  lastPointerY: 0,
  didMove: false,
  dragRawValue: 0,
  step: 1,
  min: null,
  max: null,
  decimals: 0,
  sensitivity: 1,
  wrapMode: false,
  isPointerLocked: false,
});

const getOrderedSelectedDeviceIds = (
  state: SelectionState,
  orderedIds: readonly string[],
): string[] => orderedIds.filter((id) => state.selectedDeviceIds.has(id));

const setSelectedDeviceIds = (
  state: SelectionState,
  ids: Iterable<string>,
  anchorId: string | null,
  validIds: ReadonlySet<string>,
): void => {
  const nextSelection = new Set<string>();
  for (const id of ids) {
    if (validIds.has(id)) {
      nextSelection.add(id);
    }
  }

  state.selectedDeviceIds = nextSelection;
  if (anchorId && validIds.has(anchorId)) {
    state.lastSelectedDeviceId = anchorId;
  } else if (state.selectedDeviceIds.size === 0) {
    state.lastSelectedDeviceId = null;
  }
};

const getSelectedGroupIds = (state: SelectionState): string[] =>
  [...state.selectedGroupIds];

const setSelectedGroupIds = (
  state: SelectionState,
  ids: Iterable<string>,
  validGroupIds: ReadonlySet<string>,
): void => {
  const nextSelection = new Set<string>();
  let lastValidId: string | null = null;
  for (const id of ids) {
    if (!validGroupIds.has(id)) {
      continue;
    }
    nextSelection.add(id);
    lastValidId = id;
  }

  state.selectedGroupIds = nextSelection;
  if (state.lastSelectedGroupId && nextSelection.has(state.lastSelectedGroupId)) {
    return;
  }
  state.lastSelectedGroupId = lastValidId;
};

const toggleSelectedGroupId = (
  state: SelectionState,
  id: string,
  validGroupIds: ReadonlySet<string>,
): void => {
  if (!validGroupIds.has(id)) {
    return;
  }

  const nextSelection = new Set(state.selectedGroupIds);
  if (nextSelection.has(id)) {
    nextSelection.delete(id);
    if (state.lastSelectedGroupId === id) {
      const [lastId] = [...nextSelection].slice(-1);
      state.lastSelectedGroupId = lastId ?? null;
    }
  } else {
    nextSelection.add(id);
    state.lastSelectedGroupId = id;
  }

  state.selectedGroupIds = nextSelection;
};

const reconcileSelectedDeviceIds = (
  state: SelectionState,
  validIds: ReadonlySet<string>,
  validGroupIds: ReadonlySet<string>,
): void => {
  state.selectedDeviceIds = new Set(
    [...state.selectedDeviceIds].filter((id) => validIds.has(id)),
  );

  if (state.lastSelectedDeviceId && !validIds.has(state.lastSelectedDeviceId)) {
    state.lastSelectedDeviceId = null;
  }

  state.selectedGroupIds = new Set(
    [...state.selectedGroupIds].filter((id) => validGroupIds.has(id)),
  );

  if (state.lastSelectedGroupId && !state.selectedGroupIds.has(state.lastSelectedGroupId)) {
    state.lastSelectedGroupId = null;
  }
};

const renderSelectedDeviceCards = (
  chainDevices: HTMLElement,
  selectedDeviceIds: ReadonlySet<string>,
  selectedGroupIds: ReadonlySet<string>,
): void => {
  for (const groupEl of chainDevices.querySelectorAll<HTMLElement>('.device-group.is-rack[data-group-id]')) {
    const groupId = groupEl.dataset.groupId ?? null;
    groupEl.classList.toggle('is-selected', !!groupId && selectedGroupIds.has(groupId));
  }

  for (const card of chainDevices.querySelectorAll<HTMLElement>('.device-card[data-device-id]')) {
    const id = card.dataset.deviceId;
    card.classList.toggle('is-selected', !!id && selectedDeviceIds.has(id));
  }
};

const buildSelectionRange = (
  orderedIds: readonly string[],
  fromId: string,
  toId: string,
): string[] => {
  const fromIndex = orderedIds.indexOf(fromId);
  const toIndex = orderedIds.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0) {
    return [toId];
  }

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return orderedIds.slice(start, end + 1);
};

const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'range',
  'button',
  'submit',
  'reset',
]);

const isRackNumericInput = (target: EventTarget | null): target is HTMLInputElement =>
  target instanceof HTMLInputElement
  && target.type === 'number'
  && !!target.dataset.action
  && !!target.dataset.id;

const NUMERIC_RESET_DOUBLE_CLICK_WINDOW_MS = 400;

const isTextEditingElement = (element: Element | null): boolean => {
  if (!element) {
    return false;
  }

  if (
    element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
    || (element instanceof HTMLElement && element.isContentEditable)
  ) {
    return true;
  }

  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }

  return false;
};

const blurIfTextEditingElement = (element: Element | null): boolean => {
  if (!isTextEditingElement(element)) {
    return false;
  }

  if (element instanceof HTMLElement) {
    element.blur();
    return true;
  }

  return false;
};

/** Manages pointer, keyboard, and selection behavior for the device rack surface. */
export class DeviceRackController {
  private readonly chainDevices: HTMLElement;

  private readonly interactiveElementSelector: string;

  private readonly getChainState: () => GeneratorChain;

  private readonly saveChain: (chain: GeneratorChain) => void;

  private readonly scheduleAutoPreview: (delayMs?: number) => void;

  private readonly openContextMenu: (
    clientX: number,
    clientY: number,
    target: ContextMenuTarget,
  ) => void;

  private readonly closeContextMenu: () => void;

  private readonly selectionState = createSelectionState();

  private suppressDeviceSelectionClick = false;

  private readonly centerPickerState = createCenterPickerSessionState();

  private readonly maskTileState = createMaskTilePaintState();

  private readonly numberDragState = createNumberDragState();

  private overwriteOnTypeInput: HTMLInputElement | null = null;

  private lastNumberClickInput: HTMLInputElement | null = null;

  private lastNumberClickAt = 0;

  private readonly chainControlHandlers: ReturnType<typeof createChainControlHandlers>;

  constructor(options: DeviceRackControllerOptions) {
    this.chainDevices = options.chainDevices;
    this.interactiveElementSelector = options.interactiveElementSelector;
    this.getChainState = options.getChainState;
    this.saveChain = options.saveChain;
    this.scheduleAutoPreview = options.scheduleAutoPreview;
    this.openContextMenu = options.openContextMenu;
    this.closeContextMenu = options.closeContextMenu;
    this.chainControlHandlers = createChainControlHandlers({
      findDeviceById: this.findDeviceById.bind(this),
      getMaskSourceGroupIds: this.getMaskSourceGroupIds.bind(this),
      getMaskSourceGeneratorIds: this.getMaskSourceGeneratorIds.bind(this),
    });
  }

  getOrderedSelectedDeviceIds(): string[] {
    return getOrderedSelectedDeviceIds(this.selectionState, this.getChainDeviceOrderIds());
  }

  selectDeviceIds(ids: Iterable<string>, anchorId: string | null): void {
    this.setSelectedDeviceIds(ids, anchorId);
  }

  getSelectedGroupIds(): string[] {
    return getSelectedGroupIds(this.selectionState);
  }

  getSelectedGroupContexts(): GroupSelectionContext[] {
    const selectedGroupIds = this.getSelectedGroupIds();
    const contexts: GroupSelectionContext[] = [];
    for (const groupId of selectedGroupIds) {
      const memberDeviceIds = this.getGroupMemberIds(groupId);
      if (memberDeviceIds.length === 0) {
        continue;
      }
      contexts.push({ groupId, memberDeviceIds });
    }
    return contexts;
  }

  isCenterPickerActive(): boolean {
    return isCenterPickerActive(this.centerPickerState);
  }

  markSuppressSelectionClickOnce(): void {
    this.suppressDeviceSelectionClick = true;
  }

  syncAfterRender(): void {
    this.reconcileSelectedDeviceIds();
    this.renderSelectedDeviceCards();
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
    this.commitChainChange();
    return true;
  }

  handleChainFocusIn(event: FocusEvent): void {
    const target = event.target;
    if (!isRackNumericInput(target) || target.disabled || target.readOnly) {
      return;
    }
    this.overwriteOnTypeInput = target;
    delete target.dataset.keyboardEditing;
  }

  handleChainKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    if (!isRackNumericInput(target)) {
      return;
    }
    const isTypingKey = !(
      event.defaultPrevented
      || event.isComposing
      || event.ctrlKey
      || event.metaKey
      || event.altKey
      || event.key.length !== 1
      || !/[0-9+\-eE.]/.test(event.key)
    );
    if (!isTypingKey) {
      return;
    }

    target.dataset.keyboardEditing = 'true';
    if (this.overwriteOnTypeInput === target) {
      this.overwriteOnTypeInput = null;
      target.value = '';
    }
  }

  handleChainPointerDown(event: PointerEvent): boolean {
    if (
      event.button !== 0
      || !event.isPrimary
      || this.isNumberDragActive()
      || isCenterPickerActive(this.centerPickerState)
      || isMaskTilePaintActive(this.maskTileState)
    ) {
      return false;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    if (this.tryStartNumberInputDrag(event, target)) {
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

    if (this.isNumberDragPointer(event.pointerId)) {
      if (this.numberDragState.isPointerLocked) {
        return true;
      }
      this.applyNumberInputDrag(event.clientX, event.clientY);
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
    if (this.isNumberDragPointer(event.pointerId)) {
      this.finalizeNumberDragInteraction(event.timeStamp);
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
    if (this.isNumberDragPointer(event.pointerId)) {
      this.clearNumberDragState();
      this.clearNumberClickState();
      return true;
    }
    if (!isCenterPickerPointer(this.centerPickerState, event.pointerId)) {
      return false;
    }
    this.clearCenterPickerPointerState(false);
    return true;
  }

  handleWindowBlur(): void {
    if (this.isNumberDragActive()) {
      this.clearNumberDragState();
    }
    this.clearNumberClickState();
  }

  handleWindowMouseUp(event: MouseEvent): void {
    if (this.isNumberDragActive()) {
      this.finalizeNumberDragInteraction(event.timeStamp);
    }
  }

  handlePointerLockChange(): void {
    const input = this.numberDragState.inputEl;
    const wasPointerLocked = this.numberDragState.isPointerLocked;
    const isPointerLocked = !!input && document.pointerLockElement === input;
    this.numberDragState.isPointerLocked = isPointerLocked;
    if (wasPointerLocked && !isPointerLocked && this.isNumberDragActive()) {
      this.clearNumberDragState();
      this.clearNumberClickState();
    }
  }

  handleLockedMouseMove(event: MouseEvent): void {
    if (!this.isNumberDragActive() || !this.numberDragState.isPointerLocked) {
      return;
    }
    this.applyNumberInputDragDelta(event.movementX, -event.movementY);
  }

  handleContextMenu(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      this.closeContextMenu();
      return;
    }

    const railContext = this.resolveGroupRailContext(target);
    if (railContext) {
      event.preventDefault();
      if (!this.selectionState.selectedGroupIds.has(railContext.groupId)) {
        this.clearSelection();
        this.setSelectedGroupIds([railContext.groupId]);
      }
      this.openContextMenu(event.clientX, event.clientY, {
        kind: 'group',
        groupId: railContext.groupId,
        memberDeviceIds: railContext.memberDeviceIds,
      });
      return;
    }

    if (target.closest(this.interactiveElementSelector)) {
      this.closeContextMenu();
      return;
    }

    const cardId = this.resolveHeaderCardId(target);
    if (!cardId) {
      this.closeContextMenu();
      return;
    }

    event.preventDefault();

    if (!this.selectionState.selectedDeviceIds.has(cardId)) {
      this.clearSelection();
      this.setSelectedDeviceIds([cardId], cardId);
    }

    const deviceIds = this.getOrderedSelectedDeviceIds();

    this.openContextMenu(event.clientX, event.clientY, {
      kind: 'devices',
      deviceIds,
      canGroup: this.canGroupDevices(deviceIds),
    });
  }

  handleClick(event: MouseEvent): void {
    if (this.suppressDeviceSelectionClick) {
      this.suppressDeviceSelectionClick = false;
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest('.center-point-control')) {
      return;
    }

    if (target.closest('.modulation-curve-control')) {
      return;
    }

    if (target.closest(this.interactiveElementSelector)) {
      return;
    }

    if (target.closest('.group-rail')) {
      this.closeContextMenu();
      return;
    }

    const cardId = this.resolveHeaderCardId(target);
    if (!cardId) {
      this.handleRackBackgroundClick(event);
      return;
    }

    this.closeContextMenu();
    const additiveSelection = this.isAdditiveSelection(event);
    if (event.shiftKey) {
      this.applyRangeSelection(cardId, additiveSelection);
      return;
    }

    if (additiveSelection) {
      this.toggleDeviceSelection(cardId);
      return;
    }

    this.selectSingleDevice(cardId);
  }

  handleDoubleClick(event: MouseEvent): boolean {
    if (event.button !== 0) {
      return false;
    }

    return this.tryResetControlFromDoubleClick(event.target);
  }

  prepareSelectionOnPointerDown(target: PointerDownSelectionTarget, event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }

    this.blurActiveTextEditingElement();
    const additiveSelection = this.isAdditiveSelection(event);

    if (target.kind === 'group') {
      this.closeContextMenu();

      if (additiveSelection) {
        this.toggleSelectedGroupId(target.id);
        return;
      }

      this.clearSelection();
      this.setSelectedGroupIds([target.id]);
      return;
    }

    if (event.shiftKey || additiveSelection) {
      return;
    }

    if (this.selectionState.selectedDeviceIds.has(target.id)) {
      return;
    }

    this.closeContextMenu();
    this.selectSingleDevice(target.id);
  }

  clearSelection(): void {
    this.selectionState.selectedDeviceIds = new Set<string>();
    this.selectionState.lastSelectedDeviceId = null;
    this.selectionState.selectedGroupIds = new Set<string>();
    this.selectionState.lastSelectedGroupId = null;
    this.renderSelectedDeviceCards();
  }

  applyNextSelectionAfterDelete(deletedIds: readonly string[]): void {
    const currentIds = this.getChainDeviceOrderIds();
    const deletedSet = new Set(deletedIds);

    let highestDeletedIndex = -1;
    let lowestDeletedIndex = currentIds.length;

    for (const id of deletedIds) {
      const idx = currentIds.indexOf(id);
      if (idx > highestDeletedIndex) highestDeletedIndex = idx;
      if (idx !== -1 && idx < lowestDeletedIndex) lowestDeletedIndex = idx;
    }

    if (highestDeletedIndex === -1) {
      this.clearSelection();
      return;
    }

    for (let index = highestDeletedIndex + 1; index < currentIds.length; index += 1) {
      if (!deletedSet.has(currentIds[index])) {
        this.selectSingleDevice(currentIds[index]);
        return;
      }
    }

    for (let index = lowestDeletedIndex - 1; index >= 0; index -= 1) {
      if (!deletedSet.has(currentIds[index])) {
        this.selectSingleDevice(currentIds[index]);
        return;
      }
    }

    this.clearSelection();
  }

  private handleRackBackgroundClick(event: MouseEvent): void {
    if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
      this.clearSelection();
    }
    this.closeContextMenu();
  }

  private blurActiveTextEditingElement(): void {
    blurIfTextEditingElement(document.activeElement);
  }

  private resolveHeaderCardId(target: HTMLElement): string | null {
    const header = target.closest<HTMLElement>('.device-head');
    if (!header) {
      return null;
    }

    const card = header.closest<HTMLElement>('.device-card[data-device-id]');
    return card?.dataset.deviceId ?? null;
  }

  private resolveGroupRailContext(
    target: HTMLElement,
  ): GroupSelectionContext | null {
    const rail = target.closest<HTMLElement>('.group-rail');
    if (!rail) {
      return null;
    }

    const groupEl = rail.closest<HTMLElement>('.device-group.is-rack[data-group-id]');
    const groupId = normalizeOptionalId(groupEl?.dataset.groupId);
    if (!groupId) {
      return null;
    }

    const memberDeviceIds = this.getGroupMemberIds(groupId);
    if (memberDeviceIds.length === 0) {
      return null;
    }

    return { groupId, memberDeviceIds };
  }

  private isAdditiveSelection(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
    return event.metaKey || event.ctrlKey;
  }

  private canGroupDevices(deviceIds: readonly string[]): boolean {
    if (deviceIds.length === 0) {
      return false;
    }

    const chain = this.getChainState();
    return deviceIds.every((id) => {
      const device = chain.devices.find((item) => item.id === id);
      return !normalizeOptionalId(device?.groupId ?? null);
    });
  }

  private applyRangeSelection(cardId: string, isAdditiveSelection: boolean): void {
    const orderedIds = this.getChainDeviceOrderIds();
    const anchorId =
      this.selectionState.lastSelectedDeviceId
      && orderedIds.includes(this.selectionState.lastSelectedDeviceId)
        ? this.selectionState.lastSelectedDeviceId
        : cardId;
    const rangeIds = buildSelectionRange(orderedIds, anchorId, cardId);
    if (isAdditiveSelection) {
      this.setSelectedDeviceIds([...this.getOrderedSelectedDeviceIds(), ...rangeIds], anchorId);
      return;
    }

    this.clearSelection();
    this.setSelectedDeviceIds(rangeIds, anchorId);
  }

  private toggleDeviceSelection(cardId: string): void {
    const nextSelection = new Set(this.getOrderedSelectedDeviceIds());
    if (nextSelection.has(cardId)) {
      nextSelection.delete(cardId);
    } else {
      nextSelection.add(cardId);
    }
    this.setSelectedDeviceIds(nextSelection, cardId);
  }

  private selectSingleDevice(cardId: string): void {
    this.clearSelection();
    this.setSelectedDeviceIds([cardId], cardId);
  }

  private getChainDeviceOrderIds(): string[] {
    return this.getChainState().devices.map((device) => device.id);
  }

  private getChainGroupIds(): string[] {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const device of this.getChainState().devices) {
      const groupId = normalizeOptionalId(device.groupId);
      if (!groupId || seen.has(groupId)) {
        continue;
      }
      seen.add(groupId);
      ids.push(groupId);
    }
    return ids;
  }

  private getGroupMemberIds(groupId: string): string[] {
    return this.getChainState().devices
      .filter((device) => normalizeOptionalId(device.groupId) === groupId)
      .map((device) => device.id);
  }

  private setSelectedDeviceIds(ids: Iterable<string>, anchorId: string | null): void {
    const validIds = new Set(this.getChainDeviceOrderIds());
    setSelectedDeviceIds(this.selectionState, ids, anchorId, validIds);
    this.reconcileSelectedDeviceIds(validIds);
    this.renderSelectedDeviceCards();
  }

  private setSelectedGroupIds(ids: Iterable<string>): void {
    const validGroupIds = new Set(this.getChainGroupIds());
    setSelectedGroupIds(this.selectionState, ids, validGroupIds);
    this.renderSelectedDeviceCards();
  }

  private toggleSelectedGroupId(groupId: string): void {
    const validGroupIds = new Set(this.getChainGroupIds());
    toggleSelectedGroupId(this.selectionState, groupId, validGroupIds);
    this.renderSelectedDeviceCards();
  }

  private reconcileSelectedDeviceIds(validIds = new Set(this.getChainDeviceOrderIds())): void {
    reconcileSelectedDeviceIds(this.selectionState, validIds, new Set(this.getChainGroupIds()));
  }

  private renderSelectedDeviceCards(): void {
    renderSelectedDeviceCards(
      this.chainDevices,
      this.selectionState.selectedDeviceIds,
      this.selectionState.selectedGroupIds,
    );
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
      this.saveChain(this.getChainState());
    });
  }

  private clearCenterPickerPointerState(persist: boolean): void {
    clearCenterPickerPointerState(this.centerPickerState, persist, () => {
      this.saveChain(this.getChainState());
    });
  }

  private isNumberDragActive(): boolean {
    return this.numberDragState.pointerId !== null;
  }

  private isNumberDragPointer(pointerId: number): boolean {
    return this.numberDragState.pointerId === pointerId;
  }

  private parseInputBound(rawValue: string): number | null {
    if (rawValue.trim() === '') {
      return null;
    }
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private resolveNumberStep(input: HTMLInputElement): number {
    const parsedStep = Number(input.step);
    return Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : 1;
  }

  private resolveStepDecimals(input: HTMLInputElement): number {
    const stepText = input.step;
    if (!stepText || stepText === 'any') {
      return 0;
    }
    const dotIndex = stepText.indexOf('.');
    if (dotIndex < 0) {
      return 0;
    }
    return Math.max(0, stepText.length - dotIndex - 1);
  }

  private formatDraggedValue(value: number, decimals: number): string {
    return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
  }

  private clampValue(value: number, min: number | null, max: number | null): number {
    let next = value;
    if (min !== null) {
      next = Math.max(next, min);
    }
    if (max !== null) {
      next = Math.min(next, max);
    }
    return next;
  }

  private requestNumberInputPointerLock(input: HTMLInputElement): void {
    if (!('requestPointerLock' in input)) {
      return;
    }

    try {
      input.requestPointerLock();
    } catch {
      // Pointer lock is optional; drag still works without it.
    }
  }

  private exitNumberInputPointerLock(input: HTMLInputElement | null): void {
    if (!input || document.pointerLockElement !== input) {
      return;
    }
    document.exitPointerLock();
  }

  private snapDraggedValue(rawValue: number, state: NumberDragState): number {
    if (
      state.wrapMode
      && state.min !== null
      && state.max !== null
      && state.max > state.min
    ) {
      const range = state.max - state.min;
      const stepped = Math.round((rawValue - state.min) / state.step) * state.step + state.min;
      let wrapped = (stepped - state.min) % range;
      if (wrapped < 0) {
        wrapped += range;
      }
      return Number((state.min + wrapped).toFixed(state.decimals));
    }

    const base = state.min ?? 0;
    const stepped = Math.round((rawValue - base) / state.step) * state.step + base;
    const clamped = this.clampValue(stepped, state.min, state.max);
    return Number(clamped.toFixed(state.decimals));
  }

  private tryStartNumberInputDrag(event: PointerEvent, target: HTMLElement): boolean {
    const input = target.closest<HTMLInputElement>('input[type="number"][data-action][data-id]');
    if (!input || input.disabled || input.readOnly) {
      return false;
    }

    const min = this.parseInputBound(input.min);
    const max = this.parseInputBound(input.max);
    const step = this.resolveNumberStep(input);
    const decimals = this.resolveStepDecimals(input);
    const currentValue = Number(input.value);
    const initialValue = Number.isFinite(currentValue) ? currentValue : (min ?? 0);
    const hasFiniteRange = min !== null && max !== null && max > min;
    const wrapMode = input.dataset.action === 'set-angle-param' && hasFiniteRange;
    const sensitivity = hasFiniteRange ? Math.max((max - min) / 480, step) : step;

    this.numberDragState.pointerId = event.pointerId;
    this.numberDragState.inputEl = input;
    this.numberDragState.lastPointerX = event.clientX;
    this.numberDragState.lastPointerY = event.clientY;
    this.numberDragState.didMove = false;
    this.numberDragState.dragRawValue = initialValue;
    this.numberDragState.step = step;
    this.numberDragState.min = min;
    this.numberDragState.max = max;
    this.numberDragState.decimals = decimals;
    this.numberDragState.sensitivity = sensitivity;
    this.numberDragState.wrapMode = wrapMode;
    this.numberDragState.isPointerLocked = false;
    this.overwriteOnTypeInput = input;
    delete input.dataset.keyboardEditing;

    input.dataset.dragActive = 'true';
    input.focus();
    input.setPointerCapture(event.pointerId);
    if (event.pointerType === 'mouse') {
      this.requestNumberInputPointerLock(input);
    }
    return true;
  }

  private tryResetControlFromDoubleClick(target: EventTarget | null): boolean {
    return this.tryResetNumericControl(target) || this.tryResetCenterPickerSurface(target);
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
      this.commitChainChange();
    }
    return true;
  }

  private applyNumberInputDrag(clientX: number, clientY: number): void {
    const input = this.numberDragState.inputEl;
    if (!input) {
      return;
    }

    const deltaY = this.numberDragState.lastPointerY - clientY;
    const deltaX = clientX - this.numberDragState.lastPointerX;
    this.numberDragState.lastPointerX = clientX;
    this.numberDragState.lastPointerY = clientY;
    this.applyNumberInputDragDelta(deltaX, deltaY);
  }

  private applyNumberInputDragDelta(deltaX: number, deltaY: number): void {
    const input = this.numberDragState.inputEl;
    if (!input) {
      return;
    }

    if (deltaX !== 0 || deltaY !== 0) {
      this.numberDragState.didMove = true;
    }

    this.numberDragState.dragRawValue += (deltaY + deltaX * 0.5) * this.numberDragState.sensitivity;

    const nextValue = this.snapDraggedValue(this.numberDragState.dragRawValue, this.numberDragState);
    const nextText = this.formatDraggedValue(nextValue, this.numberDragState.decimals);
    if (input.value === nextText) {
      return;
    }

    input.value = nextText;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private finalizeNumberDragInteraction(at: number): void {
    const { inputEl, didMove } = this.numberDragState;
    this.clearNumberDragState();

    if (!inputEl) {
      this.clearNumberClickState();
      return;
    }

    if (didMove) {
      this.clearNumberClickState();
      return;
    }

    const isDoubleClick = this.lastNumberClickInput === inputEl
      && at - this.lastNumberClickAt <= NUMERIC_RESET_DOUBLE_CLICK_WINDOW_MS;
    this.lastNumberClickInput = inputEl;
    this.lastNumberClickAt = at;

    if (!isDoubleClick) {
      return;
    }

    this.clearNumberClickState();
    this.tryResetNumericControl(inputEl);
  }

  private clearNumberClickState(): void {
    this.lastNumberClickInput = null;
    this.lastNumberClickAt = 0;
  }

  private clearNumberDragState(): void {
    const { inputEl, pointerId } = this.numberDragState;
    if (inputEl && pointerId !== null && inputEl.hasPointerCapture(pointerId)) {
      inputEl.releasePointerCapture(pointerId);
    }
    this.exitNumberInputPointerLock(inputEl);
    if (inputEl) {
      delete inputEl.dataset.dragActive;
    }

    Object.assign(this.numberDragState, createNumberDragState());
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
    return this.getChainGroupIds();
  }

  private getMaskSourceGeneratorIds(): string[] {
    return this.getChainState().devices
      .filter((device) =>
        device.kind === 'waterdrop' || device.kind === 'scanner' || device.kind === 'spiral')
      .map((device) => device.id);
  }

  private commitChainChange(delayMs?: number): void {
    const chain = this.getChainState();
    reconcileGeneratorChainModulators(chain);
    this.saveChain(chain);
    this.scheduleAutoPreview(delayMs);
  }

  private getCardElement(id: string): HTMLElement | null {
    return this.chainDevices.querySelector<HTMLElement>(`.device-card[data-device-id="${id}"]`);
  }
}
