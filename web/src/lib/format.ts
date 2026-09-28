/** Render a NUMERIC string without trailing zeros, grouped for readability. Never parses to float for math. */
export function qty(v: string | number | null | undefined, unit?: string): string {
  if (v === null || v === undefined || v === '') return '—';
  const s = String(v);
  const neg = s.startsWith('-');
  const [int, frac = ''] = (neg ? s.slice(1) : s).split('.');
  const f = frac.replace(/0+$/, '');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}${grouped}${f ? `.${f}` : ''}${unit ? ` ${unit}` : ''}`;
}

export function dateTime(v: string | null | undefined): string {
  if (!v) return '—';
  return new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function date(v: string | null | undefined): string {
  if (!v) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function relative(v: string | null | undefined): string {
  if (!v) return 'never';
  const days = Math.floor((Date.now() - new Date(v).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return date(v);
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  OPENING: 'Opening Stock', RECEIPT: 'Receipt', ISSUE: 'Issue', RETURN: 'Return',
  ADJUSTMENT: 'Adjustment', SCRAP: 'Damage / Scrap', REVERSAL: 'Reversal',
};
