import { SvelteMap } from 'svelte/reactivity';
import type {
  HardwareMidiOutput,
  HardwareMidiOutputState,
} from '../../shared/contracts/preview/hardware-output';
import {
  createHardwareOutputMessages,
  DEFAULT_HARDWARE_OUTPUT_PROFILE,
  identifyHardwareOutput,
  type HardwareOutputProfile,
  type HardwareOutputPortRole,
  type IdentifiedHardwareOutput,
} from '../features/preview/hardware-output-identification';

interface HardwarePreviewControllerOptions {
  preferredOutputId?: string | null;
  onPreferredOutputChange?: (outputId: string | null) => void;
  onOutputConnected?: (
    outputName: string,
    reason: HardwareOutputConnectionReason,
  ) => void;
  onOutputDisconnected?: (
    outputName: string,
    reason: HardwareOutputDisconnectionReason,
  ) => void;
}

type HardwareOutputConnectionReason = 'automatic' | 'manual' | 'restored';
type HardwareOutputDisconnectionReason = 'device' | 'manual';

const sanitizeMidiByte = (value: number): number =>
  Math.max(0, Math.min(127, Math.round(value)));

const closeMidiPort = async (port: MIDIPort | null): Promise<void> => {
  if (!port || port.connection === 'closed') {
    return;
  }
  try {
    await port.close();
  } catch {
    // Selection can continue even if the platform cannot release a stale port.
  }
};

const removeRedundantLaunchpadEndpointAlias = (name: string): string => {
  const words = name.split(/\s+/u);
  if (words[0]?.toLowerCase() !== 'launchpad') {
    return name;
  }
  const portRoleIndex = words.findIndex((word) =>
    ['daw', 'live', 'midi', 'standalone'].includes(word.toLowerCase()));
  if (portRoleIndex < 2 || !words[portRoleIndex - 1].toLowerCase().startsWith('lp')) {
    return name;
  }
  return words.toSpliced(portRoleIndex - 1, 1).join(' ');
};

const resolveOutputLabel = (output: MIDIOutput): string => {
  const name = output.name?.trim();
  if (!name) {
    return output.id;
  }

  const manufacturer = output.manufacturer?.trim();
  if (
    manufacturer
    && name.toLowerCase().startsWith(`${manufacturer.toLowerCase()} `)
  ) {
    return removeRedundantLaunchpadEndpointAlias(
      name.slice(manufacturer.length).trim(),
    );
  }
  return removeRedundantLaunchpadEndpointAlias(name);
};

const matchesPortRole = (
  output: MIDIOutput,
  role: HardwareOutputPortRole,
): boolean => {
  const name = output.name?.toLowerCase() ?? '';
  const words = new Set(name.split(/[^a-z0-9]+/u).filter(Boolean));
  const hasStandaloneRole = words.has('standalone');
  const hasLiveRole = words.has('live') || words.has('daw');
  const hasMidiRole = words.has('midi')
    || Array.from(words).some((word) => /^midi(?:in|out)\d*$/u.test(word));
  if (role === 'standalone') {
    return hasStandaloneRole;
  }
  if (role === 'live') {
    return hasLiveRole || (!hasStandaloneRole && !hasMidiRole);
  }
  return hasMidiRole && !hasLiveRole && !hasStandaloneRole;
};

/** Mirrors screen-preview LED frames to one selected Web MIDI output. */
export class HardwarePreviewController {
  public readonly state: HardwareMidiOutputState = $state({
    outputs: [],
    selectedOutputId: null,
    isAccessing: false,
    error: null,
  });

  private midiAccess: MIDIAccess | null = null;

  private latestVelocityByPitch = new SvelteMap<number, number>();

  private latestSourceFrame: ReadonlyMap<number, number> | null = null;

  private sentVelocityByPitch = new SvelteMap<number, number>();

  private selectedOutputProfile = DEFAULT_HARDWARE_OUTPUT_PROFILE;

  private isAppFocused = true;

  private preferredOutputId: string | undefined;

  private automaticSelectionSuppressed = false;

  private selectionRevision = 0;

  private pendingOutputId: string | null = null;

  private detectionRevision = 0;

  private probingOutputId: string | null = null;

  private automaticDetectionTimer: number | null = null;

  private shouldRetryAutomaticDetection = false;

  private outputStateSnapshotSource: HardwareMidiOutput[] = this.state.outputs;

  private outputStateSnapshot: HardwareMidiOutputState = {
    outputs: [],
    selectedOutputId: null,
    isAccessing: false,
    error: null,
  };

  public constructor(private readonly options: HardwarePreviewControllerOptions = {}) {
    this.preferredOutputId = options.preferredOutputId ?? undefined;
  }

  public async refreshOutputs(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      this.state.error = 'unsupported';
      return;
    }

    const needsMidiAccess = !this.midiAccess?.sysexEnabled;
    if (needsMidiAccess) {
      this.state.isAccessing = true;
    }
    this.state.error = null;
    try {
      if (!this.midiAccess?.sysexEnabled) {
        try {
          this.setMidiAccess(await navigator.requestMIDIAccess({ sysex: true }));
        } catch {
          if (!this.midiAccess) {
            this.setMidiAccess(await navigator.requestMIDIAccess());
          }
        }
      }
      this.syncOutputs();
      await this.selectInitialOutput();
    } catch {
      this.state.error = 'access-denied';
    } finally {
      if (needsMidiAccess) {
        this.state.isAccessing = false;
      }
    }
  }

  public async selectOutput(outputId: string | null): Promise<void> {
    const disconnectedOutputName = outputId === null
      ? this.resolveSelectedOutputName()
      : null;
    this.cancelAutomaticDetection();
    this.automaticSelectionSuppressed = outputId === null;
    this.preferredOutputId = outputId ?? undefined;
    this.options.onPreferredOutputChange?.(outputId);
    await this.applyOutputSelection(outputId, undefined, 'manual');
    if (disconnectedOutputName) {
      this.options.onOutputDisconnected?.(disconnectedOutputName, 'manual');
    }
  }

  private async applyOutputSelection(
    outputId: string | null,
    identifiedProfile?: HardwareOutputProfile,
    connectionReason?: HardwareOutputConnectionReason,
  ): Promise<void> {
    const selectionRevision = ++this.selectionRevision;
    const previousOutput = this.resolveSelectedOutput();
    this.pendingOutputId = outputId;
    this.turnOffSentLeds();
    this.state.selectedOutputId = null;
    this.selectedOutputProfile = DEFAULT_HARDWARE_OUTPUT_PROFILE;
    await closeMidiPort(previousOutput);
    if (selectionRevision !== this.selectionRevision) {
      return;
    }
    if (!outputId) {
      this.state.error = null;
      this.pendingOutputId = null;
      return;
    }

    const output = this.midiAccess?.outputs.get(outputId);
    if (!output || output.state !== 'connected') {
      this.state.selectedOutputId = null;
      this.selectedOutputProfile = DEFAULT_HARDWARE_OUTPUT_PROFILE;
      this.state.error = 'output-disconnected';
      this.pendingOutputId = null;
      this.syncOutputs();
      return;
    }

    const outputProfile = identifiedProfile
      ?? await this.resolveOutputProfile(output);
    if (selectionRevision !== this.selectionRevision) {
      return;
    }

    try {
      await output.open();
      if (selectionRevision !== this.selectionRevision) {
        if (
          this.pendingOutputId !== output.id
          && this.state.selectedOutputId !== output.id
        ) {
          await closeMidiPort(output);
        }
        return;
      }
      this.selectedOutputProfile = outputProfile;
      this.sendProfileMessages(output, outputProfile.connectMessages);
      this.state.selectedOutputId = output.id;
      this.state.error = null;
      this.pendingOutputId = null;
      this.sendLatestFrame();
      if (connectionReason) {
        this.options.onOutputConnected?.(
          resolveOutputLabel(output),
          connectionReason,
        );
      }
    } catch {
      if (selectionRevision !== this.selectionRevision) {
        if (
          this.pendingOutputId !== output.id
          && this.state.selectedOutputId !== output.id
        ) {
          await closeMidiPort(output);
        }
        return;
      }
      this.state.selectedOutputId = null;
      this.selectedOutputProfile = DEFAULT_HARDWARE_OUTPUT_PROFILE;
      this.state.error = 'output-open-failed';
      this.pendingOutputId = null;
      await closeMidiPort(output);
    }
  }

  public syncFrame(activeVelocityByPitch: ReadonlyMap<number, number>): void {
    if (this.latestSourceFrame === activeVelocityByPitch) {
      return;
    }
    this.latestSourceFrame = activeVelocityByPitch;
    const nextVelocityByPitch = new SvelteMap<number, number>();
    for (const [pitch, velocity] of activeVelocityByPitch) {
      nextVelocityByPitch.set(sanitizeMidiByte(pitch), sanitizeMidiByte(velocity));
    }
    this.latestVelocityByPitch = nextVelocityByPitch;
    this.sendLatestFrame();
  }

  public createOutputStateSnapshot(): HardwareMidiOutputState {
    if (
      this.outputStateSnapshotSource === this.state.outputs
      && this.outputStateSnapshot.selectedOutputId === this.state.selectedOutputId
      && this.outputStateSnapshot.isAccessing === this.state.isAccessing
      && this.outputStateSnapshot.error === this.state.error
    ) {
      return this.outputStateSnapshot;
    }

    this.outputStateSnapshotSource = this.state.outputs;
    this.outputStateSnapshot = {
      outputs: this.state.outputs.map((output) => ({ ...output })),
      selectedOutputId: this.state.selectedOutputId,
      isAccessing: this.state.isAccessing,
      error: this.state.error,
    };
    return this.outputStateSnapshot;
  }

  public setAppFocused(isFocused: boolean): void {
    if (this.isAppFocused === isFocused) {
      return;
    }
    this.isAppFocused = isFocused;
    if (isFocused) {
      this.sendLatestFrame();
      return;
    }
    this.turnOffSentLeds();
  }

  public dispose(): void {
    this.cancelAutomaticDetection();
    this.selectionRevision += 1;
    this.pendingOutputId = null;
    const selectedOutput = this.resolveSelectedOutput();
    this.turnOffSentLeds();
    this.state.selectedOutputId = null;
    void closeMidiPort(selectedOutput);
    if (this.midiAccess) {
      this.midiAccess.onstatechange = null;
    }
    this.midiAccess = null;
    this.selectedOutputProfile = DEFAULT_HARDWARE_OUTPUT_PROFILE;
  }

  private sendLatestFrame(): void {
    const output = this.resolveSelectedOutput();
    if (!output || !this.isAppFocused) {
      return;
    }

    try {
      for (const [pitch, velocity] of this.latestVelocityByPitch) {
        if (this.sentVelocityByPitch.get(pitch) !== velocity) {
          this.sendLed(output, pitch, velocity);
        }
      }
      for (const pitch of this.sentVelocityByPitch.keys()) {
        if (!this.latestVelocityByPitch.has(pitch)) {
          this.sendLed(output, pitch, 0);
        }
      }
      this.sentVelocityByPitch = new SvelteMap(this.latestVelocityByPitch);
      this.state.error = null;
    } catch {
      this.sentVelocityByPitch.clear();
      this.latestSourceFrame = null;
      this.state.error = 'output-failed';
    }
  }

  private turnOffSentLeds(): void {
    const output = this.resolveSelectedOutput();
    if (output) {
      try {
        for (const pitch of this.sentVelocityByPitch.keys()) {
          this.sendLed(output, pitch, 0);
        }
      } catch {
        this.state.error = 'output-failed';
      }
    }
    this.sentVelocityByPitch.clear();
  }

  private sendLed(output: MIDIOutput, pitch: number, velocity: number): void {
    for (const message of createHardwareOutputMessages(
      this.selectedOutputProfile,
      pitch,
      velocity,
    )) {
      output.send(message);
    }
  }

  private sendProfileMessages(
    output: MIDIOutput,
    messages: readonly (readonly number[])[],
  ): void {
    for (const message of messages) {
      if (message[0] !== 0xf0 || this.midiAccess?.sysexEnabled) {
        output.send(message);
      }
    }
  }

  private async resolveOutputProfile(output: MIDIOutput): Promise<HardwareOutputProfile> {
    if (!this.midiAccess?.sysexEnabled) {
      return DEFAULT_HARDWARE_OUTPUT_PROFILE;
    }
    return (await identifyHardwareOutput(this.midiAccess, output))?.profile
      ?? DEFAULT_HARDWARE_OUTPUT_PROFILE;
  }

  private setMidiAccess(midiAccess: MIDIAccess): void {
    if (this.midiAccess && this.midiAccess !== midiAccess) {
      const selectedOutput = this.resolveSelectedOutput();
      this.midiAccess.onstatechange = null;
      void closeMidiPort(selectedOutput);
    }
    this.midiAccess = midiAccess;
    midiAccess.onstatechange = (event) => {
      this.handleMidiStateChange(event);
    };
  }

  private resolveSelectedOutput(): MIDIOutput | null {
    if (!this.state.selectedOutputId) {
      return null;
    }
    const output = this.midiAccess?.outputs.get(this.state.selectedOutputId) ?? null;
    return output?.state === 'connected' ? output : null;
  }

  private resolveSelectedOutputName(): string | null {
    if (!this.state.selectedOutputId) {
      return null;
    }
    return this.state.outputs.find(
      (output) => output.id === this.state.selectedOutputId,
    )?.name ?? this.state.selectedOutputId;
  }

  private async selectInitialOutput(): Promise<void> {
    if (
      this.state.selectedOutputId
      || this.pendingOutputId
      || this.probingOutputId
      || this.automaticSelectionSuppressed
    ) {
      return;
    }

    const preferredOutput = this.preferredOutputId
      ? this.midiAccess?.outputs.get(this.preferredOutputId) ?? null
      : null;
    if (preferredOutput?.state === 'connected') {
      const identifiedOutput = this.midiAccess?.sysexEnabled
        ? await identifyHardwareOutput(this.midiAccess, preferredOutput)
        : null;
      if (!identifiedOutput || this.matchesRequiredPort(preferredOutput, identifiedOutput)) {
        await this.applyOutputSelection(
          preferredOutput.id,
          identifiedOutput?.profile,
          'restored',
        );
        return;
      }
    }

    await this.detectAndSelectOutput();
  }

  private handleMidiStateChange(event: MIDIConnectionEvent): void {
    const outputListChanged = this.syncOutputs();
    const port = event.port;
    const output = port?.type === 'output'
      ? this.midiAccess?.outputs.get(port.id) ?? null
      : null;
    if (this.probingOutputId) {
      if (outputListChanged && !this.state.selectedOutputId) {
        this.shouldRetryAutomaticDetection = true;
      }
      return;
    }

    if (
      output?.state === 'connected'
      && !this.state.selectedOutputId
      && !this.pendingOutputId
    ) {
      this.automaticSelectionSuppressed = false;
      this.scheduleAutomaticDetection();
      return;
    }

    if (!this.state.selectedOutputId) {
      void this.selectInitialOutput();
    }
  }

  private scheduleAutomaticDetection(): void {
    if (this.automaticDetectionTimer !== null) {
      window.clearTimeout(this.automaticDetectionTimer);
    }
    this.automaticDetectionTimer = window.setTimeout(() => {
      this.automaticDetectionTimer = null;
      void this.detectAndSelectOutput();
    }, 50);
  }

  private cancelAutomaticDetection(): void {
    this.detectionRevision += 1;
    this.probingOutputId = null;
    this.shouldRetryAutomaticDetection = false;
    if (this.automaticDetectionTimer !== null) {
      window.clearTimeout(this.automaticDetectionTimer);
      this.automaticDetectionTimer = null;
    }
  }

  private async detectAndSelectOutput(): Promise<void> {
    if (
      !this.midiAccess?.sysexEnabled
      || this.state.selectedOutputId
      || this.pendingOutputId
      || this.automaticSelectionSuppressed
      || this.probingOutputId
    ) {
      return;
    }

    const detectionRevision = ++this.detectionRevision;
    this.shouldRetryAutomaticDetection = false;
    const outputs = Array.from(this.midiAccess.outputs.values())
      .filter((output) =>
        output.state === 'connected'
        && output.id !== this.state.selectedOutputId)
      .sort((left, right) => left.id.localeCompare(right.id));

    for (const output of outputs) {
      this.probingOutputId = output.id;
      const identifiedOutput = await identifyHardwareOutput(this.midiAccess, output);
      if (detectionRevision !== this.detectionRevision) {
        return;
      }
      this.probingOutputId = null;
      if (!identifiedOutput || !this.matchesRequiredPort(output, identifiedOutput)) {
        continue;
      }

      this.preferredOutputId = output.id;
      this.shouldRetryAutomaticDetection = false;
      await this.applyOutputSelection(output.id, identifiedOutput.profile, 'automatic');
      return;
    }

    if (this.shouldRetryAutomaticDetection) {
      this.shouldRetryAutomaticDetection = false;
      this.scheduleAutomaticDetection();
    }
  }

  private matchesRequiredPort(
    output: MIDIOutput,
    identifiedOutput: IdentifiedHardwareOutput,
  ): boolean {
    return identifiedOutput.requiredPortRole === null
      || matchesPortRole(output, identifiedOutput.requiredPortRole);
  }

  private syncOutputs(): boolean {
    const selectedOutputName = this.resolveSelectedOutputName();
    const selectedOutput = this.state.selectedOutputId
      ? this.midiAccess?.outputs.get(this.state.selectedOutputId) ?? null
      : null;
    const outputs = this.midiAccess
      ? Array.from(this.midiAccess.outputs.values())
          .filter((output) => output.state === 'connected')
          .map((output) => ({
            id: output.id,
            name: resolveOutputLabel(output),
          }))
          .sort((left, right) => left.name.localeCompare(right.name))
      : [];
    const outputListChanged = outputs.length !== this.state.outputs.length
      || outputs.some((output, index) =>
        output.id !== this.state.outputs[index]?.id
        || output.name !== this.state.outputs[index]?.name);
    if (outputListChanged) {
      this.state.outputs = outputs;
    }

    if (
      this.state.selectedOutputId
      && !outputs.some((output) => output.id === this.state.selectedOutputId)
    ) {
      this.sentVelocityByPitch.clear();
      this.state.selectedOutputId = null;
      void closeMidiPort(selectedOutput);
      this.selectedOutputProfile = DEFAULT_HARDWARE_OUTPUT_PROFILE;
      this.state.error = 'output-disconnected';
      if (selectedOutputName) {
        this.options.onOutputDisconnected?.(selectedOutputName, 'device');
      }
    }
    return outputListChanged;
  }
}

export const createHardwarePreviewController = (
  options: HardwarePreviewControllerOptions = {},
): HardwarePreviewController => new HardwarePreviewController(options);
