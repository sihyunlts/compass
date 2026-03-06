import type { GeneratorChain } from '../../../shared/model';
import {
  createChainHistory,
  type ChainHistory,
  type ChainHistoryEntry,
  type ChainHistoryKind,
  type ChainHistoryListItem,
  type ChainMutationMeta,
} from './history-core';

type EditorHistoryOptions = Parameters<typeof createChainHistory>[1];

interface EditorHistoryEntryMeta {
  id: string;
  revision: number;
  label: string;
  createdAt: number;
  kind: ChainHistoryKind;
}

export interface EditorHistoryListEntry extends EditorHistoryEntryMeta {
  isCurrent: boolean;
}

interface EditorHistorySnapshotEntry extends EditorHistoryEntryMeta {
  chain: GeneratorChain;
}

export interface EditorHistory {
  push(chain: GeneratorChain, meta: ChainMutationMeta): boolean;
  undo(): GeneratorChain | null;
  redo(): GeneratorChain | null;
  list(): EditorHistoryListEntry[];
  checkout(target: string | number): GeneratorChain | null;
  canUndo(): boolean;
  canRedo(): boolean;
  getUndoEntry(): EditorHistorySnapshotEntry | null;
  getRedoEntry(): EditorHistorySnapshotEntry | null;
  replaceCurrent(chain: GeneratorChain, label?: string): void;
  flushPendingMerge(): void;
}

interface EditorHistoryMetadata {
  revision: number;
  createdAt: number;
}

class EditorHistoryImpl implements EditorHistory {
  private readonly chainHistory: ChainHistory;

  private readonly metadataById = new Map<string, EditorHistoryMetadata>();

  private nextRevision = 1;

  constructor(
    initialChain: GeneratorChain,
    options?: EditorHistoryOptions,
  ) {
    this.chainHistory = createChainHistory(initialChain, options);
    this.syncMetadata();
  }

  public push(chain: GeneratorChain, meta: ChainMutationMeta): boolean {
    const changed = this.chainHistory.push(chain, meta);
    this.syncMetadata();
    return changed;
  }

  public undo(): GeneratorChain | null {
    const restored = this.chainHistory.undo();
    this.syncMetadata();
    return restored;
  }

  public redo(): GeneratorChain | null {
    const restored = this.chainHistory.redo();
    this.syncMetadata();
    return restored;
  }

  public list(): EditorHistoryListEntry[] {
    this.syncMetadata();
    return this.chainHistory.getHistoryItems().map((item) => this.toListEntry(item));
  }

  public checkout(target: string | number): GeneratorChain | null {
    this.syncMetadata();
    const items = this.chainHistory.getHistoryItems();
    const matchedItem = typeof target === 'number'
      ? items.find((item) => this.requireMetadata(item.id).revision === target)
      : items.find((item) => item.id === target);

    if (!matchedItem) {
      return null;
    }

    const restored = this.chainHistory.restore(matchedItem.index);
    this.syncMetadata();
    return restored;
  }

  public canUndo(): boolean {
    return this.chainHistory.canUndo();
  }

  public canRedo(): boolean {
    return this.chainHistory.canRedo();
  }

  public getUndoEntry(): EditorHistorySnapshotEntry | null {
    const entry = this.chainHistory.getUndoEntry();
    if (!entry) {
      return null;
    }
    return this.toSnapshotEntry(entry);
  }

  public getRedoEntry(): EditorHistorySnapshotEntry | null {
    const entry = this.chainHistory.getRedoEntry();
    if (!entry) {
      return null;
    }
    return this.toSnapshotEntry(entry);
  }

  public replaceCurrent(chain: GeneratorChain, label?: string): void {
    this.chainHistory.replaceCurrent(chain, label);
    this.syncMetadata();
  }

  public flushPendingMerge(): void {
    this.chainHistory.flushPendingMerge();
    this.syncMetadata();
  }

  private syncMetadata(): void {
    const items = this.chainHistory.getHistoryItems();
    const activeIds = new Set<string>();
    for (const item of items) {
      activeIds.add(item.id);
      if (this.metadataById.has(item.id)) {
        continue;
      }
      this.metadataById.set(item.id, {
        revision: this.nextRevision,
        createdAt: item.timestampMs,
      });
      this.nextRevision += 1;
    }

    for (const id of [...this.metadataById.keys()]) {
      if (activeIds.has(id)) {
        continue;
      }
      this.metadataById.delete(id);
    }
  }

  private requireMetadata(id: string): EditorHistoryMetadata {
    const metadata = this.metadataById.get(id);
    if (!metadata) {
      throw new Error(`Missing editor history metadata for ${id}`);
    }
    return metadata;
  }

  private toListEntry(item: ChainHistoryListItem): EditorHistoryListEntry {
    const metadata = this.requireMetadata(item.id);
    return {
      id: item.id,
      revision: metadata.revision,
      label: item.label,
      createdAt: metadata.createdAt,
      kind: item.kind,
      isCurrent: item.isCurrent,
    };
  }

  private toSnapshotEntry(entry: ChainHistoryEntry): EditorHistorySnapshotEntry {
    this.syncMetadata();
    const metadata = this.requireMetadata(entry.id);
    return {
      id: entry.id,
      revision: metadata.revision,
      label: entry.label,
      createdAt: metadata.createdAt,
      kind: entry.kind,
      chain: entry.chain,
    };
  }
}

export const createEditorHistory = (
  initialChain: GeneratorChain,
  options?: EditorHistoryOptions,
): EditorHistory => new EditorHistoryImpl(initialChain, options);
