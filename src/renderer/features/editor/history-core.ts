import { cloneChainForIpc, type GeneratorChain } from '../../../shared/model';

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MERGE_IDLE_MS = 500;

export type ChainHistoryKind =
  | 'add-device'
  | 'insert-device'
  | 'move-devices'
  | 'delete-devices'
  | 'group-create'
  | 'group-ungroup'
  | 'group-toggle-enabled'
  | 'rename-device'
  | 'rename-group'
  | 'clipboard-cut'
  | 'clipboard-paste'
  | 'duplicate'
  | 'insert-device-preset'
  | 'insert-group-preset'
  | 'load-rack-preset'
  | 'control-edit'
  | 'center-picker-edit'
  | 'mask-tile-edit';

export interface ChainMutationMeta {
  kind: ChainHistoryKind;
  label: string;
  mergeKey?: string | null;
  finalize?: boolean;
  mergeIdleMs?: number;
}

export interface ChainHistoryEntry {
  id: string;
  timestampMs: number;
  kind: ChainHistoryKind;
  label: string;
  chain: GeneratorChain;
}

export interface ChainHistoryListItem {
  id: string;
  index: number;
  timestampMs: number;
  kind: ChainHistoryKind;
  label: string;
  isCurrent: boolean;
}

interface ChainHistoryEntryInternal extends ChainHistoryEntry {
  signature: string;
}

interface ChainSnapshot {
  chain: GeneratorChain;
  signature: string;
}

interface ChainHistoryOptions {
  maxEntries?: number;
  mergeIdleMs?: number;
}

const stableSerialize = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'undefined';
  }

  const valueType = typeof value;
  if (valueType === 'number') {
    return Number.isFinite(value as number) ? `${value}` : 'null';
  }
  if (valueType === 'string') {
    return JSON.stringify(value);
  }
  if (valueType === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  if (valueType === 'object') {
    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue).sort();
    const pairs: string[] = [];
    for (const key of keys) {
      pairs.push(`${JSON.stringify(key)}:${stableSerialize(objectValue[key])}`);
    }
    return `{${pairs.join(',')}}`;
  }

  return 'null';
};

const toSnapshot = (chain: GeneratorChain): ChainSnapshot => {
  const cloned = cloneChainForIpc(chain);
  return {
    chain: cloned,
    signature: stableSerialize(cloned),
  };
};

const normalizeMergeKey = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export class ChainHistory {
  private readonly maxEntries: number;

  private readonly defaultMergeIdleMs: number;

  private readonly entries: ChainHistoryEntryInternal[] = [];

  private cursor = 0;

  private nextId = 1;

  private pendingMergeKey: string | null = null;

  private pendingMergeIndex: number | null = null;

  private pendingMergeSnapshot: GeneratorChain | null = null;

  private pendingMergeTimer: number | null = null;

  constructor(initialChain: GeneratorChain, options: ChainHistoryOptions = {}) {
    this.maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries && options.maxEntries > 0
      ? options.maxEntries
      : DEFAULT_MAX_ENTRIES;
    this.defaultMergeIdleMs = Number.isFinite(options.mergeIdleMs)
      && (options.mergeIdleMs as number) > 0
      ? (options.mergeIdleMs as number)
      : DEFAULT_MERGE_IDLE_MS;

    this.addEntry(initialChain, {
      kind: 'control-edit',
      label: 'Initial state',
    });
  }

  public canUndo(): boolean {
    return this.cursor > 0;
  }

  public canRedo(): boolean {
    return this.cursor < this.entries.length - 1;
  }

  public getUndoEntry(): ChainHistoryEntry | null {
    if (!this.canUndo()) {
      return null;
    }
    return this.toPublicEntry(this.entries[this.cursor - 1]);
  }

  public getRedoEntry(): ChainHistoryEntry | null {
    if (!this.canRedo()) {
      return null;
    }
    return this.toPublicEntry(this.entries[this.cursor + 1]);
  }

  public getCurrentEntry(): ChainHistoryEntry {
    return this.toPublicEntry(this.entries[this.cursor]);
  }

  public getHistoryItems(): ChainHistoryListItem[] {
    return this.entries.map((entry, index): ChainHistoryListItem => ({
      id: entry.id,
      index,
      timestampMs: entry.timestampMs,
      kind: entry.kind,
      label: entry.label,
      isCurrent: index === this.cursor,
    }));
  }

  public push(chain: GeneratorChain, meta: ChainMutationMeta): boolean {
    const mergeKey = normalizeMergeKey(meta.mergeKey);
    const currentEntry = this.entries[this.cursor];
    const isActiveMergeSession = !!mergeKey
      && this.pendingMergeKey === mergeKey
      && this.pendingMergeIndex === this.cursor
      && currentEntry.kind === meta.kind;

    if (isActiveMergeSession) {
      this.stagePendingMerge(chain, mergeKey, meta);
      return true;
    }

    this.flushPendingMerge();
    const latestEntry = this.entries[this.cursor];
    const snapshot = toSnapshot(chain);
    if (latestEntry.signature === snapshot.signature) {
      return false;
    }

    if (this.cursor < this.entries.length - 1) {
      this.entries.splice(this.cursor + 1);
    }

    this.addEntry(snapshot.chain, meta, snapshot.signature);
    this.cursor = this.entries.length - 1;
    this.trimToCapacity();

    if (mergeKey && !meta.finalize) {
      this.stagePendingMerge(chain, mergeKey, meta);
    }
    return true;
  }

  public reset(chain: GeneratorChain, meta: ChainMutationMeta): void {
    this.flushPendingMerge();
    this.entries.splice(0);
    this.cursor = 0;
    this.addEntry(chain, meta);
  }

  public replaceCurrent(chain: GeneratorChain, label?: string): void {
    this.flushPendingMerge();
    const snapshot = toSnapshot(chain);
    const current = this.entries[this.cursor];
    current.chain = snapshot.chain;
    current.signature = snapshot.signature;
    current.timestampMs = Date.now();
    if (label) {
      current.label = label;
    }
  }

  public undo(): GeneratorChain | null {
    this.flushPendingMerge();
    if (!this.canUndo()) {
      return null;
    }
    this.cursor -= 1;
    return cloneChainForIpc(this.entries[this.cursor].chain);
  }

  public redo(): GeneratorChain | null {
    this.flushPendingMerge();
    if (!this.canRedo()) {
      return null;
    }
    this.cursor += 1;
    return cloneChainForIpc(this.entries[this.cursor].chain);
  }

  public restore(index: number): GeneratorChain | null {
    this.flushPendingMerge();
    if (!Number.isInteger(index) || index < 0 || index >= this.entries.length) {
      return null;
    }
    if (index === this.cursor) {
      return null;
    }
    this.cursor = index;
    return cloneChainForIpc(this.entries[this.cursor].chain);
  }

  public flushPendingMerge(): void {
    if (this.pendingMergeTimer !== null) {
      window.clearTimeout(this.pendingMergeTimer);
      this.pendingMergeTimer = null;
    }
    this.commitPendingMergeSnapshot();
    this.pendingMergeKey = null;
    this.pendingMergeIndex = null;
    this.pendingMergeSnapshot = null;
  }

  private toPublicEntry(entry: ChainHistoryEntryInternal): ChainHistoryEntry {
    return {
      id: entry.id,
      timestampMs: entry.timestampMs,
      kind: entry.kind,
      label: entry.label,
      chain: cloneChainForIpc(entry.chain),
    };
  }

  private createEntryId(): string {
    const id = this.nextId;
    this.nextId += 1;
    return `chain-history-${id}`;
  }

  private addEntry(
    chain: GeneratorChain,
    meta: ChainMutationMeta,
    signature?: string,
  ): void {
    const snapshot = signature
      ? { chain: cloneChainForIpc(chain), signature }
      : toSnapshot(chain);
    this.entries.push({
      id: this.createEntryId(),
      timestampMs: Date.now(),
      kind: meta.kind,
      label: meta.label,
      chain: snapshot.chain,
      signature: snapshot.signature,
    });
  }

  private stagePendingMerge(
    chain: GeneratorChain,
    mergeKey: string,
    meta: ChainMutationMeta,
  ): void {
    const entry = this.entries[this.cursor];
    entry.timestampMs = Date.now();
    entry.label = meta.label;

    this.pendingMergeKey = mergeKey;
    this.pendingMergeIndex = this.cursor;
    this.pendingMergeSnapshot = cloneChainForIpc(chain);
    if (meta.finalize) {
      this.flushPendingMerge();
      return;
    }

    this.armPendingMerge(meta.mergeIdleMs);
  }

  private commitPendingMergeSnapshot(): void {
    if (this.pendingMergeIndex === null || !this.pendingMergeSnapshot) {
      return;
    }

    const entry = this.entries[this.pendingMergeIndex];
    if (!entry) {
      return;
    }

    const signature = stableSerialize(this.pendingMergeSnapshot);
    if (entry.signature === signature) {
      return;
    }
    entry.chain = this.pendingMergeSnapshot;
    entry.signature = signature;
    entry.timestampMs = Date.now();
  }

  private armPendingMerge(mergeIdleMs: number | undefined): void {
    if (this.pendingMergeTimer !== null) {
      window.clearTimeout(this.pendingMergeTimer);
      this.pendingMergeTimer = null;
    }

    const timeoutMs = Number.isFinite(mergeIdleMs) && (mergeIdleMs as number) > 0
      ? (mergeIdleMs as number)
      : this.defaultMergeIdleMs;
    this.pendingMergeTimer = window.setTimeout(() => {
      this.flushPendingMerge();
    }, timeoutMs);
  }

  private trimToCapacity(): void {
    const overflow = this.entries.length - this.maxEntries;
    if (overflow <= 0) {
      return;
    }

    this.entries.splice(0, overflow);
    this.cursor = Math.max(0, this.cursor - overflow);
  }
}

export const createChainHistory = (
  initialChain: GeneratorChain,
  options?: ChainHistoryOptions,
): ChainHistory => new ChainHistory(initialChain, options);
