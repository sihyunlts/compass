<svelte:options runes={true} />

<script lang="ts">
  import {
    COMPOSITION_CENTER,
  } from '../../core/geometry';
  import type { GeneratorDeviceNode } from '../../shared/model';
  import PathEditor from '../../renderer/components/controls/PathEditor.svelte';
  import FieldShell from '../../renderer/components/fields/FieldShell.svelte';
  import NumberField from '../../renderer/components/fields/NumberField.svelte';
  import SelectField from '../../renderer/components/fields/SelectField.svelte';
  import Switch from '../../renderer/components/primitives/Switch.svelte';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';
  import { i18n } from '../../renderer/i18n.svelte';
  import { clamp } from '../../shared/math';
  import type { RendererDeviceEditorPropsBase } from '../types';
  import {
    resolvePathTransformMetrics,
  } from './transform';

  type PathDeviceEditorProps = RendererDeviceEditorPropsBase & {
    device: Extract<GeneratorDeviceNode, { kind: 'path' }>;
  };
  let {
    device,
    activeDeviceTab = 'path',
    currentProgress01 = 0,
    onControlChange,
  }: PathDeviceEditorProps = $props();

  const activeTab = $derived(activeDeviceTab === 'animate' ? 'animate' : 'path');
  const directionOptions = $derived([
    { value: 'forward', label: i18n.t('control.pathForward') },
    { value: 'reverse', label: i18n.t('control.pathReverse') },
  ]);
  const previewProgress = $derived(clamp(currentProgress01, 0, 1));
  const startAnchorIndex = $derived(device.params.anchors.findIndex(
    (anchor) => anchor.id === device.params.animation.startAnchorId,
  ));
  const formatCoordinateDisplay = (value: number): string => (
    String(Number(value.toFixed(1)) || 0)
  );
  const formatRotationDisplay = (value: number): string => `${Math.round(value) || 0}°`;
  const normalizeFieldValue = (value: number): number => Number(value.toFixed(6)) || 0;
  const pathTransformMetrics = $derived(resolvePathTransformMetrics(
    device.params.anchors,
    device.params.closed,
    device.params.transform,
  ));
  const pathFieldState = $derived({
    enabled: pathTransformMetrics !== null,
    center: pathTransformMetrics?.center ?? COMPOSITION_CENTER,
    rotation: pathTransformMetrics?.rotation ?? 0,
  });

</script>

<DeviceBodyLayout kind="surface" size="regular">
  {#snippet surface()}
    {#if activeTab === 'path'}
      <PathEditor
        deviceId={device.id}
        anchors={device.params.anchors}
        closed={device.params.closed}
        fill={device.params.fill}
        transform={device.params.transform}
        previewProgress01={device.params.animation.enabled ? previewProgress : null}
        previewDirection={device.params.animation.direction}
        previewStartAnchorId={device.params.animation.startAnchorId}
        {onControlChange}
      />
    {:else}
      <PathEditor
        deviceId={device.id}
        anchors={device.params.anchors}
        closed={device.params.closed}
        transform={device.params.transform}
        readonly={true}
        previewProgress01={device.params.animation.enabled ? previewProgress : null}
        previewDirection={device.params.animation.direction}
        previewStartAnchorId={device.params.animation.startAnchorId}
        selectedAnchorId={device.params.closed
          ? device.params.animation.startAnchorId
          : null}
        onAnchorSelect={device.params.closed
          ? (anchorId) => onControlChange({
            action: 'set-path-animation-start-anchor',
            deviceId: device.id,
            value: anchorId,
            finalize: true,
          })
          : undefined}
        {onControlChange}
      />
    {/if}
  {/snippet}

  {#snippet settings()}
    {#if activeTab === 'path'}
      <div class="path-paired-fields">
        <NumberField
          label="W"
          size="compact"
          fill={true}
          class="path-paired-field"
          value={pathTransformMetrics?.width ?? 0}
          displayText={formatCoordinateDisplay(Math.abs(pathTransformMetrics?.width ?? 0))}
          step="any"
          dragStep={0.1}
          disabled={!pathTransformMetrics || pathTransformMetrics.basisWidth === 0}
          dataAction="set-path-transform-param"
          dataId={device.id}
          dataParam="width"
          ariaLabel={`${i18n.t('control.size')} W`}
          {onControlChange}
        />
        <NumberField
          label="H"
          size="compact"
          fill={true}
          class="path-paired-field"
          value={pathTransformMetrics?.height ?? 0}
          displayText={formatCoordinateDisplay(Math.abs(pathTransformMetrics?.height ?? 0))}
          step="any"
          dragStep={0.1}
          disabled={!pathTransformMetrics || pathTransformMetrics.basisHeight === 0}
          dataAction="set-path-transform-param"
          dataId={device.id}
          dataParam="height"
          ariaLabel={`${i18n.t('control.size')} H`}
          {onControlChange}
        />
      </div>
      <div class="path-paired-fields">
        <NumberField
          label="X"
          size="compact"
          fill={true}
          class="path-paired-field"
          value={normalizeFieldValue(pathFieldState.center.x)}
          displayText={formatCoordinateDisplay(pathFieldState.center.x)}
          step="any"
          dragStep={0.1}
          dataAction="set-path-transform-param"
          dataId={device.id}
          dataParam="x"
          ariaLabel={`${i18n.t('control.position')} X`}
          disabled={!pathFieldState.enabled}
          {onControlChange}
        />
        <NumberField
          label="Y"
          size="compact"
          fill={true}
          class="path-paired-field"
          value={normalizeFieldValue(pathFieldState.center.y)}
          displayText={formatCoordinateDisplay(pathFieldState.center.y)}
          step="any"
          dragStep={0.1}
          dataAction="set-path-transform-param"
          dataId={device.id}
          dataParam="y"
          ariaLabel={`${i18n.t('control.position')} Y`}
          disabled={!pathFieldState.enabled}
          {onControlChange}
        />
      </div>
      <div class="path-paired-fields">
        <NumberField
          label={i18n.t('control.rotation')}
          size="compact"
          fill={true}
          class="path-paired-field"
          value={pathFieldState.rotation}
          displayText={formatRotationDisplay(pathFieldState.rotation)}
          step="any"
          dragStep={1}
          dataAction="set-path-transform-param"
          dataId={device.id}
          dataParam="rotation"
          disabled={!pathFieldState.enabled}
          {onControlChange}
        />
        <FieldShell
          label={i18n.t('control.pathFill')}
          fill={true}
          class="path-paired-field"
        >
          <Switch
            checked={device.params.fill}
            label={i18n.t('control.pathFill')}
            disabled={device.params.anchors.length < 3}
            onCheckedChange={(checked) => onControlChange({
              action: 'set-path-fill',
              deviceId: device.id,
              value: checked,
              finalize: true,
            })}
          />
        </FieldShell>
      </div>
    {:else}
      <FieldShell label={i18n.t('control.pathAnimate')}>
        <Switch
          checked={device.params.animation.enabled}
          label={i18n.t('control.pathAnimate')}
          onCheckedChange={(checked) => onControlChange({
            action: 'set-path-animation-enabled',
            deviceId: device.id,
            value: checked,
            finalize: true,
          })}
        />
      </FieldShell>
      <SelectField
        label={i18n.t('control.pathDirection')}
        value={device.params.animation.direction}
        options={directionOptions}
        dataAction="set-path-animation-direction"
        dataId={device.id}
        onControlChange={onControlChange}
      />
      <FieldShell label={i18n.t('control.pathStartPoint')}>
        <span class="path-start-value">
          {device.params.closed
            ? i18n.t('control.pathAnchorValue', {
              index: Math.max(startAnchorIndex, 0) + 1,
            })
            : i18n.t('control.pathEndpointByDirection')}
        </span>
      </FieldShell>
    {/if}
  {/snippet}
</DeviceBodyLayout>

<style lang="scss">
  .path-paired-fields {
    display: flex;
    gap: var(--gap-6);
    min-width: 0;
  }

  :global(.path-paired-field) {
    flex: 1 1 0;
  }

  .path-start-value {
    color: var(--color-text-primary);
    font-size: var(--text-12);
  }
</style>
