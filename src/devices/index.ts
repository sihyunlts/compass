import type { Component } from 'svelte';

import {
  createRendererDeviceNode,
  getRendererDeviceControlDefinition,
  getRendererDeviceGroup,
  getRendererDeviceLabel,
  getRendererModulationTargetParamDefinitions,
  hydrateImportedRendererDeviceNode,
  isRendererDeviceKind,
  RENDERER_DEVICE_GROUPS,
  RENDERER_DEVICE_KINDS,
  RENDERER_DEVICE_MANIFEST,
  type RendererDeviceManifestEntry,
} from './registry-core';
import type {
  RendererDeviceDefinition,
  RendererDeviceKind,
} from './types';

type RendererDeviceEditorComponent = Component<Record<string, unknown>>;

type RendererDeviceDefinitionByKind = {
  [K in RendererDeviceKind]: Extract<RendererDeviceDefinition, { kind: K }>;
};

const rendererDeviceEditors = import.meta.glob<RendererDeviceEditorComponent>(
  './*/ui.svelte',
  {
    eager: true,
    import: 'default',
  },
);

const resolveRendererDeviceEditor = (
  path: RendererDeviceManifestEntry['editor'],
): RendererDeviceEditorComponent => {
  const editor = rendererDeviceEditors[path];
  if (!editor) {
    throw new Error(`Missing renderer device editor module: ${path}`);
  }

  return editor;
};

const rendererDeviceDefinitions = Object.fromEntries(
  RENDERER_DEVICE_MANIFEST.map((definition) => [
    definition.kind,
    {
      ...definition,
      editor: resolveRendererDeviceEditor(definition.editor),
    },
  ]),
) as RendererDeviceDefinitionByKind;

export type {
  RendererDeviceKind,
} from './types';

export const getRendererDeviceDefinition = <K extends RendererDeviceKind>(
  kind: K,
): RendererDeviceDefinitionByKind[K] => rendererDeviceDefinitions[kind];

export {
  createRendererDeviceNode,
  getRendererDeviceControlDefinition,
  getRendererDeviceGroup,
  getRendererDeviceLabel,
  getRendererModulationTargetParamDefinitions,
  hydrateImportedRendererDeviceNode,
  isRendererDeviceKind,
  RENDERER_DEVICE_GROUPS,
  RENDERER_DEVICE_KINDS,
};
