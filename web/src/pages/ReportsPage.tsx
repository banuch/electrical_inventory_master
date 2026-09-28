import { useState } from 'react';
import { Button, Grid, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import { qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { todayIso } from '../lib/format';
import { PageHeader } from '../components/common';

const monthStart = () => `${todayIso().slice(0, 8)}01`;

export default function ReportsPage() {
  const { me } = useAuth();
  const [stockSub, setStockSub] = useState('');
  const [txSub, setTxSub] = useState('');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayIso);

  const subSelect = (value: string, onChange: (v: string) => void) => (
    <TextField select fullWidth label="Substation" value={value} onChange={(e) => onChange(e.target.value)}>
      <MenuItem value="">{me?.orgWide ? 'All substations' : 'All my substations'}</MenuItem>
      {me?.substations.map((s) => <MenuItem key={s.id} value={s.id}>{s.code} — {s.name}</MenuItem>)}
    </TextField>
  );

  return (
    <>
      <PageHeader title="Reports & exports" subtitle="CSV files open directly in Excel. Every export is recorded in the audit log." />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Current stock</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Balances by substation and item with minimum levels and last movement.</Typography>
            <Stack spacing={2}>
              {subSelect(stockSub, setStockSub)}
              <Button variant="contained" startIcon={<DownloadIcon />} href={`/api/reports/current-stock.csv${qs({ substationId: stockSub })}`}>Download CSV</Button>
            </Stack>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Transaction register</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Receipts, issues, returns, adjustments, scrap and reversals with running balances.</Typography>
            <Stack spacing={2}>
              {subSelect(txSub, setTxSub)}
              <Stack direction="row" spacing={2}>
                <TextField fullWidth type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                <TextField fullWidth type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              </Stack>
              <Button variant="contained" startIcon={<DownloadIcon />} disabled={!from || !to || from > to}
                href={`/api/reports/transactions.csv${qs({ substationId: txSub, from, to })}`}>Download CSV</Button>
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </>
  );
}
