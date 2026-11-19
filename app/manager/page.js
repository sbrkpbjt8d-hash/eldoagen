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

      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900">👔 صفحة المدير</h1>
          <p className="mt-1 text-sm text-gray-500">مراجعة طلبات التعديل والحذف والتسوية وفواتير الشراء</p>
        </div>
        <span className="rounded-xl bg-amber-100 px-4 py-2 text-sm font-bold text-amber-800">
          {pendingRequests.length + pendingInvoices.length} طلب بانتظار الاعتماد
        </span>
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
        <div>
          <h2 className="text-lg font-black text-gray-900">طلبات التعديل والحذف والتسوية</h2>
          <p className="mt-1 text-sm text-gray-500">لن يتغير السجل قبل اعتماد الطلب.</p>
        </div>

        {isRequestsError && (
          <div className="rounded-2xl bg-red-50 p-4 text-sm font-bold text-red-700">
            تعذر تحميل طلبات التعديل والحذف والتسوية.
          </div>
        )}

        {isLoadingRequests ? (
          <div className="rounded-2xl bg-white p-6 text-center text-sm text-gray-500">جارٍ تحميل الطلبات...</div>
        ) : pendingRequests.length ? (
          <div className="space-y-3">
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
                <article key={approval.id} className="space-y-3 rounded-2xl border bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-black text-gray-900">{operationLabel}: {request.record_label}</h3>
                      <p className="mt-1 text-xs text-gray-500">
                        المجموعة: {request.collection_name} · أرسل الطلب: {request.requested_by || 'مستخدم'}
                      </p>
                    </div>
                    <span className="rounded-lg bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                      بانتظار الاعتماد
                    </span>
                  </div>

                  <div className="space-y-3 rounded-xl bg-gray-50 p-3">
                    {details.map((detail) => (
                      <section key={detail.id} className="space-y-2">
                        {request.operation === 'compound' && (
                          <h4 className="text-sm font-black text-gray-800">
                            {detail.operation === 'create' ? 'إضافة' : detail.operation === 'update' ? 'تعديل' : 'حذف'}
                            {' '}{COLLECTION_LABELS[detail.collection] || detail.collection}
                            {detail.record ? ` — ${detail.record}` : ''}
                          </h4>
                        )}
                        {detail.operation === 'delete' && request.operation !== 'compound' && (
                          <p className="text-sm font-bold text-gray-700">بيانات السجل قبل الحذف</p>
                        )}
                        <ApprovalDetails data={detail.changes} />
                        {detail.transaction && Object.keys(detail.transaction).length > 0 && (
                          <div>
                            <h4 className="mb-2 text-sm font-black text-gray-800">تفاصيل حركة التسوية</h4>
                            <ApprovalDetails data={detail.transaction} />
                          </div>
                        )}
                      </section>
                    ))}
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => requestDecisionMutation.mutate({
                        request: approval,
                        decision: APPROVAL_REJECTED,
                      })}
                      disabled={requestDecisionMutation.isPending}
                      className="rounded-xl bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700 disabled:opacity-50"
                    >
                      رفض وإلغاء الطلب
                    </button>
                    <button
                      type="button"
                      onClick={() => requestDecisionMutation.mutate({
                        request: approval,
                        decision: APPROVAL_APPROVED,
                      })}
                      disabled={requestDecisionMutation.isPending}
                      className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {requestDecisionMutation.isPending ? 'جارٍ التنفيذ...' : 'اعتماد'}
                    </button>
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
        <h2 className="text-lg font-black text-gray-900">فواتير شراء الخامات</h2>
      {isLoading ? (
        <div className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500">جارٍ تحميل الفواتير...</div>
      ) : pendingInvoices.length ? (
        <div className="space-y-4">
          {pendingInvoices.map((invoice) => (
            <article key={invoice.id} className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm">
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
                    disabled={approvalMutation.isPending || rejectionMutation.isPending}
                    className="rounded-xl bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700 disabled:opacity-50"
                  >
                    رفض
                  </button>
                  <button
                    type="button"
                    onClick={() => approvalMutation.mutate(invoice.id)}
                    disabled={approvalMutation.isPending || rejectionMutation.isPending}
                    className="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {approvalMutation.isPending ? 'جارٍ الاعتماد...' : 'اعتماد الفاتورة'}
                  </button>
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
