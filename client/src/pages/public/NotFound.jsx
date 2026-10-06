import { Link } from 'react-router-dom';
import { Button } from '../../components/ui.jsx';

export const NotFound = () => (
  <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
    <p className="font-mono text-5xl font-bold text-brand-600 dark:text-brand-400">404</p>
    <h1 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">Page not found</h1>
    <p className="mt-2 max-w-sm text-sm text-slate-500 dark:text-slate-400">
      That link does not lead anywhere. It may have moved, or never existed.
    </p>
    <Button as={Link} to="/" className="mt-6">
      Back to home
    </Button>
  </div>
);

export default NotFound;
