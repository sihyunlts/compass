import { clamp } from '../../../shared/math';
import type { GeneratorChain, GeneratorDeviceNode } from '../../../shared/model';
import type { RendererControlChange } from '../../../devices/control-types';
import type {
  BrowserInsertSource,
  BrowserPresetInsertSource,
  BrowserNonRackPresetInsertSource,
  RackInteractionCommit,
  RackScrollMetrics,
} from '../../components/rack/device-rack-types';
import type { ChainMutationMeta } from '../editor/history-core';
import { RackDragController, type ActiveDragInfo } from './drag-controller';
import { RackDropIndicator } from './drop-indicator';
import type { ChainDragSourceKind, RackDropZone } from './drop-ops';
import { createRackViewApi, type RackViewApi } from './api';
import { RackInteractionManager } from './interaction-manager';
import type { RackSelection } from './selection.svelte';

interface RackSurfaceControllerOptions {
  rackSelection: RackSelection;
  getDevices: () => readonly GeneratorDeviceNode[];
  getChainState: () => GeneratorChain;
  getOrderedDeviceIds: () => readonly string[];
  getOrderedGroupIds: () => readonly string[];
  getInteractiveElementSelector: () => string;
  resolveMiniMapLayoutSignature: () => string;
  closeContextMenu: () => void;
  saveChain: (chain: GeneratorChain, meta: ChainMutationMeta) => void;
  scheduleAutoPreview: (delayMs?: number) => void;
  commitRackInteraction: (commit: RackInteractionCommit) => void;
  commitPresetInsertDrop: (
    source: BrowserNonRackPresetInsertSource,
    dropZone: RackDropZone,
  ) => void;
  commitRackPresetDrop: (source: Extract<BrowserPresetInsertSource, { kind: 'rack-preset' }>) => void;
  onScrollMetricsChange: (metrics: RackScrollMetrics) => void;
  onMiniMapContentRevisionChange: (revision: number) => void;
  startRenamingDevice: (deviceId: string) => boolean;
  startRenamingGroup: (groupId: string) => boolean;
}

type MountElements = {
  chainDevices: HTMLElement;
  dropIndicator: HTMLElement;
  browserDragBadge: HTMLElement;
};

const toScrollMetricsSignature = (metrics: RackScrollMetrics): string => (
  `${metrics.scrollLeft.toFixed(2)}|${metrics.scrollWidth.toFixed(2)}|${metrics.clientWidth.toFixed(2)}`
);

/** Owns rack-side interaction controllers and exposes a compact view API. */
class RackSurfaceController {
  public activeDragInfo = $state<ActiveDragInfo | null>(null);

  public readonly api: RackViewApi;

  private readonly options: RackSurfaceControllerOptions;

  private chainDevices: HTMLElement | null = null;

  private interactionManager: RackInteractionManager | null = null;

  private dragController: RackDragController | null = null;

  private dropIndicator: RackDropIndicator | null = null;

  private resizeObserver: ResizeObserver | null = null;

  private resizeSyncFrameId: number | null = null;

  private lastScrollMetricsSignature: string | null = null;

  private lastMiniMapLayoutSignature: string | null = null;

  private miniMapContentRevision = 0;

  private suppressSelectionClick = false;

  public constructor(options: RackSurfaceControllerOptions) {
    this.options = options;
    this.api = createRackViewApi({
      rackSelection: options.rackSelection,
      getDevices: options.getDevices,
      getOrderedDeviceIds: options.getOrderedDeviceIds,
      getOrderedGroupIds: options.getOrderedGroupIds,
      syncAfterRender: () => this.syncAfterRender(),
      startRenamingDevice: options.startRenamingDevice,
      startRenamingGroup: options.startRenamingGroup,
      hasPointerInteraction: () => this.hasPointerInteraction(),
      setScrollLeft: (nextScrollLeft) => {
        this.setScrollLeft(nextScrollLeft);
      },
      handleBrowserPointerDown: (sourceEvent, source, itemEl, badgeLabel) =>
        this.startBrowserDrag(sourceEvent, source, itemEl, badgeLabel),
    });
  }

  public mount(elements: MountElements): () => void {
    this.chainDevices = elements.chainDevices;

    this.interactionManager = new RackInteractionManager({
      chainDevices: elements.chainDevices,
      getChainState: this.options.getChainState,
      saveChain: this.options.saveChain,
      scheduleAutoPreview: this.options.scheduleAutoPreview,
      closeContextMenu: this.options.closeContextMenu,
    });

    this.dropIndicator = new RackDropIndicator({
      chainDevices: elements.chainDevices,
      indicator: elements.dropIndicator,
    });

    this.dragController = new RackDragController({
      chainDevices: elements.chainDevices,
      browserDragBadge: elements.browserDragBadge,
      isBlocked: () => this.interactionManager?.isCenterPickerActive() ?? false,
      closeContextMenu: this.options.closeContextMenu,
      onDragUpdate: (info) => {
        this.activeDragInfo = info;
        this.dropIndicator?.sync(info);
      },
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.queueScrollMetricsSync();
    });
    this.resizeObserver.observe(elements.chainDevices);
    this.emitScrollMetrics();
    this.emitMiniMapContentRevision();

    document.addEventListener('pointerlockchange', this.handlePointerLockChange);

    return () => {
      document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
      this.clearDropIndicator();
      if (this.resizeSyncFrameId !== null) {
        window.cancelAnimationFrame(this.resizeSyncFrameId);
        this.resizeSyncFrameId = null;
      }
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      this.activeDragInfo = null;
      this.dragController = null;
      this.dropIndicator = null;
      this.interactionManager = null;
      this.chainDevices = null;
    };
  }

  public reconcileSelection(): void {
    this.options.rackSelection.reconcileWithDevices(this.options.getDevices());
  }

  public syncLayout(): void {
    if (!this.chainDevices) {
      return;
    }

    this.queueScrollMetricsSync();
    this.emitMiniMapContentRevision();
  }

  public syncAfterRender(): void {
    this.reconcileSelection();
    this.interactionManager?.syncAfterRender();
  }

  public hasPointerInteraction(): boolean {
    return (
      (this.dragController?.hasActivePointer() ?? false)
      || (this.interactionManager?.isCenterPickerActive() ?? false)
    );
  }

  public setScrollLeft(nextScrollLeft: number): void {
    if (!this.chainDevices || !Number.isFinite(nextScrollLeft)) {
      return;
    }

    const maxScrollLeft = Math.max(
      this.chainDevices.scrollWidth - this.chainDevices.clientWidth,
      0,
    );
    const clamped = clamp(nextScrollLeft, 0, maxScrollLeft);
    if (Math.abs(this.chainDevices.scrollLeft - clamped) > 0.1) {
      this.chainDevices.scrollLeft = clamped;
    }

    this.emitScrollMetrics();
  }

  public startBrowserDrag(
    sourceEvent: PointerEvent,
    source: BrowserInsertSource,
    itemEl: HTMLElement,
    badgeLabel: string,
  ): boolean {
    if (!this.dragController) {
      return false;
    }

    const started = this.dragController.startBrowserDrag(
      sourceEvent,
      source,
      itemEl,
      badgeLabel,
    );

    if (started) {
      this.clearDropIndicator();
      sourceEvent.preventDefault();
    }

    return started;
  }

  public startChainDrag(
    event: PointerEvent,
    sourceIds: readonly string[],
    sourceKind: ChainDragSourceKind,
  ): boolean {
    if (!this.dragController) {
      return false;
    }

    const started = this.dragController.startChainDrag(event, sourceIds, sourceKind);
    if (started) {
      this.clearDropIndicator();
    }
    return started;
  }

  public clearDropIndicator(): void {
    this.dropIndicator?.clear();
  }

  public syncExternalFileDropIndicator(clientX: number, clientY: number): RackDropZone | null {
    const dropZone = this.dragController?.resolveExternalFileDropZone(clientX, clientY) ?? null;
    this.dropIndicator?.sync({
      didMove: true,
      dropZone,
    });
    return dropZone;
  }

  public consumeSuppressedSelectionClick(): boolean {
    if (!this.suppressSelectionClick) {
      return false;
    }

    this.suppressSelectionClick = false;
    return true;
  }

  public handleControlChange(change: RendererControlChange): void {
    this.interactionManager?.handleControlChange(change);
  }

  public handleChainFocusIn(event: FocusEvent): void {
    this.interactionManager?.handleChainFocusIn(event);
  }

  public handleChainKeyDown(event: KeyboardEvent): void {
    this.interactionManager?.handleChainKeyDown(event);
  }

  public handleChainPointerDown(event: PointerEvent): void {
    if (this.interactionManager?.handleChainPointerDown(event)) {
      event.preventDefault();
    }
  }

  public handleChainContextMenu(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      this.options.closeContextMenu();
      return;
    }

    if (target.closest(this.options.getInteractiveElementSelector())) {
      this.options.closeContextMenu();
      return;
    }

    this.options.closeContextMenu();
  }

  public handleChainClick(event: MouseEvent): void {
    if (this.consumeSuppressedSelectionClick()) {
      return;
    }

    if (event.defaultPrevented) {
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

    if (target.closest(this.options.getInteractiveElementSelector())) {
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
      this.options.rackSelection.clear();
    }
    this.options.closeContextMenu();
  }

  public handleChainDoubleClick(event: MouseEvent): void {
    if (this.interactionManager?.handleDoubleClick(event)) {
      event.preventDefault();
    }
  }

  public handleChainScroll(): void {
    this.emitScrollMetrics();
  }

  public handleWindowPointerMove(event: PointerEvent, isSidebarResizing: boolean): void {
    if (isSidebarResizing) {
      return;
    }

    if (this.interactionManager?.handleWindowPointerMove(event)) {
      event.preventDefault();
      return;
    }

    const didHandlePointerMove = this.dragController?.handlePointerMove(event) ?? false;
    if (didHandlePointerMove) {
      event.preventDefault();
    }
  }

  public handleWindowPointerUp(event: PointerEvent): void {
    if (this.interactionManager?.handleWindowPointerUp(event)) {
      return;
    }

    const pointerResult = this.dragController?.handlePointerUp(event);
    if (!pointerResult) {
      return;
    }

    if (pointerResult.kind === 'chain') {
      if (pointerResult.didMove) {
        this.suppressSelectionClick = true;
      }

      if (pointerResult.shouldCommit && pointerResult.dropZone) {
        this.options.commitRackInteraction({
          kind: 'move',
          sourceKind: pointerResult.sourceKind,
          sourceIds: pointerResult.sourceIds,
          dropZone: pointerResult.dropZone,
        });
      }
      return;
    }

    if (!pointerResult.shouldCommit || !pointerResult.dropZone) {
      return;
    }

    if (pointerResult.source.kind === 'device-kind') {
      this.options.commitRackInteraction({
        kind: 'insert-device',
        deviceKind: pointerResult.source.deviceKind,
        dropZone: pointerResult.dropZone,
      });
      return;
    }

    if (pointerResult.source.kind === 'rack-preset') {
      this.options.commitRackPresetDrop(pointerResult.source);
      return;
    }

    this.options.commitPresetInsertDrop(pointerResult.source, pointerResult.dropZone);
  }

  public handleWindowPointerCancel(event: PointerEvent): void {
    if (this.interactionManager?.handleWindowPointerCancel(event)) {
      return;
    }
    this.dragController?.handlePointerCancel(event);
  }

  public handleWindowBlur(): void {
    this.interactionManager?.handleWindowBlur();
  }

  public handleWindowMouseUp(event: MouseEvent): void {
    this.interactionManager?.handleWindowMouseUp(event);
  }

  public handleLockedMouseMove(event: MouseEvent): void {
    this.interactionManager?.handleLockedMouseMove(event);
  }

  private resolveScrollMetrics(): RackScrollMetrics | null {
    if (!this.chainDevices) {
      return null;
    }

    const scrollWidth = Math.max(this.chainDevices.scrollWidth, 0);
    const clientWidth = Math.max(this.chainDevices.clientWidth, 0);
    const maxScrollLeft = Math.max(scrollWidth - clientWidth, 0);
    const scrollLeft = clamp(this.chainDevices.scrollLeft, 0, maxScrollLeft);

    return {
      scrollLeft,
      scrollWidth,
      clientWidth,
    };
  }

  private emitScrollMetrics(): RackScrollMetrics | null {
    const metrics = this.resolveScrollMetrics();
    if (!metrics) {
      return null;
    }

    const signature = toScrollMetricsSignature(metrics);
    if (signature === this.lastScrollMetricsSignature) {
      return metrics;
    }

    this.lastScrollMetricsSignature = signature;
    this.options.onScrollMetricsChange(metrics);
    return metrics;
  }

  private emitMiniMapContentRevision(): void {
    const layoutSignature = this.options.resolveMiniMapLayoutSignature();
    if (layoutSignature === this.lastMiniMapLayoutSignature) {
      return;
    }

    this.lastMiniMapLayoutSignature = layoutSignature;
    this.miniMapContentRevision += 1;
    this.options.onMiniMapContentRevisionChange(this.miniMapContentRevision);
  }

  private queueScrollMetricsSync(): void {
    if (this.resizeSyncFrameId !== null) {
      return;
    }

    this.resizeSyncFrameId = window.requestAnimationFrame(() => {
      this.resizeSyncFrameId = null;
      this.emitScrollMetrics();
    });
  }

  private readonly handlePointerLockChange = (): void => {
    this.interactionManager?.handlePointerLockChange();
  };
}

export const createRackSurfaceController = (
  options: RackSurfaceControllerOptions,
) => new RackSurfaceController(options);
