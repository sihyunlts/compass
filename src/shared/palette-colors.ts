import { clamp } from './math';
import type { PaletteFilePayload } from './model';

const PALETTE_ROW_PATTERN = /^(\d+)\s*,\s*(\d+)\s+(\d+)\s+(\d+)\s*;?\s*$/;

export class PaletteParseError extends Error {
  public constructor(
    public readonly code: 'empty' | 'format',
    message: string,
  ) {
    super(message);
    this.name = 'PaletteParseError';
  }
}

const normalizePaletteChannel = (value: number, use63Scale: boolean): number => {
  if (use63Scale) {
    return Math.round((clamp(value, 0, 63) / 63) * 255);
  }
  return Math.round(clamp(value, 0, 255));
};

export const parsePaletteColors = (
  content: string,
): Map<number, string> => {
  const rows = content.split(/\r?\n/);
  let meaningfulRowCount = 0;
  const parsedRows: Array<{ index: number; r: number; g: number; b: number }> = [];

  for (const rawRow of rows) {
    const row = rawRow.trim();
    if (!row || row.startsWith('#') || row.startsWith('//')) {
      continue;
    }

    meaningfulRowCount += 1;
    const match = row.match(PALETTE_ROW_PATTERN);
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

  if (meaningfulRowCount === 0) {
    throw new PaletteParseError('empty', 'Palette file is empty.');
  }

  if (parsedRows.length === 0) {
    throw new PaletteParseError('format', 'Palette format is not recognized.');
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

export const getLedRgbByVelocity = (
  velocity: number,
  paletteColorsByVelocity: ReadonlyMap<number, string>,
  defaultRgb: string,
): string => {
  const colorIndex = Math.round(clamp(velocity, 0, 127));
  return paletteColorsByVelocity.get(colorIndex) ?? defaultRgb;
};

export const createPaletteRgbResolver = (
  palette: PaletteFilePayload,
  defaultRgb: string,
): (velocity: number) => string => {
  const colors = parsePaletteColors(palette.content);
  return (velocity) => getLedRgbByVelocity(velocity, colors, defaultRgb);
};
