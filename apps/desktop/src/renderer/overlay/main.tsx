import React from 'react';
import ReactDOM from 'react-dom/client';
import { OverlayApp } from './OverlayApp';
import '../globals.css';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <OverlayApp />
    </React.StrictMode>,
  );
}
