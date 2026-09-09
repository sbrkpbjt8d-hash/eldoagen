'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { pb } from '../lib/pocketbase';

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState(() => pb.authStore.model?.email || '');
  const [userName, setUserName] = useState(
    () => pb.authStore.model?.name || pb.authStore.model?.username || pb.authStore.model?.email?.split('@')[0] || 'مستخدم'
  );

  useEffect(() => {
    const unsubscribe = pb.authStore.onChange(() => {
      const updatedUser = pb.authStore.model;
      setUserEmail(updatedUser?.email || '');
      setUserName(updatedUser?.name || updatedUser?.username || updatedUser?.email?.split('@')[0] || 'مستخدم');
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  const isAhmed = userEmail === 'ahmed@gmail.com';

  const isPoultryPath = pathname.startsWith('/poultry');
  const isLivestockPath = pathname === '/reports' || pathname.startsWith('/moashe') || pathname === '/purchase-invoices';
  const [openRaw, setOpenRaw] = useState(isLivestockPath);
  const [openPoultry, setOpenPoultry] = useState(isPoultryPath);
  
  const navLinkClass = href => `flex items-center rounded-xl border px-3 py-2.5 text-sm font-bold transition-all duration-200 ${pathname === href ? (isPoultryPath ? 'border-emerald-400/30 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-950/30' : 'border-blue-400/30 bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-950/30') : 'border-transparent text-slate-300 hover:border-slate-600 hover:bg-slate-800/80 hover:text-white'}`;

  if (pathname === '/login') return null;

  return (
    <aside className="sticky top-0 flex h-screen w-72 shrink-0 flex-col overflow-hidden border-l border-slate-800 bg-slate-950 text-slate-300 shadow-[0_0_40px_rgba(15,23,42,0.8)]" dir="rtl">
      <div className="mb-5 border-b border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-4">
        {/* <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/25 to-cyan-400/20 text-xl ring-1 ring-blue-400/30">🏭</span>
          <div>
            <p className="text-base font-black tracking-wide text-white">Factory ERP</p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Management system</p>
          </div>
        </div> */}
        <div className="mt-4 flex items-center gap-2 text-[11px] font-bold text-emerald-400">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
          النظام يعمل
        </div>
      </div>

      <nav className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3">
        {/* لو المستخدم هو أحمد، اعرض له زرار الخزنة فقط وامنع الباقي */}
        {isAhmed ? (
          <div className="space-y-1">
            <Link href="/moashe/Treasury" className={navLinkClass('/moashe/Treasury')}>
              الخزنه (Treasury )
            </Link>
          </div>
        ) : (
          /* باقي القائمة تظهر للمستخدمين العاديين أو المديرين */
          <div>
            <button
              onClick={() => setOpenRaw(!openRaw)}
              aria-expanded={openRaw}
              className={`w-full flex items-center justify-between rounded-2xl border p-3 text-base font-bold text-white transition-all ${isLivestockPath ? 'border-blue-400/30 bg-blue-500/10' : 'border-transparent bg-slate-900/60 hover:border-blue-400/25 hover:bg-slate-800/90'}`}
            >
              <span>الدواجن(Livestock)</span>
              <span className={`text-sm transition-transform duration-200 ${openRaw ? 'rotate-180' : ''}`}>▼</span>
            </button>

            {openRaw && (
              <div className="mr-3 mt-2 space-y-1 border-r-2 border-blue-500/70 pr-3">
                <Link href="/moashe/khamatMoashe" className={navLinkClass('/moashe/khamatMoashe')}>الخامات </Link>
                <Link href="/moashe/products" className={navLinkClass('/moashe/products')}>المنتجات </Link>
                <Link href="/moashe/orders" className={navLinkClass('/moashe/orders')}>امر تصنيع</Link>
                                <Link href="/moashe/products-stock" className={navLinkClass('/moashe/products-stock')}>مخزن المنتجات</Link>
                <Link href="/purchase-invoices" className={navLinkClass('/purchase-invoices')}>فواتير الشراء </Link>

                <Link href="/moashe/sales_invoices" className={navLinkClass('/moashe/sales_invoices')}>فواتير البيع </Link>
                <Link href="/moashe/clientsmoashe" className={navLinkClass('/moashe/clientsmoashe')}>العملاء </Link>
                                <Link href="/moashe/suppliers" className={navLinkClass('/moashe/suppliers')}>الموردين </Link>


                                <Link href="/moashe/expenses" className={navLinkClass('/moashe/expenses')}>المصروفات </Link>
                <Link href="/moashe/Treasury" className={navLinkClass('/moashe/Treasury')}>الخزنه </Link>
                <Link href="/moashe/banks" className={navLinkClass('/moashe/banks')}>البنوك </Link>
                <Link href="/moashe/salaires" className={navLinkClass('/moashe/salaires')}>المرتبات </Link>
                                <Link href="/moashe/other-accounts" className={navLinkClass('/moashe/other-accounts')}>عهده</Link>
                                                <Link href="/moashe/manadeb" className={navLinkClass('/moashe/manadeb')}>المناديب </Link>
                <Link href="/moashe/price" className={navLinkClass('/moashe/price')}>الاسعار </Link>
              </div>
            )}
          </div>
        )}
      </nav>

      <div className="border-t border-slate-800 bg-slate-950/90 px-3 pb-4 pt-4">
        {/* خانة معلومات المستخدم الحالي */}
        <div className="mb-3 rounded-xl bg-slate-900/80 p-2.5 border border-slate-800/80 flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600/20 text-blue-400 font-black text-sm border border-blue-500/30">
            {userName.charAt(0).toUpperCase()}
          </div>
          <div className="overflow-hidden">
            <p className="text-xs font-bold text-white truncate">{userName}</p>
            <p className="text-[10px] text-slate-400 truncate" title={userEmail}>{userEmail || 'لا يوجد بريد'}</p>
          </div>
        </div>

        <p className="text-center text-[10px] font-bold tracking-[0.12em] text-slate-500">Factory ERP v1.0</p>
        
        <button
          onClick={() => {
            pb.authStore.clear();
            router.replace('/login');
          }}
          className="mt-3 block w-full rounded-xl border border-slate-700 bg-slate-900 p-2.5 font-bold text-slate-300 transition hover:border-red-400/40 hover:bg-red-600 hover:text-white text-xs"
        >
          تسجيل الخروج
        </button>
      </div>
    </aside>
  );
}