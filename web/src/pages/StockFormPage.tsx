import { useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Alert, Box, Button, Divider, Grid, IconButton, MenuItem, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import AddIcon from '@mui/icons-material/Add';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, newIdempotencyKey } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DOC_TYPE_LABEL, qty, todayIso } from '../lib/format';
import { ConfirmDialog, EmptyState, ErrorAlert, ItemPicker, PageHeader, type ItemOption } from '../components/common';

type DocType = 'RECEIPT' | 'ISSUE' | 'RETURN' | 'ADJUSTMENT' | 'SCRAP' | 'OPENING';

const CONFIG: Record<string, { type: DocType; perm: string; party?: string; hint: string; direction: 1 | -1 | 0 }> = {
  receipt: { type: 'RECEIPT', perm: 'stock.receive', party: 'Received from (supplier / store)', hint: 'Material received into this substation. Stock increases on posting.', direction: 1 },
  issue: { type: 'ISSUE', perm: 'stock.issue', party: 'Issued to (person / team / work)', hint: 'Material issued for use. Stock decreases; issues beyond available stock are refused.', direction: -1 },
  return: { type: 'RETURN', perm: 'stock.return', party: 'Returned by', hint: 'Usable material returned to store. Stock increases.', direction: 1 },
  adjustment: { type: 'ADJUSTMENT', perm: 'stock.adjust', hint: 'Correction after physical verification or a recording error. Requires a reason, reference and remarks.', direction: 0 },
  scrap: { type: 'SCRAP', perm: 'stock.scrap', hint: 'Damaged or condemned material written off. Permanently reduces stock.', direction: -1 },
  opening: { type: 'OPENING', perm: 'stock.opening', hint: 'One-time opening balance when migrating a substation. Allowed once per item per substation.', direction: 1 },
};

interface Line { key: string; item: ItemOption | null; quantity: string; sign: 1 | -1; remarks: string }
const blankLine = (): Line => ({ key: crypto.randomUUID(), item: null, quantity: '', sign: 1, remarks: '' });

function validQty(q: string, dp: number): string | null {
  if (!q) return 'Required';
  if (!/^\d{1,14}(\.\d{1,4})?$/.test(q)) return 'Enter a positive number';
  if (/^0+(\.0+)?$/.test(q)) return 'Must be greater than zero';
  const frac = (q.split('.')[1] ?? '').replace(/0+$/, '');
  if (frac.length > dp) return dp === 0 ? 'Whole numbers only for this unit' : `Max ${dp} decimal places`;
  return null;
}

function OnHand({ itemId, substationId, unit }: { itemId: number; substationId: number; unit: string }) {
  const { data } = useQuery({
    queryKey: ['availability', itemId, true],
    queryFn: () => api.get<any>(`/inventory/items/${itemId}/availability?includeZero=true`),
    staleTime: 5_000,
  });
  const row = data?.substations.find((s: any) => s.substation_id === substationId);
  return <Typography variant="caption" color="text.secondary">On hand: <b>{row ? qty(row.quantity, unit) : '…'}</b></Typography>;
}

export default function StockFormPage() {
  const { type: slug = '' } = useParams();
  const cfg = CONFIG[slug];
  const { me, can, substationId: currentSub } = useAuth();
  const qc = useQueryClient();

  const [substationId, setSubstationId] = useState<number | ''>(currentSub ?? '');
  const [docDate, setDocDate] = useState(todayIso());
  const [reasonCode, setReasonCode] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ documentId: number; docNumber: string } | null>(null);

  const { data: reasons = [] } = useQuery({
    queryKey: ['reasons', cfg?.type],
    queryFn: () => api.get<any[]>(`/stock/reasons?docType=${cfg.type}`),
    enabled: !!cfg, staleTime: 300_000,
  });
  const reason = reasons.find((r) => r.code === reasonCode);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!substationId) e.substation = 'Select a substation';
    if (!docDate) e.date = 'Required'; else if (docDate > todayIso()) e.date = 'Cannot be in the future';
    if (reasons.length && !reasonCode) e.reason = 'Select a reason';
    const needsRef = reason?.requires_reference || cfg?.type === 'ADJUSTMENT' || cfg?.type === 'SCRAP';
    if (needsRef && !referenceNo.trim()) e.reference = 'Reference is required';
    if ((cfg?.type === 'ADJUSTMENT' || cfg?.type === 'SCRAP') && !remarks.trim()) e.remarks = 'Remarks are required';
    lines.forEach((l, i) => {
      if (!l.item) e[`item${i}`] = 'Select an item';
      const qe = validQty(l.quantity, l.item?.decimal_places ?? 4);
      if (qe) e[`qty${i}`] = qe;
    });
    return e;
  }, [substationId, docDate, reasons.length, reasonCode, reason, referenceNo, remarks, lines, cfg?.type]);

  if (!cfg) return <EmptyState title="Unknown transaction type" />;
  if (!can(cfg.perm)) return <EmptyState title="Not permitted">Your role does not allow posting {DOC_TYPE_LABEL[cfg.type].toLowerCase()} documents.</EmptyState>;

  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const selectedIds = lines.map((l) => l.item?.id).filter((x): x is number => !!x);

  const reset = () => {
    setLines([blankLine()]); setReferenceNo(''); setCounterparty(''); setRemarks(''); setReasonCode('');
    setIdempotencyKey(newIdempotencyKey()); setSubmitted(false); setError(null);
  };

  const post = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ documentId: number; docNumber: string }>('/stock/documents', {
        docType: cfg.type, substationId, docDate, reasonCode: reasonCode || undefined, referenceNo, counterparty, remarks,
        idempotencyKey,
        lines: lines.map((l) => ({
          itemId: l.item!.id, quantity: cfg.type === 'ADJUSTMENT' && l.sign === -1 ? `-${l.quantity}` : l.quantity, remarks: l.remarks,
        })),
      });
      setResult(res);
      reset();
      qc.invalidateQueries({ queryKey: ['availability'] });
      qc.invalidateQueries({ queryKey: ['balances'] });
      qc.invalidateQueries({ queryKey: ['search'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      // Validation / stock errors are final; the same idempotency key is reused for network retries only.
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) setIdempotencyKey(newIdempotencyKey());
      setError(err);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setResult(null);
    if (Object.keys(errors).length === 0) setConfirming(true);
  };
  const err = (k: string) => (submitted ? errors[k] : undefined);
  const sub = me?.substations.find((s) => s.id === substationId);

  return (
    <>
      <PageHeader title={DOC_TYPE_LABEL[cfg.type]} subtitle={cfg.hint} />
      {result && (
        <Alert severity="success" sx={{ mb: 2 }}
          action={<Button color="inherit" component={RouterLink} to={`/stock/documents/${result.documentId}`}>View</Button>}>
          Posted <b>{result.docNumber}</b>. Stock has been updated.
        </Alert>
      )}
      <ErrorAlert error={error} />
      <Paper variant="outlined" component="form" onSubmit={onSubmit} noValidate sx={{ p: { xs: 2, md: 3 } }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <TextField select fullWidth label="Substation" value={substationId} onChange={(e) => setSubstationId(Number(e.target.value))}
              error={!!err('substation')} helperText={err('substation')}>
              {me?.substations.map((s) => <MenuItem key={s.id} value={s.id}>{s.code} — {s.name}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 2 }}>
            <TextField fullWidth type="date" label="Document date" value={docDate} onChange={(e) => setDocDate(e.target.value)}
              error={!!err('date')} helperText={err('date')} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayIso() } }} />
          </Grid>
          {reasons.length > 0 && (
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <TextField select fullWidth label="Reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}
                error={!!err('reason')} helperText={err('reason')}>
                {reasons.map((r) => <MenuItem key={r.code} value={r.code}>{r.name}</MenuItem>)}
              </TextField>
            </Grid>
          )}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField fullWidth label="Reference no." placeholder="PO, work order, count sheet…" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)}
              error={!!err('reference')} helperText={err('reference')} />
          </Grid>
          {cfg.party && (
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label={cfg.party} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
            </Grid>
          )}
          <Grid size={{ xs: 12, md: cfg.party ? 6 : 12 }}>
            <TextField fullWidth label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)}
              error={!!err('remarks')} helperText={err('remarks')} multiline minRows={1} />
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Items</Typography>
        <Stack spacing={2}>
          {lines.map((l, i) => (
            <Box key={l.key} sx={{ p: { xs: 1.5, sm: 0 }, border: { xs: 1, sm: 0 }, borderColor: 'divider', borderRadius: 1 }}>
              <Grid container spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                <Grid size={{ xs: 12, md: 5 }}>
                  <ItemPicker value={l.item} onChange={(v) => update(i, { item: v })} exclude={selectedIds}
                    error={!!err(`item${i}`)} helperText={err(`item${i}`) ?? (l.item && substationId
                      ? <OnHand itemId={l.item.id} substationId={Number(substationId)} unit={l.item.unit} /> : undefined)} />
                </Grid>
                {cfg.type === 'ADJUSTMENT' && (
                  <Grid size={{ xs: 12, sm: 'auto' }}>
                    <ToggleButtonGroup exclusive size="small" value={l.sign} onChange={(_, v) => v && update(i, { sign: v })} sx={{ height: 40 }}>
                      <ToggleButton value={1} color="success">Increase</ToggleButton>
                      <ToggleButton value={-1} color="error">Decrease</ToggleButton>
                    </ToggleButtonGroup>
                  </Grid>
                )}
                <Grid size={{ xs: 8, sm: 4, md: 2 }}>
                  <TextField fullWidth label="Quantity" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value.trim() })}
                    error={!!err(`qty${i}`)} helperText={err(`qty${i}`)}
                    slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: l.item ? <Typography variant="caption" color="text.secondary">{l.item.unit}</Typography> : undefined } }} />
                </Grid>
                <Grid size={{ xs: 12, sm: 'grow' }} sx={{ display: { xs: 'none', sm: 'block' } }}>
                  <TextField fullWidth label="Line remarks" value={l.remarks} onChange={(e) => update(i, { remarks: e.target.value })} />
                </Grid>
                <Grid size={{ xs: 4, sm: 'auto' }} sx={{ textAlign: 'right' }}>
                  <Tooltip title="Remove line">
                    <span><IconButton onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1} aria-label="Remove line"><DeleteIcon /></IconButton></span>
                  </Tooltip>
                </Grid>
              </Grid>
            </Box>
          ))}
        </Stack>
        <Button startIcon={<AddIcon />} onClick={() => setLines((ls) => [...ls, blankLine()])} sx={{ mt: 1 }} disabled={lines.length >= 200}>Add item</Button>

        <Divider sx={{ my: 3 }} />
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={reset} disabled={busy}>Clear</Button>
          <Button type="submit" variant="contained" size="large" disabled={busy}>Review & post</Button>
        </Stack>
      </Paper>

      <ConfirmDialog open={confirming} title={`Post ${DOC_TYPE_LABEL[cfg.type].toLowerCase()}?`} confirmLabel="Post now" busy={busy}
        onClose={() => setConfirming(false)} onConfirm={post} color={cfg.direction === -1 ? 'warning' : 'primary'}>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {sub?.code} — {sub?.name} · {docDate}{reason ? ` · ${reason.name}` : ''}{referenceNo ? ` · Ref ${referenceNo}` : ''}
        </Typography>
        <Box component="ul" sx={{ pl: 2, my: 0 }}>
          {lines.map((l) => {
            const sign = cfg.direction === 0 ? l.sign : cfg.direction;
            return (
              <li key={l.key}>
                <Typography variant="body2"><b>{sign === 1 ? '+' : '−'}{qty(l.quantity, l.item?.unit)}</b> {l.item?.code} — {l.item?.name}</Typography>
              </li>
            );
          })}
        </Box>
        <Alert severity="info" sx={{ mt: 2 }}>Posted documents cannot be edited. Mistakes are corrected by a linked reversal.</Alert>
      </ConfirmDialog>
    </>
  );
}
