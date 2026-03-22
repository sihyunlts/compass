import type { CompassApi } from '../../shared/contracts/ipc/api';
import type { EditorSession } from '../features/editor/session.svelte';
import type { PlaybackSessionController } from './playback-session.svelte';
import { createPaletteController, PaletteParseError } from './palette-controller';

const ABOUT_SITE_URL = 'https://sihyunlights.com';

interface SettingsControllerState {
  appVersionText: string;
  paletteRevision: number;
  paletteDescriptionOverride: string;
  paletteDescriptionTone: 'neutral' | 'error';
  aboutDescriptionOverride: string;
  aboutDescriptionTone: 'neutral' | 'error';
}

interface SettingsControllerOptions {
  bridgeClient: CompassApi;
  editorSession: EditorSession;
}

/** Owns settings-screen side effects such as palette IO, model toggles, and about actions. */
class SettingsController {
  public readonly state: SettingsControllerState = $state({
    appVersionText: '',
    paletteRevision: 0,
    paletteDescriptionOverride: '',
    paletteDescriptionTone: 'neutral',
    aboutDescriptionOverride: '',
    aboutDescriptionTone: 'neutral',
  });

  private readonly paletteController;

  private playbackSession: PlaybackSessionController | null = null;

  private paletteFeedbackTimer: number | null = null;

  private aboutFeedbackTimer: number | null = null;

  public constructor(private readonly options: SettingsControllerOptions) {
    this.paletteController = createPaletteController({
      onPaletteNameChanged: (nameText) => {
        this.options.editorSession.state.paletteNameText = nameText;
        this.state.paletteRevision += 1;
      },
    });
  }

  public initialize(): void {
    try {
      this.paletteController.initialize();
    } catch (error) {
      this.showPaletteError('Palette initialization failed', error);
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
      } catch (error) {
        this.showPaletteError('Failed to read palette file', error);
        return;
      }

      try {
        this.paletteController.applyUploadedPalette({
          name: file.name,
          content,
        });
      } catch (error) {
        this.showPaletteError(this.resolvePaletteUploadErrorSummary(error), error);
        return;
      }

      this.playbackSession?.renderPreviewFrame();
      this.showPaletteDescription(`Palette loaded | ${file.name}`);
    } catch (error) {
      this.showPaletteError('Palette upload failed', error);
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
        ? 'Palette reset to default.'
        : 'Palette reset used embedded fallback.',
    );
  }

  public handleLaunchpadModelToggle(nextEnabled: boolean): void {
    if (this.options.editorSession.commands.setLaunchpadModelEnabled(nextEnabled)) {
      this.playbackSession?.renderPreviewFrame();
    }
  }

  public setAppVersion(version: string): void {
    this.state.appVersionText = version;
  }

  public async openAboutSite(): Promise<void> {
    try {
      await this.options.bridgeClient.openExternal(ABOUT_SITE_URL);
    } catch (error) {
      this.showAboutError('Failed to open website', error);
    }
  }

  public getAboutSiteUrl(): string {
    return ABOUT_SITE_URL;
  }

  public dispose(): void {
    this.clearPaletteFeedbackTimer();
    this.clearAboutFeedbackTimer();
  }

  private showPaletteDescription(
    message: string,
  ): void {
    this.state.paletteDescriptionOverride = message;
    this.state.paletteDescriptionTone = 'neutral';
    this.clearPaletteFeedbackTimer();
    this.paletteFeedbackTimer = window.setTimeout(() => {
      this.paletteFeedbackTimer = null;
      if (this.state.paletteDescriptionOverride === message) {
        this.state.paletteDescriptionOverride = '';
        this.state.paletteDescriptionTone = 'neutral';
      }
    }, 2500);
  }

  private showPaletteError(summary: string, error: unknown): void {
    const detail = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Unknown error.';
    const message = detail === summary ? summary : `${summary} | ${detail}`;
    this.state.paletteDescriptionOverride = message;
    this.state.paletteDescriptionTone = 'error';
    this.clearPaletteFeedbackTimer();
  }

  private resolvePaletteUploadErrorSummary(error: unknown): string {
    if (!(error instanceof PaletteParseError)) {
      return 'Palette upload failed';
    }

    switch (error.code) {
      case 'empty':
        return 'Palette is empty';
      case 'format':
        return 'Palette format is not recognized';
    }
  }

  private showAboutError(summary: string, error: unknown): void {
    const detail = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Unknown error.';
    const message = `${summary} | ${detail}`;
    this.state.aboutDescriptionOverride = message;
    this.state.aboutDescriptionTone = 'error';
    this.clearAboutFeedbackTimer();
    this.aboutFeedbackTimer = window.setTimeout(() => {
      this.aboutFeedbackTimer = null;
      if (this.state.aboutDescriptionOverride === message) {
        this.state.aboutDescriptionOverride = '';
        this.state.aboutDescriptionTone = 'neutral';
      }
    }, 2500);
  }

  private clearPaletteFeedbackTimer(): void {
    if (this.paletteFeedbackTimer === null) {
      return;
    }

    window.clearTimeout(this.paletteFeedbackTimer);
    this.paletteFeedbackTimer = null;
  }

  private clearAboutFeedbackTimer(): void {
    if (this.aboutFeedbackTimer === null) {
      return;
    }

    window.clearTimeout(this.aboutFeedbackTimer);
    this.aboutFeedbackTimer = null;
  }
}

export const createSettingsController = (
  options: SettingsControllerOptions,
): SettingsController => new SettingsController(options);
