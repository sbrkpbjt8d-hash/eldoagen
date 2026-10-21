'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { pb } from '../../lib/pocketbase';
import { getDeletedRecordLabel, isFactoryAdmin, restoreDeletedRecord } from '../../lib/deleted-records';

const COLLECTION_LABELS = {
  advances: 'العُهد',
  banks: 'البنوك',
  client_transactions: 'حركات العملاء',
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
  treasury_transactions: 'حركات الخزنة والبنوك',
};

export default function DeletedRecordsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAdmin = isFactoryAdmin();
  const [restoreConfirmRecord, setRestoreConfirmRecord] = useState(null);
  const [password, setPassword] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    if (!isAdmin) router.replace('/login');
  }, [isAdmin, router]);

  const deletedRecordsQuery = useQuery({
    queryKey: ['deleted_records'],
    queryFn: () => pb.collection('deleted_records').getFullList({ sort: '-created' }),
    enabled: isAdmin && isUnlocked,
  });

  const restoreMutation = useMutation({
    mutationFn: restoreDeletedRecord,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      setRestoreConfirmRecord(null);
    },
  });

  if (!isAdmin) return null;

  if (!isUnlocked) {
    return (
      <main className="mx-auto max-w-md p-4 pt-16 md:pt-24" dir="rtl">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (password === '01234') {
              setIsUnlocked(true);
              setPasswordError('');
              setPassword('');
              return;
            }
            setPasswordError('كلمة المرور غير صحيحة.');
          }}
          className="space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <div>
            <h1 className="text-xl font-black text-gray-900">المحذوفات</h1>
            <p className="mt-2 text-sm text-gray-600">أدخل كلمة المرور لعرض السجلات المحذوفة.</p>
          </div>
          <label className="block space-y-2 text-sm font-bold text-gray-700">
            <span>كلمة المرور</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-left outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
              autoFocus
            />
          </label>
          {passwordError && (
            <p role="alert" className="text-sm font-bold text-red-700">
              {passwordError}
            </p>
          )}
          <button
            type="submit"
            className="w-full rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-amber-700"
          >
            دخول
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-8" dir="rtl">
      <header className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <h1 className="text-2xl font-black text-gray-900">المحذوفات</h1>
        <p className="mt-2 text-sm leading-7 text-gray-700">
          تعرض الصفحة السجلات التي تم أرشفتها عند حذفها بعد تفعيل هذه الميزة. السجلات المحذوفة قبل ذلك لا تظهر هنا،
          وتحتاج إلى استعادتها من نسخة احتياطية.
        </p>
      </header>

      {deletedRecordsQuery.isPending && (
        <p className="rounded-xl bg-white p-6 text-center text-sm font-bold text-gray-600">جاري تحميل المحذوفات...</p>
      )}

      {deletedRecordsQuery.isError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          تعذر تحميل الأرشيف: {deletedRecordsQuery.error.message}
        </div>
      )}

      {restoreMutation.isError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          تعذرت الاستعادة: {restoreMutation.error.message}
        </div>
      )}

      {deletedRecordsQuery.isSuccess && deletedRecordsQuery.data.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm font-bold text-gray-500">
          لا توجد سجلات مؤرشفة.
        </div>
      )}

      {deletedRecordsQuery.data?.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full min-w-180 text-right text-sm">
            <thead className="bg-gray-100 text-xs text-gray-600">
              <tr>
                <th className="p-3">النوع</th>
                <th className="p-3">السجل</th>
                <th className="p-3">معرّف السجل</th>
                <th className="p-3">حُذف بواسطة</th>
                <th className="p-3">وقت الأرشفة</th>
                <th className="p-3">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {deletedRecordsQuery.data.map((record) => (
                <tr key={record.id}>
                  <td className="p-3 font-bold text-gray-700">
                    {COLLECTION_LABELS[record.collection_name] || record.collection_name}
                  </td>
                  <td className="p-3 font-bold text-gray-900">
                    {record.display_name || getDeletedRecordLabel(record.record_data || {})}
                  </td>
                  <td className="p-3 font-mono text-xs text-gray-500">{record.record_id}</td>
                  <td className="p-3 text-gray-600">{record.deleted_by || 'غير معروف'}</td>
                  <td className="p-3 text-gray-600">
                    {record.created ? new Date(record.created).toLocaleString('ar-EG') : '-'}
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      disabled={restoreMutation.isPending}
                      onClick={() => setRestoreConfirmRecord(record)}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {restoreMutation.isPending && restoreMutation.variables?.id === record.id ? 'جاري الاستعادة...' : 'استعادة'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {restoreConfirmRecord && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !restoreMutation.isPending) {
              setRestoreConfirmRecord(null);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-confirm-title"
            className="w-full max-w-md space-y-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl"
          >
            <h2 id="restore-confirm-title" className="text-lg font-black text-gray-900">
              تأكيد استعادة السجل
            </h2>
            <p className="text-sm leading-7 text-gray-600">
              هل تريد استعادة «{restoreConfirmRecord.display_name || getDeletedRecordLabel(restoreConfirmRecord.record_data || {})}»؟
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={restoreMutation.isPending}
                onClick={() => setRestoreConfirmRecord(null)}
                className="rounded-xl bg-gray-100 px-4 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-200 disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate(restoreConfirmRecord)}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {restoreMutation.isPending ? 'جاري الاستعادة...' : 'تأكيد الاستعادة'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
