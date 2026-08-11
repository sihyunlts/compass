<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import PathEditor from '../../renderer/components/controls/PathEditor.svelte';
  import FieldShell from '../../renderer/components/fields/FieldShell.svelte';
  import SelectField from '../../renderer/components/fields/SelectField.svelte';
  import Switch from '../../renderer/components/primitives/Switch.svelte';
  import { i18n } from '../../renderer/i18n.svelte';
  import { clamp } from '../../shared/math';
  import type { RendererDeviceEditorPropsBase } from '../types';

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
</script>

<div class="device-controls path-layout">
  {#if activeTab === 'path'}
    <div class="path-tab-panel">
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
      <FieldShell label={i18n.t('control.pathFill')} class="path-inline-control">
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
    <div class="path-tab-panel">
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
      <div class="path-animation-controls">
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
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  .path-layout,
  .path-tab-panel {
    display: flex;
    align-items: stretch;
    gap: var(--gap-8);
    min-width: 0;
    min-height: 0;
  }

  .path-tab-panel {
    flex: 1 1 auto;
  }

  .path-animation-controls {
    display: flex;
    flex: 0 0 7.5rem;
    flex-direction: column;
    gap: var(--gap-8);
    min-width: 7.5rem;
  }

  :global(.path-inline-control) {
    flex: 0 0 7.5rem;
    min-width: 7.5rem;
  }

  .path-start-value {
    color: var(--color-text-primary);
    font-size: var(--text-12);
    line-height: 1.3;
  }
</style>
