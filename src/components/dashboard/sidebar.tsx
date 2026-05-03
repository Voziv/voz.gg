'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, User, Server } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: Home, exact: true },
  { href: '/dashboard/profile', label: 'Profile', icon: User, exact: false },
  { href: '/dashboard/servers', label: 'Servers', icon: Server, exact: false },
];

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-4">
      <Link
        href="/"
        className="mb-6 flex items-center gap-2 px-2 py-1 text-2xl font-bold tracking-tight text-white"
        style={{ textShadow: '0 0 24px rgba(0,229,255,0.35)' }}
      >
        voz.gg
      </Link>
      {NAV.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-[#00e5ff]/10 text-[#00e5ff] ring-1 ring-[#00e5ff]/30'
                : 'text-white/60 hover:bg-white/5 hover:text-white',
            )}
          >
            <Icon size={16} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
