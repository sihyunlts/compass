import type {
  GeneratorDeviceNode,
  ModulationCurve,
} from './model';

export type DeviceKind = GeneratorDeviceNode['kind'];
type DeviceNodeOfKind<K extends DeviceKind> = Extract<GeneratorDeviceNode, { kind: K }>;

export const DEVICE_KINDS = Object.freeze([
  'waterdrop',
  'scanner',
  'spiral',
  'modulator',
  'mirror',
  'mask',
  'symmetry',
  'rotate',
  'reverse',
  'color',
]) as readonly DeviceKind[];

const DEVICE_KIND_SET = new Set<DeviceKind>(DEVICE_KINDS);

export const isDeviceKind = (value: string | undefined): value is DeviceKind =>
  !!value && DEVICE_KIND_SET.has(value as DeviceKind);

export type ModulationTargetDeviceKind = Exclude<
  DeviceKind,
  'reverse' | 'modulator' | 'symmetry' | 'mask' | 'color'
>;

const MODULATION_TARGET_PARAM_KEYS: Record<
  ModulationTargetDeviceKind,
  readonly string[]
> = {
  waterdrop: ['centerX', 'centerY', 'curvature', 'startRadius'],
  scanner: ['angleDeg', 'startOffset'],
  spiral: ['centerX', 'centerY', 'turns', 'startRadius'],
  mirror: ['angleDeg'],
  rotate: ['angleDeg'],
};

const MODULATION_TARGET_KIND_SET = new Set<ModulationTargetDeviceKind>(
  Object.keys(MODULATION_TARGET_PARAM_KEYS) as ModulationTargetDeviceKind[],
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
    && MODULATION_TARGET_PARAM_KEYS[kind].includes(paramKey);

const cloneCurve = (curve: ModulationCurve): ModulationCurve => ({
  domain: curve.domain,
  divisions: curve.divisions,
  nodes: curve.nodes.map((node) => ({ ...node })),
});

export const cloneDeviceNode = (
  device: GeneratorDeviceNode,
): GeneratorDeviceNode => {
  if (device.kind === 'waterdrop') {
    return {
      id: device.id,
      kind: 'waterdrop',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'scanner') {
    return {
      id: device.id,
      kind: 'scanner',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'spiral') {
    return {
      id: device.id,
      kind: 'spiral',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'reverse') {
    return {
      id: device.id,
      kind: 'reverse',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
    };
  }

  if (device.kind === 'modulator') {
    return {
      id: device.id,
      kind: 'modulator',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: {
        amount: device.params.amount,
        target: device.params.target
          ? {
            deviceId: device.params.target.deviceId,
            paramKey: device.params.target.paramKey,
          }
          : null,
        curve: cloneCurve(device.params.curve),
      },
    };
  }

  if (device.kind === 'mask') {
    return {
      id: device.id,
      kind: 'mask',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: {
        mode: device.params.mode,
        tiles: [...device.params.tiles],
        sourceKind: device.params.sourceKind ?? 'tiles',
        sourceId: device.params.sourceId ?? null,
        sourceVisibility: device.params.sourceVisibility === 'show' ? 'show' : 'hide',
      },
    };
  }

  if (device.kind === 'color') {
    return {
      id: device.id,
      kind: 'color',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: {
        velocities: [...device.params.velocities],
        noteLengthPercent: device.params.noteLengthPercent,
      },
    };
  }

  if (device.kind === 'mirror') {
    return {
      id: device.id,
      kind: 'mirror',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'symmetry') {
    return {
      id: device.id,
      kind: 'symmetry',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: { ...device.params },
    };
  }

  return {
    id: device.id,
    kind: 'rotate',
    enabled: device.enabled !== false,
    groupId: device.groupId ?? null,
    params: { ...device.params },
  };
};

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
  if (!Number.isFinite(value)) {
    return false;
  }
  if (!isModulationTargetDeviceKind(device.kind)) {
    return false;
  }

  const accessor = NUMERIC_PARAM_ACCESSORS[device.kind][paramKey];
  if (!accessor) {
    return false;
  }

  accessor.write(device, value);
  return true;
};
