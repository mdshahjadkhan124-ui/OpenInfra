/**
 * Public transparency dashboard — placeholder.
 *
 * Phase 10 builds this out properly as the showpiece. It needs unauthenticated
 * /api/public endpoints, which do not exist yet; the page is routed now so
 * every "see the money trail" link in the app and in the emails already
 * resolves rather than 404ing.
 */
import { Link } from 'react-router-dom';
import { Card, Button, Alert, EtherscanLink } from '../../components/ui.jsx';
import { CONTRACT_ADDRESS } from '../../lib/constants.js';

export const Transparency = () => (
  <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
      Transparency dashboard
    </h1>
    <p className="mt-2 text-slate-600 dark:text-slate-400">
      Every project, every bid, and every payment — no account needed.
    </p>

    <Alert tone="blue" title="Being built next" className="mt-8">
      This page is the showpiece and is the next phase of work. In the meantime the escrow
      contract is already public, and every payment made so far is visible on it.
    </Alert>

    {CONTRACT_ADDRESS && (
      <Card className="mt-5 p-5">
        <p className="text-xs font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          Escrow contract
        </p>
        <p className="mt-2 font-mono text-sm break-all text-slate-900 dark:text-slate-100">
          {CONTRACT_ADDRESS}
        </p>
        <div className="mt-3">
          <EtherscanLink
            address={CONTRACT_ADDRESS}
            label="View the contract and every transaction"
          />
        </div>
      </Card>
    )}

    <Button as={Link} to="/" variant="secondary" className="mt-6">
      Back to home
    </Button>
  </div>
);

export default Transparency;
