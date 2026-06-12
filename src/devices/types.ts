import type { Component } from 'svelte';

import type { GeneratorDeviceNode } from '../shared/model';
import type { RendererControlChange, RendererKindControlDefinition } from './control-types';

export type RendererDeviceKind = GeneratorDeviceNode['kind'];
export type RendererDeviceGroup = 'generator' | 'effect';
export type RendererDeviceNodeOfKind<K extends RendererDeviceKind> = Extract<
  GeneratorDeviceNode,
  { kind: K }
>;

export interface RendererDeviceEditorPropsBase {
  devices?: GeneratorDeviceNode[];
  deviceDisplayNameById?: Record<string, string>;
  groupDisplayNameById?: Record<string, string>;
  paletteRevision: number;
  currentBeatBeats?: number;
  currentProgress01?: number;
  modulationReadoutById?: Record<string, string>;
  resolvePaletteRgb: (velocity: number) => string;
  onControlChange: (change: RendererControlChange) => void;
}

type RendererDeviceEditorProps<K extends RendererDeviceKind = RendererDeviceKind> =
  RendererDeviceEditorPropsBase & {
    device: RendererDeviceNodeOfKind<K>;
  };

export interface RendererModulationParamDefinition {
  key: string;
  label: string;
}

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
  modulationTargetParams?: readonly RendererModulationParamDefinition[];
  numericParamKeys?: readonly string[];
  createDefaultNode: RendererDeviceNodeFactory<K>;
  hydrateImportedNode: ImportedRendererDeviceHydrator<K>;
}

export interface RendererDeviceDefinition<K extends RendererDeviceKind = RendererDeviceKind>
  extends RendererDeviceSchema<K> {
  editor: Component<RendererDeviceEditorProps<K>>;
  controls?: RendererKindControlDefinition;
}
