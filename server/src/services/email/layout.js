/**
 * Email layout.
 *
 * Table-based with inline styles, because that is still what email clients
 * reliably render — Gmail strips <style> blocks in some contexts, Outlook uses
 * Word's rendering engine, and flexbox is unusable. Every template therefore
 * composes from the small set of builders here rather than writing its own
 * markup, so one fix propagates everywhere.
 *
 * Each template returns BOTH html and text. The plain-text alternative is not
 * decoration: a message with no text part is markedly more likely to be
 * filtered as spam, and it is the version screen readers and watch
 * notifications show.
 */
import { config } from '../../config/env.js';

const BRAND = {
  primary: '#0f766e', // teal-700
  primaryDark: '#115e59',
  accent: '#0369a1', // sky-700
  ink: '#1f2937',
  muted: '#6b7280',
  border: '#e5e7eb',
  bg: '#f3f4f6',
  card: '#ffffff',
  green: '#047857',
  red: '#b91c1c',
  amber: '#b45309',
};

export const STATUS_COLOUR = {
  success: BRAND.green,
  danger: BRAND.red,
  warning: BRAND.amber,
  info: BRAND.accent,
  neutral: BRAND.muted,
};

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Format a money amount for display, or a dash when absent. */
export const money = (amount, currency) => {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '—';
  return `${currency ? `${currency} ` : ''}${Number(amount).toLocaleString('en-IN')}`;
};

/** Wei to a short ETH string, for on-chain amounts. */
export const eth = (wei) => {
  if (wei === null || wei === undefined) return '—';
  try {
    const value = BigInt(wei);
    const whole = value / 10n ** 18n;
    const frac = (value % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '').slice(0, 6);
    return `${whole}${frac ? `.${frac}` : ''} ETH`;
  } catch {
    return '—';
  }
};

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

export const paragraph = (text) =>
  `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${BRAND.ink};">${esc(text)}</p>`;

/** A paragraph that may contain pre-built, already-escaped inline HTML. */
export const paragraphRaw = (html) =>
  `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${BRAND.ink};">${html}</p>`;

export const heading = (text) =>
  `<h2 style="margin:0 0 12px;font-size:19px;line-height:1.35;font-weight:600;color:${BRAND.ink};">${esc(text)}</h2>`;

export const badge = (text, tone = 'neutral') => {
  const colour = STATUS_COLOUR[tone] ?? BRAND.muted;
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${colour}1a;color:${colour};font-size:12px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;">${esc(text)}</span>`;
};

/** Key/value facts. The workhorse of almost every template. */
export const factTable = (rows) => {
  const body = rows
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 12px 8px 0;font-size:13px;color:${BRAND.muted};vertical-align:top;white-space:nowrap;">${esc(label)}</td>
          <td style="padding:8px 0;font-size:14px;color:${BRAND.ink};font-weight:500;vertical-align:top;">${esc(value)}</td>
        </tr>`
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;">${body}</table>`;
};

export const button = (label, href, tone = 'primary') => {
  const bg = tone === 'primary' ? BRAND.primary : BRAND.accent;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr><td style="border-radius:8px;background:${bg};">
        <a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(label)}</a>
      </td></tr>
    </table>`;
};

/** A quote block, used for AI assessments and rejection reasons. */
export const quote = (text) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;">
     <tr><td style="padding:14px 16px;background:${BRAND.bg};border-left:3px solid ${BRAND.primary};border-radius:0 6px 6px 0;font-size:14px;line-height:1.6;color:${BRAND.ink};">${esc(text)}</td></tr>
   </table>`;

export const bullets = (items) => {
  if (!items?.length) return '';
  const lis = items
    .map(
      (item) =>
        `<li style="margin:0 0 6px;font-size:14px;line-height:1.55;color:${BRAND.ink};">${esc(item)}</li>`
    )
    .join('');
  return `<ul style="margin:0 0 20px;padding-left:20px;">${lis}</ul>`;
};

/**
 * The on-chain proof block.
 *
 * Deliberately prominent and deliberately worded as an invitation to verify
 * independently: a transparency platform asserting "we paid them" is worth
 * little, while a link to a public ledger the platform does not control is
 * the actual claim.
 */
export const onChainProof = ({ transactionHash, explorerUrl, amount, note }) => {
  if (!transactionHash && !explorerUrl) return '';
  const short = transactionHash
    ? `${String(transactionHash).slice(0, 10)}…${String(transactionHash).slice(-8)}`
    : '';

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;border-collapse:separate;">
      <tr><td style="padding:18px 20px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:10px;">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.primaryDark};margin:0 0 8px;">Verified on the public blockchain</div>
        ${note ? `<div style="font-size:14px;line-height:1.6;color:${BRAND.ink};margin:0 0 10px;">${esc(note)}</div>` : ''}
        ${amount ? `<div style="font-size:20px;font-weight:700;color:${BRAND.primaryDark};margin:0 0 10px;">${esc(amount)}</div>` : ''}
        ${short ? `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:${BRAND.muted};margin:0 0 12px;word-break:break-all;">${esc(short)}</div>` : ''}
        ${explorerUrl ? `<a href="${esc(explorerUrl)}" style="display:inline-block;padding:10px 18px;background:${BRAND.primary};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:7px;">View the transaction on Etherscan</a>` : ''}
        <div style="font-size:12px;line-height:1.5;color:${BRAND.muted};margin:12px 0 0;">You do not have to take our word for it — this record is public and we cannot alter it.</div>
      </td></tr>
    </table>`;
};

// ---------------------------------------------------------------------------
// Document wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap body HTML in the full email document.
 *
 * `preheader` is the grey snippet inbox lists show next to the subject. Left
 * empty, clients scrape the first visible text, which is usually "Hello Asha".
 */
export const wrap = ({ title, preheader, body, footerNote }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader ?? '')}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:${BRAND.bg};">
    <tr><td align="center" style="padding:28px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:580px;">

        <tr><td style="padding:0 0 18px;">
          <span style="font-size:17px;font-weight:700;color:${BRAND.primaryDark};letter-spacing:-0.01em;">OpenInfra</span>
          <span style="font-size:13px;color:${BRAND.muted};"> · civic infrastructure transparency</span>
        </td></tr>

        <tr><td style="padding:28px 28px 8px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:12px;">
          ${body}
        </td></tr>

        <tr><td style="padding:18px 4px 0;font-size:12px;line-height:1.6;color:${BRAND.muted};">
          ${footerNote ? `<div style="margin:0 0 8px;">${esc(footerNote)}</div>` : ''}
          <div>This is an automated message from OpenInfra. Every project and payment is
          publicly auditable at <a href="${esc(config.clientUrl)}/transparency" style="color:${BRAND.accent};">the transparency dashboard</a>.</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Plain-text helpers
// ---------------------------------------------------------------------------

export const textBlock = (lines) =>
  lines
    .filter((l) => l !== null && l !== undefined && l !== false)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const textFacts = (rows) =>
  rows
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => `  ${label}: ${value}`)
    .join('\n');

export const TEXT_FOOTER = `
---
OpenInfra — civic infrastructure transparency
Every project and payment is publicly auditable: ${config.clientUrl}/transparency`;

export { BRAND };
