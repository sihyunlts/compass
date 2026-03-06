import type { LaunchpadButton, LaunchpadModel, MidiAddress } from '../shared/model';
export type LaunchpadLayout = 'drum-rack';

const CHANNEL = 1;
const LAYOUT: LaunchpadLayout = 'drum-rack';

interface LogoConfig {
  x: number;
  y: number;
  outputNote: number;
}

interface EdgeConfig {
  leftTopOutputNote: number;
  leftOutputNotes: ReadonlyArray<number>;
  rightOutputNotes: ReadonlyArray<number>;
  topOutputNotes: ReadonlyArray<number>;
  bottomTopRowOutputNotes: ReadonlyArray<number>;
  bottomBottomRowOutputNotes: ReadonlyArray<number>;
}

interface LaunchpadMapProfile {
  logo: LogoConfig;
  gridOutputNotes: ReadonlyArray<ReadonlyArray<number>>;
  edges: EdgeConfig;
}

const note = (number: number): MidiAddress => ({
  kind: 'note',
  number,
  channel: CHANNEL,
});

const GRID_WIDTH = 8;
const GRID_HEIGHT = 8;

// Fixed drum-rack grid note map (based on MK3).
// Rows are listed bottom to top (`y=1` is the bottom row).
const DRUM_RACK_GRID_NOTES: ReadonlyArray<ReadonlyArray<number>> = [
  [0x24, 0x25, 0x26, 0x27, 0x44, 0x45, 0x46, 0x47],
  [0x28, 0x29, 0x2a, 0x2b, 0x48, 0x49, 0x4a, 0x4b],
  [0x2c, 0x2d, 0x2e, 0x2f, 0x4c, 0x4d, 0x4e, 0x4f],
  [0x30, 0x31, 0x32, 0x33, 0x50, 0x51, 0x52, 0x53],
  [0x34, 0x35, 0x36, 0x37, 0x54, 0x55, 0x56, 0x57],
  [0x38, 0x39, 0x3a, 0x3b, 0x58, 0x59, 0x5a, 0x5b],
  [0x3c, 0x3d, 0x3e, 0x3f, 0x5c, 0x5d, 0x5e, 0x5f],
  [0x40, 0x41, 0x42, 0x43, 0x60, 0x61, 0x62, 0x63],
];

const DRUM_RACK_EDGE_CONFIG: EdgeConfig = Object.freeze({
  leftTopOutputNote: 0x1a,
  // Coordinate `y=1` is the bottom row, so this array is also bottom -> top.
  leftOutputNotes: [0x73, 0x72, 0x71, 0x70, 0x6f, 0x6e, 0x6d, 0x6c],
  rightOutputNotes: [0x6b, 0x6a, 0x69, 0x68, 0x67, 0x66, 0x65, 0x64],
  topOutputNotes: [0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23],
  bottomTopRowOutputNotes: [0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x7b],
  bottomBottomRowOutputNotes: [0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13],
});

const LAUNCHPAD_PROFILES: Record<LaunchpadModel, LaunchpadMapProfile> = {
  mk3: {
    logo: { x: 9, y: 9, outputNote: 0x1b },
    gridOutputNotes: DRUM_RACK_GRID_NOTES,
    edges: DRUM_RACK_EDGE_CONFIG,
  },
  // MK2 keeps the same note mapping but uses a different logo coordinate in Compass math.
  mk2: {
    logo: { x: 4.5, y: 0, outputNote: 0x1b },
    gridOutputNotes: DRUM_RACK_GRID_NOTES,
    edges: DRUM_RACK_EDGE_CONFIG,
  },
};

const buildButton = (
  id: string,
  zone: LaunchpadButton['zone'],
  x: number,
  y: number,
  outputAddress: MidiAddress,
): LaunchpadButton => {
  return {
    id,
    zone,
    x,
    y,
    output: outputAddress,
  };
};

const createGridButtons = (profile: LaunchpadMapProfile): LaunchpadButton[] => {
  const buttons: LaunchpadButton[] = [];
  for (let y = 1; y <= GRID_HEIGHT; y += 1) {
    for (let x = 1; x <= GRID_WIDTH; x += 1) {
      buttons.push(
        buildButton(
          `grid-${x}-${y}`,
          'grid',
          x,
          y,
          note(profile.gridOutputNotes[y - 1][x - 1]),
        ),
      );
    }
  }
  return buttons;
};

const createLeftButtons = (profile: LaunchpadMapProfile): LaunchpadButton[] => {
  const buttons: LaunchpadButton[] = [];
  buttons.push(
    buildButton(
      'left-top',
      'left',
      0,
      9,
      note(profile.edges.leftTopOutputNote),
    ),
  );
  for (let y = 1; y <= GRID_HEIGHT; y += 1) {
    buttons.push(
      buildButton(
        `left-${y}`,
        'left',
        0,
        y,
        note(profile.edges.leftOutputNotes[y - 1]),
      ),
    );
  }
  return buttons;
};

const createRightButtons = (profile: LaunchpadMapProfile): LaunchpadButton[] => {
  const buttons: LaunchpadButton[] = [];
  for (let y = 1; y <= GRID_HEIGHT; y += 1) {
    buttons.push(
      buildButton(
        `right-${y}`,
        'right',
        9,
        y,
        note(profile.edges.rightOutputNotes[y - 1]),
      ),
    );
  }
  return buttons;
};

const createTopButtons = (profile: LaunchpadMapProfile): LaunchpadButton[] => {
  const buttons: LaunchpadButton[] = [];
  for (let x = 1; x <= GRID_WIDTH; x += 1) {
    buttons.push(
      buildButton(
        `top-${x}`,
        'top',
        x,
        9,
        note(profile.edges.topOutputNotes[x - 1]),
      ),
    );
  }
  return buttons;
};

const createBottomButtons = (profile: LaunchpadMapProfile): LaunchpadButton[] => {
  const buttons: LaunchpadButton[] = [];
  for (let x = 1; x <= GRID_WIDTH; x += 1) {
    buttons.push(
      buildButton(
        `bottom-top-${x}`,
        'bottom',
        x,
        0,
        note(profile.edges.bottomTopRowOutputNotes[x - 1]),
      ),
    );

    // Keep the two physical bottom rows at the same virtual coordinate.
    buttons.push(
      buildButton(
        `bottom-bottom-${x}`,
        'bottom',
        x,
        0,
        note(profile.edges.bottomBottomRowOutputNotes[x - 1]),
      ),
    );
  }

  // Bottom corners do not exist physically. Keep virtual corner placeholders so
  // rotation/symmetry logic does not drop corner energy.
  buttons.push(
    buildButton(
      'bottom-corner-left',
      'bottom',
      0,
      0,
      note(0x7e), // F#8 (Ableton naming)
    ),
  );
  buttons.push(
    buildButton(
      'bottom-corner-right',
      'bottom',
      9,
      0,
      note(0x7f), // G8 (Ableton naming)
    ),
  );

  return buttons;
};

const createLogoButton = (profile: LaunchpadMapProfile): LaunchpadButton => {
  const config = profile.logo;
  return {
    id: 'logo',
    zone: 'logo',
    x: config.x,
    y: config.y,
    output: note(config.outputNote),
  };
};

/** Builds the immutable button map used by the generation engine for one Launchpad model. */
export const createLaunchpadMap = (
  model: LaunchpadModel = 'mk3',
): ReadonlyArray<LaunchpadButton> => {
  const profile = LAUNCHPAD_PROFILES[model];
  const buttons = [
    ...createGridButtons(profile),
    ...createLeftButtons(profile),
    ...createRightButtons(profile),
    ...createTopButtons(profile),
    ...createBottomButtons(profile),
    createLogoButton(profile),
  ];

  return Object.freeze(buttons);
};

/** Declares the fixed Launchpad layout label used in outgoing bridge envelopes. */
export const launchpadLayout = LAYOUT;
