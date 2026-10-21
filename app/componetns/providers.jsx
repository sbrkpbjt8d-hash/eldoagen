
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { pb } from '../lib/pocketbase';
import { isFactoryAdmin } from '../lib/deleted-records';

function AuthGuard({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(pathname === '/login');

  useEffect(() => {
    if (pathname === '/login') {
      setReady(true);
      return undefined;
    }

    const adminOnly = ['/reports', '/poultry/reports', '/moashe/deleted'];
    if (adminOnly.includes(pathname) && !isFactoryAdmin()) {
      router.replace('/login');
      return undefined;
    }

    if (!pb.authStore.isValid) {
      router.replace('/login');
      return undefined;
    }

    setReady(true);
    return pb.authStore.onChange(() => {
      if (!pb.authStore.isValid) router.replace('/login');
    });
  }, [pathname, router]);

  return ready ? children : null;
}

export default function Providers({ children }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
      },
    },
  }));

  return <QueryClientProvider client={queryClient}><AuthGuard>{children}</AuthGuard></QueryClientProvider>;
}