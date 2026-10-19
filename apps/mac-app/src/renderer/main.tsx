import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { reportRendererErrors } from './lib/ipc';
import './styles.css';

reportRendererErrors();

const root = document.getElementById('root');
if (!root) throw new Error('thiếu #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
