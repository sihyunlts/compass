import type { Component } from 'svelte';

import type { GeneratorDeviceNode } from '../shared/model';

export type RendererDeviceKind = GeneratorDeviceNode['kind'];
export type RendererDeviceGroup = 'generator' | 'effect';
export type RendererDeviceNodeOfKind<K extends RendererDeviceKind> = Extract<
  GeneratorDeviceNode,
  { kind: K }
>;

export interface RendererDeviceEditorPropsBase {
  devices?: GeneratorDeviceNode[];
  paletteRevision: number;
  currentBeat?: number;
  modulationReadoutById?: Record<string, string>;
  resolvePaletteRgb: (velocity: number) => string;
}

export type RendererDeviceEditorProps<K extends RendererDeviceKind = RendererDeviceKind> =
  RendererDeviceEditorPropsBase & {
    device: RendererDeviceNodeOfKind<K>;
  };

export interface RendererModulationParamDefinition {
  key: string;
  label: string;
}

export type RendererDeviceNodeFactory<K extends RendererDeviceKind = RendererDeviceKind> = (
  id: string,
  enabled: boolean,
) => RendererDeviceNodeOfKind<K>;

export interface RendererDeviceSchema<K extends RendererDeviceKind = RendererDeviceKind> {
  kind: K;
  label: string;
  group: RendererDeviceGroup;
  modulationTargetParams?: readonly RendererModulationParamDefinition[];
  numericParamKeys?: readonly string[];
  createDefaultNode: RendererDeviceNodeFactory<K>;
}

export interface RendererDeviceDefinition<K extends RendererDeviceKind = RendererDeviceKind>
  extends RendererDeviceSchema<K> {
  editor: Component<RendererDeviceEditorProps<K>>;
}
