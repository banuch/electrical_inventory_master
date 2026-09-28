import { useEffect, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Link, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/EditOutlined';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, type Page } from '../lib/api';
import { useAuth } from '../lib/auth';
import { qty, relative } from '../lib/format';
import { CriticalChip, DataTable, EmptyState, ErrorAlert, Loading, PageHeader, StatusChip, useDebounced } from '../components/common';

const STATUSES = [['all', 'All tracked items'], ['in_stock', 'In stock'], ['low', 'Below minimum'], ['out', 'Out of stock'], ['critical', 'Critical below minimum']];

function LevelsDialog({ row, substationId, onClose }: { row: any; substationId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [min, setMin] = useState(String(Number(row.min_level)));
  const [reorder, setReorder] = useState(String(Number(row.reorder_level)));
  const save = useMutation({
    mutationFn: () => api.put(`/inventory/substations/${substationId}/items/${row.item_id}/levels`, { minLevel: min || '0', reorderLevel: reorder || '0' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['balances'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Stock levels — {row.code}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={save.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label={`Minimum level (${row.unit})`} value={min} onChange={(e) => setMin(e.target.value)} slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            helperText="Below this the item is flagged as low stock." />
          <TextField label={`Reorder level (${row.unit})`} value={reorder} onChange={(e) => setReorder(e.target.value)} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function InventoryPage() {
  const { me, substationId, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'all';
  const [input, setInput] = useState('');
  const q = useDebounced(input);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [editing, setEditing] = useState<any>(null);
  useEffect(() => setPage(1), [q, status, substationId]);

  const current = me?.substations.find((s) => s.id === substationId);
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ['balances', substationId, q, status, page, pageSize],
    queryFn: () => api.get<Page<any>>(`/inventory/substations/${substationId}/balances${qs({ q, status, page, pageSize })}`),
    enabled: !!substationId,
    placeholderData: keepPreviousData,
  });

  if (!substationId) return <EmptyState title="No substation assigned">Ask an administrator to assign you to a substation.</EmptyState>;

  return (
    <>
      <PageHeader title="Substation inventory" subtitle={current ? `${current.code} — ${current.name}` : undefined}
        actions={can('reports.export') && <Button variant="outlined" href={`/api/reports/current-stock.csv?substationId=${substationId}`}>Export CSV</Button>} />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField fullWidth label="Filter by code, name, specification" value={input} onChange={(e) => setInput(e.target.value)} />
          <TextField select label="Status" value={status} sx={{ minWidth: 220 }}
            onChange={(e) => setParams(e.target.value === 'all' ? {} : { status: e.target.value }, { replace: true })}>
            {STATUSES.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
          </TextField>
        </Stack>
      </Paper>
      <ErrorAlert error={error} />
      {isLoading ? <Loading /> : (
        <div style={{ opacity: isFetching ? 0.7 : 1 }}>
          <DataTable rowKey={(r: any) => r.item_id} rows={data?.items ?? []} total={data?.total} page={page} pageSize={pageSize}
            onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} empty="No items match"
            columns={[
              { key: 'item', label: 'Item', render: (r: any) => (
                <>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Link component={RouterLink} to={`/items/${r.item_id}`} sx={{ fontWeight: 600 }}>{r.code}</Link>
                    {r.is_critical && <CriticalChip />}
                  </Stack>
                  <Typography variant="body2">{r.name}</Typography>
                </>) },
              { key: 'spec', label: 'Specification / rating', render: (r: any) => [r.specification, r.rating].filter(Boolean).join(' · ') || '—', hideBelow: 'lg' },
              { key: 'cat', label: 'Category', render: (r: any) => r.category_name, hideBelow: 'md' },
              { key: 'q', label: 'On hand', align: 'right', render: (r: any) => <b>{qty(r.quantity, r.unit)}</b> },
              { key: 'min', label: 'Min', align: 'right', hideBelow: 'sm', render: (r: any) => (
                <Stack direction="row" sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
                  {Number(r.min_level) ? qty(r.min_level) : '—'}
                  {can('stock.min_levels') && (
                    <Tooltip title="Set minimum / reorder level"><IconButton size="small" onClick={() => setEditing(r)}><EditIcon fontSize="inherit" /></IconButton></Tooltip>
                  )}
                </Stack>) },
              { key: 'st', label: 'Status', render: (r: any) => <StatusChip status={r.status} /> },
              { key: 'l', label: 'Last movement', render: (r: any) => relative(r.last_txn_at), hideBelow: 'md' },
            ]} />
        </div>
      )}
      {editing && <LevelsDialog row={editing} substationId={substationId} onClose={() => setEditing(null)} />}
    </>
  );
}
