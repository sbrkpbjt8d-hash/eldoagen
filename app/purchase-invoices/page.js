'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import { isFactoryAdmin } from '../lib/deleted-records';
import { getPendingDeletionActionKeys, requestCompoundOperation } from '../lib/approval-requests';
import {
  isPurchaseInvoiceApproved,
  PURCHASE_INVOICE_APPROVED,
  PURCHASE_INVOICE_PENDING,
} from '../lib/purchase-approval';

const emptyForm = { supplierId: '', items: [], discount: '', paymentType: 'credit' };
const money = value => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 1 })} ج.م`;

export default function PurchaseInvoicesPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const [materialSearch, setMaterialSearch] = useState('');
  const [materialDropdownOpen, setMaterialDropdownOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [detailsInvoice, setDetailsInvoice] = useState(null);
  const [deleteInvoice, setDeleteInvoice] = useState(null);
  const [isPurchaseHistoryExpanded, setIsPurchaseHistoryExpanded] = useState(false);
  const [message, setMessage] = useState({ text: '', type: 'success' });

  const notify = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: 'success' }), 4000);
  };

  const { data: materials = [] } = useQuery({
    queryKey: ['khamat_moashe'],
    queryFn: () => pb.collection('khamat_moashe').getFullList().catch(() => []),
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => pb.collection('suppliers').getFullList().catch(() => []),
  });
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['purchase_invoices'],
    queryFn: () => pb.collection('purchase_invoices').getFullList().catch(() => []),
  });
  const { data: pendingDeletionKeys = [], isError: pendingDeletionLoadFailed } = useQuery({
    queryKey: ['pending_manager_deletion_action_keys'],
    queryFn: getPendingDeletionActionKeys,
    refetchOnWindowFocus: true,
    refetchInterval: 15000,
  });
  const pendingDeletionKeySet = new Set(pendingDeletionKeys);

  const { data: supplierTransactions = [] } = useQuery({
    queryKey: ['all_supplier_transactions'],
    queryFn: () => pb.collection('supplier_transactions').getFullList().catch(() => []),
  });

  const getSupplierDerivedBalance = supplierId => {
    const normalizedId = String(supplierId || '');
    const transactionTotal = supplierTransactions
      .filter(transaction => String(transaction.supplier_id || '') === normalizedId)
      .reduce((sum, transaction) => {
        const type = String(transaction.type || '').toLowerCase();
        const amount = Number(transaction.amount || 0);
        if (type === 'opening_balance') return sum + amount;
        if (type === 'payment') return sum - amount;
        return sum + amount;
      }, 0);

    const purchaseTotal = invoices
      .filter(invoice => String(invoice.supplier_id || '') === normalizedId)
      .filter(isPurchaseInvoiceApproved)
      .reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0);

    return transactionTotal + purchaseTotal;
  };

  const selectedSupplierName = suppliers.find(supplier => supplier.id === form.supplierId)?.name || '';
  const filteredSuppliers = suppliers.filter(supplier => String(supplier.name || '').toLowerCase().includes(supplierSearch.toLowerCase().trim()));
  const filteredMaterials = materials.filter(material => String(material.name || '').toLowerCase().includes(materialSearch.toLowerCase().trim()));

  const subtotal = form.items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
  const discount = Number(form.discount || 0);
  const total = Math.max(0, subtotal - discount);

  const isAdmin = isFactoryAdmin();
  const canRequestChanges = Boolean(pb.authStore.model);

  const saveMutation = useMutation({
    mutationFn: async ({ invoiceNumber }) => {
      if (editingInvoice && !isPurchaseInvoiceApproved(editingInvoice)) {
        throw new Error('لا يمكن تعديل فاتورة لم تعتمد بعد.');
      }

      const supplier = suppliers.find(item => item.id === form.supplierId);
      if (!supplier) throw new Error('اختر المورد أولاً');
      const oldInvoice = editingInvoice;
      const needsApproval = !oldInvoice && !isAdmin;
      const data = {
        invoice_number: oldInvoice?.invoice_number || invoiceNumber,
        supplier_id: supplier.id,
        supplier_name: supplier.name,
        items: form.items,
        sub_total: subtotal,
        discount,
        total_amount: total,
        payment_type: form.paymentType,
        actor_name: pb.authStore.model?.name || pb.authStore.model?.email || 'مستخدم',
        status: needsApproval ? PURCHASE_INVOICE_PENDING : oldInvoice?.status || PURCHASE_INVOICE_APPROVED,
      };

      if (needsApproval) {
        return pb.collection('purchase_invoices').create(data);
      }

      const stockAfterReversal = new Map(
        materials.map(material => [material.id, Number(material.stock ?? 0)])
      );

      const actions = [];

      // 1. في حالة التعديل: عكس التأثير القديم على المخزون
      if (oldInvoice) {
        for (const item of oldInvoice.items || []) {
          const material = materials.find(record => record.id === (item.materialId || item.material_id));
          if (material) {
            const reversedStock = (stockAfterReversal.get(material.id) ?? 0) - Number(item.qty || 0);
            stockAfterReversal.set(material.id, reversedStock);
          }
        }
      }

      // 2. تجهيز تأثير المخزون الجديد ضمن طلب الاعتماد
      const materialChanges = new Map();
      for (const item of form.items) {
        const material = materials.find(record => record.id === item.materialId);
        if (material) {
          const oldStock = stockAfterReversal.get(material.id) ?? Number(material.stock ?? 0);
          const qty = Number(item.qty || 0);
          const price = Number(item.price || 0);
          const newStock = oldStock + qty;
          const averagePrice = oldStock > 0
            ? ((oldStock * Number(material.price || 0)) + qty * price) / newStock
            : price;
          stockAfterReversal.set(material.id, newStock);
          materialChanges.set(material.id, {
            type: 'update',
            collection: 'khamat_moashe',
            id: material.id,
            data: { stock: newStock, price: averagePrice },
          });
        }
      }
      actions.push(...materialChanges.values());

      // 3. تجهيز تحديثات أرصدة الموردين والفاتورة ضمن طلب واحد
      const supplierBalanceChanges = new Map();
      if (oldInvoice?.payment_type === 'credit') {
        supplierBalanceChanges.set(
          oldInvoice.supplier_id,
          (supplierBalanceChanges.get(oldInvoice.supplier_id) || 0) - Number(oldInvoice.total_amount || 0),
        );
      }
      if (form.paymentType === 'credit') {
        supplierBalanceChanges.set(
          supplier.id,
          (supplierBalanceChanges.get(supplier.id) || 0) + total,
        );
      }
      for (const [supplierId, balanceChange] of supplierBalanceChanges) {
        if (!supplierId) continue;
        actions.push({
          type: 'update',
          collection: 'suppliers',
          id: supplierId,
          data: { balance: getSupplierDerivedBalance(supplierId) + balanceChange },
        });
      }

      actions.push(oldInvoice
        ? { type: 'update', collection: 'purchase_invoices', id: oldInvoice.id, data }
        : { type: 'create', collection: 'purchase_invoices', data });
      await requestCompoundOperation(actions, `تعديل فاتورة الشراء ${data.invoice_number}`);
      return { approvalRequested: true };
    },
    onSuccess: saved => {
      queryClient.invalidateQueries({ queryKey: ['purchase_invoices'] });
      queryClient.invalidateQueries({ queryKey: ['khamat_moashe'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setForm(emptyForm);
      setSupplierSearch('');
      setMaterialSearch('');
      setSupplierDropdownOpen(false);
      setMaterialDropdownOpen(false);
      setEditingInvoice(null);
      notify(saved.approvalRequested
        ? 'تم إرسال تعديل فاتورة الشراء للمدير لاعتماده.'
        : saved.status === PURCHASE_INVOICE_PENDING
        ? 'تم إرسال فاتورة الشراء للمدير لاعتمادها.'
        : 'تم حفظ فاتورة الشراء وتحديث المخزون بنجاح.');
    },
    onError: error => notify(`فشل الحفظ: ${error.message}`, 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: async invoice => {
      const actions = [];

      if (isPurchaseInvoiceApproved(invoice)) {
        const materialChanges = new Map();
        for (const item of invoice.items || []) {
          const material = materials.find(record => record.id === (item.materialId || item.material_id));
          if (material) {
            const currentStock = materialChanges.get(material.id)?.data.stock ?? Number(material.stock ?? 0);
            materialChanges.set(material.id, {
              type: 'update',
              collection: 'khamat_moashe',
              id: material.id,
              data: {
                stock: currentStock - Number(item.qty || item.quantity || 0),
              },
            });
          }
        }
        actions.push(...materialChanges.values());
        if (invoice.payment_type === 'credit') {
          const supplier = suppliers.find(item => item.id === invoice.supplier_id);
          if (supplier) {
            actions.push({
              type: 'update',
              collection: 'suppliers',
              id: supplier.id,
              data: {
                balance: getSupplierDerivedBalance(supplier.id) - Number(invoice.total_amount || 0),
              },
            });
          }
        }
      }
      actions.push({
        type: 'delete',
        collection: 'purchase_invoices',
        id: invoice.id,
        record_label: invoice.invoice_number || invoice.id,
      });
      await requestCompoundOperation(actions, `حذف فاتورة الشراء ${invoice.invoice_number || invoice.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase_invoices'] });
      queryClient.invalidateQueries({ queryKey: ['khamat_moashe'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['pending_manager_approvals'] });
      queryClient.invalidateQueries({ queryKey: ['pending_manager_deletion_action_keys'] });
      setDeleteInvoice(null);
      notify('تم حذف فاتورة الشراء وإرجاع أثرها إلى المخزون ورصيد المورد بنجاح.');
    },
    onError: error => notify(`فشل الحذف: ${error.message}`, 'error'),
  });

  const filteredInvoices = invoices.filter(invoice => {
    const query = search.toLowerCase();
    const date = String(invoice.created || '').slice(0, 10);
    return (invoice.supplier_name?.toLowerCase().includes(query) || invoice.invoice_number?.toLowerCase().includes(query)) && (!startDate || date >= startDate) && (!endDate || date <= endDate);
  });
  const filteredTotal = filteredInvoices
    .filter(isPurchaseInvoiceApproved)
    .reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0);

  const addMaterial = id => {
    const material = materials.find(item => item.id === id);
    if (!material || form.items.some(item => item.materialId === id)) return;
    setForm({ ...form, items: [...form.items, { materialId: id, name: material.name, price: Number(material.price || 0), qty: 1 }] });
  };

  const editInvoice = invoice => {
    if (!isPurchaseInvoiceApproved(invoice)) {
      notify('الفاتورة المعلقة تحتاج إلى اعتماد أو رفض من صفحة المدير.', 'error');
      return;
    }
    setEditingInvoice(invoice);
    setDetailsInvoice(null);
    const selectedSupplier = suppliers.find(supplier => supplier.id === invoice.supplier_id);
    const invoiceDiscount = invoice.discount ?? invoice.discount_amount ?? 0;
    setForm({ supplierId: invoice.supplier_id || '', items: invoice.items || [], discount: String(invoiceDiscount || ''), paymentType: 'credit' });
    setSupplierSearch(selectedSupplier?.name || invoice.supplier_name || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = event => {
    event.preventDefault();
    if (!form.supplierId) return notify('اختر المورد أولاً.', 'error');
    if (!form.items.length) return notify('أضف خامة واحدة على الأقل للفاتورة.', 'error');
    saveMutation.mutate({
      invoiceNumber: `PUR-${Date.now().toString().slice(-6)}`,
    });
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8" dir="rtl">
      {message.text && (
        <div className={`p-4 rounded-2xl text-xs font-bold ${message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
          {message.text}
        </div>
      )}
      {pendingDeletionLoadFailed && (
        <div role="alert" className="rounded-2xl bg-amber-50 p-4 text-xs font-bold text-amber-800">
          تعذر تحميل طلبات الحذف المعلقة؛ قد لا تظهر علامة الانتظار على الفواتير.
        </div>
      )}

      {deleteInvoice && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-black">تأكيد حذف الفاتورة</h3>
            <p className="text-xs text-gray-500">سيتم حذف الفاتورة {deleteInvoice.invoice_number} وإرجاع أثرها إلى المخزون ورصيد المورد مباشرةً.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteInvoice(null)} disabled={deleteMutation.isPending} className="flex-1 bg-gray-100 p-3 rounded-xl text-xs font-bold disabled:opacity-50">إلغاء</button>
              <button onClick={() => deleteMutation.mutate(deleteInvoice)} disabled={deleteMutation.isPending} className="flex-1 bg-red-600 text-white p-3 rounded-xl text-xs font-bold disabled:opacity-50">
                {deleteMutation.isPending ? 'جاري إرسال الطلب...' : 'إرسال طلب الحذف'}
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="border-b pb-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-gray-900">🧾 فواتير شراء الخامات</h1>
          <p className="text-sm text-gray-500 mt-1">إدارة شراء الخامات وتحديث المخزون</p>
        </div>
        <span className="bg-blue-50 text-blue-700 px-4 py-2 rounded-xl text-xs font-bold">{invoices.length} فاتورة</span>
      </header>

      <form onSubmit={submit} className="bg-white rounded-3xl p-6 shadow-xl border space-y-5">
        <h2 className="text-lg font-black border-b pb-3">{editingInvoice ? '✏️ تعديل فاتورة شراء' : '➕ فاتورة شراء جديدة'}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="relative">
            <input
              required
              type="text"
              value={supplierDropdownOpen ? supplierSearch : selectedSupplierName}
              onFocus={() => { setSupplierSearch(''); setSupplierDropdownOpen(true); }}
              onChange={e => { setSupplierSearch(e.target.value); setForm({ ...form, supplierId: '' }); setSupplierDropdownOpen(true); }}
              placeholder="ابحث عن المورد..."
              className="w-full border p-3 rounded-xl text-xs font-bold"
            />
            {supplierDropdownOpen && (
              <div className="absolute z-30 mt-1 w-full max-h-52 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl">
                {filteredSuppliers.length ? filteredSuppliers.map(supplier => (
                  <button key={supplier.id} type="button" onClick={() => { setForm({ ...form, supplierId: supplier.id }); setSupplierSearch(supplier.name || ''); setSupplierDropdownOpen(false); }} className="block w-full px-4 py-2.5 text-right text-xs font-bold hover:bg-blue-50">{supplier.name}</button>
                )) : <p className="p-3 text-xs text-gray-400">لا يوجد مورد بهذا الاسم.</p>}
              </div>
            )}
          </div>
          <div className="relative">
            <input
              type="text"
              value={materialDropdownOpen ? materialSearch : ''}
              onFocus={() => { setMaterialSearch(''); setMaterialDropdownOpen(true); }}
              onChange={e => { setMaterialSearch(e.target.value); setMaterialDropdownOpen(true); }}
              placeholder="ابحث عن الخامة المسجلة..."
              className="w-full border p-3 rounded-xl text-xs font-bold"
            />
            {materialDropdownOpen && (
              <div className="absolute z-30 mt-1 w-full max-h-52 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl">
                {filteredMaterials.length ? filteredMaterials.map(material => (
                  <button key={material.id} type="button" onClick={() => { addMaterial(material.id); setMaterialSearch(''); setMaterialDropdownOpen(false); }} className="block w-full px-4 py-2.5 text-right text-xs font-bold hover:bg-amber-50">{material.name}</button>
                )) : <p className="p-3 text-xs text-gray-400">لا توجد خامة بهذا الاسم.</p>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 p-3 rounded-xl text-xs font-bold text-amber-700">
            <span>⏳</span><span>فاتورة آجل - تُسجل كمستحقات على المورد</span>
          </div>
        </div>
        <div className="border rounded-2xl overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3">الخامة</th>
                <th className="p-3">سعر الشراء</th>
                <th className="p-3">الكمية</th>
                <th className="p-3">الإجمالي</th>
                <th className="p-3">إزالة</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {form.items.map(item => (
                <tr key={item.materialId}>
                  <td className="p-3 font-bold">{item.name}</td>
                  <td className="p-3">
                    <input type="number" min="0" step="0.01" value={item.price} onChange={e => setForm({ ...form, items: form.items.map(row => row.materialId === item.materialId ? { ...row, price: Number(e.target.value) } : row) })} className="w-28 border p-2 rounded-lg" />
                  </td>
                  <td className="p-3">
                    <input type="number" min="0.001" step="any" value={item.qty} onChange={e => setForm({ ...form, items: form.items.map(row => row.materialId === item.materialId ? { ...row, qty: Number(e.target.value) } : row) })} className="w-24 border p-2 rounded-lg" />
                  </td>
                  <td className="p-3 font-black text-blue-700">{money(item.price * item.qty)}</td>
                  <td className="p-3">
                    <button type="button" onClick={() => setForm({ ...form, items: form.items.filter(row => row.materialId !== item.materialId) })} className="text-red-600 font-bold">✕</button>
                  </td>
                </tr>
              ))}
              {!form.items.length && <tr><td colSpan="5" className="p-8 text-center text-gray-400">لم تتم إضافة خامات.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <input type="number" min="0" step="0.01" placeholder="الخصم" value={form.discount} onChange={e => setForm({ ...form, discount: e.target.value })} className="border p-3 rounded-xl text-xs" />
          <div className="bg-gray-50 p-3 rounded-xl text-xs font-bold">
            المجموع: {money(subtotal)}<br />
            <span className="text-emerald-700">الصافي: {money(total)}</span>
          </div>
          <button type="submit" disabled={saveMutation.isPending} className="bg-blue-600 text-white p-3 rounded-xl text-xs font-black">
            {saveMutation.isPending ? 'جاري الحفظ...' : editingInvoice ? 'حفظ التعديل' : 'حفظ الفاتورة'}
          </button>
        </div>
      </form>

      <section className={`purchase-history-print-area bg-white rounded-3xl p-6 shadow-xl border space-y-5 ${isPurchaseHistoryExpanded ? 'purchase-history-expanded fixed inset-0 z-40 overflow-auto rounded-none' : ''}`}>
        <div className="flex flex-col md:flex-row justify-between gap-3 border-b pb-3">
          <h2 className="text-lg font-black">📋 سجل فواتير الشراء</h2>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex flex-wrap gap-2 print:hidden">
            <input placeholder="بحث باسم المورد أو رقم الفاتورة" value={search} onChange={e => setSearch(e.target.value)} className="border p-2 rounded-xl text-xs" />
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border p-2 rounded-xl text-xs" />
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border p-2 rounded-xl text-xs" />
            </div>
            {isPurchaseHistoryExpanded && <button type="button" onClick={() => window.print()} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold print:hidden">🖨️ طباعة السجل</button>}
            <button type="button" onClick={() => setIsPurchaseHistoryExpanded((expanded) => !expanded)} className="bg-gray-900 text-white px-4 py-2 rounded-xl text-xs font-bold print:hidden">
              {isPurchaseHistoryExpanded ? 'إغلاق السجل' : 'عرض السجل'}
            </button>
          </div>
        </div>
        <div className="bg-blue-50 p-4 rounded-2xl flex justify-between text-xs font-bold">
          <span>إجمالي المشتريات المفلترة</span>
          <span className="text-blue-800">{money(filteredTotal)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3">رقم الفاتورة</th>
                <th className="p-3">المورد</th>
                <th className="p-3">الدفع</th>
                <th className="p-3">الإجمالي</th>
                <th className="p-3">حالة الاعتماد</th>
                <th className="p-3">التاريخ</th>
                <th className="p-3">بواسطة</th>
                <th className="p-3 print:hidden">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredInvoices.map(invoice => (
                <tr key={invoice.id}>
                  <td className="p-3 font-bold">{invoice.invoice_number}</td>
                  <td className="p-3">{invoice.supplier_name}</td>
                  <td className="p-3">{invoice.payment_type === 'credit' ? 'آجل' : 'كاش'}</td>
                  <td className="p-3 font-black text-blue-700">{money(invoice.total_amount)}</td>
                  <td className="p-3">
                    {invoice.status === PURCHASE_INVOICE_PENDING ? (
                      <span className="rounded-lg bg-amber-100 px-2 py-1 font-bold text-amber-800">بانتظار اعتماد المدير</span>
                    ) : invoice.status === 'مرفوضة' ? (
                      <span className="rounded-lg bg-red-100 px-2 py-1 font-bold text-red-700">مرفوضة</span>
                    ) : (
                      <span className="rounded-lg bg-emerald-100 px-2 py-1 font-bold text-emerald-800">معتمدة</span>
                    )}
                  </td>
                  <td className="p-3">{dateValue(invoice.created)}</td>
                  <td className="p-3 font-bold">{invoice.actor_name || 'غير معروف'}</td>
                  <td className="p-3 flex gap-1 print:hidden">
                    <button onClick={() => setDetailsInvoice(invoice)} className="bg-blue-50 text-blue-700 px-2.5 py-1.5 rounded-lg font-bold">عرض</button>
                    {canRequestChanges && (
                      <>
                        {isPurchaseInvoiceApproved(invoice) && (
                          <button onClick={() => editInvoice(invoice)} className="bg-amber-50 text-amber-700 px-2.5 py-1.5 rounded-lg font-bold">تعديل</button>
                        )}
                        <button
                          onClick={() => setDeleteInvoice(invoice)}
                          className="bg-red-50 text-red-600 px-2.5 py-1.5 rounded-lg font-bold disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          حذف
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!filteredInvoices.length && <tr><td colSpan="8" className="p-8 text-center text-gray-400">لا توجد فواتير.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {detailsInvoice && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-2xl w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between border-b pb-3">
              <h3 className="font-black">تفاصيل الفاتورة: {detailsInvoice.invoice_number}</h3>
              <button onClick={() => setDetailsInvoice(null)}>✕</button>
            </div>
            <p className="text-xs font-bold text-gray-600">المورد: {detailsInvoice.supplier_name} | المنفذ: {detailsInvoice.actor_name || 'غير معروف'}</p>
            
            <div className="border rounded-2xl overflow-hidden">
              <table className="w-full text-right text-xs">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-3">الخامة</th>
                    <th className="p-3">سعر الطن (الوحدة)</th>
                    <th className="p-3">الكمية</th>
                    <th className="p-3">الإجمالي</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(detailsInvoice.items || []).map(item => (
                    <tr key={item.materialId}>
                      <td className="p-3 font-bold">{item.name}</td>
                      <td className="p-3 text-emerald-700 font-bold">{money(item.price)}</td>
                      <td className="p-3">{item.qty}</td>
                      <td className="p-3 font-black text-blue-700">{money(Number(item.price || 0) * Number(item.qty || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-gray-50 p-4 rounded-2xl space-y-1 text-xs font-bold flex flex-col items-end">
              <div>المجموع الفرعي: {money(detailsInvoice.sub_total)}</div>
              {(() => {
                const invoiceDiscount = detailsInvoice.discount ?? detailsInvoice.discount_amount ?? 0;
                return Number(invoiceDiscount) > 0 && <div className="text-red-600">الخصم: -{money(invoiceDiscount)}</div>;
              })()}
              <div className="text-sm font-black text-blue-800 border-t pt-2">الصافي الإجمالي: {money(detailsInvoice.total_amount)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function dateValue(value) {
  return String(value || '').slice(0, 10) || '-';
}