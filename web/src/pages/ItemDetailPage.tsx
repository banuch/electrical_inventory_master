import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Box, Chip, Grid, Link, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs, type Page } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DOC_TYPE_LABEL, date, dateTime, qty, relative } from '../lib/format';
import { CriticalChip, DataTable, ErrorAlert, Loading, PageHeader, StatusChip } from '../components/common';

export default function ItemDetailPage() {
  const { id } = useParams();
  const { me } = useAuth();
  const [sub, setSub] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const avail = useQuery({ queryKey: ['availability', Number(id), true], queryFn: () => api.get<any>(`/inventory/items/${id}/availability?includeZero=true`) });
  const history = useQuery({
    queryKey: ['item-history', id, sub, page, pageSize],
    queryFn: () => api.get<Page<any>>(`/inventory/items/${id}/transactions${qs({ substationId: sub, page, pageSize })}`),
    placeholderData: keepPreviousData,
  });

  if (avail.isLoading) return <Loading />;
  if (avail.error) return <ErrorAlert error={avail.error} />;
  const { item, totalQuantity, substations } = avail.data;
  const withStock = substations.filter((s: any) => Number(s.quantity) > 0);

  return (
    <>
      <PageHeader title={`${item.code} — ${item.name}`}
        subtitle={<Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{item.category_name}</span>
          {item.is_critical && <CriticalChip />}
          {!item.is_active && <Chip size="small" label="Inactive" />}
        </Stack>} />
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
            <Typography variant="body2" color="text.secondary">Total available (visible substations)</Typography>
            <Typography variant="h3" sx={{ fontWeight: 700 }}>{qty(totalQuantity)} <Typography component="span" variant="h6" color="text.secondary">{item.unit}</Typography></Typography>
            <Typography variant="body2">at {withStock.length} of {substations.length} substations</Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
            <Grid container spacing={1}>
              {[['Specification', item.specification], ['Rating', item.rating], ['Manufacturer', item.manufacturer], ['Model', item.model],
                ['Unit', `${item.unit_name} (${item.unit})`], ['Description', item.description]].map(([k, v]) => (
                <Grid key={k} size={{ xs: 12, sm: 6 }}>
                  <Typography variant="caption" color="text.secondary">{k}</Typography>
                  <Typography variant="body2">{v || '—'}</Typography>
                </Grid>
              ))}
            </Grid>
          </Paper>
        </Grid>
      </Grid>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Availability by substation</Typography>
      <Box sx={{ mb: 3 }}>
        <DataTable rowKey={(r: any) => r.substation_id} rows={substations}
          columns={[
            { key: 's', label: 'Substation', render: (r: any) => <><b>{r.substation_code}</b> {r.substation_name}</> },
            { key: 'q', label: 'Quantity', align: 'right', render: (r: any) => <b>{qty(r.quantity, item.unit)}</b> },
            { key: 'm', label: 'Min level', align: 'right', render: (r: any) => (Number(r.min_level) ? qty(r.min_level) : '—'), hideBelow: 'sm' },
            { key: 'st', label: 'Status', render: (r: any) => <StatusChip status={r.status} /> },
            { key: 'l', label: 'Last movement', render: (r: any) => relative(r.last_txn_at), hideBelow: 'md' },
            { key: 'c', label: 'Contact', render: (r: any) => [r.contact_name, r.contact_phone].filter(Boolean).join(' · ') || '—', hideBelow: 'lg' },
          ]} />
      </Box>

      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ justifyContent: 'space-between', mb: 1, gap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Transaction history</Typography>
        <TextField select label="Substation" value={sub} onChange={(e) => { setSub(e.target.value); setPage(1); }} sx={{ minWidth: 220 }}>
          <MenuItem value="">{me?.orgWide ? 'All substations' : 'All my substations'}</MenuItem>
          {me?.substations.map((s) => <MenuItem key={s.id} value={s.id}>{s.code} — {s.name}</MenuItem>)}
        </TextField>
      </Stack>
      <ErrorAlert error={history.error} />
      <DataTable rowKey={(r: any) => r.id} rows={history.data?.items ?? []} total={history.data?.total} page={page} pageSize={pageSize}
        onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} empty="No transactions in your scope"
        columns={[
          { key: 'd', label: 'Date', render: (r: any) => <><div>{date(r.doc_date)}</div><Typography variant="caption" color="text.secondary">{dateTime(r.txn_time)}</Typography></> },
          { key: 'doc', label: 'Document', render: (r: any) => <Link component={RouterLink} to={`/stock/documents/${r.document_id}`}>{r.doc_number}</Link> },
          { key: 't', label: 'Type', render: (r: any) => DOC_TYPE_LABEL[r.txn_type] ?? r.txn_type, hideBelow: 'sm' },
          { key: 's', label: 'Substation', render: (r: any) => r.substation_code, hideBelow: 'sm' },
          { key: 'q', label: 'Qty', align: 'right', render: (r: any) => (
            <Typography variant="body2" sx={{ fontWeight: 600, color: r.quantity.startsWith('-') ? 'error.main' : 'success.main' }}>
              {r.quantity.startsWith('-') ? '' : '+'}{qty(r.quantity)}
            </Typography>) },
          { key: 'b', label: 'Balance', align: 'right', render: (r: any) => qty(r.balance_after), hideBelow: 'md' },
          { key: 'ref', label: 'Reference / party', render: (r: any) => [r.reference_no, r.counterparty].filter(Boolean).join(' · ') || '—', hideBelow: 'lg' },
          { key: 'u', label: 'User', render: (r: any) => r.user_name, hideBelow: 'lg' },
        ]} />
    </>
  );
}
