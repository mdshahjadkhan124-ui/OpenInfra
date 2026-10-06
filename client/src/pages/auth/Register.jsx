import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { homeFor } from '../../components/ProtectedRoute.jsx';
import { Button, Field, cx } from '../../components/ui.jsx';
import { ROLES } from '../../lib/constants.js';
import { GoogleButton } from './GoogleButton.jsx';

/**
 * Only citizen and contractor are offered.
 *
 * Admin is not self-assignable — the server rejects it — so showing it here
 * would be an invitation to a 422. The first admin is created with
 * `npm run create-admin`.
 */
const ROLE_OPTIONS = [
  {
    value: ROLES.CITIZEN,
    label: 'Citizen',
    blurb: 'Report problems and follow the money that fixes them.',
    icon: '📍',
  },
  {
    value: ROLES.CONTRACTOR,
    label: 'Contractor',
    blurb: 'Bid for public works and get paid per verified stage.',
    icon: '🔧',
  },
];

export const Register = () => {
  const { signUp } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: ROLES.CITIZEN,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const update = (key) => (event) => {
    setForm((f) => ({ ...f, [key]: event.target.value }));
    setError(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const user = await signUp(form);
      toast.success('Account created', `Welcome to OpenInfra, ${user.name.split(' ')[0]}.`);
      navigate(homeFor(user.role), { replace: true });
    } catch (err) {
      setError(err.userMessage ?? 'Could not create your account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="animate-slide-up">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
        Create an account
      </h1>
      <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
        Already registered?{' '}
        <Link to="/login" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
          Sign in
        </Link>
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <Field label="I am a" required>
          <div className="grid grid-cols-2 gap-2">
            {ROLE_OPTIONS.map((option) => {
              const selected = form.role === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, role: option.value }))}
                  aria-pressed={selected}
                  className={cx(
                    'rounded-xl border p-3 text-left transition-all',
                    selected
                      ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20 dark:border-brand-600 dark:bg-brand-950/50'
                      : 'border-slate-300 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-600'
                  )}
                >
                  <span className="text-lg">{option.icon}</span>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {option.label}
                  </p>
                  <p className="mt-0.5 text-xs leading-snug text-slate-500 dark:text-slate-400">
                    {option.blurb}
                  </p>
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Full name" htmlFor="name" required>
          <input
            id="name"
            type="text"
            autoComplete="name"
            className="input"
            placeholder="Asha Sharma"
            value={form.name}
            onChange={update('name')}
            required
            minLength={2}
          />
        </Field>

        <Field label="Email" htmlFor="email" required>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="input"
            placeholder="you@example.com"
            value={form.email}
            onChange={update('email')}
            required
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          required
          hint="At least 8 characters, with a letter and a number."
        >
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            className="input"
            placeholder="••••••••"
            value={form.password}
            onChange={update('password')}
            required
            minLength={8}
          />
        </Field>

        {error && (
          <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <Button type="submit" loading={submitting} className="w-full" size="lg">
          Create account
        </Button>

        {form.role === ROLES.CONTRACTOR && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            You will be asked to connect a wallet before bidding — milestone payments are
            released to it on-chain.
          </p>
        )}
      </form>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        <span className="text-xs font-medium text-slate-400 uppercase">or</span>
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      </div>

      {/* The chosen role rides along in the OAuth state parameter. */}
      <GoogleButton label={`Sign up as ${form.role} with Google`} role={form.role} />
    </div>
  );
};

export default Register;
