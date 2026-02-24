import {
  DEFAULT_PALETTE_CONTENT,
  DEFAULT_PALETTE_NAME,
} from '../../assets/palettes/novation-rgb';
import { clamp } from '../../shared/math';
import type { PaletteFilePayload } from '../../shared/types';
import {
  clearCustomPalette,
  loadCustomPalette,
  saveCustomPalette,
} from './storage';

type PaletteSource = 'default' | 'custom';
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

const reportPaletteError = (message: string, error: unknown): void => {
  console.error(`[palette] ${message}`, error);
};

const normalizePaletteChannel = (value: number, use63Scale: boolean): number => {
  if (use63Scale) {
    return Math.round((clamp(value, 0, 63) / 63) * 255);
  }
  return Math.round(clamp(value, 0, 255));
};

const parsePaletteColors = (content: string): Map<number, string> => {
  const rows = content.split(/\r?\n/);
  const parsedRows: Array<{ index: number; r: number; g: number; b: number }> = [];

  for (const rawRow of rows) {
    const row = rawRow.trim();
    if (!row || row.startsWith('#') || row.startsWith('//')) {
      continue;
    }

    const match = row.match(/^(\d+)\s*,\s*(\d+)\s+(\d+)\s+(\d+)\s*;?\s*$/);
    if (!match) {
      continue;
    }

    parsedRows.push({
      index: Number(match[1]),
      r: Number(match[2]),
      g: Number(match[3]),
      b: Number(match[4]),
    });
  }

  if (parsedRows.length === 0) {
    throw new Error('Unrecognized palette format.');
  }

  const use63Scale = parsedRows.every(
    (row) => row.r <= 63 && row.g <= 63 && row.b <= 63,
  );
  const colors = new Map<number, string>();

  for (const row of parsedRows) {
    const index = Math.round(clamp(row.index, 0, 127));
    const r = normalizePaletteChannel(row.r, use63Scale);
    const g = normalizePaletteChannel(row.g, use63Scale);
    const b = normalizePaletteChannel(row.b, use63Scale);
    colors.set(index, `${r} ${g} ${b}`);
  }

  return colors;
};

const getLedRgbByVelocity = (
  velocity: number,
  paletteColorsByVelocity: ReadonlyMap<number, string>,
  defaultRgb: string,
): string => {
  const colorIndex = Math.round(clamp(velocity, 0, 127));
  return paletteColorsByVelocity.get(colorIndex) ?? defaultRgb;
};

const getDefaultPalette = (): PaletteFilePayload => ({
  name: DEFAULT_PALETTE_NAME,
  content: DEFAULT_PALETTE_CONTENT,
});

export interface PaletteControllerOptions {
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
      this.options.onPaletteNameChanged(`Custom palette: ${payload.name} (${colors.size} colors)`);
      return;
    }

    this.options.onPaletteNameChanged(`Default palette: ${payload.name} (${colors.size} colors)`);
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
