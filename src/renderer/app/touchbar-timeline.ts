import { getLaunchpadRuntimeMap } from '../../domain';
import type { GeneratorPreview } from '../../shared/contracts/preview/generator-preview';
import type { PreviewTimelineFrameStrip } from '../../shared/contracts/preview/window-state';
import {
  buildLaunchpadPreviewCellIndexByPitch,
  LAUNCHPAD_PREVIEW_GRID_COLUMNS,
  LAUNCHPAD_PREVIEW_GRID_ROWS,
} from '../../shared/launchpad-preview-grid';
import { resolveLedSurfaceRgbChannels } from '../../shared/led-surface-color';
import type { LaunchpadModel } from '../../shared/model';

const TOUCH_BAR_TIMELINE_FRAME_COUNT = 12;

export const buildTouchBarTimelineFrameStrip = (
  preview: GeneratorPreview,
  launchpadModel: LaunchpadModel,
  resolveLedRgb: (velocity: number) => string,
): PreviewTimelineFrameStrip => {
  const cellIndexByPitch = buildLaunchpadPreviewCellIndexByPitch(
    getLaunchpadRuntimeMap(launchpadModel).buttons,
  );
  const sourceFrames = preview.ledFramesBySampleIndex;
  const frameCount = Math.min(
    TOUCH_BAR_TIMELINE_FRAME_COUNT,
    sourceFrames.length,
  );
  const cellCount =
    LAUNCHPAD_PREVIEW_GRID_COLUMNS * LAUNCHPAD_PREVIEW_GRID_ROWS;
  const data = new Uint8Array(frameCount * cellCount * 3);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const sourceIndex = frameCount <= 1
      ? 0
      : Math.round(
          (frameIndex / (frameCount - 1)) * (sourceFrames.length - 1),
        );

    for (const [pitch, velocity] of sourceFrames[sourceIndex]) {
      const cellIndex = cellIndexByPitch.get(pitch);
      if (cellIndex === undefined) {
        continue;
      }

      const channels = resolveLedSurfaceRgbChannels(resolveLedRgb(velocity));
      if (channels) {
        data.set(channels, (frameIndex * cellCount + cellIndex) * 3);
      }
    }
  }

  return {
    columns: LAUNCHPAD_PREVIEW_GRID_COLUMNS,
    rows: LAUNCHPAD_PREVIEW_GRID_ROWS,
    frameCount,
    data,
  };
};
