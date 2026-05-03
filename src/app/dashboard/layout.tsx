import { DashboardSidebar } from '@/components/dashboard/sidebar';
import { UserChip } from '@/components/dashboard/user-chip';
import { Toaster } from '@/components/ui/sonner';
import { requireUser } from '@/lib/auth';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();

  return (
    <div className="flex min-h-screen bg-[#0a0a0f] text-white">
      <aside className="hidden w-60 shrink-0 border-r border-[#1a1a2e] md:block">
        <DashboardSidebar />
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end border-b border-[#1a1a2e] px-6 py-3">
          <UserChip />
        </header>
        <main className="flex-1 p-6 md:p-10">{children}</main>
      </div>
      <Toaster theme="dark" position="bottom-right" />
    </div>
  );
}
