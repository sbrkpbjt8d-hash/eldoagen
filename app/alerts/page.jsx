'use client';

import { useCallback, useEffect, useState } from 'react';
import { pb } from '../lib/pocketbase';

const ALERT_STYLES = {
  danger: {
    card: 'border-rose-200 bg-gradient-to-br from-white to-rose-50',
    badge: 'bg-rose-100 text-rose-800 ring-rose-200',
    label: 'خطر',
    marker: 'bg-rose-500',
  },
  warning: {
    card: 'border-amber-200 bg-gradient-to-br from-white to-amber-50',
    badge: 'bg-amber-100 text-amber-800 ring-amber-200',
    label: 'مراجعة',
    marker: 'bg-amber-500',
  },
  info: {
    card: 'border-sky-200 bg-gradient-to-br from-white to-sky-50',
    badge: 'bg-sky-100 text-sky-800 ring-sky-200',
    label: 'معلومة',
    marker: 'bg-sky-500',
  },
};

async function requestPatternAnalysis(token) {
  const response = await fetch('/api/smart-alerts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'تعذر تحليل البيانات.');
  if (!Array.isArray(result)) throw new Error('استجابة التحليل غير صالحة.');
  return result;
}

function isExpenseAlert(alert) {
  return /^(مصروف|مصاريف)/.test(alert.title || '');
}

function isProductProfitAlert(alert) {
  return /^(المنتج يحقق خسارة|هامش ربح منخفض)/.test(alert.title || '');
}

function formatAnalysisTime(date) {
  if (!date) return 'لم يتم التحليل بعد';
  return new Intl.DateTimeFormat('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'long',
  }).format(date);
}

function SummaryCard({ label, value, detail, tone }) {
  const tones = {
    slate: 'border-white/10 bg-white/5 text-white',
    amber: 'border-amber-200/20 bg-amber-300/10 text-amber-100',
    rose: 'border-rose-200/20 bg-rose-300/10 text-rose-100',
  };

  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <p className="text-xs font-bold opacity-75">{label}</p>
      <p className="mt-2 text-3xl font-black tabular-nums">{value}</p>
      <p className="mt-1 text-xs opacity-70">{detail}</p>
    </div>
  );
}

export default function SmartAlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [lastAnalyzed, setLastAnalyzed] = useState(null);

  const expenseAlerts = alerts.filter(isExpenseAlert);
  const urgentExpenseAlerts = expenseAlerts.filter((alert) => alert.type === 'danger');
  const productProfitAlerts = alerts.filter(isProductProfitAlert);
  const visibleAlerts = filter === 'expenses'
    ? expenseAlerts
    : filter === 'profit'
      ? productProfitAlerts
      : [...alerts].sort((first, second) => (
        Number(isExpenseAlert(second)) - Number(isExpenseAlert(first))
        || Number(isProductProfitAlert(second)) - Number(isProductProfitAlert(first))
      ));

  const analyzePatterns = useCallback(() => {
    setIsLoading(true);
    setError('');
    requestPatternAnalysis(pb.authStore.token)
      .then((result) => {
        setAlerts(result);
        setLastAnalyzed(new Date());
      })
      .catch((requestError) => {
        setError(requestError.message || 'تعذر تحليل الأنماط. حاول مرة أخرى.');
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    let isCurrent = true;
    requestPatternAnalysis(pb.authStore.token)
      .then((result) => {
        if (!isCurrent) return;
        setAlerts(result);
        setLastAnalyzed(new Date());
      })
      .catch((requestError) => {
        if (isCurrent) setError(requestError.message || 'تعذر تحليل الأنماط. حاول مرة أخرى.');
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  return (
    <main className="mx-auto max-w-7xl space-y-7 pb-14 text-slate-800" dir="rtl">
      <section className="relative isolate overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-xl shadow-slate-900/10 sm:p-9">
        <div aria-hidden="true" className="absolute -left-20 -top-28 -z-10 h-80 w-80 rounded-full bg-amber-400/15 blur-3xl" />
        <div aria-hidden="true" className="absolute -bottom-36 right-1/3 -z-10 h-72 w-72 rounded-full bg-teal-400/10 blur-3xl" />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/20 bg-amber-300/10 px-3 py-1.5 text-xs font-bold text-amber-100">
              <span className="h-2 w-2 rounded-full bg-amber-300" />
              مركز مراقبة المصروفات والمخاطر
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">التنبيهات الذكية</h1>
            <p className="mt-3 text-sm leading-7 text-slate-300 sm:text-base">
              متابعة محلية لأنماط الصرف، ارتفاع المصروفات حسب التصنيف، والعمليات غير المعتادة إلى جانب مخاطر المخزون والعملاء والسيولة.
            </p>
            <p className="mt-4 text-xs font-medium text-slate-400">
              آخر تحليل ناجح: {formatAnalysisTime(lastAnalyzed)}
            </p>
          </div>
          <button
            type="button"
            onClick={analyzePatterns}
            disabled={isLoading}
            className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-300 px-5 text-sm font-black text-slate-950 shadow-lg shadow-amber-950/20 transition hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span aria-hidden="true" className={isLoading ? 'animate-spin' : ''}>↻</span>
            {isLoading ? 'جارٍ تحليل المصروفات...' : 'إعادة تحليل الأنماط'}
          </button>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="كل التنبيهات"
            value={alerts.length}
            detail="من بيانات المصنع المتاحة"
            tone="slate"
          />
          <SummaryCard
            label="تنبيهات المصروفات"
            value={expenseAlerts.length}
            detail="مقارنة الصرف والعمليات غير المعتادة"
            tone="amber"
          />
          <SummaryCard
            label="مصروفات عالية الخطورة"
            value={urgentExpenseAlerts.length}
            detail="تحتاج إلى مراجعة عاجلة"
            tone="rose"
          />
          <SummaryCard
            label="ربحية المنتجات"
            value={productProfitAlerts.length}
            detail="خسائر أو هوامش أقل من المعتاد"
            tone="amber"
          />
        </div>
      </section>

      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-bold">{error}</p>
          <button type="button" onClick={analyzePatterns} className="shrink-0 font-black underline underline-offset-4">
            حاول مرة أخرى
          </button>
        </div>
      )}

      <section className="space-y-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-teal-700">لوحة المتابعة</p>
            <h2 className="mt-1 text-2xl font-black text-slate-950">مراجعة التنبيهات</h2>
          </div>
          <div role="group" aria-label="تصفية التنبيهات" className="inline-flex w-fit flex-wrap rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setFilter('all')}
              aria-pressed={filter === 'all'}
              className={`rounded-lg px-4 py-2 text-sm font-bold transition ${filter === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              الكل <span className="mr-1 opacity-70">{alerts.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter('expenses')}
              aria-pressed={filter === 'expenses'}
              className={`rounded-lg px-4 py-2 text-sm font-bold transition ${filter === 'expenses' ? 'bg-amber-300 text-slate-950' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              المصروفات <span className="mr-1 opacity-70">{expenseAlerts.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter('profit')}
              aria-pressed={filter === 'profit'}
              className={`rounded-lg px-4 py-2 text-sm font-bold transition ${filter === 'profit' ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              ربحية المنتجات <span className="mr-1 opacity-70">{productProfitAlerts.length}</span>
            </button>
          </div>
        </div>

        {isLoading ? (
          <div role="status" aria-live="polite" className="grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5">
                <div className="h-4 w-1/3 rounded bg-slate-200" />
                <div className="mt-5 h-3 rounded bg-slate-100" />
                <div className="mt-2 h-3 w-4/5 rounded bg-slate-100" />
              </div>
            ))}
            <span className="sr-only">جارٍ تحليل البيانات واكتشاف الأنماط...</span>
          </div>
        ) : visibleAlerts.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-2xl text-teal-700" aria-hidden="true">✓</div>
            <h3 className="mt-4 text-lg font-black text-slate-900">
              {filter === 'expenses'
                ? 'لا توجد تنبيهات مصروفات حالياً'
                : filter === 'profit'
                  ? 'لا توجد تنبيهات ربحية للمنتجات'
                  : 'الوضع مستقر حالياً'}
            </h3>
            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">
              {filter === 'expenses'
                ? 'لم يرصد التحليل ارتفاعاً ملحوظاً أو عمليات صرف خارجة عن النمط المسجل.'
                : filter === 'profit'
                  ? 'لم يرصد التحليل منتجات تتجاوز تكلفة تصنيعها سعر بيعها أو هوامش ربح منخفضة بشكل ملحوظ.'
                  : 'لم يرصد التحليل أنماطاً غير معتادة في المصروفات أو بقية بيانات المصنع.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {visibleAlerts.map((alert, index) => {
              const style = ALERT_STYLES[alert.type] || ALERT_STYLES.info;
              const isExpense = isExpenseAlert(alert);
              const isProductProfit = isProductProfitAlert(alert);
              return (
                <article
                  key={`${alert.type}-${alert.title}-${index}`}
                  className={`group relative overflow-hidden rounded-2xl border p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-6 ${style.card}`}
                >
                  <span aria-hidden="true" className={`absolute inset-y-0 right-0 w-1 ${style.marker}`} />
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${isExpense ? 'bg-amber-100 text-amber-800' : isProductProfit ? 'bg-teal-100 text-teal-800' : 'bg-white/80 text-slate-700'}`} aria-hidden="true">
                        {isExpense ? 'ج.م' : isProductProfit ? '%' : '↗'}
                      </span>
                      <div>
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          {isExpense && <span className="text-[10px] font-black uppercase tracking-wider text-amber-800">مراجعة مالية</span>}
                          {isProductProfit && <span className="text-[10px] font-black uppercase tracking-wider text-teal-800">ربحية المنتجات</span>}
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ring-inset ${style.badge}`}>{style.label}</span>
                        </div>
                        <h3 className="text-base font-black leading-7 text-slate-950 sm:text-lg">{alert.title}</h3>
                      </div>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-slate-700">{alert.description}</p>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
