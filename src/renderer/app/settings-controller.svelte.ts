import { TransientFeedback } from './transient-feedback';
import type { CompassApi } from '../../shared/contracts/ipc/api';
import type { UpdateCheckResponse } from '../../shared/contracts/ipc/releases';
import type { EditorSession } from '../features/editor/session.svelte';
import {
  loadReduceAnimation,
  loadReduceBlur,
  loadShowMidiSaveButton,
  loadThemeSettings,
  saveReduceAnimation,
  saveReduceBlur,
  saveShowMidiSaveButton,
} from '../features/editor/persistence-storage';
import {
  findThemePreset,
  resolveThemeSelection,
  type ThemePresetId,
  type ThemeSelectionId,
} from '../theme-presets';
import type { PlaybackSessionController } from './playback-session.svelte';
import { createPaletteController, PaletteParseError } from './palette-controller';
import { updateThemeSettings } from './theme';
import { i18n } from '../i18n.svelte';

const ABOUT_SITE_URL = 'https://sihyunlights.com';
const GITHUB_URL = 'https://github.com/sihyunlts/compass';

interface SettingsControllerState {
  appVersionText: string;
  updateCheckText: string;
  updateAvailable: boolean;
  reduceAnimation: boolean;
  reduceBlur: boolean;
  showMidiSaveButton: boolean;
  themePreset: ThemeSelectionId;
  themeHue: number;
  themeSaturation: number;
  paletteRevision: number;
  paletteDescriptionOverride: string;
  aboutDescriptionOverride: string;
  aboutDescriptionTone: 'neutral' | 'error';
}

interface SettingsControllerOptions {
  bridgeClient: CompassApi;
  editorSession: EditorSession;
}

/** Owns settings UI side effects such as palette IO, model toggles, and about actions. */
class SettingsController {
  private readonly initialTheme = loadThemeSettings();

  public readonly state: SettingsControllerState = $state({
    appVersionText: '',
    updateCheckText: '',
    updateAvailable: false,
    reduceAnimation: loadReduceAnimation(),
    reduceBlur: loadReduceBlur(),
    showMidiSaveButton: loadShowMidiSaveButton(),
    themePreset: resolveThemeSelection(
      this.initialTheme.hue,
      this.initialTheme.saturation,
    ),
    themeHue: this.initialTheme.hue,
    themeSaturation: this.initialTheme.saturation,
    paletteRevision: 0,
    paletteDescriptionOverride: '',
    aboutDescriptionOverride: '',
    aboutDescriptionTone: 'neutral',
  });

  private readonly paletteController;

  private playbackSession: PlaybackSessionController | null = null;

  private readonly paletteFeedback = new TransientFeedback((message) => {
    this.state.paletteDescriptionOverride = message;
  });

  private readonly aboutFeedback = new TransientFeedback((message) => {
    this.state.aboutDescriptionOverride = message;
    this.state.aboutDescriptionTone = message ? 'error' : 'neutral';
  });

  public constructor(private readonly options: SettingsControllerOptions) {
    this.paletteController = createPaletteController({
      onPaletteChanged: ({ name, source }) => {
        this.options.editorSession.state.paletteName = name;
        this.options.editorSession.state.paletteSource = source;
        this.state.paletteRevision += 1;
      },
    });
  }

  public initialize(): void {
    try {
      this.paletteController.initialize();
    } catch {
      this.showPaletteError(i18n.t('settings.paletteInitializationFailed'));
    }
  }

  public resolvePaletteRgb(velocity: number, fallbackRgb: string): string {
    return this.paletteController.getLedRgb(velocity, fallbackRgb);
  }

  public attachPlaybackSession(playbackSession: PlaybackSessionController): void {
    this.playbackSession = playbackSession;
  }

  public async handlePaletteFileChange(event: Event): Promise<void> {
    const input = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }

    try {
      let content: string;
      try {
        content = await file.text();
      } catch {
        this.showPaletteError(i18n.t('settings.paletteReadFailed'));
        return;
      }

      try {
        this.paletteController.applyUploadedPalette({
          name: file.name,
          content,
        });
      } catch (error) {
        this.showPaletteError(this.resolvePaletteUploadErrorSummary(error));
        return;
      }

      this.playbackSession?.renderPreviewFrame();
      this.paletteFeedback.clear();
    } catch {
      this.showPaletteError(i18n.t('settings.paletteLoadFailed'));
    } finally {
      if (input) {
        input.value = '';
      }
    }
  }

  public handlePaletteReset(): void {
    const restoredDefault = this.paletteController.resetToDefault();
    this.playbackSession?.renderPreviewFrame();
    this.showPaletteDescription(
      restoredDefault
        ? i18n.t('settings.paletteReset')
        : i18n.t('settings.paletteResetFallback'),
    );
  }

  public handleLaunchpadModelToggle(nextEnabled: boolean): void {
    if (this.options.editorSession.commands.setLaunchpadModelEnabled(nextEnabled)) {
      this.playbackSession?.renderPreviewFrame();
    }
  }

  public handleReduceAnimationToggle(enabled: boolean): void {
    this.state.reduceAnimation = enabled;
    saveReduceAnimation(enabled);
  }

  public handleReduceBlurToggle(enabled: boolean): void {
    this.state.reduceBlur = enabled;
    saveReduceBlur(enabled);
  }

  public handleShowMidiSaveButtonToggle(enabled: boolean): void {
    this.state.showMidiSaveButton = enabled;
    saveShowMidiSaveButton(enabled);
  }

  public handleThemeHueChange(hue: number): void {
    const next = updateThemeSettings({ hue });
    this.state.themePreset = 'custom';
    this.state.themeHue = next.hue;
    this.state.themeSaturation = next.saturation;
  }

  public handleThemeSaturationChange(saturation: number): void {
    const next = updateThemeSettings({ saturation });
    this.state.themePreset = 'custom';
    this.state.themeHue = next.hue;
    this.state.themeSaturation = next.saturation;
  }

  public handleThemePresetChange(presetId: ThemePresetId): void {
    const preset = findThemePreset(presetId);
    const next = updateThemeSettings({
      hue: preset.hue,
      saturation: preset.saturation,
    });
    this.state.themePreset = preset.id;
    this.state.themeHue = next.hue;
    this.state.themeSaturation = next.saturation;
  }

  public setAppVersion(version: string): void {
    this.state.appVersionText = version;
  }

  public setUpdateCheckResult(result: UpdateCheckResponse): void {
    if (result.status !== 'available') {
      this.state.updateCheckText = '';
      this.state.updateAvailable = false;
      return;
    }

    this.state.updateCheckText = `Compass v${result.latestVersion}`;
    this.state.updateAvailable = true;
  }

  public async openAboutSite(): Promise<void> {
    try {
      await this.options.bridgeClient.openExternal(ABOUT_SITE_URL);
    } catch (error) {
      this.showAboutError(i18n.t('settings.openWebsiteFailed'), error);
    }
  }

  public async openGitHub(): Promise<void> {
    try {
      await this.options.bridgeClient.openExternal(GITHUB_URL);
    } catch (error) {
      this.showAboutError(i18n.t('settings.openGithubFailed'), error);
    }
  }

  public async openLatestReleasePage(): Promise<void> {
    try {
      await this.options.bridgeClient.openLatestReleasePage();
    } catch (error) {
      this.showAboutError(i18n.t('settings.openReleaseFailed'), error);
    }
  }

  public getAboutSiteUrl(): string {
    return ABOUT_SITE_URL;
  }

  public dispose(): void {
    this.paletteFeedback.clear();
    this.aboutFeedback.clear();
  }

  private showPaletteDescription(
    message: string,
  ): void {
    this.paletteFeedback.show(message);
  }

  private showPaletteError(summary: string): void {
    this.paletteFeedback.show(summary, false);
  }

  private resolvePaletteUploadErrorSummary(error: unknown): string {
    if (!(error instanceof PaletteParseError)) {
      return i18n.t('settings.paletteLoadFailed');
    }

    switch (error.code) {
      case 'empty':
        return i18n.t('settings.paletteEmpty');
      case 'format':
        return i18n.t('settings.paletteInvalid');
    }
  }

  private showAboutError(summary: string, error: unknown): void {
    const detail = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : i18n.t('settings.unknownError');
    const message = `${summary} | ${detail}`;
    this.aboutFeedback.show(message);
  }
}

export const createSettingsController = (
  options: SettingsControllerOptions,
): SettingsController => new SettingsController(options);
