import { Alert, Button, Typography } from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { dateTime, qty } from '../lib/format';
import { DataTable, ErrorAlert, PageHeader } from '../components/common';

export default function ReconciliationPage() {
  const run = useMutation({ mutationFn: () => api.get<any>('/admin/reconciliation') });
  const r = run.data;
  return (
    <>
      <PageHeader title="Ledger reconciliation"
        subtitle="Recalculates every balance from the immutable transaction ledger and compares it with current balances."
        actions={<Button variant="contained" onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending ? 'Running…' : 'Run reconciliation'}</Button>} />
      <ErrorAlert error={run.error} />
      {r && (r.mismatches.length === 0
        ? <Alert severity="success">All {r.checkedBalances} balances match the ledger. <Typography component="span" variant="caption">Run at {dateTime(r.runAt)}</Typography></Alert>
        : (
          <>
            <Alert severity="error" sx={{ mb: 2 }}>{r.mismatches.length} balance(s) differ from the ledger. Investigate before posting further corrections.</Alert>
            <DataTable rowKey={(m: any) => `${m.substation_id}-${m.item_id}`} rows={r.mismatches}
              columns={[
                { key: 's', label: 'Substation', render: (m: any) => m.substation_code },
                { key: 'i', label: 'Item', render: (m: any) => m.item_code },
                { key: 'b', label: 'Balance', align: 'right', render: (m: any) => qty(m.balance_qty) },
                { key: 'l', label: 'Ledger total', align: 'right', render: (m: any) => qty(m.ledger_qty) },
              ]} />
          </>
        ))}
    </>
  );
}
