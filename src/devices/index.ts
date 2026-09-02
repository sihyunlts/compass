import type { Component } from 'svelte';

import { colorDeviceControls } from './color/controls';
import type { RendererKindControlDefinition } from './control-types';
import { maskDeviceControls } from './mask/controls';
import { mirrorDeviceControls } from './mirror/controls';
import { modulatorDeviceControls } from './modulator/controls';
import { pathDeviceControls } from './path/controls';
import { rainDeviceControls } from './rain/controls';
import { repeatDeviceControls } from './repeat/controls';
import {
  createRendererDeviceNode,
  getRendererDeviceGroup,
  getRendererDeviceLabel,
  getRendererModulationTargetParamDefinitions,
  isRendererDeviceKind,
  RENDERER_DEVICE_KINDS,
  RENDERER_DEVICE_SCHEMAS,
} from './registry-core';
import { rotateDeviceControls } from './rotate/controls';
import { scaleDeviceControls } from './scale/controls';
import { scannerDeviceControls } from './scanner/controls';
import { spiralDeviceControls } from './spiral/controls';
import { stretchDeviceControls } from './stretch/controls';
import { symmetryDeviceControls } from './symmetry/controls';
import { timeWarpDeviceControls } from './timewarp/controls';
import { translateDeviceControls } from './translate/controls';
import { trimDeviceControls } from './trim/controls';
import type {
  RendererDeviceDefinition,
  RendererDeviceKind,
  RendererDeviceNodeOfKind,
  RendererDeviceTabDefinition,
} from './types';
import { rippleDeviceControls } from './ripple/controls';

type RendererDeviceEditorComponent = Component<Record<string, unknown>>;
type RendererDeviceEditorModulePath = `./${string}/ui.svelte`;

type RendererDeviceDefinitionByKind = {
  [K in RendererDeviceKind]: Extract<RendererDeviceDefinition, { kind: K }>;
};

type RendererDeviceViewByKind = {
  [K in RendererDeviceKind]: {
    editor: RendererDeviceEditorModulePath;
    controls?: RendererKindControlDefinition;
    defaultTabId?: string;
    tabs?: (device: RendererDeviceNodeOfKind<K>) => readonly RendererDeviceTabDefinition[];
  };
};

const rendererDeviceViewByKind: RendererDeviceViewByKind = {
  color: {
    editor: './color/ui.svelte',
    controls: colorDeviceControls,
  },
  mask: {
    editor: './mask/ui.svelte',
    controls: maskDeviceControls,
  },
  mirror: {
    editor: './mirror/ui.svelte',
    controls: mirrorDeviceControls,
  },
  modulator: {
    editor: './modulator/ui.svelte',
    controls: modulatorDeviceControls,
    defaultTabId: 'curve',
    tabs: () => [
      { id: 'curve', labelKey: 'tab.curve' },
      { id: 'map', labelKey: 'tab.map' },
    ],
  },
  path: {
    editor: './path/ui.svelte',
    controls: pathDeviceControls,
    defaultTabId: 'path',
    tabs: () => [
      { id: 'path', labelKey: 'tab.path' },
      { id: 'animate', labelKey: 'tab.animate' },
    ],
  },
  rain: {
    editor: './rain/ui.svelte',
    controls: rainDeviceControls,
  },
  repeat: {
    editor: './repeat/ui.svelte',
    controls: repeatDeviceControls,
  },
  reverse: {
    editor: './reverse/ui.svelte',
  },
  rotate: {
    editor: './rotate/ui.svelte',
    controls: rotateDeviceControls,
  },
  scale: {
    editor: './scale/ui.svelte',
    controls: scaleDeviceControls,
  },
  scanner: {
    editor: './scanner/ui.svelte',
    controls: scannerDeviceControls,
  },
  spiral: {
    editor: './spiral/ui.svelte',
    controls: spiralDeviceControls,
  },
  stretch: {
    editor: './stretch/ui.svelte',
    controls: stretchDeviceControls,
  },
  symmetry: {
    editor: './symmetry/ui.svelte',
    controls: symmetryDeviceControls,
  },
  timewarp: {
    editor: './timewarp/ui.svelte',
    controls: timeWarpDeviceControls,
  },
  translate: {
    editor: './translate/ui.svelte',
    controls: translateDeviceControls,
  },
  trim: {
    editor: './trim/ui.svelte',
    controls: trimDeviceControls,
  },
  ripple: {
    editor: './ripple/ui.svelte',
    controls: rippleDeviceControls,
  },
};

export const getRendererDeviceControlDefinition = (
  kind: RendererDeviceKind,
): RendererKindControlDefinition | null =>
  rendererDeviceViewByKind[kind].controls ?? null;

const rendererDeviceEditors = import.meta.glob<RendererDeviceEditorComponent>(
  './*/ui.svelte',
  {
    eager: true,
    import: 'default',
  },
);

const resolveRendererDeviceEditor = (
  path: RendererDeviceEditorModulePath,
): RendererDeviceEditorComponent => {
  const editor = rendererDeviceEditors[path];
  if (!editor) {
    throw new Error(`Missing renderer device editor module: ${path}`);
  }

  return editor;
};

const rendererDeviceDefinitions = Object.fromEntries(
  RENDERER_DEVICE_SCHEMAS.map((schema) => {
    const view = rendererDeviceViewByKind[schema.kind];
    return [
      schema.kind,
      {
        ...schema,
        ...view,
        editor: resolveRendererDeviceEditor(view.editor),
      },
    ];
  }),
) as RendererDeviceDefinitionByKind;

export type {
  RendererDeviceKind,
} from './types';

export const getRendererDeviceDefinition = <K extends RendererDeviceKind>(
  kind: K,
): RendererDeviceDefinitionByKind[K] => rendererDeviceDefinitions[kind];

export {
  createRendererDeviceNode,
  getRendererDeviceGroup,
  getRendererDeviceLabel,
  getRendererModulationTargetParamDefinitions,
  isRendererDeviceKind,
  RENDERER_DEVICE_KINDS,
};
