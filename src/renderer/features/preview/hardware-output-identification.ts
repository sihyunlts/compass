const DEVICE_INQUIRY = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7] as const;
const IDENTITY_RESPONSE_TIMEOUT_MS = 400;
const CORE_FW_PROBE = [
  0xf0, 0x00, 0x20, 0x29, 0x02, 0x7f, 0x00, 0xf7,
] as const;
const CORE_FW_PROBE_TIMEOUT_MS = 150;

type MidiMessage = readonly number[];
type FirmwareKind = 'stock' | 'core-fw' | 'mat1';
export type HardwareOutputPortRole = 'midi' | 'live' | 'standalone';

export interface HardwareOutputProfile {
  readonly noteOnStatus: number;
  readonly connectMessages: readonly MidiMessage[];
  readonly topRowCcStart?: number;
  readonly modeLightSysex?: boolean;
}

export interface IdentifiedHardwareOutput {
  readonly profile: HardwareOutputProfile;
  readonly requiredPortRole: HardwareOutputPortRole | null;
}

interface SupportedIdentity {
  manufacturerId: readonly [number, number, number];
  familyCode: readonly [number, number];
  familyMemberCode: readonly [number, number];
  resolveProfile: (firmware: FirmwareKind) => HardwareOutputProfile;
  resolveRequiredPortRole: (
    firmware: FirmwareKind,
  ) => HardwareOutputPortRole | null;
}

interface IdentifiedOutput {
  readonly identity: SupportedIdentity;
  readonly softwareRevision: Uint8Array;
}

const NOVATION_MANUFACTURER_ID = [0x00, 0x20, 0x29] as const;
const DJ_TECHTOOLS_MANUFACTURER_ID = [0x00, 0x01, 0x79] as const;
const SYSTEMS_203_MANUFACTURER_ID = [0x00, 0x02, 0x03] as const;
const DEFAULT_FAMILY_MEMBER_CODE = [0x00, 0x00] as const;
const MAT1_FIRMWARE_REVISION = [0x00, 0x63, 0x66, 0x79] as const;
const DRUM_RACK_TOP_NOTE_START = 0x1c;
const DRUM_RACK_TOP_NOTE_END = 0x23;
const DRUM_RACK_MODE_LIGHT_NOTE = 0x1b;

const freezeProfile = (
  profile: HardwareOutputProfile,
): HardwareOutputProfile => Object.freeze(profile);

export const DEFAULT_HARDWARE_OUTPUT_PROFILE = freezeProfile({
  noteOnStatus: 0x90,
  connectMessages: [],
});

const createProfile = (
  noteOnChannel: number,
  options: Omit<HardwareOutputProfile, 'noteOnStatus'>,
): HardwareOutputProfile => freezeProfile({
  noteOnStatus: 0x90 | (noteOnChannel - 1),
  ...options,
});

const CORE_FW_PERFORMANCE_MODE = [
  0xf0, 0x00, 0x20, 0x29, 0x02, 0x7f, 0x00, 0x00, 0xf7,
] as const;

const matchesBytes = (
  data: ArrayLike<number>,
  offset: number,
  expected: readonly number[],
): boolean => expected.every((value, index) => data[offset + index] === value);

const isMat1Firmware = (revision: ArrayLike<number>): boolean =>
  matchesBytes(revision, 0, MAT1_FIRMWARE_REVISION);

const isCoreFwProbeResponse = (data: Uint8Array): boolean =>
  data.length === 12
  && matchesBytes(data, 0, [
    0xf0, 0x00, 0x20, 0x29, 0x02, 0x7f, 0x01,
  ])
  && data[11] === 0xf7;

const isLaunchpadProIdentity = (identity: SupportedIdentity): boolean =>
  matchesBytes(identity.manufacturerId, 0, NOVATION_MANUFACTURER_ID)
  && matchesBytes(identity.familyCode, 0, [0x51, 0x00]);

const resolveCoreFwMidiPort = (
  firmware: FirmwareKind,
): HardwareOutputPortRole | null => firmware === 'core-fw' ? 'midi' : null;

const MK3_PROFILE = createProfile(1, {
  connectMessages: [],
});

const resolveLaunchpadMk2Profile = (
  firmware: FirmwareKind,
): HardwareOutputProfile => createProfile(6, {
  connectMessages: [],
  ...(firmware === 'core-fw' ? {} : { topRowCcStart: 104 }),
});

const resolveLaunchpadProProfile = (
  firmware: FirmwareKind,
): HardwareOutputProfile => {
  if (firmware === 'core-fw') {
    return createProfile(6, {
      connectMessages: [CORE_FW_PERFORMANCE_MODE],
    });
  }
  if (firmware === 'mat1') {
    return createProfile(16, {
      connectMessages: [
        [0xf0, 0x00, 0x20, 0x29, 0x02, 0x10, 0x21, 0x01, 0xf7],
        [0xf0, 0x00, 0x20, 0x29, 0x02, 0x10, 0x2c, 0x04, 0xf7],
      ],
    });
  }
  return createProfile(6, {
    connectMessages: [
      [0xf0, 0x00, 0x20, 0x29, 0x02, 0x10, 0x21, 0x00, 0xf7],
      [0xf0, 0x00, 0x20, 0x29, 0x02, 0x10, 0x22, 0x03, 0xf7],
    ],
    topRowCcStart: 91,
    modeLightSysex: true,
  });
};

const resolveLegacyProfile = (
  firmware: FirmwareKind,
): HardwareOutputProfile => createProfile(1, {
  connectMessages: [],
  ...(firmware === 'core-fw' ? {} : { topRowCcStart: 104 }),
});

const MIDI_FIGHTER_64_PROFILE = createProfile(3, {
  connectMessages: [],
});

const MYSTRIX_PROFILE = createProfile(2, {
  connectMessages: [],
});

const SUPPORTED_IDENTITIES: readonly SupportedIdentity[] = [
  {
    manufacturerId: NOVATION_MANUFACTURER_ID,
    familyCode: [0x03, 0x01],
    familyMemberCode: DEFAULT_FAMILY_MEMBER_CODE,
    resolveProfile: () => MK3_PROFILE,
    resolveRequiredPortRole: () => 'midi',
  },
  {
    manufacturerId: NOVATION_MANUFACTURER_ID,
    familyCode: [0x13, 0x01],
    familyMemberCode: DEFAULT_FAMILY_MEMBER_CODE,
    resolveProfile: () => MK3_PROFILE,
    resolveRequiredPortRole: () => 'midi',
  },
  {
    manufacturerId: NOVATION_MANUFACTURER_ID,
    familyCode: [0x23, 0x01],
    familyMemberCode: DEFAULT_FAMILY_MEMBER_CODE,
    resolveProfile: () => MK3_PROFILE,
    resolveRequiredPortRole: () => 'midi',
  },
  {
    manufacturerId: NOVATION_MANUFACTURER_ID,
    familyCode: [0x69, 0x00],
    familyMemberCode: DEFAULT_FAMILY_MEMBER_CODE,
    resolveProfile: resolveLaunchpadMk2Profile,
    resolveRequiredPortRole: resolveCoreFwMidiPort,
  },
  {
    manufacturerId: NOVATION_MANUFACTURER_ID,
    familyCode: [0x51, 0x00],
    familyMemberCode: DEFAULT_FAMILY_MEMBER_CODE,
    resolveProfile: resolveLaunchpadProProfile,
    resolveRequiredPortRole: (firmware) => {
      if (firmware === 'core-fw') {
        return 'midi';
      }
      return firmware === 'mat1' ? 'standalone' : 'live';
    },
  },
  {
    manufacturerId: NOVATION_MANUFACTURER_ID,
    familyCode: [0x36, 0x00],
    familyMemberCode: DEFAULT_FAMILY_MEMBER_CODE,
    resolveProfile: resolveLegacyProfile,
    resolveRequiredPortRole: resolveCoreFwMidiPort,
  },
  {
    manufacturerId: NOVATION_MANUFACTURER_ID,
    familyCode: [0x20, 0x00],
    familyMemberCode: DEFAULT_FAMILY_MEMBER_CODE,
    resolveProfile: resolveLegacyProfile,
    resolveRequiredPortRole: resolveCoreFwMidiPort,
  },
  {
    manufacturerId: DJ_TECHTOOLS_MANUFACTURER_ID,
    familyCode: [0x06, 0x00],
    familyMemberCode: [0x01, 0x00],
    resolveProfile: () => MIDI_FIGHTER_64_PROFILE,
    resolveRequiredPortRole: () => null,
  },
  {
    manufacturerId: SYSTEMS_203_MANUFACTURER_ID,
    familyCode: [0x4d, 0x58],
    familyMemberCode: [0x11, 0x01],
    resolveProfile: () => MYSTRIX_PROFILE,
    resolveRequiredPortRole: () => null,
  },
];

const createIdentifiedHardwareOutput = (
  identifiedOutput: IdentifiedOutput,
  firmware: FirmwareKind,
): IdentifiedHardwareOutput => ({
  profile: identifiedOutput.identity.resolveProfile(firmware),
  requiredPortRole:
    identifiedOutput.identity.resolveRequiredPortRole(firmware),
});

const resolveSupportedOutput = (
  data: Uint8Array,
): IdentifiedOutput | null => {
  if (
    data.length !== 17
    || data[0] !== 0xf0
    || data[1] !== 0x7e
    || data[3] !== 0x06
    || data[4] !== 0x02
    || data[16] !== 0xf7
  ) {
    return null;
  }

  const identity = SUPPORTED_IDENTITIES.find((candidate) =>
    matchesBytes(data, 5, candidate.manufacturerId)
    && matchesBytes(data, 8, candidate.familyCode)
    && matchesBytes(data, 10, candidate.familyMemberCode));
  if (!identity) {
    return null;
  }
  return {
    identity,
    softwareRevision: data.slice(12, 16),
  };
};

export const createHardwareOutputMessages = (
  profile: HardwareOutputProfile,
  pitch: number,
  velocity: number,
): readonly MidiMessage[] => {
  if (
    profile.topRowCcStart !== undefined
    && pitch >= DRUM_RACK_TOP_NOTE_START
    && pitch <= DRUM_RACK_TOP_NOTE_END
  ) {
    return [[
      0xb0 | (profile.noteOnStatus & 0x0f),
      profile.topRowCcStart + pitch - DRUM_RACK_TOP_NOTE_START,
      velocity,
    ]];
  }
  if (profile.modeLightSysex && pitch === DRUM_RACK_MODE_LIGHT_NOTE) {
    return [[
      0xf0, 0x00, 0x20, 0x29, 0x02, 0x10, 0x0a, 0x63, velocity, 0xf7,
    ]];
  }
  return [[profile.noteOnStatus, pitch, velocity]];
};

interface ProbePortLease {
  referenceCount: number;
  readonly openPromise: Promise<MIDIPort>;
  readonly shouldClose: boolean;
}

const probePortLeases = new WeakMap<MIDIPort, ProbePortLease>();

const releaseProbePort = async (
  port: MIDIPort,
  lease: ProbePortLease,
): Promise<void> => {
  lease.referenceCount -= 1;
  if (lease.referenceCount > 0) {
    return;
  }
  probePortLeases.delete(port);
  if (!lease.shouldClose) {
    return;
  }
  try {
    await port.close();
  } catch {
    // Failing to close one probe port must not block the remaining cleanup.
  }
};

const acquireProbePort = async (port: MIDIPort): Promise<() => Promise<void>> => {
  let lease = probePortLeases.get(port);
  if (!lease) {
    const shouldClose = port.connection === 'closed';
    lease = {
      referenceCount: 0,
      openPromise: port.open(),
      shouldClose,
    };
    probePortLeases.set(port, lease);
  }
  lease.referenceCount += 1;
  try {
    await lease.openPromise;
  } catch (error) {
    await releaseProbePort(port, lease);
    throw error;
  }
  return () => releaseProbePort(port, lease);
};

const releaseProbePorts = async (
  releases: readonly (() => Promise<void>)[],
): Promise<void> => {
  await Promise.all(releases.map(async (release) => release()));
};

/** Identifies compatible grid controllers by their Universal Device Inquiry response. */
export const identifyHardwareOutput = async (
  midiAccess: MIDIAccess,
  output: MIDIOutput,
): Promise<IdentifiedHardwareOutput | null> => {
  const inputs: MIDIInput[] = [];
  const releaseProbePortCallbacks: Array<() => Promise<void>> = [];
  for (const input of midiAccess.inputs.values()) {
    if (input.state !== 'connected') {
      continue;
    }
    try {
      releaseProbePortCallbacks.push(await acquireProbePort(input));
      inputs.push(input);
    } catch {
      // A different connected input can still carry the inquiry response.
    }
  }
  if (inputs.length === 0) {
    return null;
  }

  try {
    releaseProbePortCallbacks.push(await acquireProbePort(output));
  } catch {
    await releaseProbePorts(releaseProbePortCallbacks);
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    let identifiedOutput: IdentifiedOutput | null = null;
    let coreFwProbeTimeoutId: number | null = null;
    const finish = (result: IdentifiedHardwareOutput | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      if (coreFwProbeTimeoutId !== null) {
        window.clearTimeout(coreFwProbeTimeoutId);
      }
      for (const input of inputs) {
        input.removeEventListener('midimessage', handleMessage);
      }
      void releaseProbePorts(releaseProbePortCallbacks).then(() => resolve(result));
    };
    const handleMessage = (event: MIDIMessageEvent): void => {
      if (identifiedOutput && isCoreFwProbeResponse(event.data)) {
        finish(createIdentifiedHardwareOutput(identifiedOutput, 'core-fw'));
        return;
      }
      if (identifiedOutput) {
        return;
      }

      const nextIdentifiedOutput = resolveSupportedOutput(event.data);
      if (!nextIdentifiedOutput) {
        return;
      }
      if (
        isLaunchpadProIdentity(nextIdentifiedOutput.identity)
        && isMat1Firmware(nextIdentifiedOutput.softwareRevision)
      ) {
        finish(createIdentifiedHardwareOutput(nextIdentifiedOutput, 'mat1'));
        return;
      }
      if (!matchesBytes(
        nextIdentifiedOutput.identity.manufacturerId,
        0,
        NOVATION_MANUFACTURER_ID,
      )) {
        finish(createIdentifiedHardwareOutput(nextIdentifiedOutput, 'stock'));
        return;
      }

      identifiedOutput = nextIdentifiedOutput;
      window.clearTimeout(timeoutId);
      try {
        output.send(CORE_FW_PROBE);
        coreFwProbeTimeoutId = window.setTimeout(
          () => finish(createIdentifiedHardwareOutput(nextIdentifiedOutput, 'stock')),
          CORE_FW_PROBE_TIMEOUT_MS,
        );
      } catch {
        finish(createIdentifiedHardwareOutput(nextIdentifiedOutput, 'stock'));
      }
    };
    const timeoutId = window.setTimeout(
      () => finish(null),
      IDENTITY_RESPONSE_TIMEOUT_MS,
    );

    for (const input of inputs) {
      input.addEventListener('midimessage', handleMessage);
    }
    try {
      output.send(DEVICE_INQUIRY);
    } catch {
      finish(null);
    }
  });
};
