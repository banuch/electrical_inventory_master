import { useState } from 'react';
import { Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, Switch, TextField } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DataTable, ErrorAlert, Loading, PageHeader } from '../components/common';

function CategoryDialog({ row, categories, onClose }: { row: any | null; categories: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: row?.code ?? '', name: row?.name ?? '', parentId: row?.parent_id ? String(row.parent_id) : '', isActive: row?.is_active ?? true });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, parentId: f.parentId ? Number(f.parentId) : undefined };
      return row ? api.put(`/categories/${row.id}`, body) : api.post('/categories', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{row ? 'Edit category' : 'New category'}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={save.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required />
          <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          <TextField select label="Parent (for subcategories)" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
            <MenuItem value="">None — top-level category</MenuItem>
            {categories.filter((c) => !c.parent_id && c.id !== row?.id).map((c) => <MenuItem key={c.id} value={String(c.id)}>{c.name}</MenuItem>)}
          </TextField>
          <FormControlLabel control={<Switch checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />} label="Active" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

export function CategoriesPage() {
  const { can } = useAuth();
  const [editing, setEditing] = useState<any | null | undefined>(undefined);
  const { data = [], error, isLoading } = useQuery({ queryKey: ['categories'], queryFn: () => api.get<any[]>('/categories') });
  return (
    <>
      <PageHeader title="Categories" subtitle="Two-level category / subcategory classification for the Item Master."
        actions={can('master.items') && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>New category</Button>} />
      <ErrorAlert error={error} />
      {isLoading ? <Loading /> : (
        <DataTable rowKey={(r: any) => r.id} rows={data} onRowClick={can('master.items') ? setEditing : undefined}
          columns={[
            { key: 'n', label: 'Name', render: (r: any) => <span style={{ paddingLeft: r.parent_id ? 24 : 0, fontWeight: r.parent_id ? 400 : 600 }}>{r.name}</span> },
            { key: 'c', label: 'Code', render: (r: any) => r.code },
            { key: 'p', label: 'Parent', render: (r: any) => r.parent_name ?? '—', hideBelow: 'sm' },
            { key: 'i', label: 'Items', align: 'right', render: (r: any) => r.item_count },
            { key: 'a', label: 'Status', render: (r: any) => (r.is_active ? <Chip size="small" label="Active" color="success" variant="outlined" /> : <Chip size="small" label="Inactive" />) },
          ]} />
      )}
      {editing !== undefined && <CategoryDialog row={editing} categories={data} onClose={() => setEditing(undefined)} />}
    </>
  );
}

function UnitDialog({ row, onClose }: { row: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ code: row?.code ?? '', name: row?.name ?? '', decimalPlaces: row?.decimal_places ?? 0, isActive: row?.is_active ?? true });
  const save = useMutation({
    mutationFn: () => (row ? api.put(`/units/${row.id}`, f) : api.post('/units', f)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['units'] }); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{row ? 'Edit unit' : 'New unit'}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={save.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required />
          <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          <TextField select label="Decimal places allowed" value={f.decimalPlaces} onChange={(e) => setF({ ...f, decimalPlaces: Number(e.target.value) })}
            helperText="0 for countable items (numbers, sets); 2–3 for metres, litres, kg">
            {[0, 1, 2, 3, 4].map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
          </TextField>
          <FormControlLabel control={<Switch checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />} label="Active" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

export function UnitsPage() {
  const { can } = useAuth();
  const [editing, setEditing] = useState<any | null | undefined>(undefined);
  const { data = [], error, isLoading } = useQuery({ queryKey: ['units'], queryFn: () => api.get<any[]>('/units') });
  return (
    <>
      <PageHeader title="Units of measure" subtitle="Precision rules are enforced on every quantity entered."
        actions={can('master.items') && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>New unit</Button>} />
      <ErrorAlert error={error} />
      {isLoading ? <Loading /> : (
        <DataTable rowKey={(r: any) => r.id} rows={data} onRowClick={can('master.items') ? setEditing : undefined}
          columns={[
            { key: 'c', label: 'Code', render: (r: any) => <b>{r.code}</b> },
            { key: 'n', label: 'Name', render: (r: any) => r.name },
            { key: 'd', label: 'Decimals', align: 'right', render: (r: any) => r.decimal_places },
            { key: 'a', label: 'Status', render: (r: any) => (r.is_active ? <Chip size="small" label="Active" color="success" variant="outlined" /> : <Chip size="small" label="Inactive" />) },
          ]} />
      )}
      {editing !== undefined && <UnitDialog row={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}
