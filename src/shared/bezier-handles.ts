export type BezierHandleKind = 'handleIn' | 'handleOut';
export type BezierHandle = { x: number; y: number };
export interface BezierHandles {
  handleIn?: BezierHandle;
  handleOut?: BezierHandle;
}

/** Alt temporarily edits one handle; normal dragging restores equal-length symmetry. */
export const moveBezierHandle = (
  current: BezierHandles,
  kind: BezierHandleKind,
  offset: BezierHandle | null,
  independent: boolean,
): BezierHandles => {
  const result: BezierHandles = {
    ...(current.handleIn ? { handleIn: current.handleIn } : {}),
    ...(current.handleOut ? { handleOut: current.handleOut } : {}),
  };
  const opposite = kind === 'handleIn' ? 'handleOut' : 'handleIn';
  if (offset) {
    result[kind] = offset;
    if (!independent) result[opposite] = { x: -offset.x, y: -offset.y };
  } else {
    delete result[kind];
    if (!independent) delete result[opposite];
  }
  return result;
};
