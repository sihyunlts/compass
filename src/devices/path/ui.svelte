<svelte:options runes={true} />

<script lang="ts">
  import type { GeneratorDeviceNode } from '../../shared/model';
  import PathEditor from '../../renderer/components/controls/PathEditor.svelte';
  import FieldShell from '../../renderer/components/fields/FieldShell.svelte';
  import SelectField from '../../renderer/components/fields/SelectField.svelte';
  import Switch from '../../renderer/components/primitives/Switch.svelte';
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';
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
      <FieldShell label={i18n.t('control.pathFill')}>
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
  .path-start-value {
    color: var(--color-text-primary);
    font-size: var(--text-12);
  }
</style>
