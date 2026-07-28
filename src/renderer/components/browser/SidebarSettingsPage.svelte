<script lang="ts">
  import Button from '../primitives/Button.svelte';
  import Switch from '../primitives/Switch.svelte';

  let {
    launchpadMk2Enabled,
    reduceAnimation,
    themeHue,
    themeSaturation,
    paletteDescription,
    paletteDescriptionTone = 'neutral',
    appVersionText = '',
    updateCheckText = '',
    updateAvailable = false,
    aboutDescription,
    aboutDescriptionTone = 'neutral',
    githubDescription,
    onLaunchpadModelToggle,
    onReduceAnimationToggle,
    onThemeHueChange,
    onThemeSaturationChange,
    onThemeReset,
    onPaletteReset,
    onPaletteFileChange,
    onOpenAboutSite,
    onOpenGitHub,
    onOpenLatestReleasePage,
  } = $props<{
    launchpadMk2Enabled: boolean;
    reduceAnimation: boolean;
    themeHue: number;
    themeSaturation: number;
    paletteDescription: string;
    paletteDescriptionTone?: 'neutral' | 'error';
    appVersionText?: string;
    updateCheckText?: string;
    updateAvailable?: boolean;
    aboutDescription: string;
    aboutDescriptionTone?: 'neutral' | 'error';
    githubDescription: string;
    onLaunchpadModelToggle: (enabled: boolean) => void;
    onReduceAnimationToggle: (enabled: boolean) => void;
    onThemeHueChange: (hue: number) => void;
    onThemeSaturationChange: (saturation: number) => void;
    onThemeReset: () => void;
    onPaletteReset: () => void;
    onPaletteFileChange: (event: Event) => void | Promise<void>;
    onOpenAboutSite: () => void | Promise<void>;
    onOpenGitHub: () => void | Promise<void>;
    onOpenLatestReleasePage: () => void | Promise<void>;
  }>();
</script>

<section class="sidebar-settings-page">
  {#if updateAvailable && updateCheckText}
    <section class="sidebar-settings-card" aria-live="polite">
      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">Update available</span>
          <span class="sidebar-settings-description">{updateCheckText}</span>
        </div>
        <Button
          text="Download"
          onClick={() => onOpenLatestReleasePage()}
        />
      </div>
    </section>
  {/if}

  <section class="sidebar-settings-section">
    <h2 class="sidebar-settings-section-title">Lightshow</h2>
    <div class="sidebar-settings-card">
      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">Pro MK2 Mode</span>
          <span class="sidebar-settings-description">Enable mapping for Launchpad Pro MK2</span>
        </div>
        <Switch
          id="launchpad-model-mk2"
          checked={launchpadMk2Enabled}
          label="Pro MK2 Mode"
          onCheckedChange={onLaunchpadModelToggle}
        />
      </div>

      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">Color Palette</span>
          <span
            class="sidebar-settings-description"
            class:is-error={paletteDescriptionTone === 'error'}
            role="status"
            aria-live="polite"
          >
            {paletteDescription}
          </span>
        </div>

        <div class="sidebar-settings-actions">
          <Button
            id="palette-reset"
            text="Reset"
            onClick={() => onPaletteReset()}
          />
          <div class="sidebar-settings-file-input">
            <div class="sidebar-settings-file-button">Load</div>
            <input
              id="palette-file-input"
              type="file"
              onchange={(event) => onPaletteFileChange(event)}
            />
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="sidebar-settings-section">
    <h2 class="sidebar-settings-section-title">Interface</h2>
    <div class="sidebar-settings-card">
      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">Hue</span>
          <span class="sidebar-settings-description">{themeHue}°</span>
        </div>
        <input
          class="sidebar-settings-range"
          type="range"
          min="0"
          max="360"
          value={themeHue}
          aria-label="Theme Hue"
          oninput={(event) => onThemeHueChange(event.currentTarget.valueAsNumber)}
        />
      </div>

      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">Saturation</span>
          <span class="sidebar-settings-description">{themeSaturation}%</span>
        </div>
        <input
          class="sidebar-settings-range"
          type="range"
          min="0"
          max="100"
          value={themeSaturation}
          aria-label="Theme Saturation"
          oninput={(event) => onThemeSaturationChange(event.currentTarget.valueAsNumber)}
        />
      </div>

      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">Reset Theme</span>
          <span class="sidebar-settings-description">Restore the default theme colors</span>
        </div>
        <Button
          id="theme-reset"
          text="Reset"
          onClick={() => onThemeReset()}
        />
      </div>
    </div>

    <div class="sidebar-settings-card">
      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">Reduce Animation</span>
          <span class="sidebar-settings-description">Minimize interface motion and transitions</span>
        </div>
        <Switch
          id="reduce-animation"
          checked={reduceAnimation}
          label="Reduce Animation"
          onCheckedChange={onReduceAnimationToggle}
        />
      </div>
    </div>
  </section>

  <section class="sidebar-settings-section">
    <h2 class="sidebar-settings-section-title">About</h2>
    <div class="sidebar-settings-card">
      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">Version</span>
          <span class="sidebar-settings-description">{appVersionText ? `v${appVersionText}` : 'Loading...'}</span>
        </div>
      </div>

      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">GitHub</span>
          <span class="sidebar-settings-description">{githubDescription}</span>
        </div>
        <Button
          text="Open"
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
          text="Open"
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
    display: flex;
    flex-direction: column;
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

  .sidebar-settings-row > :global(.switch),
  .sidebar-settings-row > :global(.button) {
    align-self: center;
  }

  .sidebar-settings-file-input {
    position: relative;
    display: inline-block;

    input[type='file'] {
      position: absolute;
      left: 0;
      top: 0;
      opacity: 0;
      width: 100%;
      height: 100%;
      cursor: pointer;
    }
  }

  .sidebar-settings-file-button {
    pointer-events: none;
    background: var(--color-surface-interactive);
    padding: var(--gap-6) var(--gap-8);
    border-radius: var(--radius-6);
    font-size: var(--text-13);
    white-space: nowrap;
  }
</style>
