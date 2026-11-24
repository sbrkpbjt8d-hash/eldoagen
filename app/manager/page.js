'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import {
  APPROVAL_APPROVED,
  APPROVAL_PENDING,
  APPROVAL_REJECTED,
  APPROVAL_REQUEST_COLLECTION,
  decideApprovalRequest,
} from '../lib/approval-requests';
import {
  approvePurchaseInvoice,
  PURCHASE_INVOICE_PENDING,
  PURCHASE_INVOICE_REJECTED,
} from '../lib/purchase-approval';

const MANAGER_PAGE_PASSWORD = '1234';
const money = (value) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;

const COLLECTION_LABELS = {
  advances: 'العُهد',
  banks: 'البنوك',
  client_transactions: 'تحصيلات العملاء',
  clientsmoashe: 'العملاء',
  expense_categories: 'أنواع المصروفات',
  expenses: 'المصروفات',
  khamat_moashe: 'الخامات',
  material_adjustments: 'تسويات الخامات',
  product_stock_transactions: 'حركات مخزون المنتجات',
  products_recipes: 'تركيبات المنتجات',
  products_stock: 'مخزون المنتجات',
  production_orders: 'أوامر التصنيع',
  purchase_invoices: 'فواتير الشراء',
  sales_invoices: 'فواتير البيع',
  spend_authorizations: 'أذون الصرف',
  supplier_transactions: 'حركات الموردين',
  suppliers: 'الموردون',
  treasury: 'الخزنة',
  treasury_transactions: 'حركات الخزنة والبنوك',
};

const FIELD_LABELS = {
  name: 'الاسم',
  title: 'الوصف',
  notes: 'ملاحظات',
  address: 'العنوان',
  phone: 'الهاتف',
  balance: 'الرصيد',
  opening_balance: 'الرصيد الافتتاحي',
  amount: 'المبلغ',
  total_amount: 'الإجمالي',
  sub_total: 'الإجمالي قبل الخصم',
  discount: 'الخصم',
  payment_type: 'طريقة الدفع',
  status: 'الحالة',
  stock: 'الكمية بالمخزون',
  quantity: 'الكمية',
  quantity_needed: 'الكمية المطلوبة',
  price: 'السعر',
  selling_price: 'سعر البيع',
  total_cost: 'التكلفة الإجمالية',
  product_name: 'اسم المنتج',
  supplier_name: 'اسم المورد',
  customer_name: 'اسم العميل',
  recipient_name: 'اسم المستلم',
  returned_amount: 'المبلغ المرتجع',
  remaining_amount: 'المبلغ المتبقي',
  date: 'التاريخ',
  invoice_number: 'رقم الفاتورة',
  items: 'الأصناف',
  actor_name: 'بواسطة',
  sales_agent_name: 'المندوب',
  sales_agent_region: 'المنطقة',
};

const HIDDEN_FIELDS = new Set([
  'id', 'collectionId', 'collectionName', 'created', 'updated',
  'expand', 'actor_name', 'source_id', 'source_type', 'product_stock_id',
]);

const formatApprovalValue = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('ar-EG') : '—';
  if (Array.isArray(value)) {
    if (!value.length) return 'لا يوجد';
    return value.map((item) => {
      if (item && typeof item === 'object') {
        const label = item.name || item.product_name || item.material_name || item.title || 'صنف';
        const quantity = item.qty ?? item.quantity ?? item.quantity_needed;
        const price = item.price;
        return `${label}${quantity !== undefined ? ` — كمية ${formatApprovalValue(quantity)}` : ''}${price !== undefined ? ` — سعر ${money(price)}` : ''}`;
      }
      return String(item);
    }).join('، ');
  }
  if (typeof value === 'object') {
    if (value.name || value.title || value.product_name || value.customer_name || value.supplier_name) {
      return value.name || value.title || value.product_name || value.customer_name || value.supplier_name;
    }
    return Object.entries(value)
      .filter(([key, nestedValue]) => !HIDDEN_FIELDS.has(key) && nestedValue !== '' && nestedValue !== null && nestedValue !== undefined)
      .map(([key, nestedValue]) => `${FIELD_LABELS[key] || key}: ${formatApprovalValue(nestedValue)}`)
      .join('، ') || '—';
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString('ar-EG');
  }
  return String(value);
};

function ApprovalDetails({ data }) {
  const entries = Object.entries(data || {}).filter(([key, value]) => (
    !HIDDEN_FIELDS.has(key) && value !== undefined && value !== null && value !== ''
  ));
  if (!entries.length) return <p className="text-sm text-gray-500">لا توجد تفاصيل إضافية.</p>;

  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-xl bg-white p-3">
          <dt className="text-xs font-bold text-gray-500">{FIELD_LABELS[key] || key}</dt>
          <dd className="mt-1 break-words text-sm font-bold text-gray-800">{formatApprovalValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ManagerPage() {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [message, setMessage] = useState({ text: '', type: 'success' });
  const [rejectInvoice, setRejectInvoice] = useState(null);
  const [showBulkApproveConfirm, setShowBulkApproveConfirm] = useState(false);

  const { data: pendingInvoices = [], isLoading, isError } = useQuery({
    queryKey: ['pending_purchase_invoices'],
    enabled: isUnlocked,
    queryFn: () => pb.collection('purchase_invoices').getFullList({
      filter: `status = "${PURCHASE_INVOICE_PENDING}"`,
      sort: '-created',
    }),
  });

  const {
    data: pendingRequests = [],
    isLoading: isLoadingRequests,
    isError: isRequestsError,
  } = useQuery({
    queryKey: ['pending_manager_approvals'],
    enabled: isUnlocked,
    queryFn: async () => {
      const requests = await pb.collection(APPROVAL_REQUEST_COLLECTION).getFullList({ sort: '-created' });
      return requests.filter((request) => (
        request.payload?.status === APPROVAL_PENDING
        && !['bank', 'treasury'].includes(request.payload?.review_type)
      ));
    },
  });

  const approvalMutation = useMutation({
    mutationFn: (invoiceId) => approvePurchaseInvoice(invoiceId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pending_purchase_invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['purchase_invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['khamat_moashe'] }),
        queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
        queryClient.invalidateQueries({ queryKey: ['all_supplier_transactions'] }),
      ]);
      setMessage({ text: 'تم اعتماد الفاتورة وتحديث المخزون وحساب المورد.', type: 'success' });
    },
    onError: (error) => setMessage({ text: `تعذر اعتماد الفاتورة: ${error.message}`, type: 'error' }),
  });

  const rejectionMutation = useMutation({
    mutationFn: async (invoice) => {
      const currentInvoice = await pb.collection('purchase_invoices').getOne(invoice.id);
      if (currentInvoice.status !== PURCHASE_INVOICE_PENDING) {
        throw new Error('الفاتورة لم تعد معلقة للاعتماد.');
      }
      return pb.collection('purchase_invoices').update(invoice.id, {
        status: PURCHASE_INVOICE_REJECTED,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pending_purchase_invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['purchase_invoices'] }),
      ]);
      setRejectInvoice(null);
      setMessage({ text: 'تم رفض الفاتورة، ولم يتغير المخزون أو حساب المورد.', type: 'success' });
    },
    onError: (error) => setMessage({ text: `تعذر رفض الفاتورة: ${error.message}`, type: 'error' }),
  });

  const requestDecisionMutation = useMutation({
    mutationFn: ({ request, decision }) => decideApprovalRequest(request, decision),
    onSuccess: async (_result, { decision }) => {
      await queryClient.invalidateQueries();
      setMessage({
        text: decision === APPROVAL_APPROVED
          ? 'تم اعتماد الطلب وتطبيق التغيير.'
          : 'تم رفض الطلب وإلغاؤه دون تغيير السجل.',
        type: 'success',
      });
    },
    onError: (error) => setMessage({ text: `تعذر معالجة الطلب: ${error.message}`, type: 'error' }),
  });

  const bulkApprovalMutation = useMutation({
    mutationFn: async () => {
      const tasks = [
        ...pendingRequests.map((request) => ({
          type: 'request',
          record: request,
          label: request.payload?.record_label || 'طلب تعديل أو حذف',
        })),
        ...pendingInvoices.map((invoice) => ({
          type: 'purchase',
          record: invoice,
          label: `فاتورة شراء ${invoice.invoice_number || invoice.supplier_name || invoice.id}`,
        })),
      ];
      const results = [];

      for (const task of tasks) {
        try {
          if (task.type === 'purchase') {
            await approvePurchaseInvoice(task.record.id);
          } else {
            await decideApprovalRequest(task.record, APPROVAL_APPROVED);
          }
          results.push({ label: task.label, success: true });
        } catch (error) {
          results.push({ label: task.label, success: false, error: error.message });
        }
      }

      return results;
    },
    onSuccess: async (results) => {
      await queryClient.invalidateQueries();
      setShowBulkApproveConfirm(false);
      const approvedCount = results.filter((result) => result.success).length;
      const failures = results.filter((result) => !result.success);
      const failureSummary = failures
        .slice(0, 3)
        .map((failure) => `${failure.label}: ${failure.error}`)
        .join('؛ ');
      const remainingFailures = failures.length > 3 ? `؛ وهناك ${failures.length - 3} طلبات أخرى تعذرت` : '';
      setMessage({
        text: failures.length
          ? `تم اعتماد ${approvedCount} من ${results.length}. تعذر اعتماد ${failures.length}: ${failureSummary}${remainingFailures}`
          : `تم اعتماد جميع الطلبات (${approvedCount}) بنجاح.`,
        type: failures.length ? 'error' : 'success',
      });
    },
    onError: (error) => setMessage({ text: `تعذر اعتماد الطلبات: ${error.message}`, type: 'error' }),
  });

  const pendingActionCount = pendingRequests.length + pendingInvoices.length;
  const isApprovalActionPending = approvalMutation.isPending
    || rejectionMutation.isPending
    || requestDecisionMutation.isPending
    || bulkApprovalMutation.isPending;

  const unlockPage = (event) => {
    event.preventDefault();
    if (password !== MANAGER_PAGE_PASSWORD) {
      setMessage({ text: 'كلمة مرور المدير غير صحيحة.', type: 'error' });
      return;
    }
    setMessage({ text: '', type: 'success' });
    setPassword('');
    setIsUnlocked(true);
  };

  if (!isUnlocked) {
    return (
      <main className="mx-auto mt-12 max-w-md rounded-3xl border bg-white p-8 shadow-xl" dir="rtl">
        <h1 className="text-2xl font-black text-gray-900">🔐 صفحة المدير</h1>
        <p className="mt-2 text-sm text-gray-500">أدخل كلمة المرور لفتح طلبات الاعتماد والمراجعة.</p>
        {message.text && (
          <p className={`mt-4 rounded-xl p-3 text-sm font-bold ${message.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
            {message.text}
          </p>
        )}
        <form onSubmit={unlockPage} className="mt-5 space-y-3">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="كلمة مرور المدير"
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
    <main className="mx-auto max-w-6xl space-y-6" dir="rtl">
      {showBulkApproveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-5 rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-xl text-emerald-700">✓</span>
              <div>
                <h2 className="text-lg font-black text-slate-900">اعتماد كل الطلبات؟</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  سيتم اعتماد {pendingActionCount} طلبًا معلّقًا، بما فيها طلبات التعديل والحذف وفواتير الشراء، وتطبيق آثارها بالتتابع.
                </p>
              </div>
            </div>
            <p className="rounded-2xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
              طلبات مراجعة البنك والخزنة لا تدخل ضمن هذه القائمة؛ تُراجع من صفحة المراجع.
            </p>
            <p className="rounded-2xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
              إذا تعذر اعتماد طلب بسبب صلاحيات قاعدة البيانات أو بياناته، سيُترك معلّقًا ويظهر سببه بعد انتهاء الباقي.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowBulkApproveConfirm(false)}
                disabled={bulkApprovalMutation.isPending}
                className="flex-1 rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700 disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => bulkApprovalMutation.mutate()}
                disabled={bulkApprovalMutation.isPending || pendingActionCount === 0}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {bulkApprovalMutation.isPending ? 'جارٍ اعتماد الطلبات...' : `اعتماد ${pendingActionCount} طلب`}
              </button>
            </div>
          </div>
        </div>
      )}
      {rejectInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="font-black">تأكيد رفض الفاتورة</h2>
            <p className="text-sm text-gray-600">
              هل تريد رفض فاتورة {rejectInvoice.invoice_number} للمورد {rejectInvoice.supplier_name}؟
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRejectInvoice(null)}
                disabled={rejectionMutation.isPending}
                className="flex-1 rounded-xl bg-gray-100 p-3 text-xs font-bold"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => rejectionMutation.mutate(rejectInvoice)}
                disabled={rejectionMutation.isPending}
                className="flex-1 rounded-xl bg-red-600 p-3 text-xs font-bold text-white disabled:opacity-50"
              >
                {rejectionMutation.isPending ? 'جارٍ الرفض...' : 'تأكيد الرفض'}
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="overflow-hidden rounded-3xl bg-gradient-to-l from-slate-950 via-slate-900 to-indigo-950 p-6 text-white shadow-xl md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <span className="text-xs font-bold tracking-wide text-indigo-200">لوحة التحكم</span>
            <h1 className="mt-1 text-2xl font-black">👔 مراجعة واعتماد الطلبات</h1>
            <p className="mt-2 text-sm text-slate-300">راجع التفاصيل واعتمد كل الطلبات أو اختر طلبًا بعينه.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/10 px-5 py-3 text-center">
              <span className="block text-2xl font-black">{pendingActionCount}</span>
              <span className="text-xs font-bold text-slate-300">طلب معلّق</span>
            </div>
            <button
              type="button"
              onClick={() => setShowBulkApproveConfirm(true)}
              disabled={pendingActionCount === 0 || isApprovalActionPending || isLoading || isLoadingRequests || isError || isRequestsError}
              className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {bulkApprovalMutation.isPending ? 'جارٍ اعتماد الكل...' : '✓ اعتماد الكل'}
            </button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:max-w-lg">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <span className="block text-lg font-black">{pendingRequests.length}</span>
            <span className="text-xs text-slate-300">تعديل / حذف / تسوية</span>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <span className="block text-lg font-black">{pendingInvoices.length}</span>
            <span className="text-xs text-slate-300">فواتير شراء</span>
          </div>
        </div>
      </header>

      {message.text && (
        <div className={`rounded-2xl p-4 text-sm font-bold ${message.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {message.text}
        </div>
      )}

      {isError && (
        <div className="rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-700">
          تعذر تحميل الفواتير المعلقة. حدّث الصفحة وحاول مرة أخرى.
        </div>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-gray-900">طلبات التعديل والحذف والتسوية</h2>
            <p className="mt-1 text-sm text-gray-500">التغييرات لا تُطبّق إلا بعد الاعتماد.</p>
          </div>
          <span className="rounded-xl bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700">{pendingRequests.length} طلب</span>
        </div>

        {isRequestsError && (
          <div className="rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-700">
            تعذر تحميل طلبات التعديل والحذف والتسوية.
          </div>
        )}

        {isLoadingRequests ? (
          <div className="rounded-2xl bg-white p-6 text-center text-sm text-gray-500">جارٍ تحميل الطلبات...</div>
        ) : pendingRequests.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {pendingRequests.map((approval) => {
              const request = approval.payload;
              const operationLabel = request.operation === 'update'
                ? 'تعديل'
                : request.operation === 'delete'
                  ? 'حذف'
                  : request.operation === 'compound'
                    ? 'عملية متعددة'
                    : 'تسوية';
              const details = request.operation === 'compound'
                ? (request.request_data?.actions || []).map((action, index) => ({
                  id: `${action.collection}-${action.id || index}`,
                  operation: action.type,
                  collection: action.collection,
                  record: action.record_label
                    || action.data?.name
                    || action.data?.title
                    || action.data?.product_name
                    || action.data?.customer_name
                    || action.data?.supplier_name
                    || action.id,
                  changes: action.data || request.request_data?.snapshots?.[index],
                }))
                : [{
                  id: request.target_id || approval.id,
                  operation: request.operation,
                  collection: request.collection_name,
                  record: request.record_label,
                  changes: request.operation === 'delete'
                    ? request.request_data?.original_record
                    : request.request_data?.changes,
                  transaction: request.request_data?.transaction_data,
                }];

              return (
                <article key={approval.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-indigo-200 hover:shadow-md">
                  <div className="border-r-4 border-amber-400 p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-black text-indigo-700">{operationLabel}</span>
                          <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">بانتظار الاعتماد</span>
                        </div>
                        <h3 className="break-words text-base font-black text-slate-900">{request.record_label || 'طلب بدون وصف'}</h3>
                      </div>
                      <span className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
                        {COLLECTION_LABELS[request.collection_name] || request.collection_name || 'عملية متعددة'}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-xs">
                      <div>
                        <span className="block text-[10px] font-bold text-slate-400">مقدم الطلب</span>
                        <span className="mt-1 block truncate font-bold text-slate-700">{request.requested_by || 'مستخدم'}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] font-bold text-slate-400">التاريخ</span>
                        <span className="mt-1 block font-bold text-slate-700">{new Date(approval.created).toLocaleString('ar-EG')}</span>
                      </div>
                    </div>

                    <details className="group mt-3 rounded-xl border border-slate-200">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-xs font-bold text-slate-700 marker:content-none">
                        <span>عرض التفاصيل ({details.length})</span>
                        <span className="text-slate-400 transition group-open:rotate-180">⌄</span>
                      </summary>
                      <div className="space-y-3 border-t border-slate-100 bg-slate-50 p-3">
                        {details.map((detail) => (
                          <section key={detail.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                            {request.operation === 'compound' && (
                              <h4 className="text-xs font-black text-slate-800">
                                {detail.operation === 'create' ? 'إضافة' : detail.operation === 'update' ? 'تعديل' : 'حذف'}
                                {' '}{COLLECTION_LABELS[detail.collection] || detail.collection}
                                {detail.record ? ` — ${detail.record}` : ''}
                              </h4>
                            )}
                            {detail.operation === 'delete' && request.operation !== 'compound' && (
                              <p className="text-xs font-bold text-slate-700">بيانات السجل قبل الحذف</p>
                            )}
                            <ApprovalDetails data={detail.changes} />
                            {detail.transaction && Object.keys(detail.transaction).length > 0 && (
                              <div>
                                <h4 className="mb-2 text-xs font-black text-slate-800">تفاصيل حركة التسوية</h4>
                                <ApprovalDetails data={detail.transaction} />
                              </div>
                            )}
                          </section>
                        ))}
                      </div>
                    </details>

                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => requestDecisionMutation.mutate({
                          request: approval,
                          decision: APPROVAL_REJECTED,
                        })}
                        disabled={isApprovalActionPending}
                        className="rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                      >
                        رفض الطلب
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDecisionMutation.mutate({
                          request: approval,
                          decision: APPROVAL_APPROVED,
                        })}
                        disabled={isApprovalActionPending}
                        className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        اعتماد هذا الطلب
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border bg-white p-6 text-center text-sm text-gray-500">
            لا توجد طلبات تعديل أو حذف أو تسوية معلقة.
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-gray-900">فواتير شراء الخامات</h2>
            <p className="mt-1 text-sm text-gray-500">اعتماد فاتورة يضيف الخامات ويحدّث رصيد المورد.</p>
          </div>
          <span className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">{pendingInvoices.length} فاتورة</span>
        </div>
      {isLoading ? (
        <div className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500">جارٍ تحميل الفواتير...</div>
      ) : pendingInvoices.length ? (
        <div className="space-y-4">
          {pendingInvoices.map((invoice) => (
            <article key={invoice.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="space-y-4 border-r-4 border-blue-400 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
                <div>
                  <h2 className="font-black text-gray-900">{invoice.invoice_number} — {invoice.supplier_name}</h2>
                  <p className="mt-1 text-xs text-gray-500">
                    أنشأها: {invoice.actor_name || 'مستخدم'} · {new Date(invoice.created).toLocaleDateString('ar-EG')}
                  </p>
                </div>
                <p className="text-lg font-black text-blue-700">{money(invoice.total_amount)}</p>
              </div>

              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-right text-xs">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="p-3">الخامة</th>
                      <th className="p-3">السعر</th>
                      <th className="p-3">الكمية</th>
                      <th className="p-3">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(invoice.items || []).map((item, index) => (
                      <tr key={`${invoice.id}-${item.materialId || item.material_id || index}`}>
                        <td className="p-3 font-bold">{item.name || 'خامة'}</td>
                        <td className="p-3">{money(item.price)}</td>
                        <td className="p-3">{Number(item.qty || item.quantity || 0).toLocaleString('ar-EG')}</td>
                        <td className="p-3 font-bold">{money(Number(item.price || 0) * Number(item.qty || item.quantity || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-gray-600">
                  {invoice.payment_type === 'credit' ? 'آجل — تُضاف للمستحقات عند الاعتماد' : 'كاش'}
                  {Number(invoice.discount || 0) > 0 && ` · الخصم: ${money(invoice.discount)}`}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setRejectInvoice(invoice)}
                    disabled={isApprovalActionPending}
                    className="rounded-xl bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700 disabled:opacity-50"
                  >
                    رفض
                  </button>
                  <button
                    type="button"
                    onClick={() => approvalMutation.mutate(invoice.id)}
                    disabled={isApprovalActionPending}
                    className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {approvalMutation.isPending ? 'جارٍ الاعتماد...' : 'اعتماد الفاتورة'}
                  </button>
                </div>
              </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border bg-white p-10 text-center text-sm text-gray-500">
          لا توجد فواتير بانتظار الاعتماد.
        </div>
      )}
      </section>
    </main>
  );
}
