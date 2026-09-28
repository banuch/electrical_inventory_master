import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Box, Button, Card, CardActionArea, CardContent, Grid, Link, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DOC_TYPE_LABEL, dateTime, qty } from '../lib/format';
import { CriticalChip, DataTable, ErrorAlert, Loading, PageHeader, StatusChip } from '../components/common';

interface Dashboard {
  cards: Record<string, number>;
  recent: any[];
  lowStock: any[];
  organization: Record<string, number> | null;
}

function StatCard({ label, value, tone, to }: { label: string; value: number | undefined; tone?: 'warning' | 'error'; to?: string }) {
  const navigate = useNavigate();
  const body = (
    <CardContent>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="h4" sx={{ fontWeight: 600, color: tone && value ? `${tone}.main` : 'text.primary' }}>{value ?? '—'}</Typography>
    </CardContent>
  );
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      {to ? <CardActionArea sx={{ height: '100%' }} onClick={() => navigate(to)}>{body}</CardActionArea> : body}
    </Card>
  );
}

export default function DashboardPage() {
  const { me, substationId, can } = useAuth();
  const [scope, setScope] = useState<'site' | 'all'>(me?.orgWide && !substationId ? 'all' : 'site');
  const sid = scope === 'site' ? substationId : null;
  const current = me?.substations.find((s) => s.id === substationId);
  const { data, error, isLoading } = useQuery({
    queryKey: ['dashboard', sid],
    queryFn: () => api.get<Dashboard>(`/dashboard${sid ? `?substationId=${sid}` : ''}`),
  });

  return (
    <>
      <PageHeader
        title={`Welcome, ${me?.fullName ?? ""}`}
        subtitle={scope === 'site' && current ? `${current.code} — ${current.name}` : me?.orgWide ? 'Organization-wide view' : 'All assigned substations'}
        actions={
          <>
            {(me?.substations.length ?? 0) > 0 && (
              <ToggleButtonGroup size="small" exclusive value={scope} onChange={(_, v) => v && setScope(v)}>
                <ToggleButton value="site">This substation</ToggleButton>
                <ToggleButton value="all">{me?.orgWide ? 'Organization' : 'All my substations'}</ToggleButton>
              </ToggleButtonGroup>
            )}
            {can('stock.receive') && <Button variant="outlined" component={RouterLink} to="/stock/new/receipt">Receive</Button>}
            {can('stock.issue') && <Button variant="contained" component={RouterLink} to="/stock/new/issue">Issue</Button>}
          </>
        }
      />
      <ErrorAlert error={error} />
      {isLoading ? <Loading /> : data && (
        <Stack spacing={3}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, md: 3 }}><StatCard label="Item types in stock" value={data.cards.active_item_types} to="/inventory" /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><StatCard label="Below minimum level" value={data.cards.low_stock} tone="warning" to="/inventory?status=low" /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><StatCard label="Out of stock (tracked)" value={data.cards.out_of_stock} tone="error" to="/inventory?status=out" /></Grid>
            <Grid size={{ xs: 6, md: 3 }}><StatCard label="Critical items below minimum" value={data.cards.critical_below_min} tone="error" to="/inventory?status=critical" /></Grid>
            <Grid size={{ xs: 4 }}><StatCard label="Receipts (30 days)" value={data.cards.receipts_30d} /></Grid>
            <Grid size={{ xs: 4 }}><StatCard label="Issues (30 days)" value={data.cards.issues_30d} /></Grid>
            <Grid size={{ xs: 4 }}><StatCard label="Corrections / scrap (30 days)" value={data.cards.exceptions_30d} tone="warning" /></Grid>
          </Grid>

          {data.organization && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Organization</Typography>
              <Stack direction="row" spacing={4} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                <Box><Typography variant="h6">{data.organization.active_substations}</Typography><Typography variant="caption" color="text.secondary">Active substations</Typography></Box>
                <Box><Typography variant="h6">{data.organization.active_users}</Typography><Typography variant="caption" color="text.secondary">Active users</Typography></Box>
                <Box><Typography variant="h6">{data.organization.active_items}</Typography><Typography variant="caption" color="text.secondary">Active items in master</Typography></Box>
                <Box>
                  <Typography variant="h6" color={data.organization.stale_substations ? 'warning.main' : undefined}>{data.organization.stale_substations}</Typography>
                  <Typography variant="caption" color="text.secondary">Substations with no movement in 30 days</Typography>
                </Box>
              </Stack>
            </Paper>
          )}

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Action required — below minimum level</Typography>
            <DataTable rowKey={(r) => `${r.substation_id}-${r.item_id}`} rows={data.lowStock} empty="No items below minimum level"
              columns={[
                { key: 'item', label: 'Item', render: (r) => (
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Link component={RouterLink} to={`/items/${r.item_id}`}>{r.code}</Link>
                    <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'inline' } }}>{r.name}</Typography>
                    {r.is_critical && <CriticalChip />}
                  </Stack>) },
                { key: 'sub', label: 'Substation', render: (r) => r.substation_code },
                { key: 'qty', label: 'On hand', align: 'right', render: (r) => qty(r.quantity, r.unit) },
                { key: 'min', label: 'Minimum', align: 'right', render: (r) => qty(r.min_level), hideBelow: 'sm' },
                { key: 'st', label: 'Status', render: (r) => <StatusChip status={Number(r.quantity) === 0 ? 'OUT' : 'LOW'} /> },
              ]} />
          </Box>

          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Recent transactions</Typography>
            <DataTable rowKey={(r) => r.id} rows={data.recent} empty="No transactions yet"
              columns={[
                { key: 'doc', label: 'Document', render: (r) => <Link component={RouterLink} to={`/stock/documents/${r.id}`}>{r.doc_number}</Link> },
                { key: 'type', label: 'Type', render: (r) => DOC_TYPE_LABEL[r.doc_type] ?? r.doc_type },
                { key: 'sub', label: 'Substation', render: (r) => r.substation_code, hideBelow: 'md' },
                { key: 'lines', label: 'Lines', align: 'right', render: (r) => r.line_count, hideBelow: 'md' },
                { key: 'by', label: 'By', render: (r) => r.user_name, hideBelow: 'md' },
                { key: 'at', label: 'Posted', render: (r) => dateTime(r.posted_at), hideBelow: 'sm' },
                { key: 'st', label: 'Status', render: (r) => <StatusChip status={r.status} /> },
              ]} />
          </Box>
        </Stack>
      )}
    </>
  );
}
