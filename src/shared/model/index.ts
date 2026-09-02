export type { AuthoredMetadata } from './authored-metadata';
export {
  AUTHORED_METADATA_AUTHOR_MAX_LENGTH,
  AUTHORED_METADATA_DESCRIPTION_MAX_LENGTH,
  cloneAuthoredMetadata,
  normalizeAuthoredMetadata,
  replaceAuthoredMetadata,
} from './authored-metadata';
export type {
  ColorEffectNode,
  CurveModulatorNode,
  CurveNode,
  GeneratorChain,
  GeneratorDeviceNode,
  GeneratorEffectNode,
  GeneratorNode,
  MaskEffectNode,
  MirrorEffectNode,
  ModulationCurve,
  ModulationTarget,
  PathGeneratorNode,
  PathAnchor,
  PathAnimation,
  PathHandle,
  PathParams,
  PathTransform,
  RainGeneratorNode,
  RainParams,
  RepeatEffectNode,
  ReverseEffectNode,
  RotateEffectNode,
  ScaleEffectNode,
  ScannerGeneratorNode,
  ScannerParams,
  SpiralGeneratorNode,
  SpiralParams,
  StretchEffectNode,
  SymmetryEffectNode,
  TimeWarpCurve,
  TimeWarpEffectNode,
  TrimEffectNode,
  TranslateEffectNode,
  RippleGeneratorNode,
  RippleParams,
} from './chain';
export type { ClipNote } from './clip';
export { cloneChainForIpc } from './chain-clone';
export { cloneDeviceNode, clonePathAnchors } from './device-clone';
export {
  isCurveModulatorNode,
  isGeneratorDeviceKind,
  isGeneratorNode,
} from './device-kind';
export {
  DEFAULT_GROUP_NAME_TEMPLATE,
  applyNameIndex,
  hasNameIndexToken,
  normalizeCustomName,
} from './naming';
export type {
  LaunchpadButton,
  LaunchpadModel,
  MidiAddress,
} from './launchpad';
export type { PaletteFilePayload } from './palette';
