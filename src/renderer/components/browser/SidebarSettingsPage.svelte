<script lang="ts">
  import { onDestroy } from 'svelte';

  import Button from '../primitives/Button.svelte';
  import DropdownSelect from '../primitives/DropdownSelect.svelte';
  import Switch from '../primitives/Switch.svelte';
  import type { DropdownOption } from '../primitives/dropdown-types';
  import { isAppLocale, type AppLocale } from '../../../shared/i18n';
  import { i18n } from '../../i18n.svelte';
  import {
    isThemePresetId,
    THEME_PRESETS,
    type ThemePresetId,
    type ThemeSelectionId,
  } from '../../theme-presets';

  type ThemeMessageKey = `theme.${ThemePresetId}`;

  let {
    launchpadMk2Enabled,
    locale,
    reduceAnimation,
    themePreset,
    themeHue,
    themeSaturation,
    paletteDescription,
    appVersionText = '',
    updateCheckText = '',
    updateAvailable = false,
    aboutDescription,
    aboutDescriptionTone = 'neutral',
    githubDescription,
    onLaunchpadModelToggle,
    onLocaleChange,
    onReduceAnimationToggle,
    onThemePresetChange,
    onThemeHueChange,
    onThemeSaturationChange,
    onPaletteReset,
    onPaletteFileChange,
    onOpenAboutSite,
    onOpenGitHub,
    onOpenLatestReleasePage,
  } = $props<{
    launchpadMk2Enabled: boolean;
    locale: AppLocale;
    reduceAnimation: boolean;
    themePreset: ThemeSelectionId;
    themeHue: number;
    themeSaturation: number;
    paletteDescription: string;
    appVersionText?: string;
    updateCheckText?: string;
    updateAvailable?: boolean;
    aboutDescription: string;
    aboutDescriptionTone?: 'neutral' | 'error';
    githubDescription: string;
    onLaunchpadModelToggle: (enabled: boolean) => void;
    onLocaleChange: (locale: AppLocale) => void;
    onReduceAnimationToggle: (enabled: boolean) => void;
    onThemePresetChange: (presetId: ThemePresetId) => void;
    onThemeHueChange: (hue: number) => void;
    onThemeSaturationChange: (saturation: number) => void;
    onPaletteReset: () => void;
    onPaletteFileChange: (event: Event) => void | Promise<void>;
    onOpenAboutSite: () => void | Promise<void>;
    onOpenGitHub: () => void | Promise<void>;
    onOpenLatestReleasePage: () => void | Promise<void>;
  }>();

  const localeOptions = $derived<readonly DropdownOption[]>([
    { value: 'en', label: i18n.t('language.english') },
    { value: 'ko', label: i18n.t('language.korean') },
  ]);
  const themeOptions = $derived<readonly DropdownOption[]>(
    THEME_PRESETS.map((preset) => ({
      value: preset.id,
      label: i18n.t(`theme.${preset.id}` as ThemeMessageKey),
    })),
  );

  const handleThemePresetChange = (value: string | number): void => {
    if (isThemePresetId(value)) {
      onThemePresetChange(value);
    }
  };

  const handleLocaleChange = (value: string | number): void => {
    if (isAppLocale(value)) {
      onLocaleChange(value);
    }
  };

  let themeAdjustingTimer: number | null = null;
  let paletteFileInputEl = $state<HTMLInputElement | null>(null);

  const openPaletteFilePicker = (): void => {
    paletteFileInputEl?.click();
  };

  const handleThemeInput = (
    onChange: (value: number) => void,
    value: number,
  ): void => {
    document.documentElement.classList.add('is-theme-adjusting');
    if (themeAdjustingTimer !== null) {
      window.clearTimeout(themeAdjustingTimer);
    }
    themeAdjustingTimer = window.setTimeout(() => {
      themeAdjustingTimer = null;
      document.documentElement.classList.remove('is-theme-adjusting');
    }, 100);
    onChange(value);
  };

  onDestroy(() => {
    if (themeAdjustingTimer !== null) {
      window.clearTimeout(themeAdjustingTimer);
    }
    document.documentElement.classList.remove('is-theme-adjusting');
  });
</script>

<section class="sidebar-settings-page">
  {#if updateAvailable && updateCheckText}
    <section class="sidebar-settings-card sidebar-settings-row" aria-live="polite">
      <div class="sidebar-settings-info">
        <span class="sidebar-settings-label">{i18n.t('settings.updateAvailable')}</span>
        <span class="sidebar-settings-description">{updateCheckText}</span>
      </div>
      <Button
        text={i18n.t('settings.download')}
        onClick={() => onOpenLatestReleasePage()}
      />
    </section>
  {/if}

  <section class="sidebar-settings-section">
    <h2 class="sidebar-settings-section-title">{i18n.t('settings.lightshow')}</h2>
    <div class="sidebar-settings-card">
      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">{i18n.t('settings.mk2Mode')}</span>
          <span class="sidebar-settings-description">{i18n.t('settings.mk2Description')}</span>
        </div>
        <Switch
          id="launchpad-model-mk2"
          checked={launchpadMk2Enabled}
          label={i18n.t('settings.mk2Mode')}
          onCheckedChange={onLaunchpadModelToggle}
        />
      </div>

      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">{i18n.t('settings.colorPalette')}</span>
          <span
            class="sidebar-settings-description"
            role="status"
            aria-live="polite"
          >
            {paletteDescription}
          </span>
        </div>

        <div class="sidebar-settings-actions">
          <Button
            id="palette-reset"
            text={i18n.t('settings.reset')}
            onClick={() => onPaletteReset()}
          />
          <Button
            id="palette-load"
            text={i18n.t('settings.load')}
            onClick={openPaletteFilePicker}
          />
          <input
            bind:this={paletteFileInputEl}
            id="palette-file-input"
            class="sidebar-settings-file-input"
            type="file"
            onchange={(event) => onPaletteFileChange(event)}
          />
        </div>
      </div>
    </div>
  </section>

  <section class="sidebar-settings-section">
    <h2 class="sidebar-settings-section-title">{i18n.t('settings.interface')}</h2>
    <div class="sidebar-settings-card">
      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">{i18n.t('settings.theme')}</span>
          <span class="sidebar-settings-description">{i18n.t('settings.chooseTheme')}</span>
        </div>
        <DropdownSelect
          class="sidebar-settings-theme-select"
          value={themePreset}
          valueLabel={themePreset === 'custom' ? i18n.t('theme.custom') : undefined}
          options={themeOptions}
          ariaLabel={i18n.t('settings.theme')}
          onValueChange={handleThemePresetChange}
        />
      </div>

      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">{i18n.t('settings.hue')}</span>
          <span class="sidebar-settings-description">{themeHue}°</span>
        </div>
        <input
          class="sidebar-settings-range sidebar-settings-hue-range"
          type="range"
          min="0"
          max="360"
          value={themeHue}
          aria-label={i18n.t('settings.themeHue')}
          oninput={(event) =>
            handleThemeInput(onThemeHueChange, event.currentTarget.valueAsNumber)}
        />
      </div>

      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">{i18n.t('settings.saturation')}</span>
          <span class="sidebar-settings-description">{themeSaturation}%</span>
        </div>
        <input
          class="sidebar-settings-range sidebar-settings-saturation-range"
          type="range"
          min="0"
          max="100"
          value={themeSaturation}
          aria-label={i18n.t('settings.themeSaturation')}
          oninput={(event) =>
            handleThemeInput(onThemeSaturationChange, event.currentTarget.valueAsNumber)}
        />
      </div>
    </div>

    <div class="sidebar-settings-card sidebar-settings-row">
      <div class="sidebar-settings-info">
        <span class="sidebar-settings-label">{i18n.t('settings.reduceAnimation')}</span>
        <span class="sidebar-settings-description">{i18n.t('settings.reduceAnimationDescription')}</span>
      </div>
      <Switch
        id="reduce-animation"
        checked={reduceAnimation}
        label={i18n.t('settings.reduceAnimation')}
        onCheckedChange={onReduceAnimationToggle}
      />
    </div>

    <div class="sidebar-settings-card sidebar-settings-row">
      <div class="sidebar-settings-info">
        <span class="sidebar-settings-label">{i18n.t('settings.language')}</span>
        <span class="sidebar-settings-description">
          {i18n.t('settings.languageGreeting')}
        </span>
      </div>
      <DropdownSelect
        class="sidebar-settings-theme-select"
        value={locale}
        options={localeOptions}
        ariaLabel={i18n.t('settings.language')}
        onValueChange={handleLocaleChange}
      />
    </div>
  </section>

  <section class="sidebar-settings-section">
    <h2 class="sidebar-settings-section-title">{i18n.t('settings.about')}</h2>
    <div class="sidebar-settings-card">
      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">{i18n.t('app.version')}</span>
          <span class="sidebar-settings-description">{appVersionText ? `v${appVersionText}` : i18n.t('app.loading')}</span>
        </div>
      </div>

      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">GitHub</span>
          <span class="sidebar-settings-description">{githubDescription}</span>
        </div>
        <Button
          text={i18n.t('app.open')}
          onClick={() => onOpenGitHub()}
        />
      </div>

      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">sihyunlights</span>
          <span
            class="sidebar-settings-description"
            class:is-error={aboutDescriptionTone === 'error'}
            role="status"
            aria-live="polite"
          >
            {aboutDescription}
          </span>
        </div>
        <Button
          text={i18n.t('app.open')}
          onClick={() => onOpenAboutSite()}
        />
      </div>
    </div>
  </section>
</section>

<style lang="scss">
  .sidebar-settings-page {
    display: flex;
    flex-direction: column;
    gap: var(--gap-16);
  }

  .sidebar-settings-section {
    display: flex;
    flex-direction: column;
    gap: var(--gap-8);

    &-title {
      font-size: var(--text-12);
      font-weight: 500;
      color: var(--color-text-tertiary);
      padding-left: var(--gap-2);
    }
  }

  .sidebar-settings-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border-tertiary);
    border-radius: var(--radius-8);
  }

  .sidebar-settings-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gap-10);
    padding: var(--gap-12);
  }

  .sidebar-settings-info {
    display: flex;
    flex-direction: column;
    gap: var(--gap-4);
    min-width: 0;
    flex: 1 1 auto;
  }

  .sidebar-settings-label {
    font-size: var(--text-13);
    font-weight: 500;
  }

  .sidebar-settings-description {
    font-size: var(--text-12);
    line-height: 1.3;
    color: var(--color-text-secondary);
    word-break: break-word;

    &.is-error {
      color: var(--color-text-primary);
    }
  }

  .sidebar-settings-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--gap-8);
  }

  .sidebar-settings-range {
    align-self: center;
    width: 8rem;
  }

  .sidebar-settings-hue-range {
    --range-track-background: linear-gradient(
      to right,
      oklch(65% 0.14 0),
      oklch(65% 0.14 60),
      oklch(65% 0.14 120),
      oklch(65% 0.14 180),
      oklch(65% 0.14 240),
      oklch(65% 0.14 300),
      oklch(65% 0.14 360)
    );
  }

  .sidebar-settings-saturation-range {
    --range-track-background: linear-gradient(
      to right,
      oklch(65% 0 var(--theme-hue)),
      oklch(65% 0.14 var(--theme-hue))
    );
  }

  :global(.sidebar-settings-theme-select) {
    align-self: center;
    --dropdown-select-radius: var(--radius-6);
  }

  :global(.sidebar-settings-theme-select .dropdown-select-trigger) {
    width: 6rem;
  }

  .sidebar-settings-row > :global(.switch),
  .sidebar-settings-row > :global(.button) {
    align-self: center;
  }

  .sidebar-settings-file-input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
</style>
