export type Curve = 'linear' | 'logarithmic' | 'exponential' | 's-curve';
export type Mode = 'normal' | 'toggle';

export type RuleConfig = {
  readonly cc: number;
  readonly label: string;
  readonly inputMin: number;
  readonly inputMax: number;
  readonly outputMin: number;
  readonly outputMax: number;
  readonly curve: Curve;
  readonly smoothing?: number;      // sliding average window size (0 = off)
  readonly invert?: boolean;        // reverse output direction
  readonly mode?: Mode;             // normal | toggle
  readonly deadZoneMin?: number;    // values below → clamped to inputMin
  readonly deadZoneMax?: number;    // values above → clamped to inputMax
};

export type MacroOutput = {
  readonly cc: number;
  readonly label: string;
  readonly outputMin: number;
  readonly outputMax: number;
  readonly curve: Curve;
  readonly invert?: boolean;
};

export type MacroConfig = {
  readonly input: number;           // input CC number
  readonly label: string;
  readonly outputs: readonly MacroOutput[];
};

export type NetworkConfig = {
  readonly port?: number;        // TCP port, default 9900
  readonly pin?: string;         // 4-char PIN string, undefined = open
  readonly hostName?: string;    // mDNS advertised name
};

export type AppConfig = {
  readonly deviceName: string;
  readonly rules: readonly RuleConfig[];
  readonly macros?: readonly MacroConfig[];
  readonly network?: NetworkConfig;
};
