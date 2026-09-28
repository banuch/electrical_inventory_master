import { createTheme } from '@mui/material';

// Restrained, high-contrast palette suited to office / industrial use; system fonts keep payloads small.
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1f3a5f', light: '#3d5a80', dark: '#132640' },
    secondary: { main: '#f2a900' },
    background: { default: '#f4f6f8', paper: '#ffffff' },
    success: { main: '#2e7d32' },
    warning: { main: '#b26a00' },
    error: { main: '#c62828' },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    h5: { fontSize: '1.4rem' },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiAppBar: { styleOverrides: { root: { backgroundColor: '#1f3a5f' } } },
    MuiTableCell: { styleOverrides: { head: { backgroundColor: '#f0f3f7' } } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiButton: { defaultProps: { disableElevation: true } },
  },
});
