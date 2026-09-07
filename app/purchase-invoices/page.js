'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';

const emptyForm = { supplierId: '', items: [], discount: '', paymentType: 'credit' };
const money = value => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 1 })} ج.م`;

export default function PurchaseInvoicesPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [detailsInvoice, setDetailsInvoice] = useState(null);
  const [deleteInvoice, setDeleteInvoice] = useState(null);
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

  const subtotal = form.items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
  const discount = Number(form.discount || 0);
  const total = Math.max(0, subtotal - discount);

  // تحقق الأدمن (لتعديل وحذف الفواتير القديمة فقط)
  const isAdmin = pb.authStore.model?.collectionName === '_superusers' || pb.authStore.model?.role === 'admin';

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingInvoice && !isAdmin) {
        throw new Error('تعديل الفواتير متاح للأدمن فقط');
      }

      const supplier = suppliers.find(item => item.id === form.supplierId);
      if (!supplier) throw new Error('اختر المورد أولاً');
      const oldInvoice = editingInvoice;

      // 1. في حالة التعديل: عكس التأثير القديم على المخزون ورصيد المورد
      if (oldInvoice) {
        for (const item of oldInvoice.items || []) {
          const material = materials.find(record => record.id === item.materialId);
          if (material) {
            await pb.collection('khamat_moashe').update(material.id, {
              stock: Math.max(0, Number(material.stock || 0) - Number(item.qty || 0))
            });
          }
        }
        if (oldInvoice.payment_type === 'credit') {
          const oldSupplier = suppliers.find(item => item.id === oldInvoice.supplier_id);
          if (oldSupplier) {
            await pb.collection('suppliers').update(oldSupplier.id, {
              balance: Number(oldSupplier.balance || 0) - Number(oldInvoice.total_amount || 0)
            });
          }
        }
      }

      // 2. تجهيز بيانات الفاتورة الجديدة أو المعدلة
      const data = {
        invoice_number: oldInvoice?.invoice_number || `PUR-${Date.now().toString().slice(-6)}`,
        supplier_id: supplier.id,
        supplier_name: supplier.name,
        items: form.items,
        sub_total: subtotal,
        discount,
        total_amount: total,
        payment_type: form.paymentType,
        actor_name: pb.authStore.model?.name || pb.authStore.model?.email || 'مستخدم',
        status: 'مكتملة',
      };

      const saved = oldInvoice
        ? await pb.collection('purchase_invoices').update(oldInvoice.id, data)
        : await pb.collection('purchase_invoices').create(data);

      // 3. تطبيق التأثير الجديد على المخزون (زيادة المخزون وحساب متوسط السعر)
      for (const item of form.items) {
        const material = materials.find(record => record.id === item.materialId);
        if (material) {
          const oldStock = Number(material.stock || 0);
          const qty = Number(item.qty || 0);
          const price = Number(item.price || 0);
          const newStock = oldStock + qty;
          const averagePrice = newStock ? ((oldStock * Number(material.price || 0)) + qty * price) / newStock : price;
          await pb.collection('khamat_moashe').update(material.id, {
            stock: newStock,
            price: averagePrice
          });
        }
      }

      // 4. تحديث رصيد المورد إذا كانت الفاتورة آجل
      if (form.paymentType === 'credit') {
        await pb.collection('suppliers').update(supplier.id, {
          balance: Number(supplier.balance || 0) + total
        });
      }

      return saved;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase_invoices'] });
      queryClient.invalidateQueries({ queryKey: ['khamat_moashe'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setForm(emptyForm);
      setEditingInvoice(null);
      notify('تم حفظ فاتورة الشراء وتحديث المخزون بنجاح.');
    },
    onError: error => notify(`فشل الحفظ: ${error.message}`, 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: async invoice => {
      if (!isAdmin) throw new Error('حذف الفواتير متاح للأدمن فقط');

      for (const item of invoice.items || []) {
        const material = materials.find(record => record.id === item.materialId);
        if (material) {
          await pb.collection('khamat_moashe').update(material.id, {
            stock: Math.max(0, Number(material.stock || 0) - Number(item.qty || 0))
          });
        }
      }
      if (invoice.payment_type === 'credit') {
        const supplier = suppliers.find(item => item.id === invoice.supplier_id);
        if (supplier) {
          await pb.collection('suppliers').update(supplier.id, {
            balance: Number(supplier.balance || 0) - Number(invoice.total_amount || 0)
          });
        }
      }
      await pb.collection('purchase_invoices').delete(invoice.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase_invoices'] });
      queryClient.invalidateQueries({ queryKey: ['khamat_moashe'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setDeleteInvoice(null);
      notify('تم حذف الفاتورة بنجاح.');
    },
    onError: error => notify(`فشل الحذف: ${error.message}`, 'error'),
  });

  const filteredInvoices = invoices.filter(invoice => {
    const query = search.toLowerCase();
    const date = String(invoice.created || '').slice(0, 10);
    return (invoice.supplier_name?.toLowerCase().includes(query) || invoice.invoice_number?.toLowerCase().includes(query)) && (!startDate || date >= startDate) && (!endDate || date <= endDate);
  });
  const filteredTotal = filteredInvoices.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0);

  const addMaterial = id => {
    const material = materials.find(item => item.id === id);
    if (!material || form.items.some(item => item.materialId === id)) return;
    setForm({ ...form, items: [...form.items, { materialId: id, name: material.name, price: Number(material.price || 0), qty: 1 }] });
  };

  const editInvoice = invoice => {
    if (!isAdmin) {
      notify('عذراً، تعديل الفواتير متاح للأدمن فقط.', 'error');
      return;
    }
    setEditingInvoice(invoice);
    setDetailsInvoice(null);
    setForm({ supplierId: invoice.supplier_id || '', items: invoice.items || [], discount: String(invoice.discount || ''), paymentType: 'credit' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = event => {
    event.preventDefault();
    if (!form.supplierId) return notify('اختر المورد أولاً.', 'error');
    if (!form.items.length) return notify('أضف خامة واحدة على الأقل للفاتورة.', 'error');
    saveMutation.mutate();
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8" dir="rtl">
      {message.text && (
        <div className={`p-4 rounded-2xl text-xs font-bold ${message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
          {message.text}
        </div>
      )}

      {deleteInvoice && isAdmin && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-black">تأكيد حذف الفاتورة</h3>
            <p className="text-xs text-gray-500">هل تريد حذف الفاتورة {deleteInvoice.invoice_number}؟</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteInvoice(null)} className="flex-1 bg-gray-100 p-3 rounded-xl text-xs font-bold">إلغاء</button>
              <button onClick={() => deleteMutation.mutate(deleteInvoice)} className="flex-1 bg-red-600 text-white p-3 rounded-xl text-xs font-bold">حذف</button>
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
          <select required value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })} className="border p-3 rounded-xl text-xs font-bold">
            <option value="">اختر المورد</option>
            {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
          <select value="" onChange={e => { addMaterial(e.target.value); e.target.value = ''; }} className="border p-3 rounded-xl text-xs font-bold">
            <option value="">اختر خامة مسجلة</option>
            {materials.map(material => <option key={material.id} value={material.id}>{material.name}</option>)}
          </select>
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

      <section className="bg-white rounded-3xl p-6 shadow-xl border space-y-5">
        <div className="flex flex-col md:flex-row justify-between gap-3 border-b pb-3">
          <h2 className="text-lg font-black">📋 سجل فواتير الشراء</h2>
          <div className="flex flex-wrap gap-2">
            <input placeholder="بحث باسم المورد أو رقم الفاتورة" value={search} onChange={e => setSearch(e.target.value)} className="border p-2 rounded-xl text-xs" />
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border p-2 rounded-xl text-xs" />
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border p-2 rounded-xl text-xs" />
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
                <th className="p-3">التاريخ</th>
                <th className="p-3">بواسطة</th>
                <th className="p-3">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredInvoices.map(invoice => (
                <tr key={invoice.id}>
                  <td className="p-3 font-bold">{invoice.invoice_number}</td>
                  <td className="p-3">{invoice.supplier_name}</td>
                  <td className="p-3">{invoice.payment_type === 'credit' ? 'آجل' : 'كاش'}</td>
                  <td className="p-3 font-black text-blue-700">{money(invoice.total_amount)}</td>
                  <td className="p-3">{dateValue(invoice.created)}</td>
                  <td className="p-3 font-bold">{invoice.actor_name || 'غير معروف'}</td>
                  <td className="p-3 flex gap-1">
                    <button onClick={() => setDetailsInvoice(invoice)} className="bg-blue-50 text-blue-700 px-2.5 py-1.5 rounded-lg font-bold">عرض</button>
                    {isAdmin && (
                      <>
                        <button onClick={() => editInvoice(invoice)} className="bg-amber-50 text-amber-700 px-2.5 py-1.5 rounded-lg font-bold">تعديل</button>
                        <button onClick={() => setDeleteInvoice(invoice)} className="bg-red-50 text-red-600 px-2.5 py-1.5 rounded-lg font-bold">حذف</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!filteredInvoices.length && <tr><td colSpan="7" className="p-8 text-center text-gray-400">لا توجد فواتير.</td></tr>}
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
              {Number(detailsInvoice.discount || 0) > 0 && <div className="text-red-600">الخصم: -{money(detailsInvoice.discount)}</div>}
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