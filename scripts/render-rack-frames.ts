import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import {
  DEFAULT_PALETTE_CONTENT,
  DEFAULT_PALETTE_NAME,
} from '../src/assets/palettes/novation-rgb';
import { getLaunchpadRuntimeMap, resolveLaunchpadModel } from '../src/domain';
import {
  loadRackPreviewFromFile,
  RACK_REGRESSION_FIXTURE_DIR,
  sampleRackPreviewFrames,
  type SampledRackFrame,
} from '../src/generation/rack-preview-debug';
import { resolveLedSurfaceRgb } from '../src/renderer/app/led-surface-color';
import type { GeneratorPreview } from '../src/shared/contracts/preview/generator-preview';
import type { LaunchpadButton, LaunchpadModel } from '../src/shared/model';
import {
  createPaletteRgbResolver,
} from '../src/shared/palette-colors';

type Rgb = readonly [number, number, number];

const DEFAULT_FRAME_COUNT = 32;
const FRAMES_PER_ROW = 32;
const PREVIEW_COLS = 10;
const PREVIEW_ROWS = 10;
const CELL_SIZE = 12;
const CELL_GAP = 2;
const FRAME_GAP = 14;
const FRAME_ROW_GAP = 12;
const RACK_ROW_GAP = 24;
const RACK_SECTION_HEADER_HEIGHT = 30;
const FRAME_LABEL_HEIGHT = 16;
const PAGE_PADDING = 18;
const PAGE_HEADER_HEIGHT = 40;
const DEFAULT_LED_RGB = '0 0 0';
const SURFACE_RGB: Rgb = [13, 13, 15];
const UNLIT_PAD_RGB: Rgb = [42, 46, 55];
const TITLE_RGB: Rgb = [230, 232, 238];
const META_RGB: Rgb = [168, 173, 187];

interface CliOptions {
  compare: boolean;
  frames: number;
  model: LaunchpadModel;
  outputPath: string | null;
  rackPaths: string[];
}

interface RenderRackInput {
  label: string;
  rackPath: string;
  preview: GeneratorPreview;
  sampledFrames: SampledRackFrame[];
}

interface PreviewCell {
  row: number;
  col: number;
  pitches: number[];
}

interface RenderLayout {
  frameWidth: number;
  frameHeight: number;
  framesPerRow: number;
  height: number;
  isCompare: boolean;
  rackRowHeights: number[];
  title: string;
  meta: string;
  width: number;
}

const usage = (): string => [
  'Usage:',
  '  npm run rack:frames -- [--frames 32] [--model mk3|mk2] [--output tmp/rack-frames.png] rack.compassrack',
  '  npm run rack:frames -- --compare [--frames 32] [--model mk3|mk2] [--output tmp/rack-compare.png] rack-a.compassrack rack-b.compassrack',
].join('\n');

const requireValue = (
  args: string[],
  index: number,
  optionName: string,
): string => {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value.\n${usage()}`);
  }
  return value;
};

const parsePositiveInteger = (
  value: string,
  optionName: string,
): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  return parsed;
};

const parseModel = (value: string): LaunchpadModel => {
  if (value !== 'mk2' && value !== 'mk3') {
    throw new Error('--model must be mk2 or mk3.');
  }
  return value;
};

const parseArgs = (
  args: string[],
): CliOptions => {
  const options: CliOptions = {
    compare: false,
    frames: DEFAULT_FRAME_COUNT,
    model: 'mk3',
    outputPath: null,
    rackPaths: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--help':
      case '-h':
        console.log(usage());
        process.exit(0);
        break;
      case '--compare':
        options.compare = true;
        break;
      case '--frames':
        options.frames = parsePositiveInteger(requireValue(args, index, '--frames'), '--frames');
        index += 1;
        break;
      case '--model':
        options.model = parseModel(requireValue(args, index, '--model'));
        index += 1;
        break;
      case '--output':
      case '-o': {
        options.outputPath = requireValue(args, index, arg);
        index += 1;
        break;
      }
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unknown option: ${arg}\n${usage()}`);
        }
        options.rackPaths.push(arg);
        break;
    }
  }

  if (options.compare) {
    if (options.rackPaths.length < 2) {
      throw new Error(`--compare requires at least two rack files.\n${usage()}`);
    }
  } else if (options.rackPaths.length !== 1) {
    throw new Error(`Expected exactly one rack file.\n${usage()}`);
  }

  return options;
};

const resolveRackPath = (
  inputPath: string,
): string => {
  const candidates = [
    path.resolve(inputPath),
    path.join(RACK_REGRESSION_FIXTURE_DIR, inputPath),
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(`Rack file not found: ${inputPath}`);
  }
  return resolved;
};

const resolveDefaultOutputPath = (
  options: CliOptions,
): string => {
  if (options.outputPath) {
    return path.resolve(options.outputPath);
  }

  const baseName = options.compare
    ? 'rack-frame-compare'
    : path.basename(options.rackPaths[0], path.extname(options.rackPaths[0]));
  return path.join(process.cwd(), 'tmp', `${baseName}-frames.png`);
};

const cellKey = (row: number, col: number): string => `${row}:${col}`;

const buttonToPreviewCell = (
  button: LaunchpadButton,
): { row: number; col: number } | null => {
  switch (button.zone) {
    case 'grid':
      return { row: 9 - button.y, col: button.x };
    case 'left':
      if (button.id === 'left-top') {
        return { row: 0, col: 0 };
      }
      return { row: 9 - button.y, col: 0 };
    case 'right':
      return { row: 9 - button.y, col: 9 };
    case 'top':
      return { row: 0, col: button.x };
    case 'bottom':
      return { row: 9, col: button.x };
    case 'logo':
      return { row: 0, col: 9 };
    default:
      return null;
  }
};

const buildPreviewCells = (
  model: LaunchpadModel,
): PreviewCell[] => {
  const pitchesByCell = new Map<string, number[]>();
  for (const button of getLaunchpadRuntimeMap(model).buttons) {
    if (button.output.kind !== 'note') {
      continue;
    }

    const cell = buttonToPreviewCell(button);
    if (!cell) {
      continue;
    }

    const key = cellKey(cell.row, cell.col);
    const pitches = pitchesByCell.get(key);
    if (pitches) {
      pitches.push(button.output.number);
      continue;
    }
    pitchesByCell.set(key, [button.output.number]);
  }

  const cells: PreviewCell[] = [];
  for (let row = 0; row < PREVIEW_ROWS; row += 1) {
    for (let col = 0; col < PREVIEW_COLS; col += 1) {
      cells.push({
        row,
        col,
        pitches: pitchesByCell.get(cellKey(row, col)) ?? [],
      });
    }
  }
  return cells;
};

const clampRgbChannel = (
  value: number,
): number => Math.round(Math.min(255, Math.max(0, value)));

const parseRgbString = (
  rgb: string,
): Rgb => {
  const channels = rgb.trim().split(/\s+/).map((channel) => Number(channel));
  if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
    return [0, 0, 0];
  }
  return [
    clampRgbChannel(channels[0]),
    clampRgbChannel(channels[1]),
    clampRgbChannel(channels[2]),
  ];
};

const FONT_3X5: Record<string, string[]> = {
  ' ': ['000', '000', '000', '000', '000'],
  '.': ['000', '000', '000', '000', '010'],
  '-': ['000', '000', '111', '000', '000'],
  '_': ['000', '000', '000', '000', '111'],
  '/': ['001', '001', '010', '100', '100'],
  ':': ['000', '010', '000', '010', '000'],
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['111', '100', '100', '100', '111'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['111', '100', '101', '101', '111'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '111'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['101', '111', '111', '111', '101'],
  O: ['111', '101', '101', '101', '111'],
  P: ['111', '101', '111', '100', '100'],
  Q: ['111', '101', '101', '111', '001'],
  R: ['110', '101', '110', '101', '101'],
  S: ['111', '100', '111', '001', '111'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
};

const writePngChunk = (
  type: string,
  data: Buffer,
): Buffer => {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
};

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

const crc32 = (
  data: Buffer,
): number => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const createPngBuffer = (
  width: number,
  height: number,
  pixels: Buffer,
): Buffer => {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rawOffset = y * (width * 4 + 1);
    raw[rawOffset] = 0;
    pixels.copy(raw, rawOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    writePngChunk('IHDR', header),
    writePngChunk('IDAT', deflateSync(raw)),
    writePngChunk('IEND', Buffer.alloc(0)),
  ]);
};

const drawRect = (
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  rgb: Rgb,
): void => {
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(width, Math.ceil(x + rectWidth));
  const endY = Math.min(height, Math.ceil(y + rectHeight));
  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      const offset = ((py * width) + px) * 4;
      pixels[offset] = rgb[0];
      pixels[offset + 1] = rgb[1];
      pixels[offset + 2] = rgb[2];
      pixels[offset + 3] = 255;
    }
  }
};

const drawText = (
  pixels: Buffer,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  scale: number,
  rgb: Rgb,
): void => {
  let cursorX = x;
  for (const rawChar of text.toUpperCase()) {
    const glyph = FONT_3X5[rawChar] ?? FONT_3X5[' '];
    for (let row = 0; row < glyph.length; row += 1) {
      for (let col = 0; col < glyph[row].length; col += 1) {
        if (glyph[row][col] !== '1') {
          continue;
        }
        drawRect(pixels, width, height, cursorX + col * scale, y + row * scale, scale, scale, rgb);
      }
    }
    cursorX += 4 * scale;
  }
};

const buildLayout = (
  racks: ReadonlyArray<RenderRackInput>,
  model: LaunchpadModel,
): RenderLayout => {
  const frameWidth = (PREVIEW_COLS * CELL_SIZE) + ((PREVIEW_COLS - 1) * CELL_GAP);
  const frameHeight = FRAME_LABEL_HEIGHT + (PREVIEW_ROWS * CELL_SIZE) + ((PREVIEW_ROWS - 1) * CELL_GAP);
  const maxFrameCount = Math.max(...racks.map((rack) => rack.sampledFrames.length));
  const framesPerRow = Math.max(1, Math.min(FRAMES_PER_ROW, maxFrameCount));
  const isCompare = racks.length > 1;
  const rackRowHeights = racks.map((rack) => {
    const frameRowCount = Math.max(1, Math.ceil(rack.sampledFrames.length / framesPerRow));
    return (isCompare ? RACK_SECTION_HEADER_HEIGHT : 0)
      + (frameRowCount * frameHeight)
      + ((frameRowCount - 1) * FRAME_ROW_GAP);
  });
  const width = PAGE_PADDING
    + (framesPerRow * frameWidth)
    + (Math.max(framesPerRow - 1, 0) * FRAME_GAP)
    + PAGE_PADDING;
  const height = PAGE_PADDING
    + PAGE_HEADER_HEIGHT
    + rackRowHeights.reduce((total, rackRowHeight) => total + rackRowHeight, 0)
    + (Math.max(racks.length - 1, 0) * RACK_ROW_GAP)
    + PAGE_PADDING;
  return {
    frameWidth,
    frameHeight,
    framesPerRow,
    height,
    isCompare,
    rackRowHeights,
    title: isCompare ? 'Rack frame compare' : racks[0].label,
    meta: isCompare
      ? `model ${model} - palette ${DEFAULT_PALETTE_NAME} - ${racks.length} racks`
      : `model ${model} - palette ${DEFAULT_PALETTE_NAME} - ${racks[0].preview.ledFramesBySampleIndex.length} frames`,
    width,
  };
};

const renderPng = (
  racks: ReadonlyArray<RenderRackInput>,
  model: LaunchpadModel,
): Buffer => {
  const cells = buildPreviewCells(model);
  const paletteRgb = createPaletteRgbResolver({
    name: DEFAULT_PALETTE_NAME,
    content: DEFAULT_PALETTE_CONTENT,
  }, DEFAULT_LED_RGB);
  const resolveVelocityRgb = (velocity: number): Rgb =>
    parseRgbString(resolveLedSurfaceRgb(paletteRgb(velocity)));
  const layout = buildLayout(racks, model);
  const pixels = Buffer.alloc(layout.width * layout.height * 4);
  drawRect(pixels, layout.width, layout.height, 0, 0, layout.width, layout.height, SURFACE_RGB);
  drawText(pixels, layout.width, layout.height, layout.title, PAGE_PADDING, PAGE_PADDING, 3, TITLE_RGB);
  drawText(pixels, layout.width, layout.height, layout.meta, PAGE_PADDING, PAGE_PADDING + 20, 2, META_RGB);

  let rackY = PAGE_PADDING + PAGE_HEADER_HEIGHT;
  racks.forEach((rack, rowIndex) => {
    const rowY = rackY;
    if (layout.isCompare) {
      drawText(pixels, layout.width, layout.height, rack.label, PAGE_PADDING, rowY, 2, TITLE_RGB);
      drawText(pixels, layout.width, layout.height, `${rack.preview.ledFramesBySampleIndex.length} frames - ${rack.preview.notes.length} notes`, PAGE_PADDING, rowY + 14, 2, META_RGB);
    }

    const frameBaseY = rowY + (layout.isCompare ? RACK_SECTION_HEADER_HEIGHT : 0);
    rack.sampledFrames.forEach((frame, frameIndex) => {
      const activeVelocityByPitch = new Map<number, number>(frame.entries);
      const frameRowIndex = Math.floor(frameIndex / layout.framesPerRow);
      const frameColumnIndex = frameIndex % layout.framesPerRow;
      const frameX = PAGE_PADDING
        + (frameColumnIndex * (layout.frameWidth + FRAME_GAP));
      const frameY = frameBaseY + (frameRowIndex * (layout.frameHeight + FRAME_ROW_GAP));
      drawText(pixels, layout.width, layout.height, `f${frame.frameIndex}`, frameX, frameY, 1, META_RGB);
      const gridY = frameY + FRAME_LABEL_HEIGHT;

      for (const cell of cells) {
        const x = frameX + (cell.col * (CELL_SIZE + CELL_GAP));
        const y = gridY + (cell.row * (CELL_SIZE + CELL_GAP));
        const activeVelocity = cell.pitches
          .map((pitch) => activeVelocityByPitch.get(pitch) ?? 0)
          .find((velocity) => velocity > 0) ?? 0;
        const fill = activeVelocity > 0
          ? resolveVelocityRgb(activeVelocity)
          : UNLIT_PAD_RGB;
        drawRect(pixels, layout.width, layout.height, x, y, CELL_SIZE, CELL_SIZE, SURFACE_RGB);
        drawRect(pixels, layout.width, layout.height, x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2, fill);
      }
    });

    rackY += layout.rackRowHeights[rowIndex] + RACK_ROW_GAP;
  });

  return createPngBuffer(layout.width, layout.height, pixels);
};

const loadRackInputs = async (
  options: CliOptions,
): Promise<RenderRackInput[]> => Promise.all(options.rackPaths.map(async (inputPath) => {
  const rackPath = resolveRackPath(inputPath);
  const preview = await loadRackPreviewFromFile(rackPath, {
    launchpadModel: options.model,
  });
  return {
    label: path.basename(rackPath),
    rackPath,
    preview,
    sampledFrames: sampleRackPreviewFrames(preview, options.frames),
  };
}));

const assertPngOutputPath = (
  outputPath: string,
): void => {
  if (path.extname(outputPath).toLowerCase() !== '.png') {
    throw new Error(`Output path must end with .png: ${outputPath}`);
  }
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const model = resolveLaunchpadModel(options.model);
  const racks = await loadRackInputs({ ...options, model });
  const outputPath = resolveDefaultOutputPath(options);
  assertPngOutputPath(outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderPng(racks, model));

  for (const rack of racks) {
    console.log(`${rack.label}: ${rack.preview.ledFramesBySampleIndex.length} frames, ${rack.preview.notes.length} notes (${rack.rackPath})`);
  }
  console.log(`Wrote ${outputPath}`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
