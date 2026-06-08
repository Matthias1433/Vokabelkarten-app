import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// Vollbild + Standard-Margin entfernen, damit die App die ganze Höhe nutzt
const reset = document.createElement('style');
reset.textContent = 'html,body,#root{height:100%;margin:0}';
document.head.appendChild(reset);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
