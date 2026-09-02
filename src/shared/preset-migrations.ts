const LEGACY_MODULATION_TARGET_ID = 'mod-target-legacy';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const createMigratedPathAnchorId = (
  deviceId: unknown,
  index: number,
): string => {
  const normalizedDeviceId = typeof deviceId === 'string' && deviceId.trim()
    ? deviceId.trim()
    : 'path';
  return `${normalizedDeviceId}-path-anchor-${index + 1}`;
};

const resolveLegacySymmetrySourceDirection = (
  params: {
    mode: 'mirror-half' | 'quad-mirror' | 'quad-pinwheel';
    axis: 'horizontal' | 'vertical';
    sourceAnchor: 'bl' | 'br' | 'tr' | 'tl';
  },
): number => {
  const anchor = params.sourceAnchor;
  if (params.mode === 'mirror-half') {
    if (params.axis === 'vertical') {
      return anchor === 'tl' || anchor === 'tr' ? 90 : 270;
    }
    return anchor === 'br' || anchor === 'tr' ? 0 : 180;
  }

  if (anchor === 'br') return 315;
  if (anchor === 'tr') return 45;
  if (anchor === 'tl') return 135;
  return 225;
};

const migrateLegacySymmetryParams = (
  params: Record<string, unknown>,
): Record<string, unknown> | null => {
  const { mode: legacyMode, axis, sourceAnchor } = params;
  if (
    legacyMode !== 'mirror-half'
      && legacyMode !== 'quad-mirror'
      && legacyMode !== 'quad-pinwheel'
    || axis !== 'horizontal' && axis !== 'vertical'
    || sourceAnchor !== 'bl'
      && sourceAnchor !== 'br'
      && sourceAnchor !== 'tr'
      && sourceAnchor !== 'tl'
  ) {
    return null;
  }

  return {
    mode: legacyMode === 'quad-pinwheel' ? 'rotation' : 'reflection',
    sourceScope: 'sector',
    count: legacyMode === 'mirror-half' ? 2 : 4,
    directionDeg: resolveLegacySymmetrySourceDirection({
      mode: legacyMode,
      axis,
      sourceAnchor,
    }),
    centerX: 4.5,
    centerY: 4.5,
  };
};

const migrateDeviceFromVersion1 = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value;
  }

  const kind = value.kind === 'waterdrop' ? 'ripple' : value.kind;
  if (!isRecord(value.params)) {
    return kind === value.kind ? value : { ...value, kind };
  }

  if (kind === 'modulator') {
    const {
      target,
      amount,
      ...currentParams
    } = value.params;
    const targets = Array.isArray(currentParams.targets)
      ? currentParams.targets
      : isRecord(target)
        ? [{
            ...target,
            id: LEGACY_MODULATION_TARGET_ID,
            slotIndex: 0,
            amount,
          }]
        : [];
    return {
      ...value,
      kind,
      params: {
        ...currentParams,
        targets,
      },
    };
  }

  if (kind === 'symmetry') {
    const params = migrateLegacySymmetryParams(value.params);
    if (!params) {
      return value;
    }
    return {
      ...value,
      kind,
      params,
    };
  }

  if (kind === 'rotate') {
    return {
      ...value,
      kind,
      params: {
        ...value.params,
        centerX: 4.5,
        centerY: 4.5,
      },
    };
  }

  if (kind === 'path' && Object.hasOwn(value.params, 'points')) {
    const {
      points,
      ...currentParams
    } = value.params;
    const anchors = Array.isArray(currentParams.anchors)
      ? currentParams.anchors
      : Array.isArray(points)
        ? points.map((point, index) => isRecord(point)
          ? {
              ...point,
              id: createMigratedPathAnchorId(value.id, index),
            }
          : point)
        : points;
    return {
      ...value,
      kind,
      params: {
        ...currentParams,
        anchors,
      },
    };
  }

  return kind === value.kind ? value : { ...value, kind };
};

const migrateDevicesFromVersion1 = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map((device) => migrateDeviceFromVersion1(device))
    : value;

const migratePresetFromVersion1 = (
  value: Record<string, unknown>,
): Record<string, unknown> => {
  if (value.presetType === 'device') {
    return {
      ...value,
      schemaVersion: 2,
      device: migrateDeviceFromVersion1(value.device),
    };
  }

  if (value.presetType === 'group' && isRecord(value.group)) {
    return {
      ...value,
      schemaVersion: 2,
      group: {
        ...value.group,
        devices: migrateDevicesFromVersion1(value.group.devices),
      },
    };
  }

  if (value.presetType === 'rack' && isRecord(value.chain)) {
    return {
      ...value,
      schemaVersion: 2,
      chain: {
        ...value.chain,
        devices: migrateDevicesFromVersion1(value.chain.devices),
      },
    };
  }

  return {
    ...value,
    schemaVersion: 2,
  };
};

interface PresetMigration {
  toVersion: number;
  migrate: (value: Record<string, unknown>) => Record<string, unknown>;
}

const PRESET_MIGRATIONS = new Map<number, PresetMigration>([
  [1, {
    toVersion: 2,
    migrate: migratePresetFromVersion1,
  }],
]);

interface MigratedPresetValue {
  value: Record<string, unknown>;
  migrated: boolean;
}

export const migratePresetValue = (
  value: unknown,
  targetVersion: number,
): MigratedPresetValue | null => {
  if (!isRecord(value) || !Number.isInteger(value.schemaVersion)) {
    return null;
  }

  let current = value;
  let version = value.schemaVersion as number;
  let migrated = false;
  while (version !== targetVersion) {
    const migration = PRESET_MIGRATIONS.get(version);
    if (!migration || migration.toVersion <= version || migration.toVersion > targetVersion) {
      return null;
    }

    current = migration.migrate(current);
    version = migration.toVersion;
    migrated = true;
  }

  return {
    value: current,
    migrated,
  };
};
