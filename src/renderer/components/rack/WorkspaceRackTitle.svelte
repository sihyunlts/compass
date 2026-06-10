<script lang="ts">
  let {
    title,
    dirty = false,
  } = $props<{
    title: string;
    dirty?: boolean;
  }>();

  const displayTitle = $derived(dirty ? `${title}*` : title);
</script>

<div
  class="workspace-rack-title"
  title={dirty ? `${title} - unsaved changes` : title}
  aria-label={dirty ? `Rack: ${title}, unsaved changes` : `Rack: ${title}`}
>
  <span class="workspace-rack-title-text">{displayTitle}</span>
</div>

<style lang="scss">
  .workspace-rack-title {
    display: inline-flex;
    align-items: center;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 10rem;
    height: 1.75rem;
    padding: var(--gap-4) var(--gap-8);
    color: var(--neutral-90);
    font-size: var(--text-14);
    font-weight: 500;

    &-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

  }
</style>
