import { useEffect, useState } from 'react';
import { Box, Chip, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs, type Page } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { DataTable, ErrorAlert, Loading, PageHeader } from '../components/common';

function summarize(details: any): string {
  if (!details || typeof details !== 'object') return '';
  const parts: string[] = [];
  if (details.docNumber) parts.push(details.docNumber);
  if (details.reversalNumber) parts.push(`→ ${details.reversalNumber}`);
  if (details.referenceNo) parts.push(`ref ${details.referenceNo}`);
  if (Array.isArray(details.lines)) parts.push(details.lines.map((l: any) => `${l.code} ${l.quantity}`).join(', '));
  if (details.itemCode) parts.push(details.itemCode);
  if (details.after?.code) parts.push(details.after.code);
  if (details.code && !details.docNumber) parts.push(details.code);
  if (typeof details.rows === 'number') parts.push(`${details.rows} rows`);
  if (details.remarks) parts.push(`“${details.remarks}”`);
  return parts.join(' · ');
}

function AuditLog() {
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => setPage(1), [action, from, to]);
  const { data, error, isLoading } = useQuery({
    queryKey: ['audit', action, from, to, page, pageSize],
    queryFn: () => api.get<Page<any>>(`/audit${qs({ action: action.trim().toUpperCase(), from, to, page, pageSize })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Action (e.g. STOCK_ISSUE_POSTED)" value={action} onChange={(e) => setAction(e.target.value)} sx={{ flex: 1 }} />
          <TextField type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        </Stack>
      </Paper>
      <ErrorAlert error={error} />
      {isLoading ? <Loading /> : (
        <DataTable rowKey={(r: any) => r.id} rows={data?.items ?? []} total={data?.total} page={page} pageSize={pageSize}
          onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} onRowClick={(r: any) => setOpen(open === r.id ? null : r.id)}
          columns={[
            { key: 't', label: 'When', render: (r: any) => dateTime(r.occurred_at) },
            { key: 'u', label: 'User', render: (r: any) => r.username ?? 'system' },
            { key: 'a', label: 'Action', render: (r: any) => <Chip size="small" label={r.action} variant="outlined" sx={{ fontFamily: 'monospace' }} /> },
            { key: 's', label: 'Substation', render: (r: any) => r.substation_code ?? '—', hideBelow: 'sm' },
            { key: 'd', label: 'Details', render: (r: any) => open === r.id
              ? <Box component="pre" sx={{ m: 0, fontSize: 12, whiteSpace: 'pre-wrap', maxWidth: 520 }}>{JSON.stringify(r.details, null, 2)}</Box>
              : <Typography variant="body2" sx={{ maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summarize(r.details)}</Typography>, hideBelow: 'md' },
            { key: 'ip', label: 'IP', render: (r: any) => r.ip ?? '—', hideBelow: 'lg' },
          ]} />
      )}
    </>
  );
}

function LoginHistory() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const { data, error, isLoading } = useQuery({
    queryKey: ['logins', page, pageSize],
    queryFn: () => api.get<Page<any>>(`/audit/logins${qs({ page, pageSize })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <ErrorAlert error={error} />
      {isLoading ? <Loading /> : (
        <DataTable rowKey={(r: any) => r.id} rows={data?.items ?? []} total={data?.total} page={page} pageSize={pageSize}
          onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }}
          columns={[
            { key: 't', label: 'When', render: (r: any) => dateTime(r.occurred_at) },
            { key: 'u', label: 'Username', render: (r: any) => r.username_attempted },
            { key: 's', label: 'Result', render: (r: any) => (r.success ? <Chip size="small" color="success" variant="outlined" label="Success" /> : <Chip size="small" color="error" variant="outlined" label={r.reason ?? 'Failed'} />) },
            { key: 'ip', label: 'IP', render: (r: any) => r.ip ?? '—', hideBelow: 'sm' },
            { key: 'ua', label: 'Browser', render: (r: any) => <Typography variant="caption">{r.user_agent ?? '—'}</Typography>, hideBelow: 'lg' },
          ]} />
      )}
    </>
  );
}

export default function AuditPage() {
  const { me } = useAuth();
  const [tab, setTab] = useState(0);
  return (
    <>
      <PageHeader title="Audit" subtitle="Append-only record of every material change. Entries cannot be edited or deleted." />
      {me?.orgWide && (
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab label="Activity log" />
          <Tab label="Sign-in history" />
        </Tabs>
      )}
      {tab === 0 ? <AuditLog /> : <LoginHistory />}
    </>
  );
}
