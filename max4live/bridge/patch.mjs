// Build-time patch definition. Keep runtime routing, object IDs and the device
// face stable; editor-only artifacts are omitted. This module does not run in Max.
import { createDeviceFace, DEVICE_HEIGHT, DEVICE_WIDTH } from '../shared/device-face.mjs';

const box = (id, maxclass, patchingRect, properties) => ({
  box: { id, maxclass, patching_rect: patchingRect, numinlets: 1, numoutlets: 0, ...properties },
});
const object = (id, text, rect, outletTypes = [], properties = {}) => box(id, 'newobj', rect, {
  text, numoutlets: outletTypes.length,
  ...(outletTypes.length ? { outlettype: outletTypes } : {}), ...properties,
});
const message = (id, text, rect) => box(id, 'message', rect, {
  text, numinlets: 2, numoutlets: 1, outlettype: [''],
});
// Named object references keep connection code independent of Max's numeric IDs.
const connect = (source, destination, { outlet = 0, inlet = 0 } = {}) => ({
  patchline: {
    source: [source.box.id, outlet], destination: [destination.box.id, inlet],
  },
});

// Presentation objects and the original patch editor positions are kept together.
// IDs are retained for compatibility; callers use the role names below.
function createObjects(version) {
  return {
    ...createDeviceFace(version, 'Compass Bridge'),

    // Incoming OSC is deferred before it reaches the Live API bridge.
    udpReceiver: object('obj-2', 'udpreceive 8970', [30, 132, 97, 20], ['']),
    receiveDeferral: object('obj-13', 'deferlow', [30, 161, 56, 20], ['']),
    bridge: object('obj-3', 'js live-bridge.js', [30, 191, 173, 20], ['', '', ''], {
      saved_object_attributes: { filename: 'live-bridge.js', parameter_enable: 0 },
    }),

    // Startup configuration.
    loadTrigger: object('obj-4', 'loadbang', [212, 132, 58, 20], ['bang']),
    configureOscPath: message('obj-5', 'set_path /compass/clip-notes', [283, 132, 180, 20]),

    // Tempo replies to the desktop app.
    tempoSender: object('obj-19', 'udpsend 127.0.0.1 8971', [392, 239, 138, 20]),

    // Keep console diagnostics without duplicating them in message boxes.
    statusConsole: object('obj-6', 'print compass_bridge', [30, 239, 129, 20]),
    errorConsole: object('obj-7', 'print compass_bridge_error', [208, 239, 168, 20]),

    // MIDI passes through without entering the OSC/Live API path.
    midiInput: object('obj-11', 'midiin', [30, 382, 43, 20], ['int']),
    midiOutput: object('obj-12', 'midiout', [110, 382, 50, 20]),
  };
}

function createConnections(objects) {
  return [
    connect(objects.loadTrigger, objects.configureOscPath),
    connect(objects.configureOscPath, objects.bridge),
    connect(objects.udpReceiver, objects.receiveDeferral),
    connect(objects.receiveDeferral, objects.bridge),
    connect(objects.bridge, objects.tempoSender, { outlet: 2 }),
    connect(objects.bridge, objects.statusConsole),
    connect(objects.bridge, objects.errorConsole, { outlet: 1 }),
    connect(objects.midiInput, objects.midiOutput),
  ];
}

export function createBridgePatch(version) {
  const objects = createObjects(version);
  return {
    patcher: {
      ...PATCH_LAYOUT,
      boxes: Object.values(objects),
      lines: createConnections(objects),
      ...DEVICE_METADATA,
    },
  };
}

// Max window defaults; these do not participate in bridge message routing.
const PATCH_LAYOUT = {
  fileversion: 1,
  appversion: {
    major: 9,
    minor: 1,
    revision: 4,
    architecture: 'x64',
    modernui: 1
  },
  classnamespace: 'box',
  rect: [92, 380, 683, 317],
  openrect: [0, 0, DEVICE_WIDTH, DEVICE_HEIGHT],
  openrectmode: 0,
  openinpresentation: 1,
  default_fontsize: 10,
  default_fontname: 'Ableton Sans',
  gridsize: [8, 8],
  boxanimatetime: 500,
  devicewidth: DEVICE_WIDTH
};

// Device type and dependency handling are kept separate from routing and layout.
const DEVICE_METADATA = {
  latency: 0,
  is_mpe: 0,
  external_mpe_tuning_enabled: 0,
  minimum_live_version: '',
  minimum_max_version: '',
  platform_compatibility: 0,
  project: {
    version: 1,
    autoorganize: 1,
    hideprojectwindow: 1,
    showdependencies: 1,
    autolocalize: 0,
    contents: {
      patchers: {}
    },
    searchpath: {},
    amxdtype: 1835887981,
    readonly: 0,
    devpathtype: 0,
    devpath: '.',
    includepackages: 0
  },
  autosave: 0,
  oscreceiveudpport: 0
};
