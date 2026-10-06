import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { homeFor } from '../../components/ProtectedRoute.jsx';
import { Button, Field, Alert } from '../../components/ui.jsx';
import { GoogleButton } from './GoogleButton.jsx';

export const Login = () => {
  const { signIn } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const [form, setForm] = useState({ email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // The OAuth callback redirects here with ?error=... when Google sign-in
  // fails or is cancelled.
  const oauthError = params.get('error');

  const update = (key) => (event) => {
    setForm((f) => ({ ...f, [key]: event.target.value }));
    setError(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const user = await signIn(form);
      toast.success(`Welcome back, ${user.name.split(' ')[0]}`);
      // Return them to wherever the guard interrupted, if anywhere.
      navigate(location.state?.from ?? homeFor(user.role), { replace: true });
    } catch (err) {
      setError(err.userMessage ?? 'Could not sign you in.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="animate-slide-up">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
        Sign in
      </h1>
      <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
        New here?{' '}
        <Link to="/register" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
          Create an account
        </Link>
      </p>

      {oauthError && (
        <Alert tone="red" className="mt-5">
          {oauthError}
        </Alert>
      )}

      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
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

        <Field label="Password" htmlFor="password" required>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="input"
            placeholder="••••••••"
            value={form.password}
            onChange={update('password')}
            required
          />
        </Field>

        {error && (
          <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <Button type="submit" loading={submitting} className="w-full" size="lg">
          Sign in
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        <span className="text-xs font-medium text-slate-400 uppercase">or</span>
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      </div>

      <GoogleButton label="Continue with Google" />
    </div>
  );
};

export default Login;
