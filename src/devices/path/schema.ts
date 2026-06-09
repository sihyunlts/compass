import { clamp } from '../../shared/math';
import type {
  PathGeneratorNode,
  PathParams,
  PathPoint,
} from '../../shared/model';
import {
  applyImportedDeviceMeta,
  isImportRecord,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
  toFiniteNumber,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

export const PATH_COORDINATE_MIN = 0;
export const PATH_COORDINATE_MAX = 9;
export const PATH_POINT_MIN_COUNT = 2;

const DEFAULT_PATH_POINTS = Object.freeze<PathPoint[]>([
  { x: 2, y: 4.5 },
  { x: 7, y: 4.5 },
]);

const clampPathCoordinate = (value: number): number =>
  Number(clamp(value, PATH_COORDINATE_MIN, PATH_COORDINATE_MAX).toFixed(3));

const clonePathPoints = (
  points: readonly PathPoint[],
): PathPoint[] => points.map((point) => ({
  x: point.x,
  y: point.y,
}));

const createDefaultPathPoints = (): PathPoint[] =>
  clonePathPoints(DEFAULT_PATH_POINTS);

export const sanitizePathPoints = (
  value: unknown,
): PathPoint[] => {
  if (!Array.isArray(value)) {
    return createDefaultPathPoints();
  }

  const points: PathPoint[] = [];
  for (const item of value) {
    if (!isImportRecord(item)) {
      continue;
    }

    const x = toFiniteNumber(item.x, Number.NaN);
    const y = toFiniteNumber(item.y, Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    points.push({
      x: clampPathCoordinate(x),
      y: clampPathCoordinate(y),
    });
  }

  return points.length >= PATH_POINT_MIN_COUNT
    ? points
    : createDefaultPathPoints();
};

export const sanitizePathParams = (
  value: unknown,
): PathParams => {
  const params = isImportRecord(value) ? value : {};
  return {
    points: sanitizePathPoints(params.points),
    closed: false,
  };
};

const createDefaultPathNode = (
  id: string,
  enabled: boolean,
): PathGeneratorNode => ({
  id,
  kind: 'path',
  enabled: enabled !== false,
  groupId: null,
  params: {
    points: createDefaultPathPoints(),
    closed: false,
  },
});

const hydrateImportedPathNode = (
  source: Record<string, unknown>,
): PathGeneratorNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultPathNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  device.params = sanitizePathParams(resolveImportedParams(source));
  return device;
};

export const pathDeviceSchema = {
  kind: 'path',
  label: 'Path',
  group: 'generator',
  createDefaultNode: createDefaultPathNode,
  hydrateImportedNode: hydrateImportedPathNode,
} satisfies RendererDeviceSchema<'path'>;
