export function mapValueClamped(
  value: number,
  from: readonly [number, number],
  to: readonly [number, number]
): number {
  const [a, b] = from;
  const [c, d] = to;

  if (value <= a) {
    return c;
  }
  if (value >= b) {
    return d;
  }

  const t = (value - a) / (b - a);
  return c + t * (d - c);
}

export const mapValueClampedCurried =
  (from: readonly [number, number], to: readonly [number, number]) =>
  (value: number) =>
    mapValueClamped(value, from, to);

// typescript
export function mapValueLogClamped(
  value: number,
  from: readonly [number, number],
  to: readonly [number, number]
): number {
  const [a, b] = from;
  const [c, d] = to;

  if (value <= a) return c;
  if (value >= b) return d;

  // Если целевой диапазон содержит ноль или имеет разные знаки — fallback на линейное
  if (c === 0 || d === 0 || Math.sign(c) !== Math.sign(d)) {
    return mapValueClamped(value, from, to);
  }

  const t = (value - a) / (b - a); // нормализованное положение в [0,1]

  const sign = Math.sign(c); // c и d имеют одинаковый знак
  const absC = Math.abs(c);
  const absD = Math.abs(d);

  const ratio = absD / absC;
  const resultAbs = absC * Math.pow(ratio, t);
  return sign * resultAbs;
}

export const mapValueLogClampedCurried =
  (from: readonly [number, number], to: readonly [number, number]) =>
  (value: number) =>
    mapValueLogClamped(value, from, to);

export function mapValueExponential(
  value: number,
  from: readonly [number, number],
  to: readonly [number, number]
): number {
  const [a, b] = from;
  const [c, d] = to;

  if (value <= a) return c;
  if (value >= b) return d;

  const t = (value - a) / (b - a);
  return c + (d - c) * t * t;
}

export const mapValueExponentialCurried =
  (from: readonly [number, number], to: readonly [number, number]) =>
  (value: number) =>
    mapValueExponential(value, from, to);

export function mapValueSCurve(
  value: number,
  from: readonly [number, number],
  to: readonly [number, number]
): number {
  const [a, b] = from;
  const [c, d] = to;

  if (value <= a) return c;
  if (value >= b) return d;

  const t = (value - a) / (b - a);
  return c + (d - c) * (3 * t * t - 2 * t * t * t);
}

export const mapValueSCurveCurried =
  (from: readonly [number, number], to: readonly [number, number]) =>
  (value: number) =>
    mapValueSCurve(value, from, to);
