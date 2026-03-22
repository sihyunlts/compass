import type { CompassApi } from '../../shared/contracts/ipc/api';
import type { EditorSession } from '../features/editor/session.svelte';
import type { PlaybackSessionController } from './playback-session.svelte';
import { createPaletteController } from './palette-controller';

const ABOUT_SITE_URL = 'https://sihyunlights.com';

interface SettingsControllerState {
  appVersionText: string;
  paletteRevision: number;
}

interface SettingsControllerOptions {
  bridgeClient: CompassApi;
  editorSession: EditorSession;
  showMessage: (message: string) => void;
}

/** Owns settings-screen side effects such as palette IO, model toggles, and about actions. */
class SettingsController {
  public readonly state: SettingsControllerState = $state({
    appVersionText: '',
    paletteRevision: 0,
  });

  private readonly paletteController;

  private playbackSession: PlaybackSessionController | null = null;

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
      this.showError('Palette initialization failed', error);
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
      this.paletteController.applyUploadedPalette({
        name: file.name,
        content: await file.text(),
      });
      this.playbackSession?.renderPreviewFrame();
      this.options.showMessage(`Palette loaded | ${file.name}`);
    } catch (error) {
      this.showError('Palette upload failed', error);
    } finally {
      if (input) {
        input.value = '';
      }
    }
  }

  public handlePaletteReset(): void {
    const restoredDefault = this.paletteController.resetToDefault();
    this.playbackSession?.renderPreviewFrame();
    this.options.showMessage(
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
      this.showError('Failed to open website', error);
    }
  }

  public getAboutSiteUrl(): string {
    return ABOUT_SITE_URL;
  }

  private showError(summary: string, error: unknown): void {
    const detail = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Unknown error.';
    this.options.showMessage(`${summary} | ${detail}`);
  }
}

export const createSettingsController = (
  options: SettingsControllerOptions,
): SettingsController => new SettingsController(options);
