'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';
import {
  buildCashForecast,
  buildCreditAnalytics,
  buildMonthlyFactoryPerformance,
} from '../../lib/factory-analytics';

const collectionNames = [
  'khamat_moashe',
  'products_recipes',
  'sales_invoices',
  'clientsmoashe',
  'client_transactions',
  'expenses',
  'salaries_payouts',
  'supplier_transactions',
  'treasury',
];

const formatMoney = (value) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م`;
const formatDecimal = (value, digits = 1) => Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: digits });
const formatPercent = (value) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 1 })}%`;

function Metric({ label, value, detail, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-950',
    teal: 'border-teal-200 bg-teal-50 text-teal-950',
    amber: 'border-amber-200 bg-amber-50 text-amber-950',
    rose: 'border-rose-200 bg-rose-50 text-rose-950',
    blue: 'border-sky-200 bg-sky-50 text-sky-950',
  };

  return (
    <div className={`min-w-0 border-r-4 p-4 ${tones[tone]}`}>
      <p className="text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-2 wrap-break-word text-xl font-black tabular-nums">{value}</p>
      {detail && <p className="mt-1 text-[11px] leading-5 text-slate-500">{detail}</p>}
    </div>
  );
}

function SectionHeading({ eyebrow, title, children }) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-teal-700">{eyebrow}</p>
        <h2 className="mt-1 text-xl font-black text-slate-950">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function EmptyState({ children }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}

export default function FactoryAnalyticsPage() {
  const queryClient = useQueryClient();

  const { data = {}, isLoading, isFetching, isError } = useQuery({
    queryKey: ['factory-analytics-data'],
    queryFn: async () => {
      const records = await Promise.all(collectionNames.map(async (name) => (
        pb.collection(name).getFullList({
          sort: '-created',
          requestKey: null,
          ...(name === 'expenses' ? { expand: 'category_id' } : {}),
        }).catch(() => [])
      )));
      return Object.fromEntries(collectionNames.map((name, index) => [name, records[index]]));
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const materials = data.khamat_moashe || [];
  const recipes = data.products_recipes || [];
  const invoices = data.sales_invoices || [];
  const clients = data.clientsmoashe || [];
  const clientTransactions = data.client_transactions || [];
  const expenses = data.expenses || [];
  const salaryPayouts = data.salaries_payouts || [];
  const supplierTransactions = data.supplier_transactions || [];
  const treasuryRecords = data.treasury || [];
  const treasury = [...treasuryRecords].sort((first, second) => (
    new Date(second.updated || second.created || 0) - new Date(first.updated || first.created || 0)
  )).find((record) => record.balance !== undefined || record.opening_balance !== undefined);

  const now = new Date();
  const creditAnalytics = buildCreditAnalytics({ clients, invoices, transactions: clientTransactions, now });
  const cashForecast = buildCashForecast({
    treasury,
    invoices,
    clientTransactions,
    supplierTransactions,
    expenses,
    salaryPayouts,
    now,
  });
  const agingTotals = creditAnalytics.clients.reduce((totals, client) => ({
    current: totals.current + client.aging.current,
    days31to60: totals.days31to60 + client.aging.days31to60,
    days61to90: totals.days61to90 + client.aging.days61to90,
    over90: totals.over90 + client.aging.over90,
  }), { current: 0, days31to60: 0, days61to90: 0, over90: 0 });
  const topRiskClient = creditAnalytics.clients[0];
  const monthlyPerformance = buildMonthlyFactoryPerformance({ recipes, materials, invoices, expenses, salaryPayouts, now });
  const topProfitProduct = monthlyPerformance.current.rankedProducts[0];
  const expenseToGrossProfitRatio = monthlyPerformance.current.grossContribution > 0
    ? monthlyPerformance.current.allOverhead / monthlyPerformance.current.grossContribution * 100
    : null;
  const previousExpenseToGrossProfitRatio = monthlyPerformance.previous.grossContribution > 0
    ? monthlyPerformance.previous.allOverhead / monthlyPerformance.previous.grossContribution * 100
    : null;
  const expenseRatioDifference = monthlyPerformance.current.expenseRatio === null || monthlyPerformance.previous.expenseRatio === null
    ? null
    : monthlyPerformance.current.expenseRatio - monthlyPerformance.previous.expenseRatio;

  const refreshData = () => queryClient.invalidateQueries({ queryKey: ['factory-analytics-data'] });

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-12 text-slate-800" dir="rtl">
      <header className="flex flex-col gap-5 border-b border-slate-300 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-teal-700">مصنع أعلاف الزعيم / مركز القرار</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">تحليلات المصنع</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            قراءة تشغيلية مبنية على فواتير البيع، الوصفات، المخزون، والتحصيلات المسجلة في PocketBase.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-slate-500">نافذة التحليل: آخر 90 يومًا</span>
          <button
            type="button"
            onClick={refreshData}
            disabled={isFetching}
            className="inline-flex min-h-10 items-center gap-2 border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 transition hover:border-teal-600 hover:text-teal-800 disabled:opacity-60"
            aria-label="تحديث بيانات التحليلات"
          >
            <span aria-hidden="true" className={isFetching ? 'animate-spin' : ''}>↻</span>
            {isFetching ? 'جارٍ التحديث' : 'تحديث البيانات'}
          </button>
        </div>
      </header>

      {isError && <div role="alert" className="border border-rose-300 bg-rose-50 p-4 text-sm font-bold text-rose-800">تعذر تحميل بعض بيانات التحليلات من PocketBase.</div>}
      {isLoading ? (
        <div className="border-y border-slate-200 py-16 text-center text-sm font-bold text-slate-500">جارٍ تجميع بيانات المبيعات والتشغيل والتحصيل...</div>
      ) : (
        <>
          <nav aria-label="أقسام التحليلات" className="flex flex-wrap gap-x-6 gap-y-2 border-b border-slate-200 pb-3 text-sm font-bold">
            <a className="text-teal-800 hover:underline" href="#profitability">الربحية الشهرية</a>
            <a className="text-teal-800 hover:underline" href="#expenses">المصاريف والمبيعات</a>
            <a className="text-teal-800 hover:underline" href="#credit">الائتمان والسيولة</a>
          </nav>

          <section id="profitability" className="scroll-mt-6">
            <SectionHeading eyebrow="01 / monthly profitability" title="ربحية المصنع وترتيب الأصناف">
              <span className="text-xs text-slate-500">{now.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })} مقارنة بالشهر السابق</span>
            </SectionHeading>
            <div className="grid grid-cols-1 divide-y divide-slate-200 border-y border-slate-200 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7 sm:divide-x sm:divide-y-0 sm:divide-x-reverse">
              <Metric label="إيرادات المبيعات" value={formatMoney(monthlyPerformance.current.sales)} detail={`السابق: ${formatMoney(monthlyPerformance.previous.sales)}`} tone="blue" />
              <Metric label="إجمالي تكلفة خامات المبيعات" value={formatMoney(monthlyPerformance.current.salesMaterialCost)} detail={`تكلفة الوصفات الحالية · السابق: ${formatMoney(monthlyPerformance.previous.salesMaterialCost)}`} tone="amber" />
              <Metric label="إجمالي الربح" value={formatMoney(monthlyPerformance.current.grossContribution)} detail={`قبل المصاريف والرواتب · السابق: ${formatMoney(monthlyPerformance.previous.grossContribution)}`} tone="teal" />
              <Metric label="المصاريف والرواتب" value={formatMoney(monthlyPerformance.current.allOverhead)} detail={`السابق: ${formatMoney(monthlyPerformance.previous.allOverhead)}`} tone="amber" />
             
              <Metric label="صافي مساهمة تقديرية" value={formatMoney(monthlyPerformance.current.estimatedNetProfit)} detail="بعد تكلفة الوصفات ومصاريف الشهر" tone={monthlyPerformance.current.estimatedNetProfit < 0 ? 'rose' : 'teal'} />
              <Metric label="مصروفات / مبيعات" value={monthlyPerformance.current.expenseRatio === null ? 'غير متاح' : formatPercent(monthlyPerformance.current.expenseRatio)} detail={monthlyPerformance.previous.expenseRatio === null ? 'لا توجد مبيعات بالشهر السابق للمقارنة' : `السابق: ${formatPercent(monthlyPerformance.previous.expenseRatio)}`} tone={expenseRatioDifference !== null && expenseRatioDifference > 0 ? 'rose' : 'slate'} />
              <Metric label="المصاريف / إجمالي الربح" value={expenseToGrossProfitRatio === null ? 'غير متاح' : formatPercent(expenseToGrossProfitRatio)} detail={previousExpenseToGrossProfitRatio === null ? 'حد التعادل 100% · ربح الشهر السابق غير موجب' : `حد التعادل 100% · السابق: ${formatPercent(previousExpenseToGrossProfitRatio)}`} tone={expenseToGrossProfitRatio !== null && expenseToGrossProfitRatio > 100 ? 'rose' : 'teal'} />
            </div>

            {expenseToGrossProfitRatio !== null && expenseToGrossProfitRatio > 100 ? (
              <div role="alert" className="mt-4 border-r-4 border-rose-600 bg-rose-50 p-4 text-sm font-bold leading-6 text-rose-900">
                تنبيه: المصاريف والرواتب تستهلك {formatPercent(expenseToGrossProfitRatio)} من إجمالي الربح، متجاوزة حد التعادل 100%؛ صافي المساهمة التقديرية للشهر سالب.
              </div>
            ) : monthlyPerformance.current.grossContribution <= 0 ? (
              <div role="alert" className="mt-4 border-r-4 border-rose-600 bg-rose-50 p-4 text-sm font-bold leading-6 text-rose-900">
                تنبيه: إجمالي الربح غير موجب هذا الشهر، لذلك لا يمكن حساب نسبة المصاريف إليه بصورة ذات معنى.
              </div>
            ) : null}

            {topProfitProduct && monthlyPerformance.current.estimatedNetProfit > 0 && (
              <div className="mt-4 border-r-4 border-teal-700 bg-teal-50 px-4 py-3 text-sm leading-6 text-teal-950">
                أعلى مساهمة صافية مقدرة هذا الشهر: <strong>{topProfitProduct.name}</strong>
                {topProfitProduct.profitShare !== null ? `، وتمثل ${formatPercent(topProfitProduct.profitShare)} من صافي المساهمة الموجبة.` : '.'}
              </div>
            )}

            <div className="mt-5 overflow-x-auto border-y border-slate-200">
              {monthlyPerformance.current.rankedProducts.length === 0 ? <EmptyState>لا توجد مبيعات هذا الشهر لأصناف يمكن احتساب تكلفتها من وصفة وأسعار خامات مسجلة.</EmptyState> : (
                <table className="w-full min-w-280 text-right text-sm">
                  <thead className="bg-slate-100 text-xs text-slate-600">
                    <tr><th className="p-3">الترتيب / المنتج</th>
                    <th className="p-3">الكمية المباعة</th>
                    <th className="p-3">صافي الإيراد</th>
                    <th className="p-3">تكلفة الوصفة المقدرة</th>
                    <th className="p-3">الربح الاجمالى</th>
                     <th className="p-3">نسبه اجمالى الربح</th>
                    <th className="p-3">مصاريف موزعة</th>
                    <th className="p-3">صافى الربح</th>
            
                    <th className="p-3">ربح / التكلفة بعد المصاريف</th>
                    <th className="p-3">حصة الربح</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {monthlyPerformance.current.rankedProducts.map((product, index) => (
                      <tr key={product.name} className="hover:bg-teal-50/40">
                        <td className="p-3 font-black">{String(index + 1).padStart(2, '0')} · {product.name}</td>
                        <td className="p-3 tabular-nums">{formatDecimal(product.quantity, 2)} طن</td>
                        <td className="p-3 tabular-nums">{formatMoney(product.revenue)}</td>
                        <td className="p-3 tabular-nums">{formatMoney(product.estimatedMaterialCost)}</td>
                        <td className={`p-3 font-bold tabular-nums ${product.grossContribution < 0 ? 'text-rose-700' : 'text-teal-800'}`}>{formatMoney(product.grossContribution)}</td>
                               <td className={`p-3 font-bold tabular-nums ${product.grossProfitPercent !== null && product.grossProfitPercent < 0 ? 'text-rose-700' : 'text-teal-800'}`}>{product.grossProfitPercent === null ? 'غير متاح' : formatPercent(product.grossProfitPercent)}</td>
                        <td className="p-3 tabular-nums">{formatMoney(product.allocatedExpenses)}</td>
                        <td className={`p-3 font-black tabular-nums ${product.netContribution < 0 ? 'text-rose-700' : 'text-teal-800'}`}>{formatMoney(product.netContribution)}</td>
                
                        <td className={`p-3 font-bold tabular-nums ${product.netProfitPercent !== null && product.netProfitPercent < 0 ? 'text-rose-700' : 'text-teal-800'}`}>{product.netProfitPercent === null ? 'غير متاح' : formatPercent(product.netProfitPercent)}</td>
                        <td className="p-3">{product.profitShare === null ? 'غير موجب' : formatPercent(product.profitShare)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              نسب الربح محسوبة من تكلفة الخامات: قبل المصاريف (صافي الإيراد ناقص التكلفة) وبعد توزيع المصاريف والرواتب. تكلفة الوصفة محسوبة بالأسعار الحالية لا بتاريخ الفاتورة، والمصاريف موزعة بنسبة صافي الإيراد؛ الأصناف التي ينقصها سعر خامة مستبعدة، ونسبة تغطية تكلفة الأصناف هذا الشهر {formatPercent(monthlyPerformance.current.productCostCoverage)}.
            </p>
          </section>

          <section id="expenses" className="scroll-mt-6 border-t border-slate-300 pt-7">
            <SectionHeading eyebrow="02 / expense control" title="مراقب المصاريف مقابل المبيعات">
              <span className="text-xs text-slate-500">مقارنة فعلية شهر بشهر من السجلات</span>
            </SectionHeading>
            {expenseRatioDifference !== null && expenseRatioDifference > 0 && monthlyPerformance.current.expenseRatio > 0 && (
              <div role="status" className="mb-4 border-r-4 border-rose-600 bg-rose-50 p-4 text-sm font-bold leading-6 text-rose-900">
                تنبيه: نسبة المصاريف والرواتب إلى المبيعات ارتفعت من {formatPercent(monthlyPerformance.previous.expenseRatio)} إلى {formatPercent(monthlyPerformance.current.expenseRatio)} ({formatDecimal(expenseRatioDifference, 1)} نقطة مئوية).
                {monthlyPerformance.current.topExpense ? ` أكبر بند مسجل هذا الشهر: ${monthlyPerformance.current.topExpense.name} بقيمة ${formatMoney(monthlyPerformance.current.topExpense.amount)}.` : ' لا يوجد بند مصروفات مفصل مسجل.'}
              </div>
            )}
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              {[
                ['الشهر الحالي', monthlyPerformance.current],
                ['الشهر السابق', monthlyPerformance.previous],
              ].map(([label, month]) => (
                <div key={label} className="border-y border-slate-200 py-4">
                  <h3 className="mb-3 text-sm font-black text-slate-900">{label}</h3>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-slate-600">إيرادات المبيعات</dt><dd className="font-bold tabular-nums">{formatMoney(month.sales)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-600">مصروفات مسجلة</dt><dd className="font-bold tabular-nums">{formatMoney(month.expenseAmount)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-600">رواتب مصروفة</dt><dd className="font-bold tabular-nums">{formatMoney(month.salaryAmount)}</dd></div>
                    <div className="flex justify-between gap-3 border-t border-slate-200 pt-2"><dt className="font-bold text-slate-800">نسبة الإجمالي للمبيعات</dt><dd className="font-black text-amber-800 tabular-nums">{month.expenseRatio === null ? 'غير متاح' : formatPercent(month.expenseRatio)}</dd></div>
                  </dl>
                  {month.topExpense && <p className="mt-3 text-xs text-slate-500">البند الأكبر: <strong className="text-slate-800">{month.topExpense.name}</strong> · {formatMoney(month.topExpense.amount)}</p>}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">المقارنة تقيس المصروفات والرواتب المسجلة خلال الشهر، لا التزامات مستقبلية. التنبيه مبني على الشهر السابق الفعلي وليس نسبة معيارية ثابتة؛ المصروفات المصنفة غير متاحة عند غياب تصنيف للمصروف.</p>
          </section>

          <section id="credit" className="scroll-mt-6 border-t border-slate-300 pt-7">
            <SectionHeading eyebrow="03 / working capital" title="مخاطر الائتمان وصحة التدفق النقدي">
              <span className="text-xs text-slate-500">أعمار الدين تقديرية لعدم وجود تخصيص سداد لكل فاتورة</span>
            </SectionHeading>
            <div className="mb-5 grid grid-cols-1 divide-y divide-slate-200 border-y border-slate-200 sm:grid-cols-2 xl:grid-cols-4 sm:divide-x sm:divide-y-0 sm:divide-x-reverse">
              <Metric label="إجمالي المديونية الحالية" value={formatMoney(creditAnalytics.totalReceivables)} tone="rose" />
              <Metric label="DSO تقديري" value={creditAnalytics.dso === null ? 'غير متاح' : `${formatDecimal(creditAnalytics.dso, 0)} يوم`} detail="على أساس مبيعات آجلة خلال 90 يومًا" tone="blue" />
              <Metric label="متوسط الأيام منذ آخر تحصيل" value={creditAnalytics.averageCollectionGap === null ? 'غير متاح' : `${formatDecimal(creditAnalytics.averageCollectionGap, 0)} يوم`} detail="متوسط العملاء أصحاب الرصيد المفتوح" tone="amber" />
              <Metric label="رصيد متوقع بعد 30 يومًا" value={formatMoney(cashForecast.projectedBalance)} detail="استمرار متوسط المقبوضات والمدفوعات لآخر 90 يومًا" tone={cashForecast.projectedBalance < 0 ? 'rose' : 'teal'} />
            </div>

            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Metric label="سيولة الخزنة المسجلة الآن" value={formatMoney(cashForecast.currentBalance)} tone="slate" />
              <Metric label="تدفقات داخلة متوقعة / 30 يومًا" value={formatMoney(cashForecast.projectedInflows)} tone="teal" />
              <Metric label="تدفقات خارجة متوقعة / 30 يومًا" value={formatMoney(cashForecast.projectedOutflows)} detail={cashForecast.estimatedDaysToShortfall === null ? 'لا يظهر معدل استنزاف صافٍ وفق الفترة' : `معدل الحرق الحالي قد يستنفد الرصيد خلال ${cashForecast.estimatedDaysToShortfall} يومًا`} tone="amber" />
            </div>

            {cashForecast.projectedShortfall > 0 && (
              <div role="status" className="mb-5 border-r-4 border-rose-600 bg-rose-50 p-4 text-sm font-bold leading-6 text-rose-900">
                إسقاط الاتجاه الحالي يشير إلى عجز محتمل قدره {formatMoney(cashForecast.projectedShortfall)} خلال 30 يومًا. لا توجد مواعيد استحقاق مسجلة، لذلك لا يمكن تحديد يوم العجز أو الشيكات المستحقة بدقة.
              </div>
            )}

            <div className="mb-3 grid grid-cols-2 gap-px border border-slate-200 bg-slate-200 sm:grid-cols-4">
              {[
                ['حتى 30 يومًا', agingTotals.current, 'teal'],
                ['31 إلى 60 يومًا', agingTotals.days31to60, 'amber'],
                ['61 إلى 90 يومًا', agingTotals.days61to90, 'rose'],
                ['أكثر من 90 / غير مخصص', agingTotals.over90, 'slate'],
              ].map(([label, value, tone]) => <Metric key={label} label={label} value={formatMoney(value)} tone={tone} />)}
            </div>

            <div className="overflow-x-auto border-y border-slate-200">
              {creditAnalytics.clients.length === 0 ? <EmptyState>لا توجد أرصدة عملاء موجبة مسجلة.</EmptyState> : (
                <table className="w-full min-w-180 text-right text-sm">
                  <thead className="bg-slate-100 text-xs text-slate-600">
                    <tr><th className="p-3">العميل</th><th className="p-3">الرصيد</th><th className="p-3">31-60 يومًا</th><th className="p-3">61-90 يومًا</th><th className="p-3">أكثر من 90</th><th className="p-3">منذ آخر تحصيل</th><th className="p-3">مؤشر الخطر</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {creditAnalytics.clients.slice(0, 12).map((client) => (
                      <tr key={client.id} className="hover:bg-slate-50">
                        <td className="p-3 font-black">{client.name}</td>
                        <td className="p-3 font-bold">{formatMoney(client.debt)}</td>
                        <td className="p-3">{formatMoney(client.aging.days31to60)}</td>
                        <td className="p-3">{formatMoney(client.aging.days61to90)}</td>
                        <td className="p-3">{formatMoney(client.aging.over90)}</td>
                        <td className="p-3">{client.daysSincePayment === null ? 'لا يوجد تحصيل مسجل' : `${client.daysSincePayment} يوم`}</td>
                        <td className="p-3">
                          <span className={`inline-flex min-w-20 justify-center border px-2 py-1 text-xs font-black ${client.riskLabel === 'مرتفع' ? 'border-rose-300 bg-rose-50 text-rose-800' : client.riskLabel === 'متوسط' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-teal-300 bg-teal-50 text-teal-800'}`}>
                            {client.riskLabel} · {client.riskScore}/100
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              درجة الخطر مؤشر فرز داخلي يعتمد على عمر التعرض ومرور الوقت منذ آخر تحصيل، وليست تصنيفًا ائتمانيًا مصرفيًا. توزيع الأعمار يخصص الرصيد الحالي على أحدث فواتير الآجل أولًا، وما لا يقابله فاتورة يظهر ضمن «غير مخصص».
              {topRiskClient ? ` أعلى رصيد خطر حاليًا: ${topRiskClient.name}.` : ''}
            </p>
          </section>

          <footer className="border-t border-slate-300 pt-4 text-[11px] leading-5 text-slate-500">
            جميع القيم للمتابعة واتخاذ القرار، وليست قيودًا مالية جديدة. تاريخ استحقاق الفواتير والمصروفات غير متاح في السجلات الحالية؛ إسقاط السيولة استمرار لمتوسط حركة آخر 90 يومًا وليس جدول تحصيل أو التزام مستقبلي مؤكد.
          </footer>
        </>
      )}
    </div>
  );
}