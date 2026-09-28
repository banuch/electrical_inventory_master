// Quantities travel as decimal strings end-to-end; arithmetic happens in PostgreSQL NUMERIC.
const QTY = /^-?\d{1,14}(\.\d{1,4})?$/;

export function isQuantity(s: string): boolean {
  return QTY.test(s);
}

/** Number of significant fractional digits, e.g. "2.500" -> 1. */
export function fractionDigits(s: string): number {
  const frac = s.split('.')[1];
  return frac ? frac.replace(/0+$/, '').length : 0;
}

export function isZero(s: string): boolean {
  return /^-?0+(\.0+)?$/.test(s);
}

export function isNegative(s: string): boolean {
  return s.startsWith('-') && !isZero(s);
}

export function negate(s: string): string {
  return s.startsWith('-') ? s.slice(1) : `-${s}`;
}
