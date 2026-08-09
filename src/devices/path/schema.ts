import type {
  PathAnchor,
  PathAnimation,
  PathGeneratorNode,
  PathHandle,
  PathParams,
  PathTransform,
} from '../../shared/model';
import { clonePathAnchors } from '../../shared/model';
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

export const IDENTITY_PATH_TRANSFORM = Object.freeze<PathTransform>({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
});

export const sanitizePathTransform = (value: unknown): PathTransform => {
  if (!isImportRecord(value)) {
    return { ...IDENTITY_PATH_TRANSFORM };
  }
  const transform = {
    a: toFiniteNumber(value.a, Number.NaN),
    b: toFiniteNumber(value.b, Number.NaN),
    c: toFiniteNumber(value.c, Number.NaN),
    d: toFiniteNumber(value.d, Number.NaN),
    tx: toFiniteNumber(value.tx, Number.NaN),
    ty: toFiniteNumber(value.ty, Number.NaN),
  };
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (
    !Object.values(transform).every(Number.isFinite)
    || Math.abs(determinant) < 1e-12
  ) {
    return { ...IDENTITY_PATH_TRANSFORM };
  }
  return {
    a: Number(transform.a.toFixed(6)),
    b: Number(transform.b.toFixed(6)),
    c: Number(transform.c.toFixed(6)),
    d: Number(transform.d.toFixed(6)),
    tx: Number(transform.tx.toFixed(6)),
    ty: Number(transform.ty.toFixed(6)),
  };
};

const DEFAULT_PATH_ANCHORS = Object.freeze<PathAnchor[]>([
  {
    id: 'path-anchor-start',
    x: 2,
    y: 4.5,
  },
  {
    id: 'path-anchor-end',
    x: 7,
    y: 4.5,
  },
]);

export const createPathAnchorId = (): string =>
  `path-anchor-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;

const roundPathCoordinate = (value: number): number => Number(value.toFixed(3));

const createDefaultPathAnchors = (): PathAnchor[] =>
  clonePathAnchors(DEFAULT_PATH_ANCHORS);

const sanitizeHandle = (
  value: unknown,
): PathHandle | undefined => {
  if (!isImportRecord(value)) {
    return undefined;
  }

  const relativeX = toFiniteNumber(value.x, Number.NaN);
  const relativeY = toFiniteNumber(value.y, Number.NaN);
  if (!Number.isFinite(relativeX) || !Number.isFinite(relativeY)) {
    return undefined;
  }

  return {
    x: roundPathCoordinate(relativeX),
    y: roundPathCoordinate(relativeY),
  };
};

export const sanitizePathAnchors = (value: unknown): PathAnchor[] => {
  if (!Array.isArray(value)) {
    return createDefaultPathAnchors();
  }

  const anchors: PathAnchor[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (!isImportRecord(item)) {
      continue;
    }

    const rawX = toFiniteNumber(item.x, Number.NaN);
    const rawY = toFiniteNumber(item.y, Number.NaN);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
      continue;
    }

    const x = roundPathCoordinate(rawX);
    const y = roundPathCoordinate(rawY);
    const importedId = typeof item.id === 'string' ? item.id.trim() : '';
    const id = importedId && !ids.has(importedId)
      ? importedId
      : createPathAnchorId();
    ids.add(id);

    const handleIn = sanitizeHandle(item.handleIn);
    const handleOut = sanitizeHandle(item.handleOut);
    anchors.push({
      id,
      x,
      y,
      ...(handleIn ? { handleIn } : {}),
      ...(handleOut ? { handleOut } : {}),
    });
  }

  return anchors;
};

const sanitizePathAnimation = (
  value: unknown,
  anchors: readonly PathAnchor[],
): PathAnimation => {
  const animation = isImportRecord(value) ? value : {};
  const importedStartAnchorId = typeof animation.startAnchorId === 'string'
    ? animation.startAnchorId.trim()
    : '';
  return {
    enabled: animation.enabled === true,
    direction: animation.direction === 'reverse' ? 'reverse' : 'forward',
    startAnchorId: anchors.some((anchor) => anchor.id === importedStartAnchorId)
      ? importedStartAnchorId
      : anchors[0]?.id ?? '',
  };
};

export const sanitizePathParams = (value: unknown): PathParams => {
  const params = isImportRecord(value) ? value : {};
  const anchors = sanitizePathAnchors(params.anchors);
  const closed = params.closed === true && anchors.length >= 2;
  const fill = params.fill === true && anchors.length >= 3;
  return {
    anchors,
    closed: fill || closed,
    fill,
    transform: sanitizePathTransform(params.transform),
    animation: sanitizePathAnimation(params.animation, anchors),
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
  params: sanitizePathParams({}),
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
