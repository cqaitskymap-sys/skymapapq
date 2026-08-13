import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-md w-full text-center space-y-4">
        <h1 className="text-6xl font-bold text-blue-600">404</h1>
        <h2 className="text-xl font-semibold">Page Not Found</h2>
        <p className="text-muted-foreground text-sm">
          The page you are looking for does not exist or has been moved.
        </p>
        <Button asChild className="bg-blue-600 hover:bg-blue-700">
          <Link href="/launcher">Return to Launcher</Link>
        </Button>
      </div>
    </div>
  );
}
