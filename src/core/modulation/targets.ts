import type { ModulationTarget } from '../../shared/model';

export const DEFAULT_MODULATION_TARGET_AMOUNT = 1;
export const MODULATION_TARGET_SLOT_COUNT = 10;

const createIndexedTargetId = (index: number): string => `mod-target-${index + 1}`;

const resolveUniqueTargetId = (
  preferredId: string,
  fallbackIndex: number,
  seenIds: ReadonlySet<string>,
): string => {
  if (!seenIds.has(preferredId)) {
    return preferredId;
  }

  const fallbackId = createIndexedTargetId(fallbackIndex);
  if (!seenIds.has(fallbackId)) {
    return fallbackId;
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${fallbackId}-${suffix}`;
    if (!seenIds.has(candidate)) {
      return candidate;
    }
  }
};

const sanitizeAmount = (
  value: unknown,
  fallback = 0,
): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Number(numeric.toFixed(6));
};

export const createModulationTargetId = (): string =>
  `mod-target-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;

export const sanitizeModulationTargetAmount = (
  value: unknown,
): number => sanitizeAmount(value, DEFAULT_MODULATION_TARGET_AMOUNT);

export const isValidModulationTargetSlotIndex = (
  value: unknown,
): value is number => (
  typeof value === 'number'
  && Number.isInteger(value)
  && value >= 0
  && value < MODULATION_TARGET_SLOT_COUNT
);

const sanitizeModulationTargetSlotIndex = (
  value: unknown,
  fallback: number,
): number => {
  if (isValidModulationTargetSlotIndex(value)) {
    return value;
  }

  if (isValidModulationTargetSlotIndex(fallback)) {
    return fallback;
  }

  return 0;
};

const resolveAvailableSlotIndex = (
  preferredSlotIndex: number,
  seenSlotIndices: ReadonlySet<number>,
): number | null => {
  for (
    let slotIndex = preferredSlotIndex;
    slotIndex < MODULATION_TARGET_SLOT_COUNT;
    slotIndex += 1
  ) {
    if (!seenSlotIndices.has(slotIndex)) {
      return slotIndex;
    }
  }

  for (let slotIndex = 0; slotIndex < preferredSlotIndex; slotIndex += 1) {
    if (!seenSlotIndices.has(slotIndex)) {
      return slotIndex;
    }
  }

  return null;
};

export const sanitizeModulationTarget = (
  target: unknown,
  fallbackId = '',
  fallbackSlotIndex = 0,
): ModulationTarget | null => {
  if (!target || typeof target !== 'object') {
    return null;
  }

  const id = typeof (target as { id?: unknown }).id === 'string'
    ? (target as { id: string }).id.trim()
    : fallbackId;
  const deviceId = typeof (target as { deviceId?: unknown }).deviceId === 'string'
    ? (target as { deviceId: string }).deviceId.trim()
    : '';
  const paramKey = typeof (target as { paramKey?: unknown }).paramKey === 'string'
    ? (target as { paramKey: string }).paramKey.trim()
    : '';

  if (!deviceId || !paramKey) {
    return null;
  }

  return {
    id: id || fallbackId || createModulationTargetId(),
    slotIndex: sanitizeModulationTargetSlotIndex(
      (target as { slotIndex?: unknown }).slotIndex,
      fallbackSlotIndex,
    ),
    deviceId,
    paramKey,
    amount: sanitizeModulationTargetAmount((target as { amount?: unknown }).amount),
  };
};

export const sanitizeModulationTargets = (
  targets: unknown,
): ModulationTarget[] => {
  if (!Array.isArray(targets)) {
    return [];
  }

  const sanitizedTargets: ModulationTarget[] = [];
  const seenIds = new Set<string>();
  const seenSlotIndices = new Set<number>();
  for (let index = 0; index < targets.length; index += 1) {
    const target = sanitizeModulationTarget(
      targets[index],
      createIndexedTargetId(index),
      index,
    );
    if (!target) {
      continue;
    }

    const targetId = resolveUniqueTargetId(target.id, index, seenIds);
    seenIds.add(targetId);

    const slotIndex = resolveAvailableSlotIndex(target.slotIndex, seenSlotIndices);
    if (slotIndex === null) {
      continue;
    }
    seenSlotIndices.add(slotIndex);

    sanitizedTargets.push({
      ...target,
      id: targetId,
      slotIndex,
    });
  }

  return sanitizedTargets.sort((left, right) => left.slotIndex - right.slotIndex);
};
