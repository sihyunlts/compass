import type { GeneratorDeviceNode } from '../shared/model/chain';
import { normalizeCustomName } from '../shared/model/naming';
import { normalizeOptionalId } from '../shared/normalize-id';

export const isImportRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

export const toFiniteNumber = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export const toIntegerArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const next: number[] = [];
  for (const item of value) {
    const numeric = Number(item);
    if (Number.isInteger(numeric)) {
      next.push(numeric);
    }
  }

  return next;
};

export const resolveImportedDeviceId = (
  source: Record<string, unknown>,
): string | null =>
  normalizeOptionalId(source.id as string | null | undefined);

export const resolveImportedOptionalId = (value: unknown): string | null =>
  normalizeOptionalId(value as string | null | undefined);

export const resolveImportedDeviceEnabled = (
  source: Record<string, unknown>,
): boolean => toBoolean(source.enabled, true);

export const resolveImportedParams = (
  source: Record<string, unknown>,
): Record<string, unknown> =>
  isImportRecord(source.params) ? source.params : {};

export const applyImportedDeviceMeta = <T extends GeneratorDeviceNode>(
  device: T,
  source: Record<string, unknown>,
): T => {
  device.groupId = normalizeOptionalId(source.groupId as string | null | undefined);
  device.name = normalizeCustomName(source.name);
  return device;
};
