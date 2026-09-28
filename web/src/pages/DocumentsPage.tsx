import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Link, MenuItem, Paper, Stack, TextField } from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs, type Page } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DOC_TYPE_LABEL, date, dateTime } from '../lib/format';
import { DataTable, ErrorAlert, Loading, PageHeader, StatusChip, useDebounced } from '../components/common';

export default function DocumentsPage() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [substationId, setSubstationId] = useState('');
  const [docType, setDocType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [input, setInput] = useState('');
  const q = useDebounced(input);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => setPage(1), [substationId, docType, from, to, q]);

  const { data, error, isLoading } = useQuery({
    queryKey: ['documents', substationId, docType, from, to, q, page, pageSize],
    queryFn: () => api.get<Page<any>>(`/stock/documents${qs({ substationId, docType, from, to, q, page, pageSize })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Stock documents" subtitle="Receipts, issues, returns, adjustments, scrap, opening stock and reversals in your scope." />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField label="Document no., reference or party" value={input} onChange={(e) => setInput(e.target.value)} sx={{ flex: 2 }} />
          <TextField select label="Substation" value={substationId} onChange={(e) => setSubstationId(e.target.value)} sx={{ flex: 1, minWidth: 160 }}>
            <MenuItem value="">All</MenuItem>
            {me?.substations.map((s) => <MenuItem key={s.id} value={s.id}>{s.code}</MenuItem>)}
          </TextField>
          <TextField select label="Type" value={docType} onChange={(e) => setDocType(e.target.value)} sx={{ flex: 1, minWidth: 160 }}>
            <MenuItem value="">All types</MenuItem>
            {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
          </TextField>
          <TextField type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        </Stack>
      </Paper>
      <ErrorAlert error={error} />
      {isLoading ? <Loading /> : (
        <DataTable rowKey={(r: any) => r.id} rows={data?.items ?? []} total={data?.total} page={page} pageSize={pageSize}
          onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} onRowClick={(r: any) => navigate(`/stock/documents/${r.id}`)}
          columns={[
            { key: 'n', label: 'Document', render: (r: any) => <Link component={RouterLink} to={`/stock/documents/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.doc_number}</Link> },
            { key: 't', label: 'Type', render: (r: any) => DOC_TYPE_LABEL[r.doc_type] },
            { key: 'd', label: 'Date', render: (r: any) => date(r.doc_date), hideBelow: 'sm' },
            { key: 's', label: 'Substation', render: (r: any) => r.substation_code, hideBelow: 'md' },
            { key: 'r', label: 'Reference / party', render: (r: any) => [r.reference_no, r.counterparty].filter(Boolean).join(' · ') || '—', hideBelow: 'lg' },
            { key: 'l', label: 'Lines', align: 'right', render: (r: any) => r.line_count, hideBelow: 'md' },
            { key: 'u', label: 'Posted by', render: (r: any) => <>{r.created_by_name}<br /><small>{dateTime(r.posted_at)}</small></>, hideBelow: 'lg' },
            { key: 'st', label: 'Status', render: (r: any) => <StatusChip status={r.status} /> },
          ]} />
      )}
    </>
  );
}
