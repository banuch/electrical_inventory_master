import { useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, Link, MenuItem, Paper, Stack,
  Switch, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, type Page } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CriticalChip, DataTable, ErrorAlert, Loading, PageHeader, useDebounced } from '../components/common';

const EMPTY = { code: '', name: '', description: '', categoryId: '', unitId: '', specification: '', rating: '', manufacturer: '', model: '',
  isCritical: false, isActive: true, aliases: '' };

function ItemDialog({ item, onClose }: { item: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(() => item ? {
    code: item.code, name: item.name, description: item.description, categoryId: String(item.category_id), unitId: String(item.unit_id),
    specification: item.specification, rating: item.rating, manufacturer: item.manufacturer, model: item.model,
    isCritical: item.is_critical, isActive: item.is_active, aliases: (item.aliases ?? []).join(', '),
  } : EMPTY);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: () => api.get<any[]>('/categories') });
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: () => api.get<any[]>('/units') });
  const name = useDebounced(f.name, 400);
  const code = useDebounced(f.code, 400);
  const { data: similar = [] } = useQuery({
    queryKey: ['similar', name, code, item?.id],
    queryFn: () => api.get<any[]>(`/items/similar${qs({ name, code, excludeId: item?.id })}`),
    enabled: name.length >= 3 || code.length >= 2,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, categoryId: Number(f.categoryId), unitId: Number(f.unitId),
        aliases: f.aliases.split(',').map((a: string) => a.trim()).filter(Boolean) };
      return item ? api.put(`/items/${item.id}`, body) : api.post('/items', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['items'] }); qc.invalidateQueries({ queryKey: ['search'] }); onClose(); },
  });

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{item ? `Edit ${item.code}` : 'New Item Master record'}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={save.error} />
        {!item && <Alert severity="info" sx={{ mb: 2 }}>Search existing items first. Create a new record only when no standardized item matches.</Alert>}
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth required label="Item code" value={f.code} onChange={set('code')} helperText="Unique; letters, digits . _ / -" /></Grid>
          <Grid size={{ xs: 12, sm: 8 }}><TextField fullWidth required label="Standardized name" value={f.name} onChange={set('name')} /></Grid>
          {similar.length > 0 && (
            <Grid size={12}>
              <Alert severity="warning">
                <Typography variant="body2" sx={{ fontWeight: 600 }}>Possible duplicates — check before saving:</Typography>
                {similar.map((s) => (
                  <Typography key={s.id} variant="body2">{s.code} — {s.name} {s.rating && `(${s.rating})`} {!s.is_active && '[inactive]'}</Typography>
                ))}
              </Alert>
            </Grid>
          )}
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField select fullWidth required label="Category" value={f.categoryId} onChange={set('categoryId')}>
              {categories.filter((c) => c.is_active || String(c.id) === f.categoryId).map((c) => (
                <MenuItem key={c.id} value={String(c.id)} sx={{ pl: c.parent_id ? 4 : 2 }}>{c.parent_name ? `${c.parent_name} › ` : ''}{c.name}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField select fullWidth required label="Unit of measure" value={f.unitId} onChange={set('unitId')}
              helperText={item ? 'Cannot be changed once stock has been posted' : undefined}>
              {units.filter((u) => u.is_active || String(u.id) === f.unitId).map((u) => <MenuItem key={u.id} value={String(u.id)}>{u.code} — {u.name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Specification" value={f.specification} onChange={set('specification')} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Rating (e.g. 33kV 1250A)" value={f.rating} onChange={set('rating')} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Manufacturer / make" value={f.manufacturer} onChange={set('manufacturer')} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Model" value={f.model} onChange={set('model')} /></Grid>
          <Grid size={12}><TextField fullWidth multiline minRows={2} label="Description" value={f.description} onChange={set('description')} /></Grid>
          <Grid size={12}><TextField fullWidth label="Aliases / old names (comma separated)" value={f.aliases} onChange={set('aliases')} helperText="Accepted search terms, e.g. local names used at substations" /></Grid>
          <Grid size={12}>
            <FormControlLabel control={<Switch checked={f.isCritical} onChange={(e) => setF({ ...f, isCritical: e.target.checked })} />} label="Critical item" />
            <FormControlLabel control={<Switch checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />} label="Active" />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || !f.code || !f.name || !f.categoryId || !f.unitId}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ItemsMasterPage() {
  const { can } = useAuth();
  const [input, setInput] = useState('');
  const q = useDebounced(input);
  const [active, setActive] = useState('true');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [editing, setEditing] = useState<any | null | undefined>(undefined);
  useEffect(() => setPage(1), [q, active]);

  const { data, error, isLoading } = useQuery({
    queryKey: ['items', q, active, page, pageSize],
    queryFn: () => api.get<Page<any>>(`/items${qs({ q, active, page, pageSize })}`),
    placeholderData: keepPreviousData,
  });
  const editable = can('master.items');

  return (
    <>
      <PageHeader title="Item Master" subtitle="One standardized catalogue shared by all substations."
        actions={editable && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>New item</Button>} />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField fullWidth label="Search code, name, specification, make" value={input} onChange={(e) => setInput(e.target.value)} />
          <TextField select label="Status" value={active} onChange={(e) => setActive(e.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="true">Active</MenuItem>
            <MenuItem value="false">Inactive</MenuItem>
            <MenuItem value="">All</MenuItem>
          </TextField>
        </Stack>
      </Paper>
      <ErrorAlert error={error} />
      {isLoading ? <Loading /> : (
        <DataTable rowKey={(r: any) => r.id} rows={data?.items ?? []} total={data?.total} page={page} pageSize={pageSize}
          onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }}
          onRowClick={editable ? (r) => setEditing(r) : undefined}
          columns={[
            { key: 'c', label: 'Code', render: (r: any) => <Link component={RouterLink} to={`/items/${r.id}`} onClick={(e) => e.stopPropagation()} sx={{ fontWeight: 600 }}>{r.code}</Link> },
            { key: 'n', label: 'Name', render: (r: any) => <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><span>{r.name}</span>{r.is_critical && <CriticalChip />}{!r.is_active && <Chip size="small" label="Inactive" />}</Stack> },
            { key: 'cat', label: 'Category', render: (r: any) => r.category_name, hideBelow: 'md' },
            { key: 's', label: 'Specification / rating', render: (r: any) => [r.specification, r.rating].filter(Boolean).join(' · ') || '—', hideBelow: 'lg' },
            { key: 'm', label: 'Make', render: (r: any) => r.manufacturer || '—', hideBelow: 'lg' },
            { key: 'u', label: 'Unit', render: (r: any) => r.unit },
          ]} />
      )}
      {editing !== undefined && <ItemDialog item={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}
