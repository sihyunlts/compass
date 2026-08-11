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

export interface MigratedPresetValue {
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
