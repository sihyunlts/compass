export type ShortcutPlatform = 'mac' | 'windows' | 'linux';

interface ShortcutChord {
  key: string;
  primary?: boolean;
  shift?: boolean;
}

interface ShortcutDefinition {
  default: readonly ShortcutChord[];
  overrides?: Partial<Record<ShortcutPlatform, readonly ShortcutChord[]>>;
}

const primaryChord = (
  key: string,
  shift = false,
): ShortcutChord => ({ key, primary: true, shift });

const APP_SHORTCUTS = {
  groupSelection: {
    default: [primaryChord('g')],
  },
  ungroupSelection: {
    default: [primaryChord('g', true)],
  },
  renameSelection: {
    default: [primaryChord('r')],
  },
  newRack: {
    default: [primaryChord('n')],
  },
  saveRack: {
    default: [primaryChord('s')],
  },
  saveRackAs: {
    default: [primaryChord('s', true)],
  },
  undo: {
    default: [primaryChord('z')],
  },
  redo: {
    default: [primaryChord('z', true)],
    overrides: {
      windows: [primaryChord('y'), primaryChord('z', true)],
      linux: [primaryChord('y'), primaryChord('z', true)],
    },
  },
  copy: {
    default: [primaryChord('c')],
  },
  cut: {
    default: [primaryChord('x')],
  },
  paste: {
    default: [primaryChord('v')],
  },
  duplicate: {
    default: [primaryChord('d')],
  },
  selectAll: {
    default: [primaryChord('a')],
  },
  toggleEnabled: {
    default: [{ key: '0' }],
  },
  collapseSelection: {
    default: [{ key: '-' }],
  },
  expandSelection: {
    default: [{ key: '=' }],
  },
  deleteSelection: {
    default: [{ key: 'Delete' }, { key: 'Backspace' }],
    overrides: {
      mac: [{ key: 'Backspace' }, { key: 'Delete' }],
    },
  },
  deletePresetEntries: {
    default: [{ key: 'Delete' }],
    overrides: {
      mac: [primaryChord('Backspace')],
    },
  },
} as const satisfies Record<string, ShortcutDefinition>;

export type AppShortcutId = keyof typeof APP_SHORTCUTS;

export interface ShortcutPresentation {
  display: string;
  ariaKeyShortcuts: string;
}

export const resolveShortcutPlatform = (value: string): ShortcutPlatform => {
  const normalized = value.toLowerCase();
  if (normalized === 'darwin' || normalized.includes('mac')) {
    return 'mac';
  }
  if (normalized === 'win32' || normalized.includes('windows')) {
    return 'windows';
  }
  return 'linux';
};

const resolveShortcutChords = (
  id: AppShortcutId,
  platform: ShortcutPlatform,
): readonly ShortcutChord[] => {
  const definition: ShortcutDefinition = APP_SHORTCUTS[id];
  return definition.overrides?.[platform] ?? definition.default;
};

const normalizeEventKey = (key: string): string =>
  key.length === 1 ? key.toLowerCase() : key;

const matchesChord = (
  event: KeyboardEvent,
  chord: ShortcutChord,
  platform: ShortcutPlatform,
): boolean => normalizeEventKey(event.key) === normalizeEventKey(chord.key)
  && event.ctrlKey === (chord.primary === true && platform !== 'mac')
  && event.metaKey === (chord.primary === true && platform === 'mac')
  && !event.altKey
  && event.shiftKey === (chord.shift === true);

export const matchesAppShortcut = (
  event: KeyboardEvent,
  id: AppShortcutId,
  platform: ShortcutPlatform,
): boolean => resolveShortcutChords(id, platform).some(
  (chord) => matchesChord(event, chord, platform),
);

const formatKey = (key: string, platform: ShortcutPlatform): string => {
  if (platform === 'mac') {
    if (key === 'Backspace') {
      return '⌫';
    }
    if (key === 'Delete') {
      return '⌦';
    }
  }
  return key.length === 1 ? key.toUpperCase() : key;
};

const formatCanonicalKey = (key: string): string =>
  key.length === 1 ? key.toUpperCase() : key;

const formatDisplayChord = (
  chord: ShortcutChord,
  platform: ShortcutPlatform,
): string => {
  const key = formatKey(chord.key, platform);
  if (platform === 'mac') {
    return `${chord.shift ? '⇧' : ''}${chord.primary ? '⌘' : ''}${key}`;
  }

  return [chord.primary ? 'Ctrl' : '', chord.shift ? 'Shift' : '', key]
    .filter(Boolean)
    .join('+');
};

const formatAriaChord = (
  chord: ShortcutChord,
  platform: ShortcutPlatform,
): string => {
  const primary = chord.primary
    ? platform === 'mac' ? 'Meta' : 'Control'
    : '';
  return [primary, chord.shift ? 'Shift' : '', formatCanonicalKey(chord.key)]
    .filter(Boolean)
    .join('+');
};

export const resolveShortcutPresentation = (
  id: AppShortcutId,
  platform: ShortcutPlatform,
): ShortcutPresentation => {
  const chords = resolveShortcutChords(id, platform);
  return {
    display: formatDisplayChord(chords[0], platform),
    ariaKeyShortcuts: chords.map((chord) => formatAriaChord(chord, platform)).join(' '),
  };
};

export const resolveElectronAccelerator = (
  id: AppShortcutId,
  platform: ShortcutPlatform,
): string => {
  const chord = resolveShortcutChords(id, platform)[0];
  const primary = chord.primary
    ? platform === 'mac' ? 'Command' : 'Control'
    : '';
  return [primary, chord.shift ? 'Shift' : '', formatCanonicalKey(chord.key)]
    .filter(Boolean)
    .join('+');
};
