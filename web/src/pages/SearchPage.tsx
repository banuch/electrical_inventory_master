import { Fragment, useEffect, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Box, Button, Chip, Collapse, FormControlLabel, IconButton, InputAdornment, Link, MenuItem, Paper, Stack, Switch,
  Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ExpandMoreIcon from '@mui/icons-material/KeyboardArrowDown';
import ExpandLessIcon from '@mui/icons-material/KeyboardArrowUp';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs, type Page } from '../lib/api';
import { qty, relative } from '../lib/format';
import { useAuth } from '../lib/auth';
import { CriticalChip, ErrorAlert, Loading, PageHeader, StatusChip, paginationSx, useDebounced } from '../components/common';

interface SearchRow {
  id: number; code: string; name: string; specification: string; rating: string; manufacturer: string; model: string;
  is_critical: boolean; category_name: string; unit: string; total_quantity: string; substations_with_stock: number;
  substations_low: number; last_movement_at: string | null; stock_status: string;
}

interface Availability {
  totalQuantity: string;
  substations: { substation_id: number; substation_code: string; substation_name: string; contact_name: string; contact_phone: string;
    quantity: string; last_txn_at: string | null; min_level: string; status: string }[];
}

function AvailabilityPanel({ itemId, unit }: { itemId: number; unit: string }) {
  const [includeZero, setIncludeZero] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['availability', itemId, includeZero],
    queryFn: () => api.get<Availability>(`/inventory/items/${itemId}/availability?includeZero=${includeZero}`),
  });
  return (
    <Box sx={{ p: { xs: 1, sm: 2 }, bgcolor: 'grey.50' }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2">Substation-wise availability</Typography>
        <FormControlLabel control={<Switch size="small" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />}
          label={<Typography variant="body2">Show zero-stock substations</Typography>} />
      </Stack>
      <ErrorAlert error={error} />
      {isLoading ? <Loading /> : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Substation</TableCell>
              <TableCell align="right">Quantity</TableCell>
              <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Status</TableCell>
              <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Last movement</TableCell>
              <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Contact</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data?.substations.length === 0 && <TableRow><TableCell colSpan={5} sx={{ color: 'text.secondary' }}>No stock at any substation.</TableCell></TableRow>}
            {data?.substations.map((s) => (
              <TableRow key={s.substation_id}>
                <TableCell><b>{s.substation_code}</b> <Typography component="span" variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'inline' } }}>{s.substation_name}</Typography></TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>{qty(s.quantity, unit)}</TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}><StatusChip status={s.status} /></TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{relative(s.last_txn_at)}</TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{[s.contact_name, s.contact_phone].filter(Boolean).join(' · ') || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}

export default function SearchPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get('q') ?? '');
  const q = useDebounced(input, 300);
  const [categoryId, setCategoryId] = useState('');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => { setInput(params.get('q') ?? ''); }, [params]);
  useEffect(() => { setPage(1); setExpanded(null); }, [q, categoryId, criticalOnly, availableOnly]);

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api.get<any[]>('/categories'), staleTime: 300_000 });
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ['search', q, categoryId, criticalOnly, availableOnly, page, pageSize],
    queryFn: () => api.get<Page<SearchRow>>(`/inventory/search${qs({
      q, categoryId, critical: criticalOnly ? true : undefined, availableOnly, page, pageSize })}`),
    placeholderData: keepPreviousData,
  });

  const exportUrl = '/api/reports/current-stock.csv';

  return (
    <>
      <PageHeader title="Find stock across all substations"
        subtitle="Search the standardized Item Master and see total and substation-wise availability."
        actions={can('reports.export') && <Button variant="outlined" href={exportUrl}>Export current stock (CSV)</Button>} />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'center' } }}>
          <TextField autoFocus fullWidth size="medium" value={input} placeholder="Item code, name, specification, rating, manufacturer…"
            onChange={(e) => { setInput(e.target.value); setParams(e.target.value ? { q: e.target.value } : {}, { replace: true }); }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> } }} />
          <TextField select label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">All categories</MenuItem>
            {categories?.filter((c) => c.is_active).map((c) => (
              <MenuItem key={c.id} value={c.id} sx={{ pl: c.parent_id ? 4 : 2 }}>{c.name}</MenuItem>
            ))}
          </TextField>
        </Stack>
        <Stack direction="row" useFlexGap spacing={2} sx={{ mt: 1, flexWrap: "wrap" }}>
          <FormControlLabel control={<Switch checked={availableOnly} onChange={(e) => setAvailableOnly(e.target.checked)} />} label="Available only" />
          <FormControlLabel control={<Switch checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} />} label="Critical items only" />
        </Stack>
      </Paper>
      <ErrorAlert error={error} />
      {isLoading ? <Loading /> : (
        <Paper variant="outlined" sx={{ opacity: isFetching ? 0.7 : 1, transition: 'opacity .2s' }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell sx={{ fontWeight: 600 }}>Item</TableCell>
                  <TableCell sx={{ fontWeight: 600, display: { xs: 'none', md: 'table-cell' } }}>Specification / rating</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Total available</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, display: { xs: 'none', sm: 'table-cell' } }}>Substations</TableCell>
                  <TableCell sx={{ fontWeight: 600, display: { xs: 'none', sm: 'table-cell' } }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600, display: { xs: 'none', lg: 'table-cell' } }}>Last movement</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data?.items.length === 0 && (
                  <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    No matching items{availableOnly ? ' with available stock' : ''}.
                    {availableOnly && <> <Link component="button" onClick={() => setAvailableOnly(false)}>Include zero-stock items</Link></>}
                  </TableCell></TableRow>
                )}
                {data?.items.map((r) => (
                  <Fragment key={r.id}>
                    <TableRow hover sx={{ cursor: 'pointer', '& > td': { borderBottom: expanded === r.id ? 'none' : undefined } }}
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                      <TableCell padding="checkbox">
                        <IconButton size="small" aria-label="Show substation availability">{expanded === r.id ? <ExpandLessIcon /> : <ExpandMoreIcon />}</IconButton>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Link component={RouterLink} to={`/items/${r.id}`} onClick={(e) => e.stopPropagation()} sx={{ fontWeight: 600 }}>{r.code}</Link>
                          {r.is_critical && <CriticalChip />}
                        </Stack>
                        <Typography variant="body2">{r.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{r.category_name}{r.manufacturer ? ` · ${r.manufacturer}` : ''}</Typography>
                      </TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                        <Typography variant="body2">{r.specification || '—'}</Typography>
                        {r.rating && <Chip size="small" label={r.rating} variant="outlined" sx={{ mt: 0.5 }} />}
                      </TableCell>
                      <TableCell align="right"><Typography sx={{ fontWeight: 700 }}>{qty(r.total_quantity)}</Typography><Typography variant="caption" color="text.secondary">{r.unit}</Typography></TableCell>
                      <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{r.substations_with_stock}</TableCell>
                      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}><StatusChip status={r.stock_status} /></TableCell>
                      <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>{relative(r.last_movement_at)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={7} sx={{ p: 0, borderBottom: expanded === r.id ? undefined : 'none' }}>
                        <Collapse in={expanded === r.id} unmountOnExit><AvailabilityPanel itemId={r.id} unit={r.unit} /></Collapse>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination component="div" sx={paginationSx} count={data?.total ?? 0} page={page - 1} rowsPerPage={pageSize}
            onPageChange={(_, p) => setPage(p + 1)} rowsPerPageOptions={[10, 25, 50, 100]}
            onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} />
        </Paper>
      )}
    </>
  );
}
