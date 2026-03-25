import { getLaunchpadRuntimeMap } from './launchpad-model';
import type { LaunchpadModel } from '../shared/model';
import type { ButtonIndex } from '../core/pipeline/types';
import type { RuntimeMapData } from './note-generation-types';

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

  return {
    buttons,
    buttonIndex,
  };
};
