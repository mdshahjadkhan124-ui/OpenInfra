/** Public landing page. */
import { Link } from 'react-router-dom';
import { Button, Card } from '../../components/ui.jsx';

const STEPS = [
  {
    n: '01',
    title: 'A citizen reports',
    body: 'Photo, location, description. Our AI confirms it is genuinely public infrastructure, or explains why it is not.',
  },
  {
    n: '02',
    title: 'AI prices the repair',
    body: 'A plausible cost range from the photograph, with its assumptions stated — the benchmark every bid is judged against.',
  },
  {
    n: '03',
    title: 'Contractors bid',
    body: 'Any bid more than 20% above the upper bound is flagged automatically, in red, for the reviewing official.',
  },
  {
    n: '04',
    title: 'Funds are escrowed',
    body: 'The agreed amount is locked in an Ethereum contract. Not even the administrator can withdraw it.',
  },
  {
    n: '05',
    title: 'Paid per verified stage',
    body: 'The contractor photographs each stage, AI checks it against the original, an official approves, the contract pays.',
  },
  {
    n: '06',
    title: 'Anyone can check',
    body: 'Every payment is a public transaction. You do not have to trust us — the ledger is not ours to edit.',
  },
];

export const Landing = () => (
  <>
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-accent-50 dark:from-brand-950/40 dark:via-slate-950 dark:to-accent-950/30" />
      <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/70 px-3 py-1 text-xs font-semibold text-brand-800 backdrop-blur dark:border-brand-800 dark:bg-slate-900/70 dark:text-brand-300">
            <span className="h-1.5 w-1.5 animate-pulse-ring rounded-full bg-brand-500" />
            Live on Ethereum Sepolia
          </span>

          <h1 className="mt-5 text-4xl leading-[1.08] font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl dark:text-white">
            Public money,{' '}
            <span className="bg-gradient-to-r from-brand-600 to-accent-600 bg-clip-text text-transparent">
              publicly accounted for
            </span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-300">
            Report a pothole with a photo. Watch an AI price the repair, see every contractor bid
            measured against it, and follow the exact Ethereum transaction that paid to fix it.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button as={Link} to="/register" size="lg">
              Report a problem
            </Button>
            <Button as={Link} to="/transparency" variant="secondary" size="lg">
              See the money trail
            </Button>
          </div>
        </div>
      </div>
    </section>

    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
      <div className="max-w-2xl">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
          How a pothole becomes a verified payment
        </h2>
        <p className="mt-3 text-slate-600 dark:text-slate-400">
          Six steps, each one recorded. The interesting part is that none of them require trusting
          this platform.
        </p>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((step) => (
          <Card key={step.n} hover className="p-5">
            <span className="font-mono text-xs font-bold text-brand-600 dark:text-brand-400">
              {step.n}
            </span>
            <h3 className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100">
              {step.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              {step.body}
            </p>
          </Card>
        ))}
      </div>
    </section>

    <section className="border-y border-slate-200 bg-white py-16 dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
              The guarantee is in the contract, not the promise
            </h2>
            <div className="mt-5 space-y-4 text-slate-600 dark:text-slate-400">
              <p>
                <strong className="text-slate-900 dark:text-slate-100">
                  The administrator cannot withdraw.
                </strong>{' '}
                There is no withdraw, sweep or refund function in the escrow contract. Once funds
                are locked, the only way out is a milestone payment to the awarded contractor.
              </p>
              <p>
                <strong className="text-slate-900 dark:text-slate-100">
                  A milestone cannot be paid twice.
                </strong>{' '}
                Enforced on-chain, not in application code — a duplicate request reverts.
              </p>
              <p>
                <strong className="text-slate-900 dark:text-slate-100">
                  Every approval is signed by a person.
                </strong>{' '}
                The server holds no private key. Each payment is signed in an official&rsquo;s own
                wallet, so the on-chain record names who approved it.
              </p>
            </div>
          </div>

          <Card className="p-6">
            <p className="text-xs font-bold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              What a citizen receives
            </p>
            <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-900 dark:bg-brand-950/40">
              <p className="text-sm font-semibold text-brand-900 dark:text-brand-100">
                Stage 1 verified and paid
              </p>
              <p className="mt-2 text-2xl font-bold text-brand-800 dark:text-brand-200">
                0.0012 ETH
              </p>
              <p className="mt-3 text-xs leading-relaxed text-brand-800/80 dark:text-brand-300/80">
                You do not have to take our word for it — this record is public and we cannot alter
                it.
              </p>
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white">
                View the transaction on Etherscan
              </span>
            </div>
            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              An email like this goes to the person who reported the problem, every time a stage is
              paid.
            </p>
          </Card>
        </div>
      </div>
    </section>

    <section className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6">
      <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
        Seen something broken?
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-slate-600 dark:text-slate-400">
        It takes a photo and about thirty seconds. You will be told what the repair should cost
        before an official even sees it.
      </p>
      <Button as={Link} to="/register" size="lg" className="mt-7">
        Report a problem
      </Button>
    </section>
  </>
);

export default Landing;
