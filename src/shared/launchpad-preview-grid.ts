import type { LaunchpadButton } from './model';

export const LAUNCHPAD_PREVIEW_GRID_COLUMNS = 10;
export const LAUNCHPAD_PREVIEW_GRID_ROWS = 10;

export interface LaunchpadPreviewGridCell {
  row: number;
  col: number;
  key: string;
  buttons: ReadonlyArray<LaunchpadButton>;
  pitches: ReadonlyArray<number>;
}

const toCellKey = (row: number, col: number): string => `${row}:${col}`;

const resolveButtonCell = (
  button: LaunchpadButton,
): { row: number; col: number } | null => {
  switch (button.zone) {
    case 'grid':
      return { row: LAUNCHPAD_PREVIEW_GRID_ROWS - 1 - button.y, col: button.x };
    case 'left':
      return button.id === 'left-top'
        ? { row: 0, col: 0 }
        : { row: LAUNCHPAD_PREVIEW_GRID_ROWS - 1 - button.y, col: 0 };
    case 'right':
      return {
        row: LAUNCHPAD_PREVIEW_GRID_ROWS - 1 - button.y,
        col: LAUNCHPAD_PREVIEW_GRID_COLUMNS - 1,
      };
    case 'top':
      return { row: 0, col: button.x };
    case 'bottom':
      return { row: LAUNCHPAD_PREVIEW_GRID_ROWS - 1, col: button.x };
    case 'logo':
      return { row: 0, col: LAUNCHPAD_PREVIEW_GRID_COLUMNS - 1 };
    default:
      return null;
  }
};

export const buildLaunchpadPreviewGridCells = (
  buttons: ReadonlyArray<LaunchpadButton>,
): ReadonlyArray<LaunchpadPreviewGridCell> => {
  const buttonsByCell = new Map<string, LaunchpadButton[]>();
  for (const button of buttons) {
    if (button.output.kind !== 'note') {
      continue;
    }

    const cell = resolveButtonCell(button);
    if (!cell) {
      continue;
    }

    const key = toCellKey(cell.row, cell.col);
    const cellButtons = buttonsByCell.get(key);
    if (cellButtons) {
      cellButtons.push(button);
    } else {
      buttonsByCell.set(key, [button]);
    }
  }

  const cells: LaunchpadPreviewGridCell[] = [];
  for (let row = 0; row < LAUNCHPAD_PREVIEW_GRID_ROWS; row += 1) {
    for (let col = 0; col < LAUNCHPAD_PREVIEW_GRID_COLUMNS; col += 1) {
      const key = toCellKey(row, col);
      const cellButtons = buttonsByCell.get(key) ?? [];
      const pitches: number[] = [];
      for (const button of cellButtons) {
        if (button.output.kind === 'note') {
          pitches.push(button.output.number);
        }
      }
      cells.push({
        row,
        col,
        key,
        buttons: cellButtons,
        pitches,
      });
    }
  }
  return cells;
};
