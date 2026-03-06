import type { GeneratorDeviceNode } from '../shared/model';
import {
  getRendererModulationTargetParamDefinitions,
  RENDERER_DEVICE_KINDS,
} from './schema-registry';

type DeviceKind = GeneratorDeviceNode['kind'];
type DeviceNodeOfKind<K extends DeviceKind> = Extract<GeneratorDeviceNode, { kind: K }>;

type ModulationTargetDeviceKind = Exclude<
  DeviceKind,
  'reverse' | 'modulator' | 'symmetry' | 'mask' | 'color'
>;

const MODULATION_TARGET_DEVICE_KINDS = RENDERER_DEVICE_KINDS.filter(
  (kind) => getRendererModulationTargetParamDefinitions(kind).length > 0,
) as readonly ModulationTargetDeviceKind[];

const MODULATION_TARGET_KIND_SET = new Set<ModulationTargetDeviceKind>(
  MODULATION_TARGET_DEVICE_KINDS,
);

export const isModulationTargetDeviceKind = (
  kind: DeviceKind,
): kind is ModulationTargetDeviceKind =>
  MODULATION_TARGET_KIND_SET.has(kind as ModulationTargetDeviceKind);

export const isModulationTargetParamKey = (
  kind: DeviceKind,
  paramKey: string,
): boolean =>
  isModulationTargetDeviceKind(kind)
    && getRendererModulationTargetParamDefinitions(kind)
      .some((definition) => definition.key === paramKey);

type NumericParamAccessor = {
  read: (device: GeneratorDeviceNode) => number;
  write: (device: GeneratorDeviceNode, value: number) => void;
};

const NUMERIC_PARAM_ACCESSORS: Record<
  ModulationTargetDeviceKind,
  Record<string, NumericParamAccessor>
> = {
  waterdrop: {
    centerX: {
      read: (device) => (device as DeviceNodeOfKind<'waterdrop'>).params.centerX,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'waterdrop'>).params.centerX = value;
      },
    },
    centerY: {
      read: (device) => (device as DeviceNodeOfKind<'waterdrop'>).params.centerY,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'waterdrop'>).params.centerY = value;
      },
    },
    curvature: {
      read: (device) => (device as DeviceNodeOfKind<'waterdrop'>).params.curvature,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'waterdrop'>).params.curvature = value;
      },
    },
    startRadius: {
      read: (device) => (device as DeviceNodeOfKind<'waterdrop'>).params.startRadius,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'waterdrop'>).params.startRadius = value;
      },
    },
  },
  scanner: {
    angleDeg: {
      read: (device) => (device as DeviceNodeOfKind<'scanner'>).params.angleDeg,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'scanner'>).params.angleDeg = value;
      },
    },
    startOffset: {
      read: (device) => (device as DeviceNodeOfKind<'scanner'>).params.startOffset,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'scanner'>).params.startOffset = value;
      },
    },
  },
  spiral: {
    centerX: {
      read: (device) => (device as DeviceNodeOfKind<'spiral'>).params.centerX,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'spiral'>).params.centerX = value;
      },
    },
    centerY: {
      read: (device) => (device as DeviceNodeOfKind<'spiral'>).params.centerY,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'spiral'>).params.centerY = value;
      },
    },
    turns: {
      read: (device) => (device as DeviceNodeOfKind<'spiral'>).params.turns,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'spiral'>).params.turns = value;
      },
    },
    startRadius: {
      read: (device) => (device as DeviceNodeOfKind<'spiral'>).params.startRadius,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'spiral'>).params.startRadius = value;
      },
    },
  },
  mirror: {
    angleDeg: {
      read: (device) => (device as DeviceNodeOfKind<'mirror'>).params.angleDeg,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'mirror'>).params.angleDeg = value;
      },
    },
  },
  rotate: {
    angleDeg: {
      read: (device) => (device as DeviceNodeOfKind<'rotate'>).params.angleDeg,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'rotate'>).params.angleDeg = value;
      },
    },
  },
};

export const readNumericDeviceParam = (
  device: GeneratorDeviceNode,
  paramKey: string,
): number | null => {
  if (!isModulationTargetDeviceKind(device.kind)) {
    return null;
  }

  const accessor = NUMERIC_PARAM_ACCESSORS[device.kind][paramKey];
  return accessor ? accessor.read(device) : null;
};

export const writeNumericDeviceParam = (
  device: GeneratorDeviceNode,
  paramKey: string,
  value: number,
): boolean => {
  if (!Number.isFinite(value) || !isModulationTargetDeviceKind(device.kind)) {
    return false;
  }

  const accessor = NUMERIC_PARAM_ACCESSORS[device.kind][paramKey];
  if (!accessor) {
    return false;
  }

  accessor.write(device, value);
  return true;
};
