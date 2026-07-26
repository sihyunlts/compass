import type { RainGeneratorNode } from '../../shared/model';
import { clamp } from '../../shared/math';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
  toFiniteNumber,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

export const RAIN_SEED_MIN = 0;
export const RAIN_SEED_MAX = 0xffff_ffff;
export const RAIN_DENSITY_MIN = 0;
export const RAIN_DENSITY_MAX = 32;
export const RAIN_SPEED_MIN = 0.3;
export const RAIN_SPEED_MAX = 6;

const DEFAULT_RAIN_PARAMS: RainGeneratorNode['params'] = {
  seed: 1,
  angleDeg: 270,
  density: 4,
  speed: 1,
};

const RAIN_MODULATION_TARGET_PARAMS = [
  { key: 'angleDeg', label: 'Direction' },
  { key: 'density', label: 'Density' },
  { key: 'speed', label: 'Speed' },
] as const;

export const RAIN_NUMERIC_PARAM_KEYS = [
  'seed',
  'angleDeg',
  'density',
  'speed',
] as const;

export const normalizeRainSeed = (
  value: number,
): number => clamp(Math.trunc(value), RAIN_SEED_MIN, RAIN_SEED_MAX);

export const normalizeRainDensity = (
  value: number,
): number => clamp(value, RAIN_DENSITY_MIN, RAIN_DENSITY_MAX);

export const normalizeRainSpeed = (
  value: number,
): number => clamp(value, RAIN_SPEED_MIN, RAIN_SPEED_MAX);

const createDefaultRainNode = (
  id: string,
  enabled: boolean,
): RainGeneratorNode => ({
  id,
  kind: 'rain',
  enabled: enabled !== false,
  groupId: null,
  params: { ...DEFAULT_RAIN_PARAMS },
});

const hydrateImportedRainNode = (
  source: Record<string, unknown>,
): RainGeneratorNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultRainNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  device.params.seed = normalizeRainSeed(toFiniteNumber(params.seed, device.params.seed));
  device.params.angleDeg = toFiniteNumber(params.angleDeg, device.params.angleDeg);
  device.params.density = normalizeRainDensity(
    toFiniteNumber(params.density, device.params.density),
  );
  device.params.speed = normalizeRainSpeed(toFiniteNumber(params.speed, device.params.speed));
  return device;
};

export const rainDeviceSchema = {
  kind: 'rain',
  label: 'Rain',
  group: 'generator',
  modulationTargetParams: RAIN_MODULATION_TARGET_PARAMS,
  numericParamKeys: RAIN_NUMERIC_PARAM_KEYS,
  createDefaultNode: createDefaultRainNode,
  hydrateImportedNode: hydrateImportedRainNode,
} satisfies RendererDeviceSchema<'rain'>;
