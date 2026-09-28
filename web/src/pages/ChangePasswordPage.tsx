import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Paper, Stack, TextField } from '@mui/material';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorAlert, PageHeader } from '../components/common';

export default function ChangePasswordPage() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) { setError(new Error('The new passwords do not match')); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Change password" />
      <Paper variant="outlined" component="form" onSubmit={submit} sx={{ p: 3, maxWidth: 480 }}>
        <Stack spacing={2}>
          {me?.mustChangePassword && <Alert severity="info">You must set a new password before continuing.</Alert>}
          <ErrorAlert error={error} />
          <TextField label="Current password" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          <TextField label="New password" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required
            helperText="At least 10 characters, using 3 of: lowercase, uppercase, digits, symbols." />
          <TextField label="Confirm new password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          <Button type="submit" variant="contained" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</Button>
        </Stack>
      </Paper>
    </>
  );
}
