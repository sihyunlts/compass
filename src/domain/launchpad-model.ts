import { createLaunchpadMap } from '../core/launchpad-map';
import { buildButtonIndex } from '../core/pipeline/buttons';
import type { ButtonIndex } from '../core/pipeline/types';
import type { LaunchpadButton, LaunchpadModel } from '../shared/model';

const DEFAULT_LAUNCHPAD_MODEL: LaunchpadModel = 'mk3';

interface LaunchpadRuntimeMap {
  buttons: ReadonlyArray<LaunchpadButton>;
  buttonIndex: ButtonIndex;
}

const buildLaunchpadRuntimeMap = (model: LaunchpadModel): LaunchpadRuntimeMap => {
  const buttons = createLaunchpadMap(model);
  const buttonIndex = buildButtonIndex(buttons);
  return { buttons, buttonIndex };
};

const LAUNCHPAD_RUNTIME_MAPS: Record<LaunchpadModel, LaunchpadRuntimeMap> = {
  mk3: buildLaunchpadRuntimeMap('mk3'),
  mk2: buildLaunchpadRuntimeMap('mk2'),
};

/** Resolves the selected Launchpad model and falls back to MK3 for unknown values. */
export const resolveLaunchpadModel = (
  model?: LaunchpadModel,
): LaunchpadModel => (model === 'mk2' ? 'mk2' : DEFAULT_LAUNCHPAD_MODEL);

/** Returns the precomputed button map and button index for a Launchpad model. */
export const getLaunchpadRuntimeMap = (
  model?: LaunchpadModel,
): LaunchpadRuntimeMap => LAUNCHPAD_RUNTIME_MAPS[resolveLaunchpadModel(model)];
