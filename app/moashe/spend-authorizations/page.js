'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useReactToPrint } from 'react-to-print';
import { pb } from '../../lib/pocketbase';

const emptyAuthorization = {
  expense_type: '',
  amount: '',
  counterpart: '',
  recipient_name: '',
  recipient_signature: '',
  employee_name: '',
  manager_name: '',
};

const fieldClassName = 'h-12 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-4 text-sm font-medium text-slate-900 outline-none transition-all duration-200 focus:border-teal-600 focus:bg-white focus:ring-4 focus:ring-teal-600/10';
const labelClassName = 'mb-2 block text-xs font-bold tracking-wide text-slate-600';
const formatAmount = (value) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
const formatDate = (value) => new Date(value).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

export default function SpendAuthorizationPage() {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState(emptyAuthorization);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedAuthorization, setSelectedAuthorization] = useState(null);
  const [pendingDeleteAuthorization, setPendingDeleteAuthorization] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const authorizationPrintRef = useRef(null);
  const printAuthorization = useReactToPrint({
    contentRef: authorizationPrintRef,
    documentTitle: () => `إذن_صرف_${selectedAuthorization?.expense_type || 'الزعيم'}`,
    pageStyle: `
      @page { size: A4 portrait; margin: 14mm; }
      html, body { direction: rtl; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .spend-authorization-print-document { padding: 8mm; font-family: Arial, sans-serif; }
      .spend-authorization-print-document h2 { margin: 0 0 6px; text-align: center; font-size: 22px; }
      .spend-authorization-print-document .document-subtitle { margin: 0 0 18px; text-align: center; font-size: 16px; }
      .spend-authorization-print-document .document-meta { margin: 0 0 24px; border-bottom: 2px solid #334155; padding-bottom: 12px; text-align: center; font-size: 12px; }
      .spend-authorization-print-document dl { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 28px; }
      .spend-authorization-print-document dt { margin-bottom: 6px; color: #475569; font-size: 11px; font-weight: bold; }
      .spend-authorization-print-document dd { min-height: 24px; margin: 0; border-bottom: 1px solid #cbd5e1; padding-bottom: 7px; font-size: 14px; font-weight: bold; }
      .spend-authorization-print-document .document-amount { grid-column: 1 / -1; margin: 0 0 4px; border: 1px solid #cbd5e1; padding: 12px; text-align: center; font-size: 20px; font-weight: bold; }
      .spend-authorization-print-document .document-wide { grid-column: 1 / -1; }
      .spend-authorization-print-document .document-signature { min-height: 50px; }
    `,
  });

  const { data: authorizations = [], isLoading, isError, error } = useQuery({
    queryKey: ['spend-authorizations'],
    queryFn: () => pb.collection('spend_authorizations').getFullList({ sort: '-created', requestKey: null }),
  });

  const updateField = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
    setFeedback(null);
  };

  const submitAuthorization = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setFeedback(null);

    try {
      const user = pb.authStore.model;
      await pb.collection('spend_authorizations').create({
        ...formData,
        amount: Number(formData.amount),
        actor_name: user?.name || user?.username || user?.email || 'مستخدم',
        created_by: user?.id,
      });
      setFormData(emptyAuthorization);
      setFeedback({ type: 'success', message: 'تم إنشاء إذن الصرف وحفظه بنجاح.' });
      await queryClient.invalidateQueries({ queryKey: ['spend-authorizations'] });
    } catch (error) {
      setFeedback({
        type: 'error',
        message: `تعذر حفظ الإذن: ${error?.response?.message || error.message || 'حدث خطأ غير متوقع.'}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const filteredAuthorizations = authorizations.filter((authorization) => {
    const search = searchTerm.trim().toLocaleLowerCase();
    const matchesSearch = !search || [
      authorization.expense_type,
      authorization.counterpart,
      authorization.recipient_name,
      authorization.employee_name,
      authorization.manager_name,
      authorization.actor_name,
      authorization.amount,
    ].some((value) => String(value || '').toLocaleLowerCase().includes(search));
    const recordDate = new Date(authorization.created).toISOString().slice(0, 10);
    return matchesSearch && (!dateFrom || recordDate >= dateFrom) && (!dateTo || recordDate <= dateTo);
  });

  const deleteAuthorization = async () => {
    const authorization = pendingDeleteAuthorization;
    if (!authorization) return;
    setDeletingId(authorization.id);
    setFeedback(null);
    try {
      await pb.collection('spend_authorizations').delete(authorization.id);
      if (selectedAuthorization?.id === authorization.id) setSelectedAuthorization(null);
      setPendingDeleteAuthorization(null);
      setFeedback({ type: 'success', message: 'تم حذف إذن الصرف بنجاح.' });
      await queryClient.invalidateQueries({ queryKey: ['spend-authorizations'] });
    } catch (deleteError) {
      setFeedback({
        type: 'error',
        message: `تعذر حذف الإذن: ${deleteError?.response?.message || deleteError.message || 'حدث خطأ غير متوقع.'}`,
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 pb-16 text-slate-900 sm:px-6" dir="rtl">
      {/* Header */}
      <header className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center justify-between">
          <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-black uppercase tracking-wider text-teal-700">الإدارة المالية</span>
          <span className="text-xs font-bold text-slate-400">شركة الزعيم للأعلاف</span>
        </div>
        <h1 className="mt-4 text-center text-2xl font-black text-slate-800 sm:text-3xl">إذن الصرف المالي</h1>
        <p className="mt-1 text-center text-sm font-medium text-slate-500">تسجيل ومتابعة أذونات الصرف بدقة واحترافية</p>
      </header>

      {/* Form Section */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="mb-6 text-lg font-black text-slate-800 border-b border-slate-100 pb-3">إضافة إذن صرف جديد</h2> 
        <form onSubmit={submitAuthorization} className="space-y-6">
            

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            
            <div className="sm:col-span-2">
              <label htmlFor="expense_type" className={labelClassName}>نوع المصروف</label>
              <input
                id="expense_type"
                name="expense_type"
                type="text"
                value={formData.expense_type}
                onChange={updateField}
                className={fieldClassName}
                placeholder="أدخل نوع المصروف..."
                required
              />
            </div>

            <div>
              <label htmlFor="amount" className={labelClassName}>المبلغ (ج.م)</label>
              <input
                id="amount"
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={formData.amount}
                onChange={updateField}
                className={`${fieldClassName} tabular-nums`}
                placeholder="0.00"
                required
              />
            </div>

            <div>
              <label htmlFor="counterpart" className={labelClassName}>مقابل (البيان)</label>
              <input
                id="counterpart"
                name="counterpart"
                type="text"
                value={formData.counterpart}
                onChange={updateField}
                className={fieldClassName}
                placeholder="أدخل البيان أو السبب..."
                required
              />
            </div>

            <div>
              <label htmlFor="recipient_name" className={labelClassName}>اسم المستلم</label>
              <input
                id="recipient_name"
                name="recipient_name"
                type="text"
                value={formData.recipient_name}
                onChange={updateField}
                className={fieldClassName}
                placeholder="اسم الشخص المستلم..."
                required
              />
            </div>

            <div>
              <label htmlFor="recipient_signature" className={labelClassName}>توقيع المستلم</label>
              <input
                id="recipient_signature"
                name="recipient_signature"
                type="text"
                value={formData.recipient_signature}
                onChange={updateField}
                className={fieldClassName}
                placeholder="التوقيع أو المرجع..."
              />
            </div>

            {/* <div>
              <label htmlFor="employee_name" className={labelClassName}>الموظف المسؤول</label>
              <input
                id="employee_name"
                name="employee_name"
                type="text"
                value={formData.employee_name}
                onChange={updateField}
                className={fieldClassName}
                placeholder="اسم الموظف..."
                required
              />
            </div> */}

            <div>
              <label htmlFor="manager_name" className={labelClassName}>اعتماد المدير</label>
              <input
                id="manager_name"
                name="manager_name"
                type="text"
                value={formData.manager_name}
                onChange={updateField}
                className={fieldClassName}
                placeholder="اسم المدير المعتمد..."
              />
            </div>
          </div>

          {feedback && (
            <p
              role={feedback.type === 'error' ? 'alert' : 'status'}
              className={`rounded-xl border-r-4 px-4 py-3 text-sm font-bold shadow-sm ${feedback.type === 'error' ? 'border-rose-600 bg-rose-50 text-rose-900' : 'border-emerald-600 bg-emerald-50 text-emerald-900'}`}
            >
              {feedback.message}
            </p>
          )}

          <div className="flex justify-end border-t border-slate-100 pt-5">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex min-h-12 min-w-44 items-center justify-center rounded-xl bg-teal-700 px-6 text-sm font-black text-white shadow-lg shadow-teal-700/20 transition-all duration-200 hover:bg-teal-800 hover:shadow-none disabled:cursor-wait disabled:opacity-60"
            >
              {isSaving ? 'جارٍ الحفظ والمراجعة...' : 'إنشاء وحفظ إذن الصرف'}
            </button>
          </div>
        </form>
      </section>

      {/* Table Section */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="authorizations-heading">
        <div className="mb-6 flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 id="authorizations-heading" className="text-xl font-black text-slate-800">سجل أذونات الصرف</h2>
            <p className="mt-1 text-xs font-bold text-slate-400">إجمالي السجلات المتاحة: {filteredAuthorizations.length}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <input
              type="search"
              aria-label="بحث في أذونات الصرف"
              placeholder="ابحث بالنوع أو الاسم أو المبلغ..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="h-11 rounded-xl border border-slate-200 bg-slate-50/50 px-3 text-sm outline-none focus:border-teal-600 focus:bg-white sm:col-span-4"
            />
            <label className="flex items-center gap-2 text-xs font-bold text-slate-600 sm:col-span-2">
              <span className="shrink-0">من</span>
              <input type="date" aria-label="تاريخ البداية" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50/50 px-2 text-xs" />
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-600 sm:col-span-2">
              <span className="shrink-0">إلى</span>
              <input type="date" aria-label="تاريخ النهاية" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50/50 px-2 text-xs" />
            </label>
          </div>
        </div>

        {/* Clear search filter button if active */}
        {(searchTerm || dateFrom || dateTo) && (
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={() => { setSearchTerm(''); setDateFrom(''); setDateTo(''); }}
              className="text-xs font-bold text-teal-700 hover:underline"
            >
              إلغاء الفلترة وتطهير البحث ✕
            </button>
          </div>
        )}

        {isError && <p role="alert" className="rounded-xl border-r-4 border-rose-600 bg-rose-50 p-4 text-sm font-bold text-rose-900">تعذر تحميل سجل الأذونات: {error?.message || 'تحقق من اتصال قاعدة البيانات.'}</p>}

        {isLoading ? (
          <div className="py-16 text-center text-sm font-bold text-slate-400">جارٍ تحميل أذونات الصرف...</div>
        ) : filteredAuthorizations.length === 0 ? (
          <div className="py-16 text-center text-sm font-medium text-slate-400">لا توجد أذونات صرف مطابقة لمعايير البحث الحالية.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full min-w-180 text-right text-sm">
              <thead className="bg-slate-50 text-xs font-black text-slate-500">
                <tr>
                  <th className="p-4">م</th>
                  <th className="p-4">التاريخ</th>
                  <th className="p-4">نوع المصروف</th>
                  <th className="p-4">المبلغ</th>
                  <th className="p-4">المستلم</th>
                  <th className="p-4 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAuthorizations.map((authorization, index) => (
                  <tr key={authorization.id} className="transition-colors hover:bg-teal-50/30">
                    <td className="p-4 font-bold tabular-nums text-slate-500">{index + 1}</td>
                    <td className="p-4 whitespace-nowrap text-slate-600">{formatDate(authorization.created)}</td>
                    <td className="p-4 font-black text-slate-800">{authorization.expense_type}</td>
                    <td className="p-4 font-black tabular-nums text-teal-700">{formatAmount(authorization.amount)}</td>
                    <td className="p-4 font-medium text-slate-700">{authorization.recipient_name}</td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-2">
                        <button type="button" onClick={() => setSelectedAuthorization(authorization)} className="rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-1.5 text-xs font-bold text-teal-700 transition hover:bg-teal-700 hover:text-white">عرض</button>
                        <button type="button" onClick={() => setPendingDeleteAuthorization(authorization)} disabled={deletingId === authorization.id} className="rounded-lg border border-rose-200 bg-rose-50/50 px-3 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-600 hover:text-white disabled:opacity-50">
                          {deletingId === authorization.id ? '...' : 'حذف'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal Detail View */}
      {selectedAuthorization && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs" onClick={() => setSelectedAuthorization(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="authorization-detail-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl sm:p-8"
            onClick={(event) => event.stopPropagation()}
          >
            <article ref={authorizationPrintRef} className="spend-authorization-print-document">
              <header className="border-b border-slate-100 pb-5 text-center">
                <h2 className="text-xl font-black text-slate-800">شركة الزعيم للأعلاف</h2>
                <p id="authorization-detail-title" className="document-subtitle mt-2 text-lg font-black text-slate-800">إذن صرف</p>
                <p className="document-meta mt-1 text-xs text-slate-400">رقم الإذن: {authorizations.findIndex((item) => item.id === selectedAuthorization.id) + 1} · تاريخ الإنشاء: {formatDate(selectedAuthorization.created)}</p>
              </header>
              <dl className="mt-6 space-y-4 text-sm">
                <div className="document-amount text-teal-700">{formatAmount(selectedAuthorization.amount)}</div>
                <div><dt className="font-bold text-slate-400">نوع المصروف</dt><dd className="font-black text-slate-800">{selectedAuthorization.expense_type}</dd></div>
                <div><dt className="font-bold text-slate-400">مقابل</dt><dd className="font-medium text-slate-700">{selectedAuthorization.counterpart}</dd></div>
                <div><dt className="font-bold text-slate-400">اسم المستلم</dt><dd className="font-bold text-slate-800">{selectedAuthorization.recipient_name}</dd></div>
                <div className="document-signature"><dt className="font-bold text-slate-400">توقيع المستلم</dt><dd className="font-medium text-slate-700">{selectedAuthorization.recipient_signature || ''}</dd></div>
                <div className="document-signature"><dt className="font-bold text-slate-400">الموظف المسؤول</dt><dd className="font-medium text-slate-700">{selectedAuthorization.employee_name}</dd></div>
                <div className="document-signature"><dt className="font-bold text-slate-400">اعتماد المدير</dt><dd className="font-medium text-slate-700">{selectedAuthorization.manager_name || ''}</dd></div>
                <div className="document-wide"><dt className="font-bold text-slate-400">أنشأ الإذن</dt><dd className="font-medium text-slate-700">{selectedAuthorization.actor_name || 'غير معروف'}</dd></div>
              </dl>
            </article>
            <div className="mt-6 flex flex-wrap justify-end gap-2 print:hidden">
              <button type="button" onClick={printAuthorization} className="min-h-11 rounded-xl bg-teal-700 px-5 text-sm font-bold text-white transition hover:bg-teal-800">طباعة الإذن</button>
              <button type="button" onClick={() => setSelectedAuthorization(null)} className="min-h-11 rounded-xl border border-slate-200 bg-slate-50 px-5 text-sm font-bold text-slate-700 transition hover:bg-slate-100">إغلاق النافذة</button>
            </div>
          </section>
        </div>
      )}

      {pendingDeleteAuthorization && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={() => !deletingId && setPendingDeleteAuthorization(null)}>
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-authorization-title"
            aria-describedby="delete-authorization-description"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            dir="rtl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-authorization-title" className="text-lg font-black text-slate-900">تأكيد حذف إذن الصرف</h2>
            <p id="delete-authorization-description" className="mt-2 text-sm leading-6 text-slate-600">
              سيتم حذف إذن «{pendingDeleteAuthorization.expense_type}» بمبلغ {formatAmount(pendingDeleteAuthorization.amount)} نهائيًا.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDeleteAuthorization(null)}
                disabled={Boolean(deletingId)}
                className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >إلغاء</button>
              <button
                type="button"
                onClick={deleteAuthorization}
                disabled={Boolean(deletingId)}
                className="min-h-10 rounded-lg bg-rose-700 px-4 text-sm font-bold text-white transition hover:bg-rose-800 disabled:cursor-wait disabled:opacity-60"
              >{deletingId ? 'جارٍ الحذف...' : 'تأكيد الحذف'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}