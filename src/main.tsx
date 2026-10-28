import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { DialogProvider } from './components/ui/DialogProvider';
import { applyTheme, getStoredTheme } from './utils/theme';

// Áp giao diện đã chọn trước khi vẽ để không bị nháy sáng→tối
applyTheme(getStoredTheme());

createRoot(document.getElementById('root')!).render(
  <DialogProvider>
    <App />
  </DialogProvider>
);
