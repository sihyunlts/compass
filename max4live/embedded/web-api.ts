export interface MaxWebApi {
  bindInlet: (name: string, callback: (...values: unknown[]) => void) => void;
  outlet: (...values: unknown[]) => void;
  setDict: (name: string, value: unknown) => void;
  getDict: (name: string, callback: (value: unknown) => void) => void;
}
