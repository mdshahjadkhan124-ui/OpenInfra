/** Formatting helpers. Deliberately tolerant of missing data. */

export const money = (amount, currency = 'INR') => {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '—';
  return `${currency} ${Number(amount).toLocaleString('en-IN')}`;
};

export const compactMoney = (amount, currency = 'INR') => {
  if (amount === null || amount === undefined) return '—';
  const n = Number(amount);
  if (n >= 1e7) return `${currency} ${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${currency} ${(n / 1e5).toFixed(2)} L`;
  return money(n, currency);
};

/**
 * Wei to ETH using BigInt throughout.
 *
 * Number cannot hold 1e18 safely, so dividing a wei figure as a float quietly
 * loses precision on exactly the values that matter.
 */
export const formatEth = (wei, decimals = 5) => {
  if (wei === null || wei === undefined || wei === '') return '—';
  try {
    const value = BigInt(wei);
    const whole = value / 10n ** 18n;
    const frac = (value % 10n ** 18n).toString().padStart(18, '0').slice(0, decimals).replace(/0+$/, '');
    return `${whole}${frac ? `.${frac}` : ''} ETH`;
  } catch {
    return '—';
  }
};

export const shortAddress = (address, size = 4) =>
  !address ? '—' : `${address.slice(0, 2 + size)}…${address.slice(-size)}`;

export const shortHash = (hash) => (!hash ? '—' : `${hash.slice(0, 10)}…${hash.slice(-8)}`);

export const formatDate = (value, withTime = false) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
};

export const timeAgo = (value) => {
  if (!value) return '—';
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, secs] of units) {
    const n = Math.floor(seconds / secs);
    if (n >= 1) return `${n} ${unit}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
};

export const percent = (value) =>
  value === null || value === undefined ? '—' : `${Number(value).toFixed(0)}%`;

export const confidencePercent = (value) =>
  value === null || value === undefined ? '—' : `${Math.round(Number(value) * 100)}%`;
