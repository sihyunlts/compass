import type { Component } from 'svelte';

import type { GeneratorDeviceNode } from '../shared/model';
import type { RendererControlChange, RendererKindControlDefinition } from './control-types';
import type { NumericParameterRules } from './numeric-parameters';
import type { ModulationStateByParameter } from '../shared/contracts/preview/modulation';

export type RendererDeviceKind = GeneratorDeviceNode['kind'];
export type RendererDeviceGroup = 'generator' | 'effect';
export type RendererDeviceNodeOfKind<K extends RendererDeviceKind> = Extract<
  GeneratorDeviceNode,
  { kind: K }
>;
type RendererDeviceParams<K extends RendererDeviceKind> =
  RendererDeviceNodeOfKind<K> extends { params: infer Params extends object }
    ? Params
    : never;

export interface RendererDeviceEditorPropsBase {
  devices?: GeneratorDeviceNode[];
  deviceDisplayNameById?: Record<string, string>;
  groupDisplayNameById?: Record<string, string>;
  paletteRevision: number;
  currentBeatBeats?: number;
  currentProgress01?: number;
  modulationReadoutById?: Record<string, string>;
  modulationStateByParameter?: ModulationStateByParameter;
  activeDeviceTab?: string;
  resolvePaletteRgb: (velocity: number) => string;
  onDeviceTabChange?: (tabId: string) => void;
  onControlChange: (change: RendererControlChange) => void;
}

type RendererDeviceEditorProps<K extends RendererDeviceKind = RendererDeviceKind> =
  RendererDeviceEditorPropsBase & {
    device: RendererDeviceNodeOfKind<K>;
  };

type RendererDeviceNodeFactory<K extends RendererDeviceKind = RendererDeviceKind> = (
  id: string,
  enabled: boolean,
) => RendererDeviceNodeOfKind<K>;

type ImportedRendererDeviceHydrator<K extends RendererDeviceKind = RendererDeviceKind> = (
  source: Record<string, unknown>,
) => RendererDeviceNodeOfKind<K> | null;

export interface RendererDeviceSchema<K extends RendererDeviceKind = RendererDeviceKind> {
  kind: K;
  label: string;
  group: RendererDeviceGroup;
  numericParameters?: NumericParameterRules<RendererDeviceParams<K>>;
  createDefaultNode: RendererDeviceNodeFactory<K>;
  hydrateImportedNode: ImportedRendererDeviceHydrator<K>;
}

export interface RendererDeviceTabDefinition {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface RendererDeviceDefinition<K extends RendererDeviceKind = RendererDeviceKind>
  extends RendererDeviceSchema<K> {
  editor: Component<RendererDeviceEditorProps<K>>;
  controls?: RendererKindControlDefinition;
  defaultTabId?: string;
  tabs?: (device: RendererDeviceNodeOfKind<K>) => readonly RendererDeviceTabDefinition[];
}
