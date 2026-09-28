import { useEffect, useState } from 'react';
import {
  Alert, Autocomplete, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormGroup,
  FormLabel, MenuItem, Paper, Stack, Switch, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, type Page } from '../lib/api';
import { useAuth } from '../lib/auth';
import { relative } from '../lib/format';
import { DataTable, ErrorAlert, Loading, PageHeader, useDebounced } from '../components/common';

function UserDialog({ row, onClose }: { row: any | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: () => api.get<any[]>('/roles') });
  const { data: substations = [] } = useQuery({ queryKey: ['substations'], queryFn: () => api.get<any[]>('/substations') });
  const [f, setF] = useState({
    username: row?.username ?? '', fullName: row?.full_name ?? '', email: row?.email ?? '', phone: row?.phone ?? '',
    isActive: row?.is_active ?? true, orgWide: row?.org_wide ?? false,
    roleIds: (row?.roles ?? []).map((r: any) => r.id) as number[],
    substationIds: (row?.substations ?? []).map((s: any) => s.id) as number[],
    password: '',
  });
  const [resetPw, setResetPw] = useState('');
  const save = useMutation({
    mutationFn: () => {
      const { password, ...body } = f;
      return row ? api.put(`/users/${row.id}`, body) : api.post('/users', { ...body, password });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
  });
  const reset = useMutation({
    mutationFn: () => api.post(`/users/${row.id}/reset-password`, { password: resetPw }),
    onSuccess: () => { setResetPw(''); qc.invalidateQueries({ queryKey: ['users'] }); },
  });
  const toggleRole = (id: number) => setF({ ...f, roleIds: f.roleIds.includes(id) ? f.roleIds.filter((x) => x !== id) : [...f.roleIds, id] });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{row ? `Edit ${row.username}` : 'New user'}</DialogTitle>
      <DialogContent>
        <ErrorAlert error={save.error} />
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField fullWidth label="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />
            <TextField fullWidth label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField fullWidth label="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <TextField fullWidth label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Stack>
          {!row && (
            <TextField label="Temporary password" type="password" autoComplete="new-password" value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })} required
              helperText="The user must change it at first sign-in. Min 10 chars, 3 of: lower, upper, digit, symbol." />
          )}
          <FormGroup>
            <FormLabel>Roles</FormLabel>
            {roles.map((r) => (
              <FormControlLabel key={r.id} control={<Checkbox checked={f.roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} />}
                label={<><Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>{r.name}</Typography>{' '}
                  <Typography variant="caption" color="text.secondary">{r.description}</Typography></>} />
            ))}
          </FormGroup>
          <FormControlLabel disabled={!me?.orgWide}
            control={<Switch checked={f.orgWide} onChange={(e) => setF({ ...f, orgWide: e.target.checked })} />}
            label="Organization-wide scope (all substations)" />
          {!f.orgWide && (
            <Autocomplete multiple options={substations.filter((s) => s.is_active || f.substationIds.includes(s.id))}
              value={substations.filter((s) => f.substationIds.includes(s.id))}
              onChange={(_, v) => setF({ ...f, substationIds: v.map((s) => s.id) })}
              getOptionLabel={(s) => `${s.code} — ${s.name}`} isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(params) => <TextField {...params} label="Assigned substations" />} />
          )}
          <FormControlLabel control={<Switch checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />} label="Account active" />
          {row && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Reset password</Typography>
              <ErrorAlert error={reset.error} />
              {reset.isSuccess && <Alert severity="success" sx={{ mb: 1 }}>Password reset. All sessions were signed out; the user must change it at next sign-in.</Alert>}
              <Stack direction="row" spacing={1}>
                <TextField fullWidth type="password" autoComplete="new-password" label="New temporary password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
                <Button variant="outlined" onClick={() => reset.mutate()} disabled={!resetPw || reset.isPending}>Reset</Button>
              </Stack>
            </Paper>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function UsersPage() {
  const [input, setInput] = useState('');
  const q = useDebounced(input);
  const [active, setActive] = useState('true');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [editing, setEditing] = useState<any | null | undefined>(undefined);
  useEffect(() => setPage(1), [q, active]);
  const { data, error, isLoading } = useQuery({
    queryKey: ['users', q, active, page, pageSize],
    queryFn: () => api.get<Page<any>>(`/users${qs({ q, active, page, pageSize })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Users" subtitle="Individual accounts only — shared substation logins are not permitted."
        actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>New user</Button>} />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField fullWidth label="Search username, name, email" value={input} onChange={(e) => setInput(e.target.value)} />
          <TextField select label="Status" value={active} onChange={(e) => setActive(e.target.value)} sx={{ minWidth: 160 }}>
            <MenuItem value="true">Active</MenuItem><MenuItem value="false">Inactive</MenuItem><MenuItem value="">All</MenuItem>
          </TextField>
        </Stack>
      </Paper>
      <ErrorAlert error={error} />
      {isLoading ? <Loading /> : (
        <DataTable rowKey={(r: any) => r.id} rows={data?.items ?? []} total={data?.total} page={page} pageSize={pageSize}
          onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} onRowClick={setEditing}
          columns={[
            { key: 'u', label: 'User', render: (r: any) => <><b>{r.username}</b><br /><Typography variant="caption">{r.full_name}</Typography></> },
            { key: 'r', label: 'Roles', render: (r: any) => <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>{r.roles.map((x: any) => <Chip key={x.id} size="small" label={x.name} />)}</Stack> },
            { key: 's', label: 'Scope', render: (r: any) => (r.org_wide ? 'Organization-wide' : r.substations.map((s: any) => s.code).join(', ') || '—'), hideBelow: 'md' },
            { key: 'l', label: 'Last sign-in', render: (r: any) => relative(r.last_login_at), hideBelow: 'md' },
            { key: 'st', label: 'Status', render: (r: any) => (
              <Stack direction="row" spacing={0.5}>
                {r.is_active ? <Chip size="small" color="success" variant="outlined" label="Active" /> : <Chip size="small" label="Inactive" />}
                {r.locked_until && new Date(r.locked_until) > new Date() && <Chip size="small" color="error" label="Locked" />}
                {r.must_change_password && <Chip size="small" color="info" variant="outlined" label="Temp password" />}
              </Stack>) },
          ]} />
      )}
      {editing !== undefined && <UserDialog row={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}
