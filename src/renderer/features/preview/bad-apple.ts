// thanks to Aezuro for the idea xD
import type { PreviewWindowState } from '../../../shared/contracts/preview/window-state';
import type { LaunchpadModel } from '../../../shared/model';
import { resolvePreviewCellModels } from './view-model';

const MAGIC = 'BA10';
const HEADER_BYTES = 12;
const SUPPORTED_VERSION = 1;
const WHITE_RGB = '255 255 255';
const FRAME_DATA_URL = new URL(
  '../../../assets/easter-eggs/bad-apple-10x10-30fps.bin',
  import.meta.url,
);

export interface BadAppleAnimation {
  fps: number;
  width: number;
  height: number;
  frameCount: number;
  bytesPerFrame: number;
  frames: Uint8Array;
}

interface BadApplePreviewFrame {
  activeCells: PreviewWindowState['activeCells'];
  progress01: number;
}

const readMagic = (bytes: Uint8Array): string =>
  String.fromCharCode(...bytes.subarray(0, MAGIC.length));

const decodeBadAppleAnimation = (buffer: ArrayBuffer): BadAppleAnimation => {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < HEADER_BYTES || readMagic(bytes) !== MAGIC) {
    throw new Error('Invalid Bad Apple animation data.');
  }

  const version = bytes[4];
  const fps = bytes[5];
  const width = bytes[6];
  const height = bytes[7];
  const frameCount = new DataView(buffer).getUint32(8, true);
  const bytesPerFrame = Math.ceil((width * height) / 8);
  const expectedBytes = HEADER_BYTES + (frameCount * bytesPerFrame);
  if (
    version !== SUPPORTED_VERSION
    || fps <= 0
    || width !== 10
    || height !== 10
    || frameCount <= 0
    || bytes.length !== expectedBytes
  ) {
    throw new Error('Unsupported Bad Apple animation data.');
  }

  return {
    fps,
    width,
    height,
    frameCount,
    bytesPerFrame,
    frames: bytes.subarray(HEADER_BYTES),
  };
};

let animationPromise: Promise<BadAppleAnimation> | null = null;

/** Loads the pre-rasterized monochrome frames without bundling the source video. */
export const loadBadAppleAnimation = (): Promise<BadAppleAnimation> => {
  if (!animationPromise) {
    animationPromise = fetch(FRAME_DATA_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Bad Apple animation load failed (${response.status}).`);
        }
        return response.arrayBuffer();
      })
      .then(decodeBadAppleAnimation)
      .catch((error: unknown) => {
        animationPromise = null;
        throw error;
      });
  }
  return animationPromise;
};

const isPixelLit = (
  animation: BadAppleAnimation,
  frameIndex: number,
  pixelIndex: number,
): boolean => {
  const byteIndex = (frameIndex * animation.bytesPerFrame) + (pixelIndex >> 3);
  const bitMask = 1 << (pixelIndex & 7);
  return (animation.frames[byteIndex] & bitMask) !== 0;
};

/** Resolves one 30 fps frame directly to preview-only Launchpad cells. */
export const resolveBadApplePreviewFrame = (
  animation: BadAppleAnimation,
  elapsedMs: number,
  launchpadModel: LaunchpadModel,
): BadApplePreviewFrame | null => {
  const elapsedFrames = Math.floor(Math.max(elapsedMs, 0) * animation.fps / 1_000);
  if (elapsedFrames >= animation.frameCount) {
    return null;
  }
  const frameIndex = elapsedFrames;
  const cells = resolvePreviewCellModels(launchpadModel);
  const activeCells: PreviewWindowState['activeCells'] = [];

  for (let pixelIndex = 0; pixelIndex < cells.length; pixelIndex += 1) {
    if (!isPixelLit(animation, frameIndex, pixelIndex)) {
      continue;
    }
    const pitch = cells[pixelIndex].pitches[0];
    if (pitch === undefined) {
      continue;
    }
    activeCells.push({ pitch, rgb: WHITE_RGB });
  }

  return {
    activeCells,
    progress01: elapsedFrames / animation.frameCount,
  };
};
