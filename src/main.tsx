import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { DialogProvider } from './components/ui/DialogProvider';
import { applyTheme, getStoredTheme } from './utils/theme';
import { registerServiceWorker } from './utils/pwa';

// Áp giao diện đã chọn trước khi vẽ để không bị nháy sáng→tối
applyTheme(getStoredTheme());

registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <DialogProvider>
    <App />
  </DialogProvider>
);
