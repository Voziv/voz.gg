import { cn } from '@/lib/utils';

export function ErrorBanner({
  kind,
  children,
}: {
  kind: 'error' | 'success';
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        kind === 'error'
          ? 'border-red-500/30 bg-red-500/10 text-red-300'
          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
      )}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}
