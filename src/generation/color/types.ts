export interface CompiledColorAgeSlot {
  slotIndex: number;
  velocity: number;
}

export interface CompiledColorAgeKernel {
  noteLengthRatio: number;
  gapRatio: number;
  slots: ReadonlyArray<CompiledColorAgeSlot>;
}
