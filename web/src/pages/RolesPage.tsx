import { useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, Grid, Paper, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorAlert, Loading, PageHeader } from '../components/common';

function RoleCard({ role, permissions, editable }: { role: any; permissions: { code: string; description: string }[]; editable: boolean }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>(role.permissions);
  const dirty = selected.slice().sort().join() !== role.permissions.slice().sort().join();
  const save = useMutation({
    mutationFn: () => api.put(`/roles/${role.id}/permissions`, { permissions: selected }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  });
  const locked = !editable || role.code === 'SUPER_ADMIN';
  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{role.name}</Typography>
        {role.is_system && <Chip size="small" label="System role" variant="outlined" />}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{role.description}</Typography>
      <ErrorAlert error={save.error} />
      <Box>
        {permissions.map((p) => (
          <FormControlLabel key={p.code} sx={{ display: 'flex', alignItems: 'flex-start', mb: 0.5 }} disabled={locked}
            control={<Checkbox size="small" sx={{ pt: 0.25 }} checked={selected.includes(p.code)}
              onChange={() => setSelected(selected.includes(p.code) ? selected.filter((x) => x !== p.code) : [...selected, p.code])} />}
            label={<Box><Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{p.code}</Typography><Typography variant="caption" color="text.secondary">{p.description}</Typography></Box>} />
        ))}
      </Box>
      {!locked && dirty && (
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>Save permissions</Button>
          <Button onClick={() => setSelected(role.permissions)}>Undo</Button>
        </Stack>
      )}
    </Paper>
  );
}

export default function RolesPage() {
  const { can } = useAuth();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<any[]>('/roles') });
  const perms = useQuery({ queryKey: ['permissions'], queryFn: () => api.get<any[]>('/permissions') });
  if (roles.isLoading || perms.isLoading) return <Loading />;
  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="Access is permission-based; substation scope is assigned per user." />
      <ErrorAlert error={roles.error || perms.error} />
      {!can('admin.roles') && <Alert severity="info" sx={{ mb: 2 }}>Read-only: changing role permissions requires the admin.roles permission.</Alert>}
      <Grid container spacing={2}>
        {roles.data?.map((r) => (
          <Grid key={`${r.id}-${r.permissions.join()}`} size={{ xs: 12, md: 6, xl: 4 }}>
            <RoleCard role={r} permissions={perms.data ?? []} editable={can('admin.roles')} />
          </Grid>
        ))}
      </Grid>
    </>
  );
}
