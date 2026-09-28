import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar, Box, Divider, Drawer, IconButton, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText,
  ListSubheader, Menu, MenuItem, TextField, Toolbar, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import SearchIcon from '@mui/icons-material/Search';
import DashboardIcon from '@mui/icons-material/SpaceDashboardOutlined';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import WarehouseIcon from '@mui/icons-material/WarehouseOutlined';
import ReceiptIcon from '@mui/icons-material/MoveToInboxOutlined';
import OutboxIcon from '@mui/icons-material/OutboxOutlined';
import UndoIcon from '@mui/icons-material/AssignmentReturnOutlined';
import TuneIcon from '@mui/icons-material/TuneOutlined';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweepOutlined';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAddOutlined';
import ArticleIcon from '@mui/icons-material/ArticleOutlined';
import CategoryIcon from '@mui/icons-material/CategoryOutlined';
import StraightenIcon from '@mui/icons-material/StraightenOutlined';
import ElectricBoltIcon from '@mui/icons-material/ElectricBolt';
import LocationCityIcon from '@mui/icons-material/LocationCityOutlined';
import PeopleIcon from '@mui/icons-material/PeopleOutlined';
import AdminPanelIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import HistoryIcon from '@mui/icons-material/ManageHistoryOutlined';
import FactCheckIcon from '@mui/icons-material/FactCheckOutlined';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import AccountCircle from '@mui/icons-material/AccountCircleOutlined';
import { useAuth } from '../lib/auth';

const DRAWER = 248;

interface NavItem { to: string; label: string; icon: ReactNode; perm?: string | string[] }
interface NavGroup { title?: string; items: NavItem[] }

const NAV: NavGroup[] = [
  { items: [
    { to: '/', label: 'Dashboard', icon: <DashboardIcon /> },
    { to: '/search', label: 'Find Stock (All Substations)', icon: <TravelExploreIcon /> },
    { to: '/inventory', label: 'My Substation Inventory', icon: <WarehouseIcon /> },
  ] },
  { title: 'Stock Operations', items: [
    { to: '/stock/new/receipt', label: 'Receive Material', icon: <ReceiptIcon />, perm: 'stock.receive' },
    { to: '/stock/new/issue', label: 'Issue Material', icon: <OutboxIcon />, perm: 'stock.issue' },
    { to: '/stock/new/return', label: 'Return Material', icon: <UndoIcon />, perm: 'stock.return' },
    { to: '/stock/new/adjustment', label: 'Stock Adjustment', icon: <TuneIcon />, perm: 'stock.adjust' },
    { to: '/stock/new/scrap', label: 'Damage / Scrap', icon: <DeleteSweepIcon />, perm: 'stock.scrap' },
    { to: '/stock/new/opening', label: 'Opening Stock', icon: <PlaylistAddIcon />, perm: 'stock.opening' },
    { to: '/stock/documents', label: 'Stock Documents', icon: <ArticleIcon /> },
  ] },
  { title: 'Reports', items: [
    { to: '/reports', label: 'Reports & Exports', icon: <DownloadIcon />, perm: 'reports.export' },
    { to: '/audit', label: 'Audit Log', icon: <HistoryIcon />, perm: 'audit.view' },
  ] },
  { title: 'Master Data', items: [
    { to: '/master/items', label: 'Item Master', icon: <ElectricBoltIcon /> },
    { to: '/master/categories', label: 'Categories', icon: <CategoryIcon />, perm: 'master.items' },
    { to: '/master/units', label: 'Units', icon: <StraightenIcon />, perm: 'master.items' },
    { to: '/master/substations', label: 'Substations', icon: <LocationCityIcon /> },
  ] },
  { title: 'Administration', items: [
    { to: '/admin/users', label: 'Users', icon: <PeopleIcon />, perm: 'admin.users' },
    { to: '/admin/roles', label: 'Roles & Permissions', icon: <AdminPanelIcon />, perm: 'admin.users' },
    { to: '/admin/reconciliation', label: 'Reconciliation', icon: <FactCheckIcon />, perm: 'admin.reconcile' },
  ] },
];

export default function Layout() {
  const { me, can, logout, substationId, setSubstationId } = useAuth();
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('lg'));
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  const allowed = (i: NavItem) => !i.perm || (Array.isArray(i.perm) ? i.perm.every(can) : can(i.perm));
  const current = me?.substations.find((s) => s.id === substationId);

  const drawer = (
    <Box sx={{ overflowY: 'auto' }} onClick={() => !desktop && setOpen(false)}>
      <Toolbar />
      {NAV.map((g, gi) => {
        const items = g.items.filter(allowed);
        if (!items.length) return null;
        return (
          <List key={gi} dense subheader={g.title ? <ListSubheader sx={{ lineHeight: '32px', bgcolor: 'transparent' }}>{g.title}</ListSubheader> : undefined}>
            {items.map((i) => (
              <ListItemButton key={i.to} component={NavLink} to={i.to} end={i.to === '/'}
                sx={{ mx: 1, borderRadius: 1, '&.active': { bgcolor: 'action.selected', fontWeight: 600, '& .MuiListItemIcon-root': { color: 'primary.main' } } }}>
                <ListItemIcon sx={{ minWidth: 36 }}>{i.icon}</ListItemIcon>
                <ListItemText primary={i.label} />
              </ListItemButton>
            ))}
          </List>
        );
      })}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" elevation={0} sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 1.5 }}>
          {!desktop && <IconButton color="inherit" edge="start" onClick={() => setOpen(!open)} aria-label="Open navigation"><MenuIcon /></IconButton>}
          <ElectricBoltIcon sx={{ color: 'secondary.main', display: { xs: 'none', sm: 'block' } }} />
          <Typography variant="h6" noWrap sx={{ fontWeight: 600, display: { xs: 'none', md: 'block' } }}>CMG Electrical Inventory</Typography>
          <IconButton color="inherit" component={NavLink} to="/search" aria-label="Find stock" sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
            <SearchIcon />
          </IconButton>
          <Box sx={{ flex: 1, display: { xs: 'block', sm: 'none' } }} />
          <Box component="form" sx={{ flex: 1, maxWidth: 460, ml: { md: 2 }, display: { xs: 'none', sm: 'block' } }}
            onSubmit={(e) => { e.preventDefault(); navigate(`/search?q=${encodeURIComponent(q.trim())}`); }}>
            <TextField size="small" fullWidth placeholder="Search item code, name, rating…" value={q} onChange={(e) => setQ(e.target.value)}
              aria-label="Search inventory across all substations"
              sx={{ bgcolor: 'rgba(255,255,255,0.12)', borderRadius: 1, '& input': { color: 'common.white' }, '& fieldset': { border: 'none' } }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon sx={{ color: 'common.white' }} /></InputAdornment> } }} />
          </Box>
          {me && me.substations.length > 0 && (
            <TextField select size="small" value={substationId ?? ''} onChange={(e) => setSubstationId(Number(e.target.value))}
              aria-label="Working substation"
              sx={{ minWidth: { xs: 90, sm: 200 }, bgcolor: 'rgba(255,255,255,0.12)', borderRadius: 1, '& .MuiSelect-select, & svg': { color: 'common.white' }, '& fieldset': { border: 'none' } }}>
              {me.substations.map((s) => <MenuItem key={s.id} value={s.id}>{s.code} — {s.name}</MenuItem>)}
            </TextField>
          )}
          <Tooltip title={me?.fullName ?? ''}>
            <IconButton color="inherit" onClick={(e) => setAnchor(e.currentTarget)} aria-label="Account"><AccountCircle /></IconButton>
          </Tooltip>
          <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
            <MenuItem disabled sx={{ opacity: '1 !important', display: 'block' }}>
              <Typography variant="subtitle2">{me?.fullName}</Typography>
              <Typography variant="caption" color="text.secondary">{me?.username}{me?.orgWide ? ' · organization-wide' : current ? ` · ${current.code}` : ''}</Typography>
            </MenuItem>
            <Divider />
            <MenuItem onClick={() => { setAnchor(null); navigate('/change-password'); }}>Change password</MenuItem>
            <MenuItem onClick={async () => { setAnchor(null); await logout(); navigate('/login'); }}>Sign out</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      <Drawer variant={desktop ? 'permanent' : 'temporary'} open={desktop || open} onClose={() => setOpen(false)}
        sx={{ width: DRAWER, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER, boxSizing: 'border-box' } }}>
        {drawer}
      </Drawer>
      <Box component="main" key={location.pathname} sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 3 }, mt: 8, maxWidth: 1400 }}>
        <Outlet />
      </Box>
    </Box>
  );
}
