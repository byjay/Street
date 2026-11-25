import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Mandatory Google Maps Demo Key Tier 1 Quota Detection
(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};

const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  origConsoleError.apply(console, args);
  const msg = args.map((a) => String(a)).join(' ');
  if (
    msg.includes('OverQuotaMapError') ||
    msg.includes('QuotaExceededError') ||
    msg.includes('OVER_QUERY_LIMIT')
  ) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
  if (
    msg.includes('BillingNotEnabledMapError') ||
    msg.includes('must enable Billing')
  ) {
    window.dispatchEvent(new CustomEvent('gmp-billing-required'));
  }
};

createRoot(document.getElementById('root')!).render(<App />);
