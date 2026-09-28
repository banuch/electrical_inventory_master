import { useState } from 'react';
import { Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Switch, TextField } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { relative } from '../lib/format';
import { DataTable, ErrorAlert, Loading, PageHeader } from '../components/common';

function SubstationDialog({ row, onClose }: { row: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const [f, setF] = useState({
    code: row?.code ?? '', name: row?.name ?? '', address: row?.address ?? '', contactName: row?.contact_name ?? '',
    contactPhone: row?.contact_phone ?? '', isActive: row?.is_active ?? true,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => (row ? api.put(`/substations/${row.id}`, f) : api.post('/substations', f)),
    onSuccess: async () => { qc.invalidateQueries({ queryKey: ['substations'] }); await refresh(); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{row ? `Edit ${row.code}` : 'New substation'}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={save.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Code" value={f.code} onChange={set('code')} required sx={{ maxWidth: { sm: 160 } }} />
            <TextField fullWidth label="Name" value={f.name} onChange={set('name')} required />
          </Stack>
          <TextField label="Address" value={f.address} onChange={set('address')} multiline minRows={2} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField fullWidth label="Contact person" value={f.contactName} onChange={set('contactName')} />
            <TextField fullWidth label="Contact phone" value={f.contactPhone} onChange={set('contactPhone')} />
          </Stack>
          <FormControlLabel control={<Switch checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />}
            label="Active (inactive substations cannot post transactions)" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function SubstationsPage() {
  const { can } = useAuth();
  const [editing, setEditing] = useState<any | null | undefined>(undefined);
  const { data = [], error, isLoading } = useQuery({ queryKey: ['substations'], queryFn: () => api.get<any[]>('/substations') });
  const editable = can('master.substations');
  return (
    <>
      <PageHeader title="Substations" subtitle="Directory of stock-holding locations and contacts for transfer coordination."
        actions={editable && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>New substation</Button>} />
      <ErrorAlert error={error} />
      {isLoading ? <Loading /> : (
        <DataTable rowKey={(r: any) => r.id} rows={data} onRowClick={editable ? setEditing : undefined}
          columns={[
            { key: 'c', label: 'Code', render: (r: any) => <b>{r.code}</b> },
            { key: 'n', label: 'Name', render: (r: any) => r.name },
            { key: 'p', label: 'Contact', render: (r: any) => [r.contact_name, r.contact_phone].filter(Boolean).join(' · ') || '—', hideBelow: 'md' },
            { key: 'u', label: 'Users', align: 'right', render: (r: any) => r.user_count, hideBelow: 'sm' },
            { key: 'l', label: 'Last stock activity', render: (r: any) => relative(r.last_activity_at), hideBelow: 'sm' },
            { key: 'a', label: 'Status', render: (r: any) => (r.is_active ? <Chip size="small" label="Active" color="success" variant="outlined" /> : <Chip size="small" label="Inactive" />) },
          ]} />
      )}
      {editing !== undefined && <SubstationDialog row={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}
