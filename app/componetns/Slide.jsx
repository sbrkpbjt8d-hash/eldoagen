'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { pb } from '../lib/pocketbase';
import { isFactoryAdmin } from '../lib/deleted-records';

const otherPageRoutes = ['/re', '/moashe/analytics', '/moashe/manadeb', '/moashe/spend-authorizations', '/moashe/deleted'];
const REPORT_ACCESS_PASSWORD = '01234';
const protectedPageLabels = {
  '/re': 'التقارير',
  '/moashe/analytics': 'تحليلات المصنع',
};

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [userEmail, setUserEmail] = useState(() => pb.authStore.model?.email || '');
  const [userName, setUserName] = useState(
    () => pb.authStore.model?.name || pb.authStore.model?.username || pb.authStore.model?.email?.split('@')[0] || 'مستخدم'
  );

  // حالة للتحكم في إظهار وإخفاء القائمة على الموبايل
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isReportPasswordOpen, setIsReportPasswordOpen] = useState(false);
  const [reportPassword, setReportPassword] = useState('');
  const [reportPasswordError, setReportPasswordError] = useState('');
  const [pendingProtectedRoute, setPendingProtectedRoute] = useState(null);

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
  const isOtherPagesPath = otherPageRoutes.includes(pathname);
  const isLivestockPath = pathname === '/reports' || (pathname.startsWith('/moashe') && !isOtherPagesPath) || pathname === '/purchase-invoices';
  const [menuState, setMenuState] = useState(() => ({ pathname, openRaw: isLivestockPath, openOtherPages: isOtherPagesPath }));
  const isMenuStateCurrent = menuState.pathname === pathname;
  const openRaw = isMenuStateCurrent ? menuState.openRaw : isLivestockPath;
  const openOtherPages = isMenuStateCurrent ? menuState.openOtherPages : isOtherPagesPath;
  const [openPoultry, setOpenPoultry] = useState(isPoultryPath);

  const submitReportPassword = (event) => {
    event.preventDefault();
    if (reportPassword !== REPORT_ACCESS_PASSWORD) {
      setReportPasswordError('كلمة المرور غير صحيحة.');
      return;
    }

    setIsReportPasswordOpen(false);
    setReportPassword('');
    setReportPasswordError('');
    router.push(pendingProtectedRoute);
  };

  const requestProtectedPage = (event, route) => {
    event.preventDefault();
    setPendingProtectedRoute(route);
    setReportPassword('');
    setReportPasswordError('');
    setIsReportPasswordOpen(true);
  };
  
  const navLinkClass = href => `flex items-center rounded-xl border px-3 py-2.5 text-sm font-bold transition-all duration-200 ${pathname === href ? (isPoultryPath ? 'border-emerald-400/30 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-950/30' : 'border-blue-400/30 bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-950/30') : 'border-transparent text-slate-300 hover:border-slate-600 hover:bg-slate-800/80 hover:text-white'}`;

  if (pathname === '/' || pathname === '/login') return null;

  return (
    <>
      {/* زر القائمة للموبايل (يظهر فقط على الشاشات الصغيرة) */}
      <div className="md:hidden fixed top-3 right-3 z-50">
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 border border-slate-700 text-white shadow-lg"
          aria-label="Toggle Menu"
        >
          <span className="text-xl">{isMobileOpen ? '✕' : '☰'}</span>
        </button>
      </div>

      {/* خلفية سوداء شفافة عند فتح القائمة في الموبايل */}
      {isMobileOpen && (
        <div 
          onClick={() => setIsMobileOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        />
      )}

      {/* سايدبار التنقل */}
      <aside className={`
        fixed md:sticky top-0 h-screen w-72 shrink-0 flex flex-col overflow-hidden border-l border-slate-800 bg-slate-950 text-slate-300 shadow-[0_0_40px_rgba(15,23,42,0.8)] z-50 transition-transform duration-300
        ${isMobileOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}
      `} dir="rtl">
        <div className="shrink-0 mb-2 border-b border-slate-800 bg-linear-to-br from-slate-900 via-slate-900 to-slate-950 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-400">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
              النظام يعمل
            </div>
            {/* زر إغلاق صغير للموبايل جوه السايدبار */}
            <button 
              onClick={() => setIsMobileOpen(false)}
              className="md:hidden text-slate-400 hover:text-white text-lg font-bold px-2"
            >
              ✕
            </button>
          </div>
        </div>

        {/* منطقة اللينكات قابلة للنزول والطلوع (Scrollable) */}
        <nav
          onClick={(event) => {
            if (event.target.closest('a')) setIsMobileOpen(false);
          }}
          className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-3"
        >
          {isAhmed ? (
            <div className="space-y-1">
              <Link href="/moashe/Treasury" className={navLinkClass('/moashe/Treasury')}>
                الخزنه (Treasury )
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <button
                  onClick={() => setMenuState({ pathname, openRaw: !openRaw, openOtherPages })}
                  aria-expanded={openRaw}
                  className={`w-full flex items-center justify-between rounded-2xl border p-3 text-base font-bold text-white transition-all ${isLivestockPath ? 'border-blue-400/30 bg-blue-500/10' : 'border-transparent bg-slate-900/60 hover:border-blue-400/25 hover:bg-slate-800/90'}`}
                >
                  <span>الدواجن(Livestock)</span>
                  <span className={`text-sm transition-transform duration-200 ${openRaw ? 'rotate-180' : ''}`}>▼</span>
                </button>

                {openRaw && (
                  <div className="mr-3 mt-2 space-y-1 border-r-2 border-blue-500/70 pr-3 pb-2">
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
                  <Link href="/moashe/other-accounts" className={navLinkClass('/moashe/other-accounts')}>عهده</Link>
                  <Link href="/moashe/price" className={navLinkClass('/moashe/price')}>الاسعار </Link>
                  </div>
                )}
              </div>

              <div>
                <button
                  onClick={() => setMenuState({ pathname, openRaw, openOtherPages: !openOtherPages })}
                  aria-expanded={openOtherPages}
                  className={`w-full flex items-center justify-between rounded-2xl border p-3 text-base font-bold text-white transition-all ${isOtherPagesPath ? 'border-blue-400/30 bg-blue-500/10' : 'border-transparent bg-slate-900/60 hover:border-blue-400/25 hover:bg-slate-800/90'}`}
                >
                  <span>صفحات أخرى</span>
                  <span className={`text-sm transition-transform duration-200 ${openOtherPages ? 'rotate-180' : ''}`}>▼</span>
                </button>

                {openOtherPages && (
                  <div className="mr-3 mt-2 space-y-1 border-r-2 border-blue-500/70 pr-3 pb-2">
                    <Link
                      href="/re"
                      onClick={(event) => requestProtectedPage(event, '/re')}
                      className={navLinkClass('/re')}
                    >التقارير</Link>
                    <Link
                      href="/moashe/analytics"
                      onClick={(event) => requestProtectedPage(event, '/moashe/analytics')}
                      className={navLinkClass('/moashe/analytics')}
                    >تحليلات المصنع</Link>
                    <Link href="/moashe/manadeb" className={navLinkClass('/moashe/manadeb')}>المناديب</Link>
                    <Link href="/moashe/spend-authorizations" className={navLinkClass('/moashe/spend-authorizations')}>إذن الصرف</Link>
                    {isFactoryAdmin() && (
                      <Link href="/moashe/deleted" className={navLinkClass('/moashe/deleted')}>المحذوفات</Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </nav>

        <div className="shrink-0 border-t border-slate-800 bg-slate-950/90 px-3 pb-4 pt-4">
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

      {isReportPasswordOpen && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setIsReportPasswordOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-password-title"
            className="w-full max-w-sm border border-slate-700 bg-slate-950 p-6 text-white shadow-2xl"
            dir="rtl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="report-password-title" className="text-lg font-black">كلمة مرور {protectedPageLabels[pendingProtectedRoute]}</h2>
            <p className="mt-1 text-sm text-slate-400">أدخل كلمة المرور للمتابعة إلى الصفحة المطلوبة.</p>
            <form onSubmit={submitReportPassword} className="mt-5 space-y-4">
              <div>
                <label htmlFor="report-password" className="mb-2 block text-xs font-bold text-slate-300">كلمة المرور</label>
                <input
                  id="report-password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={reportPassword}
                  onChange={(event) => {
                    setReportPassword(event.target.value);
                    setReportPasswordError('');
                  }}
                  className="h-11 w-full border border-slate-600 bg-slate-900 px-3 text-sm text-white outline-none focus:border-blue-400"
                />
                {reportPasswordError && <p role="alert" className="mt-2 text-xs font-bold text-rose-400">{reportPasswordError}</p>}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsReportPasswordOpen(false)}
                  className="min-h-10 border border-slate-600 px-4 text-sm font-bold text-slate-300 hover:bg-slate-800"
                >إلغاء</button>
                <button type="submit" className="min-h-10 bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-500">متابعة</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}