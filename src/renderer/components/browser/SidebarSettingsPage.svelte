<script lang="ts">
  import Button from '../primitives/Button.svelte';

  let {
    launchpadMk2Enabled,
    paletteDescription,
    paletteDescriptionTone = 'neutral',
    appVersionText = '',
    aboutDescription,
    aboutDescriptionTone = 'neutral',
    githubDescription,
    onLaunchpadModelToggle,
    onPaletteReset,
    onPaletteFileChange,
    onOpenAboutSite,
    onOpenGitHub,
  } = $props<{
    launchpadMk2Enabled: boolean;
    paletteDescription: string;
    paletteDescriptionTone?: 'neutral' | 'error';
    appVersionText?: string;
    aboutDescription: string;
    aboutDescriptionTone?: 'neutral' | 'error';
    githubDescription: string;
    onLaunchpadModelToggle: (enabled: boolean) => void;
    onPaletteReset: () => void;
    onPaletteFileChange: (event: Event) => void | Promise<void>;
    onOpenAboutSite: () => void | Promise<void>;
    onOpenGitHub: () => void | Promise<void>;
  }>();
</script>

<section class="sidebar-settings-page">
  <section class="sidebar-settings-section">
    <h2 class="sidebar-settings-section-title">Settings</h2>
    <div class="sidebar-settings-card">
      <div class="sidebar-settings-row">
        <div class="sidebar-settings-info">
          <span class="sidebar-settings-label">Pro MK2 Mode</span>
          <span class="sidebar-settings-description">Enable mapping for Launchpad Pro MK2</span>
        </div>
        <input
          id="launchpad-model-mk2"
          type="checkbox"
          checked={launchpadMk2Enabled}
          onchange={(event) => {
            const target = event.currentTarget as HTMLInputElement;
            onLaunchpadModelToggle(target.checked);
          }}
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
          title="Open GitHub"
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
          title="Open website"
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
      color: var(--neutral-40);
      padding-left: var(--gap-2);
    }
  }

  .sidebar-settings-card {
    background: var(--neutral-10);
    border: 1px solid var(--neutral-20);
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
    color: var(--neutral-50);
    word-break: break-word;

    &.is-error {
      color: var(--accent-500);
    }
  }

  .sidebar-settings-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--gap-8);
  }

  .sidebar-settings-row > input[type='checkbox'],
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
    background: var(--neutral-20);
    padding: var(--gap-6) var(--gap-8);
    border-radius: var(--radius-6);
    font-size: var(--text-13);
    white-space: nowrap;
  }
</style>
