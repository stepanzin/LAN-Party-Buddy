export type CompiledRule = {
  readonly transform: (value: number) => number;
  readonly smoothing: number;
  readonly mode: 'normal' | 'toggle';
};

export type CompiledRules = Record<string, CompiledRule>;

export type CompiledMacro = {
  readonly outputCc: number;
  readonly transform: (value: number) => number;
};

export type CompiledMacros = Record<string, readonly CompiledMacro[]>;
