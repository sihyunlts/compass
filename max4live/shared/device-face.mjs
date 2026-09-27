// Shared presentation for the OSC bridge and the embedded app launcher.
export const DEVICE_WIDTH = 110;
export const DEVICE_HEIGHT = 169;

export function createDeviceFace(version, title) {
  return {
    versionLabel: {
      box: {
        id: 'obj-23', maxclass: 'comment', text: `v${version}`,
        patching_rect: [156, 24, 43, 20], numinlets: 1, numoutlets: 0,
        fontname: 'Ableton Sans', fontsize: 11, presentation: 1,
        presentation_rect: [28, 133, 54, 20], textjustification: 1,
        textcolor: [0.694, 0.694, 0.694, 1], varname: 'compass_version',
      },
    },
    logo: {
      box: {
        id: 'obj-22', maxclass: 'fpic', pic: 'compass.png',
        patching_rect: [28, 50, 55, 55], numinlets: 1, numoutlets: 1,
        outlettype: ['jit_matrix'], autofit: 1, ignoreclick: 1,
        presentation: 1, presentation_rect: [17, 14, 76, 76],
      },
    },
    title: {
      box: {
        id: 'obj-1', maxclass: 'comment', text: title,
        patching_rect: [28, 22, 124, 23], numinlets: 1, numoutlets: 0,
        fontface: 1, fontname: 'Ableton Sans Bold', fontsize: 14,
        presentation: 1, presentation_linecount: 2,
        presentation_rect: [15, 93, 80, 40], textjustification: 1,
        textcolor: [1, 1, 1, 1],
      },
    },
  };
}
