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

  if (b === a) {
    // если исходный диапазон вырожден — возвращаем середину целевого диапазона
    return (c + d) / 2;
  }

  const t = (value - a) / (b - a); // нормализованное положение в [0,1]
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

  if (b === a) {
    return (c + d) / 2;
  }

  // Если целевой диапазон содержит ноль или имеет разные знаки — fallback на линейное
  if (c === 0 || d === 0 || Math.sign(c) !== Math.sign(d)) {
    return mapValueClamped(value, from, to);
  }

  const t = (value - a) / (b - a); // нормализованное положение в [0,1]

  const sign = Math.sign(c); // c и d имеют одинаковый знак
  const absC = Math.abs(c);
  const absD = Math.abs(d);

  // защитная проверка (на всякий случай)
  if (absC === 0) {
    return sign * Math.pow(absD, t);
  }

  const ratio = absD / absC;
  const resultAbs = absC * Math.pow(ratio, t);
  return sign * resultAbs;
}

export const mapValueLogClampedCurried =
  (from: readonly [number, number], to: readonly [number, number]) =>
  (value: number) =>
    mapValueLogClamped(value, from, to);
