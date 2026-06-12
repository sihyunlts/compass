export type DropdownValue = string | number;

export type DropdownOption = {
  value: DropdownValue;
  label: string;
  meta?: string;
  disabled?: boolean;
};
