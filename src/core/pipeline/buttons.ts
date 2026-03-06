import type { LaunchpadButton } from '../../shared/model';
import type { Vec2 } from '../core-types';
import type { ButtonIndex, ButtonIndexGroup } from './types';

export const buildButtonIndex = (buttons: ReadonlyArray<LaunchpadButton>): ButtonIndex => {
  const groupsByCoordinate = new Map<string, ButtonIndexGroup>();

  for (const button of buttons) {
    if (button.output.kind !== 'note') {
      continue;
    }

    const key = `${button.x},${button.y}`;
    const group = groupsByCoordinate.get(key);
    if (group) {
      group.buttons.push(button);
    } else {
      groupsByCoordinate.set(key, {
        x: button.x,
        y: button.y,
        buttons: [button],
      });
    }
  }

  const groups = [...groupsByCoordinate.values()];
  const coordinates: Vec2[] = groups.map((group) => ({ x: group.x, y: group.y }));

  return { groups, coordinates };
};
