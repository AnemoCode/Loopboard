import { Link } from 'react-router';
import { Button } from '../components/ui';

export function NotFoundPage({ title = 'Page not found', message = "The page you're looking for doesn't exist." }: { title?: string; message?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold text-app">{title}</h1>
      <p className="mt-2 text-sm text-muted">{message}</p>
      <Link to="/" className="mt-6">
        <Button variant="primary">Back to projects</Button>
      </Link>
    </div>
  );
}
