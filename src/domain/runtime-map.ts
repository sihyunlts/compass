import { getLaunchpadRuntimeMap } from './launchpad-model';
import type { LaunchpadModel } from '../shared/model';
import type { RuntimeMapData } from './note-generation-types';

const toAddressKey = (pitch: number, channel: number): string => `${channel}:${pitch}`;

export const buildRuntimeMapData = (
  launchpadModel: LaunchpadModel | undefined,
): RuntimeMapData => {
  const runtimeMap = getLaunchpadRuntimeMap(launchpadModel);
  const buttonAddressToTileId = new Map<string, number>();

  for (const button of runtimeMap.buttons) {
    if (button.output.kind !== 'note') {
      continue;
    }

    buttonAddressToTileId.set(
      toAddressKey(button.output.number, button.output.channel),
      (button.y * 10) + button.x,
    );
  }

  return {
    buttons: runtimeMap.buttons,
    buttonIndex: runtimeMap.buttonIndex,
    buttonAddressToTileId,
  };
};

export const resolveAddressKey = toAddressKey;
