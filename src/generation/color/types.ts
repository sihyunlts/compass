interface CompiledColorAgeSlot {
  velocity: number;
  startUnit: number;
  endUnitExclusive: number;
}

interface ColorCoverageInterval {
  startUnit: number;
  endUnitExclusive: number;
  slots: ReadonlyArray<CompiledColorAgeSlot>;
}

export interface CompiledColorAgeKernel {
  sequenceEndUnit: number;
  coverageIntervals: ReadonlyArray<ColorCoverageInterval>;
}
