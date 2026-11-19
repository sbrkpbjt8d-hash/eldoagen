'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import {
  APPROVAL_APPROVED,
  APPROVAL_PENDING,
  APPROVAL_REJECTED,
  APPROVAL_REQUEST_COLLECTION,
  decideReviewRequest,
} from '../lib/approval-requests';

const REVIEWER_PASSWORD = '01024653335';

const COLLECTION_LABELS = {
  advances: 'العُهد',
  banks: 'البنوك',
  client_transactions: 'تحصيلات العملاء',
  clientsmoashe: 'العملاء',
  expenses: 'المصروفات',
  sales_invoices: 'فواتير البيع',
  supplier_transactions: 'سداد الموردين',
  suppliers: 'الموردون',
  treasury: 'الخزنة',
  treasury_transactions: 'حركات البنوك والخزنة',
};

const FIELD_LABELS = {
  name: 'اسم البنك',
  amount: 'المبلغ',
  balance: 'الرصيد بعد العملية',
  opening_balance: 'الرصيد الافتتاحي',
  type: 'نوع الحركة',
  movement_type: 'نوع الحركة',
  destination_type: 'جهة التحويل',
  destination: 'جهة التحصيل',
  bank_id: 'رقم البنك',
  destination_bank_id: 'البنك المستلم',
  client_id: 'رقم العميل',
  supplier_id: 'رقم المورد',
  customer_name: 'اسم العميل',
  supplier_name: 'اسم المورد',
  notes: 'ملاحظات مقدم الطلب',
  title: 'البيان',
  date: 'التاريخ',
  actor_name: 'مقدم العملية',
};

const HIDDEN_FIELDS = new Set([
  'id', 'collectionId', 'collectionName', 'created', 'updated',
  'expand', 'actor_name', 'source_id', 'source_type', 'product_stock_id', 'category_id',
]);

const money = (value) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;

const formatValue = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'number') return value.toLocaleString('ar-EG');
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([key, nestedValue]) => !HIDDEN_FIELDS.has(key) && nestedValue !== '' && nestedValue !== null && nestedValue !== undefined)
      .map(([key, nestedValue]) => `${FIELD_LABELS[key] || key}: ${formatValue(nestedValue)}`)
      .join('، ') || '—';
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString('ar-EG');
  }
  return String(value);
};

function ActionDetails({ action }) {
  if (action.type === 'balance_delta') {
    const change = Number(action.delta || 0);
    return (
      <p className="rounded-lg bg-white p-3 text-xs font-bold text-slate-700">
        التغيير في الرصيد: <span className={change >= 0 ? 'text-emerald-700' : 'text-red-700'}>{change >= 0 ? '+' : ''}{money(change)}</span>
      </p>
    );
  }

  const fields = Object.entries(action.data || {}).filter(([key, value]) => (
    !HIDDEN_FIELDS.has(key) && value !== undefined && value !== null && value !== ''
  ));

  if (!fields.length) {
    return <p className="text-sm text-gray-500">لا توجد تفاصيل إضافية.</p>;
  }

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {fields.map(([key, value]) => (
        <div key={key} className="min-w-0 rounded-xl border border-slate-100 bg-white p-3">
          <dt className="text-xs font-bold text-gray-500">{FIELD_LABELS[key] || key}</dt>
          <dd className="mt-1 break-words text-sm font-bold leading-6 text-gray-800">
            {key === 'amount' || key === 'balance' ? money(value) : formatValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function ReviewerPage() {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [reviewNotes, setReviewNotes] = useState({});
  const [message, setMessage] = useState({ text: '', type: 'success' });
  const [reviewFilter, setReviewFilter] = useState('all');
  const [search, setSearch] = useState('');

  const { data: requests = [], isLoading, isError } = useQuery({
    queryKey: ['pending_bank_reviews'],
    enabled: isUnlocked,
    queryFn: async () => {
      const records = await pb.collection(APPROVAL_REQUEST_COLLECTION).getFullList({ sort: '-created' });
      return records.filter((record) => (
        ['bank', 'treasury'].includes(record.payload?.review_type)
        && record.payload?.status === APPROVAL_PENDING
      ));
    },
  });

  const { data: expenseCategories = [], isError: isExpenseCategoriesError } = useQuery({
    queryKey: ['reviewer_expense_categories'],
    enabled: isUnlocked,
    queryFn: () => pb.collection('expense_categories').getFullList({ sort: 'name' }),
  });

  const decisionMutation = useMutation({
    mutationFn: ({ request, decision }) => decideReviewRequest(
      request,
      decision,
      reviewNotes[request.id] || '',
    ),
    onSuccess: async (_result, { request, decision }) => {
      await queryClient.invalidateQueries();
      setMessage({
        text: decision === APPROVAL_APPROVED
          ? 'تم اعتماد العملية وتثبيت أثرها.'
          : 'تم رفض العملية وعكس أثرها من الأرصدة والسجلات.',
        type: 'success',
      });
      setReviewNotes((current) => ({ ...current, [request.id]: '' }));
    },
    onError: (error) => setMessage({ text: `تعذرت مراجعة العملية: ${error.message}`, type: 'error' }),
  });

  const filteredRequests = useMemo(() => requests.filter((record) => {
    const request = record.payload || {};
    const matchesType = reviewFilter === 'all' || request.review_type === reviewFilter;
    const searchableText = `${request.record_label || ''} ${request.requested_by || ''}`.toLowerCase();
    return matchesType && searchableText.includes(search.trim().toLowerCase());
  }), [requests, reviewFilter, search]);

  const unlockPage = (event) => {
    event.preventDefault();
    if (password !== REVIEWER_PASSWORD) {
      setPasswordError('كلمة المرور غير صحيحة.');
      return;
    }
    setPassword('');
    setPasswordError('');
    setIsUnlocked(true);
  };

  if (!isUnlocked) {
    return (
      <main className="mx-auto mt-12 max-w-md rounded-3xl border bg-white p-8 shadow-xl" dir="rtl">
        <h1 className="text-2xl font-black text-gray-900">🔎 صفحة المراجع</h1>
        <p className="mt-2 text-sm text-gray-500">أدخل كلمة المرور لعرض عمليات البنوك والخزنة المعلقة.</p>
        {passwordError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{passwordError}</p>}
        <form onSubmit={unlockPage} className="mt-5 space-y-3">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="كلمة مرور المراجع"
            className="w-full rounded-xl border p-3 text-sm"
            required
          />
          <button type="submit" className="w-full rounded-xl bg-blue-600 p-3 text-sm font-bold text-white">
            دخول
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8" dir="rtl">
      <header className="overflow-hidden rounded-3xl bg-gradient-to-l from-slate-900 via-slate-800 to-indigo-900 p-6 text-white shadow-lg md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-3xl">🔎</div>
            <div>
              <p className="text-xs font-bold text-indigo-200">مركز المراجعة المالية</p>
              <h1 className="mt-1 text-2xl font-black md:text-3xl">صفحة المراجع</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">العمليات الجديدة تُسجّل وتؤثر على الرصيد فورًا وهي معلّقة؛ اعتمادها يثبت الأثر، ورفضها يعكسه. بعض الطلبات القديمة قد تُنفّذ عند اعتمادها.</p>
            </div>
          </div>
          <div className="min-w-32 rounded-2xl border border-white/10 bg-white/10 px-5 py-3 text-center">
            <span className="block text-3xl font-black">{requests.length.toLocaleString('ar-EG')}</span>
            <span className="mt-1 block text-xs font-bold text-indigo-100">عملية معلقة</span>
          </div>
        </div>
      </header>

      {message.text && (
        <div role="status" className={`flex items-center gap-3 rounded-2xl border p-4 text-sm font-bold ${message.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          <span aria-hidden="true">{message.type === 'error' ? '!' : '✓'}</span>
          {message.text}
        </div>
      )}

      {isError && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          تعذر تحميل عمليات المراجعة.
        </div>
      )}
      {isExpenseCategoriesError && requests.some((record) => (
        record.payload?.request_data?.actions?.some((action) => action.collection === 'expenses')
      )) && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          تعذر تحميل أنواع المصروفات؛ أعد تحميل الصفحة لعرض نوع المصروف.
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-black text-slate-900">العمليات المطلوب مراجعتها</h2>
            <p className="mt-1 text-xs text-slate-500">اختر نوع العملية أو ابحث باسمها أو بمقدم الطلب.</p>
          </div>
          <label className="relative block w-full md:max-w-xs">
            <span className="sr-only">بحث في الطلبات</span>
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">⌕</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث عن عملية أو مستخدم..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pr-9 pl-3 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-50"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { id: 'all', label: 'الكل', count: requests.length },
            { id: 'treasury', label: 'الخزنة', count: requests.filter((item) => item.payload?.review_type === 'treasury').length },
            { id: 'bank', label: 'البنوك', count: requests.filter((item) => item.payload?.review_type === 'bank').length },
          ].map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setReviewFilter(filter.id)}
              aria-pressed={reviewFilter === filter.id}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition ${reviewFilter === filter.id ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {filter.label} <span className="mr-1 opacity-75">({filter.count.toLocaleString('ar-EG')})</span>
            </button>
          ))}
        </div>
      </section>

      {isLoading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm font-bold text-slate-500">
          <span className="mx-auto mb-3 block h-7 w-7 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
          جارٍ تحميل العمليات...
        </div>
      ) : filteredRequests.length ? (
        <section className="grid items-start gap-3 lg:grid-cols-2">
          {filteredRequests.map((record) => {
            const request = record.payload;
            const actions = request.request_data?.actions || [];
            const primaryAction = actions.find((action) => Number.isFinite(Number(action.data?.amount)) && action.data?.amount !== '');
            const expenseAction = actions.find((action) => action.collection === 'expenses');
            const expenseCategoryId = expenseAction?.data?.category_id;
            const expenseCategoryName = expenseCategories.find((category) => category.id === expenseCategoryId)?.name;
            const reviewTypeLabel = request.review_type === 'treasury' ? 'الخزنة' : 'البنوك';
            return (
              <article key={record.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-indigo-200 hover:shadow-md">
                <div className="border-r-4 border-indigo-500 p-3">
                  <header className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-black ${request.review_type === 'treasury' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                          {reviewTypeLabel}
                        </span>
                        <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">بانتظار المراجعة</span>
                      </div>
                      <h3 className="break-words text-sm font-black leading-6 text-slate-900">
                        {request.record_label || 'عملية مالية'}
                      </h3>
                      {expenseAction && (
                        <div className="mt-2 inline-flex max-w-full items-center gap-2 rounded-lg border border-orange-100 bg-orange-50 px-2.5 py-1.5 text-[11px]">
                          <span className="shrink-0 font-bold text-orange-800">نوع المصروف:</span>
                          <span className="truncate font-black text-slate-800">
                            {expenseCategoryName || (isExpenseCategoriesError ? 'تعذر تحميل النوع' : 'جارٍ تحميل النوع...')}
                          </span>
                        </div>
                      )}
                    </div>
                    {primaryAction && (
                      <div className="shrink-0 rounded-lg bg-slate-50 px-2.5 py-1.5 text-left">
                        <span className="block text-[9px] font-bold text-slate-500">المبلغ</span>
                        <span className="mt-0.5 block text-sm font-black text-slate-900">{money(primaryAction.data.amount)}</span>
                      </div>
                    )}
                  </header>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2 text-[10px] text-slate-500">
                    <span><span className="font-bold text-slate-700">مقدم الطلب:</span> {request.requested_by || 'مستخدم'}</span>
                    <span><span className="font-bold text-slate-700">التاريخ:</span> {record.created ? new Date(record.created).toLocaleString('ar-EG') : '—'}</span>
                    <span>{actions.length.toLocaleString('ar-EG')} إجراء</span>
                  </div>

                  <details className="group mt-2 rounded-lg border border-slate-200 bg-slate-50">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[11px] font-bold text-slate-700 marker:content-none">
                      <span>عرض تفاصيل العملية</span>
                      <span className="text-slate-400 transition group-open:rotate-180">⌄</span>
                    </summary>
                    <div className="space-y-2 border-t border-slate-200 p-2.5">
                      {actions.map((action, index) => (
                        <section key={`${action.collection}-${action.id || index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                          <h4 className="mb-2 flex flex-wrap items-center gap-2 text-xs font-black text-slate-800">
                            <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700">
                              {action.type === 'create' ? 'إضافة' : action.type === 'update' ? 'تعديل' : 'حذف'}
                            </span>
                            {COLLECTION_LABELS[action.collection] || action.collection}
                            {action.record_label ? ` — ${action.record_label}` : ''}
                          </h4>
                          <ActionDetails action={action} />
                        </section>
                      ))}
                    </div>
                  </details>

                  <div className="mt-2 space-y-2">
                    <label className="block space-y-1">
                      <span className="text-[11px] font-bold text-slate-700">ملاحظة المراجع <span className="font-normal text-slate-400">(اختياري)</span></span>
                      <textarea
                        value={reviewNotes[record.id] || ''}
                        onChange={(event) => setReviewNotes((current) => ({ ...current, [record.id]: event.target.value }))}
                        rows={1}
                        className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50"
                        placeholder="اكتب ملاحظة أو سبب الرفض..."
                      />
                    </label>

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => decisionMutation.mutate({ request: record, decision: APPROVAL_REJECTED })}
                        disabled={decisionMutation.isPending}
                        className="min-w-20 rounded-lg border border-red-200 bg-white px-3 py-2 text-[11px] font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        رفض العملية
                      </button>
                      <button
                        type="button"
                        onClick={() => decisionMutation.mutate({ request: record, decision: APPROVAL_APPROVED })}
                        disabled={decisionMutation.isPending}
                        className="min-w-32 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {decisionMutation.isPending ? 'جارٍ التنفيذ...' : 'اعتماد وتنفيذ'}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl text-emerald-600">✓</span>
          <h3 className="mt-4 font-black text-slate-800">{requests.length ? 'لا توجد نتائج مطابقة' : 'لا توجد عمليات معلقة'}</h3>
          <p className="mt-2 text-sm text-slate-500">{requests.length ? 'غيّر نوع العملية أو عبارة البحث.' : 'ستظهر هنا طلبات الخزنة والبنوك عند إرسالها للمراجعة.'}</p>
        </div>
      )}
    </main>
  );
}
