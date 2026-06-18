import {
  DEFAULT_PALETTE_CONTENT,
  DEFAULT_PALETTE_NAME,
} from '../../assets/palettes/novation-rgb';
import type { PaletteFilePayload } from '../../shared/model';
import {
  getLedRgbByVelocity,
  PaletteParseError,
  parsePaletteColors,
} from '../../shared/palette-colors';
import {
  readPersistedRendererState,
  writePersistedRendererState,
} from '../persisted-state';

type PaletteSource = 'default' | 'custom';
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

const reportPaletteError = (message: string, error: unknown): void => {
  console.error(`[palette] ${message}`, error);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const loadCustomPalette = (): PaletteFilePayload | null => {
  const palette = readPersistedRendererState().palette;
  if (!palette || !isRecord(palette)) {
    return null;
  }

  const content = typeof palette.content === 'string' ? palette.content : '';
  if (!content.trim()) {
    return null;
  }

  const name = typeof palette.name === 'string' && palette.name.trim()
    ? palette.name
    : 'custom-palette';
  return { name, content };
};

const saveCustomPalette = (payload: PaletteFilePayload): void => {
  writePersistedRendererState({
    palette: {
      name: payload.name,
      content: payload.content,
    },
  });
};

const clearCustomPalette = (): void => {
  writePersistedRendererState({
    palette: null,
  });
};

const getDefaultPalette = (): PaletteFilePayload => ({
  name: DEFAULT_PALETTE_NAME,
  content: DEFAULT_PALETTE_CONTENT,
});

interface PaletteControllerOptions {
  onPaletteNameChanged: (nameText: string) => void;
}

/** Resolves LED color values from default or imported palette files. */
class PaletteController {
  private paletteColorsByVelocity = new Map<number, string>();

  public constructor(private readonly options: PaletteControllerOptions) {}

  public getLedRgb(velocity: number, defaultRgb: string): string {
    return getLedRgbByVelocity(velocity, this.paletteColorsByVelocity, defaultRgb);
  }

  public applyUploadedPalette(payload: PaletteFilePayload): void {
    this.applyPalette(payload, 'custom', true);
  }

  public resetToDefault(): boolean {
    clearCustomPalette();
    try {
      this.applyPalette(getDefaultPalette(), 'default', false);
      return true;
    } catch (error) {
      if (IS_DEVELOPMENT) {
        throw error;
      }
      reportPaletteError('Default palette parse failed, using embedded fallback', error);
      this.applyEmbeddedFallback();
      return false;
    }
  }

  public initialize(): void {
    const storedCustomPalette = loadCustomPalette();
    if (storedCustomPalette) {
      try {
        this.applyPalette(storedCustomPalette, 'custom', false);
        return;
      } catch (error) {
        reportPaletteError('Stored custom palette parse failed, clearing value', error);
        clearCustomPalette();
      }
    }

    try {
      this.applyPalette(getDefaultPalette(), 'default', false);
    } catch (error) {
      if (IS_DEVELOPMENT) {
        throw error;
      }
      reportPaletteError('Default palette parse failed, using embedded fallback', error);
      this.applyEmbeddedFallback();
    }
  }

  private applyPalette(
    payload: PaletteFilePayload,
    source: PaletteSource,
    persistCustom: boolean,
  ): void {
    const colors = parsePaletteColors(payload.content);
    this.paletteColorsByVelocity = colors;

    if (source === 'custom') {
      if (persistCustom) {
        saveCustomPalette(payload);
      }
      this.options.onPaletteNameChanged(`Custom palette: ${payload.name}`);
      return;
    }

    this.options.onPaletteNameChanged(`Default palette: ${payload.name}`);
  }

  private applyEmbeddedFallback(): void {
    this.paletteColorsByVelocity = new Map();
    this.options.onPaletteNameChanged('Default palette: embedded orange');
  }
}

/** Creates a palette controller with persisted-custom and embedded-default fallback paths. */
export const createPaletteController = (
  options: PaletteControllerOptions,
): PaletteController => new PaletteController(options);

export { PaletteParseError };
