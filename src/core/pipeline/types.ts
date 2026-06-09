import type { LaunchpadButton } from '../../shared/model';

export interface ButtonIndexGroup {
  x: number;
  y: number;
  buttons: LaunchpadButton[];
}

export interface ButtonIndex {
  groups: ReadonlyArray<ButtonIndexGroup>;
}
