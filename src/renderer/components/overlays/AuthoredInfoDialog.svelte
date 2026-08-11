<script lang="ts">
  import {
    AUTHORED_METADATA_AUTHOR_MAX_LENGTH,
    AUTHORED_METADATA_DESCRIPTION_MAX_LENGTH,
  } from '../../../shared/model';
  import { i18n } from '../../i18n.svelte';
  import TextAreaField from '../fields/TextAreaField.svelte';
  import TextField from '../fields/TextField.svelte';
  import ModalDialog from './ModalDialog.svelte';

  let {
    open = false,
    title,
    name,
    author,
    description,
    savedAtIso = null,
    busy = false,
    onNameChange,
    onAuthorChange,
    onDescriptionChange,
    onConfirm,
    onCancel,
  } = $props<{
    open?: boolean;
    title: string;
    name: string;
    author: string;
    description: string;
    savedAtIso?: string | null;
    busy?: boolean;
    onNameChange: (value: string) => void;
    onAuthorChange: (value: string) => void;
    onDescriptionChange: (value: string) => void;
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
  }>();

  const savedAtText = $derived.by(() => {
    if (!savedAtIso) {
      return null;
    }
    const date = new Date(savedAtIso);
    if (!Number.isFinite(date.getTime())) {
      return savedAtIso;
    }
    return new Intl.DateTimeFormat(i18n.locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  });
</script>

<ModalDialog
  {open}
  {title}
  footerNote={savedAtText
    ? i18n.t('info.lastSavedValue', { time: savedAtText })
    : null}
  confirmLabel={i18n.t('info.save')}
  cancelLabel={i18n.t('app.cancel')}
  {busy}
  wide
  defaultAction="confirm"
  {onConfirm}
  {onCancel}
>
  <div class="authored-info-fields">
    <div class="authored-info-primary-fields">
      <TextField
        value={name}
        label={i18n.t('info.name')}
        placeholder={i18n.t('info.namePlaceholder')}
        disabled={busy}
        onValueChange={onNameChange}
      />
      <TextField
        value={author}
        label={i18n.t('info.author')}
        placeholder={i18n.t('info.authorPlaceholder')}
        maxLength={AUTHORED_METADATA_AUTHOR_MAX_LENGTH}
        disabled={busy}
        onValueChange={onAuthorChange}
      />
    </div>
    <div class="authored-info-description-field">
      <TextAreaField
        value={description}
        label={i18n.t('info.description')}
        placeholder={i18n.t('info.descriptionPlaceholder')}
        maxLength={AUTHORED_METADATA_DESCRIPTION_MAX_LENGTH}
        rows={1}
        disabled={busy}
        onValueChange={onDescriptionChange}
      />
    </div>
  </div>
</ModalDialog>

<style lang="scss">
  .authored-info-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-16);
  }

  .authored-info-primary-fields {
    display: grid;
    align-content: start;
    gap: var(--gap-12);
  }

  .authored-info-description-field {
    min-width: 0;

    :global(.text-area-field) {
      height: 100%;
      grid-template-rows: auto minmax(0, 1fr);
    }

    :global(textarea) {
      height: auto;
      min-height: 0;
      max-height: none;
    }
  }

</style>
