import type {
  CurveModulatorNode,
  GeneratorDeviceNode,
  ModulationCurve,
} from './types';

export type DeviceKind = GeneratorDeviceNode['kind'];
export type DeviceGroup = 'generator' | 'effect';
type DeviceNodeOfKind<K extends DeviceKind> = Extract<GeneratorDeviceNode, { kind: K }>;

export const DEVICE_KIND_LABELS = {
  waterdrop: 'Waterdrop',
  scanner: 'Scanner',
  spiral: 'Spiral',
  modulator: 'Modulator',
  mirror: 'Mirror',
  mask: 'Mask',
  symmetry: 'Symmetry',
  rotate: 'Rotate',
  reverse: 'Reverse',
  color: 'Color',
} as const satisfies Record<DeviceKind, string>;

export const DEVICE_KIND_GROUPS = {
  generator: ['waterdrop', 'scanner', 'spiral'],
  effect: ['modulator', 'mirror', 'symmetry', 'mask', 'rotate', 'reverse', 'color'],
} as const satisfies Record<DeviceGroup, readonly DeviceKind[]>;

export const DEVICE_KINDS = Object.freeze(
  Object.keys(DEVICE_KIND_LABELS) as DeviceKind[],
);

const DEVICE_KIND_SET = new Set<DeviceKind>(DEVICE_KINDS);
const GENERATOR_KIND_SET = new Set<DeviceKind>(
  DEVICE_KIND_GROUPS.generator as readonly DeviceKind[],
);

export const isDeviceKind = (value: string | undefined): value is DeviceKind =>
  !!value && DEVICE_KIND_SET.has(value as DeviceKind);

export const getDeviceLabel = (kind: DeviceKind): string =>
  DEVICE_KIND_LABELS[kind];

export const getDeviceGroup = (kind: DeviceKind): DeviceGroup =>
  GENERATOR_KIND_SET.has(kind) ? 'generator' : 'effect';

export const WATERDROP_PARAM_KEYS = [
  'centerX',
  'centerY',
  'curvature',
  'startRadius',
] as const;
export const SCANNER_PARAM_KEYS = ['angleDeg', 'startOffset'] as const;
export const SPIRAL_PARAM_KEYS = [
  'centerX',
  'centerY',
  'turns',
  'startRadius',
] as const;

export type WaterdropParamKey = (typeof WATERDROP_PARAM_KEYS)[number];
export type ScannerParamKey = (typeof SCANNER_PARAM_KEYS)[number];
export type SpiralParamKey = (typeof SPIRAL_PARAM_KEYS)[number];

export interface ModulationTargetParamDefinition {
  key: string;
  label: string;
}

export type ModulationTargetDeviceKind = Exclude<
  DeviceKind,
  'reverse' | 'modulator' | 'symmetry' | 'mask' | 'color'
>;

const MODULATION_TARGET_PARAM_DEFINITIONS: Record<
  ModulationTargetDeviceKind,
  readonly ModulationTargetParamDefinition[]
> = {
  waterdrop: [
    { key: 'centerX', label: 'Center X' },
    { key: 'centerY', label: 'Center Y' },
    { key: 'curvature', label: 'Curvature' },
    { key: 'startRadius', label: 'Start Radius' },
  ],
  scanner: [
    { key: 'angleDeg', label: 'Angle' },
    { key: 'startOffset', label: 'Start Offset' },
  ],
  spiral: [
    { key: 'centerX', label: 'Center X' },
    { key: 'centerY', label: 'Center Y' },
    { key: 'turns', label: 'Turns' },
    { key: 'startRadius', label: 'Start Radius' },
  ],
  mirror: [
    { key: 'angleDeg', label: 'Mirror Axis Angle' },
  ],
  rotate: [
    { key: 'angleDeg', label: 'Angle' },
  ],
};

const MODULATION_TARGET_KIND_SET = new Set<ModulationTargetDeviceKind>(
  Object.keys(MODULATION_TARGET_PARAM_DEFINITIONS) as ModulationTargetDeviceKind[],
);

export const isModulationTargetDeviceKind = (
  kind: DeviceKind,
): kind is ModulationTargetDeviceKind =>
  MODULATION_TARGET_KIND_SET.has(kind as ModulationTargetDeviceKind);

export const getModulationTargetParamDefinitions = (
  kind: DeviceKind,
): readonly ModulationTargetParamDefinition[] => (
  isModulationTargetDeviceKind(kind)
    ? MODULATION_TARGET_PARAM_DEFINITIONS[kind]
    : []
);

export const isModulationTargetParamKey = (
  kind: DeviceKind,
  paramKey: string,
): boolean =>
  getModulationTargetParamDefinitions(kind).some((item) => item.key === paramKey);

const DEFAULT_WATERDROP_PARAMS: DeviceNodeOfKind<'waterdrop'>['params'] = {
  centerX: 4.5,
  centerY: 4.5,
  curvature: 2,
  startRadius: 0,
};

const DEFAULT_SCANNER_PARAMS: DeviceNodeOfKind<'scanner'>['params'] = {
  angleDeg: 0,
  startOffset: 0,
};

const DEFAULT_SPIRAL_PARAMS: DeviceNodeOfKind<'spiral'>['params'] = {
  centerX: 4.5,
  centerY: 4.5,
  turns: 2,
  startRadius: 0,
};

const DEFAULT_MIRROR_PARAMS: DeviceNodeOfKind<'mirror'>['params'] = {
  angleDeg: 90,
};

const DEFAULT_MASK_PARAMS: DeviceNodeOfKind<'mask'>['params'] = {
  mode: 'include',
  tiles: [],
  sourceKind: 'tiles',
  sourceId: null,
  sourceVisibility: 'hide',
};

const DEFAULT_SYMMETRY_PARAMS: DeviceNodeOfKind<'symmetry'>['params'] = {
  mode: 'mirror-half',
  axis: 'horizontal',
  sourceAnchor: 'bl',
};

const DEFAULT_ROTATE_PARAMS: DeviceNodeOfKind<'rotate'>['params'] = {
  angleDeg: 90,
};

const DEFAULT_COLOR_PARAMS: DeviceNodeOfKind<'color'>['params'] = {
  velocities: [3],
  noteLengthPercent: 100,
};

const DEFAULT_MODULATION_PARAMS: CurveModulatorNode['params'] = {
  amount: 1,
  target: null,
  curve: {
    domain: 'loop01',
    divisions: 16,
    nodes: [
      { id: 'curve-node-start', t: 0, v: 0 },
      { id: 'curve-node-end', t: 1, v: 0 },
    ],
  },
};

const cloneCurve = (curve: ModulationCurve): ModulationCurve => ({
  domain: curve.domain,
  divisions: curve.divisions,
  nodes: curve.nodes.map((node) => ({ ...node })),
});

type DefaultDeviceFactoryMap = {
  [K in DeviceKind]: (id: string, enabled: boolean) => DeviceNodeOfKind<K>;
};

const DEFAULT_DEVICE_FACTORIES = {
  waterdrop: (id: string, enabled: boolean): DeviceNodeOfKind<'waterdrop'> => ({
    id,
    kind: 'waterdrop',
    enabled,
    groupId: null,
    params: { ...DEFAULT_WATERDROP_PARAMS },
  }),
  scanner: (id: string, enabled: boolean): DeviceNodeOfKind<'scanner'> => ({
    id,
    kind: 'scanner',
    enabled,
    groupId: null,
    params: { ...DEFAULT_SCANNER_PARAMS },
  }),
  spiral: (id: string, enabled: boolean): DeviceNodeOfKind<'spiral'> => ({
    id,
    kind: 'spiral',
    enabled,
    groupId: null,
    params: { ...DEFAULT_SPIRAL_PARAMS },
  }),
  modulator: (id: string, enabled: boolean): DeviceNodeOfKind<'modulator'> => ({
    id,
    kind: 'modulator',
    enabled,
    groupId: null,
    params: {
      amount: DEFAULT_MODULATION_PARAMS.amount,
      target: DEFAULT_MODULATION_PARAMS.target,
      curve: cloneCurve(DEFAULT_MODULATION_PARAMS.curve),
    },
  }),
  mirror: (id: string, enabled: boolean): DeviceNodeOfKind<'mirror'> => ({
    id,
    kind: 'mirror',
    enabled,
    groupId: null,
    params: { ...DEFAULT_MIRROR_PARAMS },
  }),
  mask: (id: string, enabled: boolean): DeviceNodeOfKind<'mask'> => ({
    id,
    kind: 'mask',
    enabled,
    groupId: null,
    params: {
      mode: DEFAULT_MASK_PARAMS.mode,
      tiles: [...DEFAULT_MASK_PARAMS.tiles],
      sourceKind: DEFAULT_MASK_PARAMS.sourceKind,
      sourceId: DEFAULT_MASK_PARAMS.sourceId,
      sourceVisibility: DEFAULT_MASK_PARAMS.sourceVisibility,
    },
  }),
  symmetry: (id: string, enabled: boolean): DeviceNodeOfKind<'symmetry'> => ({
    id,
    kind: 'symmetry',
    enabled,
    groupId: null,
    params: { ...DEFAULT_SYMMETRY_PARAMS },
  }),
  rotate: (id: string, enabled: boolean): DeviceNodeOfKind<'rotate'> => ({
    id,
    kind: 'rotate',
    enabled,
    groupId: null,
    params: { ...DEFAULT_ROTATE_PARAMS },
  }),
  reverse: (id: string, enabled: boolean): DeviceNodeOfKind<'reverse'> => ({
    id,
    kind: 'reverse',
    enabled,
    groupId: null,
  }),
  color: (id: string, enabled: boolean): DeviceNodeOfKind<'color'> => ({
    id,
    kind: 'color',
    enabled,
    groupId: null,
    params: {
      velocities: [...DEFAULT_COLOR_PARAMS.velocities],
      noteLengthPercent: DEFAULT_COLOR_PARAMS.noteLengthPercent,
    },
  }),
} as const satisfies DefaultDeviceFactoryMap;

export const createDefaultDeviceNode = (
  kind: DeviceKind,
  id: string,
  enabled = true,
): GeneratorDeviceNode => {
  const isEnabled = enabled !== false;
  return DEFAULT_DEVICE_FACTORIES[kind](id, isEnabled);
};

export const cloneDeviceNode = (
  device: GeneratorDeviceNode,
): GeneratorDeviceNode => {
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

  const cloned = createDefaultDeviceNode(
    device.kind,
    device.id,
    device.enabled !== false,
  );
  cloned.groupId = device.groupId ?? null;
  if ('params' in cloned) {
    cloned.params = { ...device.params };
  }
  return cloned;
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
