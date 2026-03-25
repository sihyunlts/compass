import type { GeneratorDeviceNode } from '../shared/model';
import { normalizePositiveScaleFactor } from './scale/schema';

type DeviceKind = GeneratorDeviceNode['kind'];
type DeviceNodeOfKind<K extends DeviceKind> = Extract<GeneratorDeviceNode, { kind: K }>;

type ModulationTargetDeviceKind = Exclude<
  DeviceKind,
  'path' | 'reverse' | 'timewarp' | 'modulator' | 'symmetry' | 'mask' | 'color'
>;

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
  },
  scanner: {
    angleDeg: {
      read: (device) => (device as DeviceNodeOfKind<'scanner'>).params.angleDeg,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'scanner'>).params.angleDeg = value;
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
  scale: {
    centerX: {
      read: (device) => (device as DeviceNodeOfKind<'scale'>).params.centerX,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'scale'>).params.centerX = value;
      },
    },
    centerY: {
      read: (device) => (device as DeviceNodeOfKind<'scale'>).params.centerY,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'scale'>).params.centerY = value;
      },
    },
    scaleX: {
      read: (device) => (device as DeviceNodeOfKind<'scale'>).params.scaleX,
      write: (device, value) => {
        const scaleDevice = device as DeviceNodeOfKind<'scale'>;
        scaleDevice.params.scaleX = normalizePositiveScaleFactor(value, scaleDevice.params.scaleX);
      },
    },
    scaleY: {
      read: (device) => (device as DeviceNodeOfKind<'scale'>).params.scaleY,
      write: (device, value) => {
        const scaleDevice = device as DeviceNodeOfKind<'scale'>;
        scaleDevice.params.scaleY = normalizePositiveScaleFactor(value, scaleDevice.params.scaleY);
      },
    },
  },
  translate: {
    offsetX: {
      read: (device) => (device as DeviceNodeOfKind<'translate'>).params.offsetX,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'translate'>).params.offsetX = value;
      },
    },
    offsetY: {
      read: (device) => (device as DeviceNodeOfKind<'translate'>).params.offsetY,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'translate'>).params.offsetY = value;
      },
    },
  },
  stretch: {
    start: {
      read: (device) => (device as DeviceNodeOfKind<'stretch'>).params.start,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'stretch'>).params.start = value;
      },
    },
    end: {
      read: (device) => (device as DeviceNodeOfKind<'stretch'>).params.end,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'stretch'>).params.end = value;
      },
    },
  },
  trim: {
    start: {
      read: (device) => (device as DeviceNodeOfKind<'trim'>).params.start,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'trim'>).params.start = value;
      },
    },
    end: {
      read: (device) => (device as DeviceNodeOfKind<'trim'>).params.end,
      write: (device, value) => {
        (device as DeviceNodeOfKind<'trim'>).params.end = value;
      },
    },
  },
};

const MODULATION_TARGET_DEVICE_KINDS = Object.freeze(
  Object.keys(NUMERIC_PARAM_ACCESSORS),
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
  && paramKey in NUMERIC_PARAM_ACCESSORS[kind];

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
