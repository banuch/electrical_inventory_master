import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Grid, Link, Paper, TextField, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, newIdempotencyKey } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DOC_TYPE_LABEL, date, dateTime, qty } from '../lib/format';
import { ConfirmDialog, DataTable, ErrorAlert, Loading, PageHeader, StatusChip } from '../components/common';

export default function DocumentDetailPage() {
  const { id } = useParams();
  const { can, me } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [reversing, setReversing] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const { data: d, error: loadError, isLoading } = useQuery({ queryKey: ['document', id], queryFn: () => api.get<any>(`/stock/documents/${id}`) });
  if (isLoading) return <Loading />;
  if (loadError || !d) return <ErrorAlert error={loadError} />;

  const canReverse = d.status === 'POSTED' && d.doc_type !== 'REVERSAL' && can('stock.reverse')
    && (me?.orgWide || me?.substations.some((s) => s.id === d.substation_id));

  const reverse = async () => {
    if (!remarks.trim()) { setError(new Error('Enter the reason for reversal')); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ documentId: number }>(`/stock/documents/${id}/reverse`, { remarks, idempotencyKey: key });
      qc.invalidateQueries();
      navigate(`/stock/documents/${res.documentId}`);
    } catch (err) {
      if (err instanceof ApiError && err.status < 500 && err.status > 0) setKey(newIdempotencyKey());
      setError(err);
    } finally { setBusy(false); setReversing(false); }
  };

  const field = (label: string, value: React.ReactNode) => (
    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2">{value || '—'}</Typography>
    </Grid>
  );

  return (
    <>
      <PageHeader title={d.doc_number} subtitle={`${DOC_TYPE_LABEL[d.doc_type]} · ${d.substation_code} — ${d.substation_name}`}
        actions={<>
          <StatusChip status={d.status} />
          {canReverse && <Button color="error" variant="outlined" onClick={() => setReversing(true)}>Reverse document</Button>}
        </>} />
      <ErrorAlert error={error} />
      {d.reverses_doc_number && (
        <Alert severity="info" sx={{ mb: 2 }}>This reversal cancels <Link component={RouterLink} to={`/stock/documents/${d.reverses_document_id}`}>{d.reverses_doc_number}</Link>.</Alert>
      )}
      {d.reversed_by_doc_number && (
        <Alert severity="warning" sx={{ mb: 2 }}>This document was reversed by <Link component={RouterLink} to={`/stock/documents/${d.reversed_by_document_id}`}>{d.reversed_by_doc_number}</Link>.</Alert>
      )}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2}>
          {field('Document date', date(d.doc_date))}
          {field('Reason', d.reason_name)}
          {field('Reference', d.reference_no)}
          {field('Party', d.counterparty)}
          {field('Created by', d.created_by_name)}
          {field('Posted at', dateTime(d.posted_at))}
          <Grid size={12}>
            <Typography variant="caption" color="text.secondary">Remarks</Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{d.remarks || '—'}</Typography>
          </Grid>
        </Grid>
      </Paper>
      <DataTable rowKey={(r: any) => r.line_no} rows={d.lines}
        columns={[
          { key: 'n', label: '#', render: (r: any) => r.line_no, width: 40 },
          { key: 'i', label: 'Item', render: (r: any) => <><Link component={RouterLink} to={`/items/${r.item_id}`}>{r.item_code}</Link> <Typography component="span" variant="body2">{r.item_name}</Typography></> },
          { key: 'q', label: 'Movement', align: 'right', render: (r: any) => (
            <Typography variant="body2" sx={{ fontWeight: 600, color: r.quantity.startsWith('-') ? 'error.main' : 'success.main' }}>
              {r.quantity.startsWith('-') ? '' : '+'}{qty(r.quantity, r.unit)}
            </Typography>) },
          { key: 'b', label: 'Balance before → after', align: 'right', render: (r: any) => `${qty(r.balance_before)} → ${qty(r.balance_after)}`, hideBelow: 'sm' },
          { key: 'r', label: 'Remarks', render: (r: any) => r.remarks || '—', hideBelow: 'md' },
        ]} />

      <ConfirmDialog open={reversing} title={`Reverse ${d.doc_number}?`} confirmLabel="Post reversal" color="error" busy={busy}
        onClose={() => setReversing(false)} onConfirm={reverse}>
        <Typography variant="body2" sx={{ mb: 2 }}>
          A linked reversal document will be posted that exactly cancels every line. If stock has since been consumed, the reversal will be refused.
        </Typography>
        <TextField fullWidth autoFocus multiline minRows={2} label="Reason for reversal" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </ConfirmDialog>
    </>
  );
}
