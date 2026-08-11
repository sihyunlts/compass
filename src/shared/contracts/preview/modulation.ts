export interface ModulationParameterState {
  targetId: string;
  modulatorId: string;
  modulatorLabel: string;
  baseValue: number;
  amount: number;
  modulatedValue: number;
}

export type ModulationStateByParameter = Readonly<
  Record<string, readonly ModulationParameterState[]>
>;

export const createModulationParameterKey = (
  deviceId: string,
  paramKey: string,
): string => `${deviceId}:${paramKey}`;
