import { getLaunchpadRuntimeMap } from './launchpad-model';
import type { LaunchpadModel } from '../shared/model';
import type { ButtonIndex } from '../core/pipeline/types';
import type { RuntimeMapData } from './note-generation-types';

const toAddressKey = (pitch: number, channel: number): string => `${channel}:${pitch}`;

export const buildRuntimeMapData = (
  launchpadModel: LaunchpadModel | undefined,
): RuntimeMapData => {
  const runtimeMap = getLaunchpadRuntimeMap(launchpadModel);
  return buildRuntimeMapDataFromButtonIndex(runtimeMap.buttonIndex);
};

export const buildRuntimeMapDataFromButtonIndex = (
  buttonIndex: ButtonIndex,
): RuntimeMapData => {
  const buttons = buttonIndex.groups.flatMap((group) => group.buttons);
  const buttonAddressToTileId = new Map<string, number>();

  for (const button of buttons) {
    if (button.output.kind !== 'note') {
      continue;
    }

    buttonAddressToTileId.set(
      toAddressKey(button.output.number, button.output.channel),
      (button.y * 10) + button.x,
    );
  }

  return {
    buttons,
    buttonIndex,
    buttonAddressToTileId,
  };
};

export const resolveAddressKey = toAddressKey;
