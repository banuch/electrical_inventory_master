import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, qs, type Page } from '../lib/api';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2, alignItems: { sm: 'flex-end' }, justifyContent: 'space-between' }}>
      <Box>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>{title}</Typography>
        {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
      </Box>
      {actions && <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>{actions}</Stack>}
    </Stack>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);
  return <Alert severity="error" sx={{ mb: 2 }}>{msg}</Alert>;
}

export function Loading() {
  return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={28} /></Box>;
}

const STATUS: Record<string, { label: string; color: 'default' | 'success' | 'warning' | 'error' | 'info' }> = {
  OK: { label: 'OK', color: 'success' },
  AVAILABLE: { label: 'Available', color: 'success' },
  LOW: { label: 'Low', color: 'warning' },
  LOW_SOMEWHERE: { label: 'Low at some', color: 'warning' },
  REORDER: { label: 'Reorder', color: 'info' },
  OUT: { label: 'Out of stock', color: 'error' },
  POSTED: { label: 'Posted', color: 'success' },
  REVERSED: { label: 'Reversed', color: 'default' },
};

export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, color: 'default' as const };
  return <Chip size="small" label={s.label} color={s.color} variant={s.color === 'default' ? 'outlined' : 'filled'} />;
}

export function CriticalChip() {
  return <Chip size="small" label="Critical" color="error" variant="outlined" sx={{ fontWeight: 600 }} />;
}

/** Hide the rows-per-page selector on phones so pagination fits without horizontal scroll. */
export const paginationSx = { '& .MuiTablePagination-selectLabel, & .MuiTablePagination-input': { display: { xs: 'none', sm: 'flex' } }, '& .MuiTablePagination-toolbar': { pl: { xs: 1, sm: 2 } } };

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  render: (row: T) => ReactNode;
  hideBelow?: 'sm' | 'md' | 'lg';
  width?: number | string;
}

/** Server-paginated table. */
export function DataTable<T>({ columns, rows, total, page, pageSize, onPage, onPageSize, onRowClick, empty = 'No records found', rowKey }: {
  columns: Column<T>[]; rows: T[]; total?: number; page?: number; pageSize?: number;
  onPage?: (p: number) => void; onPageSize?: (n: number) => void; onRowClick?: (row: T) => void;
  empty?: string; rowKey: (row: T) => string | number;
}) {
  const display = (c: Column<T>) => (c.hideBelow ? { xs: 'none', [c.hideBelow]: 'table-cell' } : undefined);
  return (
    <Paper variant="outlined">
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              {columns.map((c) => (
                <TableCell key={c.key} align={c.align} sx={{ display: display(c), fontWeight: 600, whiteSpace: 'nowrap', width: c.width }}>{c.label}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={columns.length} align="center" sx={{ py: 4, color: 'text.secondary' }}>{empty}</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={rowKey(r)} hover={!!onRowClick} onClick={onRowClick ? () => onRowClick(r) : undefined}
                sx={onRowClick ? { cursor: 'pointer' } : undefined}>
                {columns.map((c) => <TableCell key={c.key} align={c.align} sx={{ display: display(c) }}>{c.render(r)}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {onPage && total !== undefined && page !== undefined && pageSize !== undefined && (
        <TablePagination component="div" sx={paginationSx} count={total} page={page - 1} rowsPerPage={pageSize}
          onPageChange={(_, p) => onPage(p + 1)} rowsPerPageOptions={[10, 25, 50, 100]}
          onRowsPerPageChange={(e) => onPageSize?.(Number(e.target.value))} />
      )}
    </Paper>
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', onConfirm, onClose, busy, color = 'primary' }: {
  open: boolean; title: string; children: ReactNode; confirmLabel?: string; onConfirm: () => void; onClose: () => void;
  busy?: boolean; color?: 'primary' | 'error' | 'warning';
}) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" color={color} onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}

export interface ItemOption { id: number; code: string; name: string; unit: string; decimal_places: number; specification?: string; rating?: string; is_active?: boolean }

/** Async Item Master picker (active items only). */
export function ItemPicker({ value, onChange, label = 'Item', error, helperText, exclude = [], autoFocus }: {
  value: ItemOption | null; onChange: (v: ItemOption | null) => void; label?: string; error?: boolean; helperText?: ReactNode;
  exclude?: number[]; autoFocus?: boolean;
}) {
  const [input, setInput] = useState('');
  const q = useDebounced(input, 250);
  const { data, isFetching } = useQuery({
    queryKey: ['item-picker', q],
    queryFn: () => api.get<Page<ItemOption>>(`/items${qs({ q, active: true, pageSize: 20 })}`),
    placeholderData: (prev) => prev,
  });
  const options = (data?.items ?? []).filter((o) => !exclude.includes(o.id) || o.id === value?.id);
  return (
    <Autocomplete
      value={value}
      onChange={(_, v) => onChange(v)}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      options={options}
      filterOptions={(x) => x}
      loading={isFetching}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      getOptionLabel={(o) => `${o.code} — ${o.name}`}
      renderOption={({ key, ...props }, o) => (
        <li key={key} {...props}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{o.code} <Typography component="span" variant="body2">{o.name}</Typography></Typography>
            <Typography variant="caption" color="text.secondary">{[o.specification, o.rating, o.unit].filter(Boolean).join(' · ')}</Typography>
          </Box>
        </li>
      )}
      renderInput={(params) => <TextField {...params} label={label} error={error} helperText={helperText} autoFocus={autoFocus} />}
    />
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{title}</Typography>
      {children && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{children}</Typography>}
    </Paper>
  );
}
