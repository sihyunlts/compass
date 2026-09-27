import { createDeviceFace, DEVICE_HEIGHT, DEVICE_WIDTH } from '../shared/device-face.mjs';

export function createEmbeddedPatch(version, { bridgeFile, installerFile, windowLayoutFile, fileHostFile }) {
  const uiWidth = 1400;
  const uiHeight = 280;

  const box = (id, maxclass, properties = {}) => ({ box: { id, maxclass, patching_rect: [20, 20, 160, 22], ...properties } });
  const object = (id, text, properties = {}) => box(id, 'newobj', { text, ...properties });
  const line = (source, outlet, destination, inlet = 0) => ({ patchline: { source: [source, outlet], destination: [destination, inlet] } });
  const patcher = (boxes, lines, properties = {}) => ({
    fileversion: 1, appversion: { major: 9, minor: 0, revision: 0, architecture: 'x64' },
    classnamespace: 'box', rect: [80, 80, 1400, 320], openinpresentation: 1,
    boxes, lines, ...properties,
  });
  const ui = patcher([
    box('web-input', 'inlet'),
    object('ui-route', 'route open files_start', { patching_rect: [20, 300, 180, 22] }),
    box('web', 'jweb', { varname: 'compass_web', numinlets: 1, numoutlets: 1, rendermode: 1, presentation: 1, presentation_rect: [0, 0, uiWidth, uiHeight], patching_rect: [0, 0, uiWidth, uiHeight], url: 'about:blank' }),
    object('open-order', 't b b b', { patching_rect: [700, 300, 60, 22] }),
    // Window configuration belongs to initialization, not every focus request.
    object('configure-once', 'onebang 1', { patching_rect: [900, 300, 80, 22] }),
    box('configure-window', 'message', { text: `presentation 1, window flags float grow nozoom, window constrain 720 ${uiHeight} 32768 ${uiHeight}, window exec`, patching_rect: [700, 340, 600, 22] }),
    box('show-window', 'message', { text: 'front', patching_rect: [900, 380, 50, 22] }),
    // Read the window width after the floating view has opened.
    object('after-open', 'deferlow', { patching_rect: [700, 380, 70, 22] }),
    object('window', 'thispatcher', { patching_rect: [900, 460, 90, 22] }),
    object('layout', `js ${windowLayoutFile} ${uiHeight}`, { patching_rect: [700, 540, 400, 22] }),
    object('window-active', 'active', { patching_rect: [700, 460, 50, 22] }),
    object('window-focused', 'sel 1', { patching_rect: [700, 500, 50, 22] }),
    object('bridge', `js ${bridgeFile}`, { numinlets: 1, numoutlets: 3, patching_rect: [20, 360, 260, 22] }),
    // Normalize both list and selector messages before calling named js methods.
    // Unmatched jweb messages must never enter the shared engine's OSC decoder.
    object('web-route', 'route compass_files compass_prepare compass_send compass_cancel compass_request_tempo compass_open_external', { patching_rect: [20, 460, 840, 22] }),
    object('transfer-prepare', 'prepend compass_prepare', { patching_rect: [300, 500, 170, 22] }),
    object('transfer-send', 'prepend compass_send', { patching_rect: [480, 500, 160, 22] }),
    object('transfer-cancel', 'prepend compass_cancel', { patching_rect: [650, 500, 170, 22] }),
    box('transfer-tempo', 'message', { text: 'compass_request_tempo', patching_rect: [830, 500, 170, 22] }),
    object('open-external', 'prepend compass_open_external', { patching_rect: [1010, 500, 210, 22] }),
    // LiveAPI must run in Max's low-priority scheduler, as in the OSC bridge.
    object('transfer-defer', 'deferlow', { patching_rect: [300, 540, 70, 22] }),
    object('file-start', 'prepend start', { patching_rect: [20, 500, 100, 22] }),
    object('files', `js ${fileHostFile}`, { numinlets: 2, numoutlets: 2, patching_rect: [20, 540, 600, 22] }),
    object('ready', 'live.thisdevice', { patching_rect: [300, 360, 100, 22] }),
    box('ready-message', 'message', { text: 'live_ready', patching_rect: [300, 400, 100, 22] }),
    object('live-path', 'live.path live_set', { patching_rect: [440, 360, 120, 22] }),
    object('tempo-observer', 'live.observer tempo', { patching_rect: [440, 400, 140, 22] }),
    object('tempo-message', 'prepend tempo', { patching_rect: [440, 440, 110, 22] }),
  ], [
    line('web-input', 0, 'ui-route'), line('ui-route', 2, 'web'),
    line('ui-route', 1, 'file-start'), line('file-start', 0, 'files'),
    line('ui-route', 0, 'open-order'),
    line('open-order', 2, 'configure-once'), line('configure-once', 0, 'configure-window'), line('configure-window', 0, 'window'),
    line('open-order', 1, 'show-window'), line('show-window', 0, 'window'),
    line('open-order', 0, 'after-open'),
    line('after-open', 0, 'layout'),
    line('window-active', 0, 'window-focused'), line('window-focused', 0, 'after-open'),
    line('web', 0, 'web-route'), line('bridge', 2, 'web'),
    line('web-route', 1, 'transfer-prepare'), line('transfer-prepare', 0, 'transfer-defer'),
    line('web-route', 2, 'transfer-send'), line('transfer-send', 0, 'transfer-defer'),
    line('web-route', 3, 'transfer-cancel'), line('transfer-cancel', 0, 'transfer-defer'),
    line('web-route', 4, 'transfer-tempo'), line('transfer-tempo', 0, 'transfer-defer'),
    line('web-route', 5, 'open-external'), line('open-external', 0, 'transfer-defer'),
    line('transfer-defer', 0, 'bridge'),
    line('web-route', 0, 'files'), line('files', 0, 'web'),
    line('ready', 0, 'ready-message'), line('ready-message', 0, 'bridge'),
    line('ready', 0, 'live-path'), line('live-path', 0, 'tempo-observer', 1),
    line('tempo-observer', 0, 'tempo-message'), line('tempo-message', 0, 'bridge'),
  ], {
    rect: [80, 80, uiWidth, uiHeight], openrect: [80, 80, uiWidth, uiHeight], openrectmode: 0,
    toolbarvisible: 0, enablehscroll: 0, enablevscroll: 0, title: 'Compass',
  });
  const face = createDeviceFace(version, 'Compass');
  face.logo.box.presentation_rect = [17, 8, 76, 76];
  face.title.box.presentation_rect = [15, 87, 80, 20];
  face.title.box.presentation_linecount = 1;
  face.versionLabel.box.presentation_rect = [28, 109, 54, 20];
  const main = patcher([
    ...Object.values(face),
    // A single tab in button mode supports a flat native fill and a pixel radius.
    box('open', 'tab', {
      tabs: ['Open'], button: 1, gradient: 0, rounded: 6,
      saved_attribute_attributes: {
        tabcolor: { expression: 'themecolor.live_control_text_bg' },
        htabcolor: { expression: 'themecolor.live_control_text_bg' },
        textcolor: { expression: 'themecolor.live_control_fg' },
      },
      multiline: 0, spacing_x: 0, spacing_y: 0,
      fontname: 'Ableton Sans', fontsize: 11,
      numinlets: 1, numoutlets: 3, outlettype: ['int', '', ''],
      presentation: 1, presentation_rect: [15, 135, 80, 24],
    }),
    box('open-message', 'message', { text: 'open', patching_rect: [20, 80, 50, 22] }),
    object('ui', 'p Compass', { patcher: ui, numinlets: 1, numoutlets: 0, patching_rect: [20, 160, 100, 22] }),
    object('installer', `js ${installerFile}`, { numoutlets: 2, patching_rect: [160, 160, 240, 22] }),
    object('load', 'loadbang', { patching_rect: [160, 20, 65, 22] }),
    box('temp-path', 'message', { text: 'Tempfolder:/', patching_rect: [160, 50, 100, 22] }),
    object('resolve-path', 'conformpath max absolute', { patching_rect: [160, 85, 180, 22] }),
    object('load-page', 'prepend load_page', { patching_rect: [160, 120, 160, 22] }),
    object('midi-in', 'midiin', { patching_rect: [20, 220, 55, 22] }),
    object('midi-out', 'midiout', { patching_rect: [20, 260, 55, 22] }),
  ], [
    line('open', 0, 'open-message'), line('open-message', 0, 'ui'),
    line('installer', 0, 'ui'), line('installer', 1, 'ui'), line('midi-in', 0, 'midi-out'),
    line('load', 0, 'temp-path'), line('temp-path', 0, 'resolve-path'),
    line('resolve-path', 0, 'load-page'), line('load-page', 0, 'installer'),
  ], {
    rect: [80, 80, 600, 340], openrect: [0, 0, DEVICE_WIDTH, DEVICE_HEIGHT],
    devicewidth: DEVICE_WIDTH, default_fontname: 'Ableton Sans', default_fontsize: 10,
  });

  return { patcher: main };
}
