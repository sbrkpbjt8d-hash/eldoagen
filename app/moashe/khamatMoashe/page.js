'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';
import toast, { Toaster } from 'react-hot-toast';

// دالة مساعدة لعرض الأرقام بدون أصفار عشرية لا داعي لها (مثل 11 بدل 11.0000)
function formatNumber(value) {
  const num = Number(value || 0);
  if (isNaN(num)) return '0';
  // يزيل الكسور الزائدة ويحافظ على الكسور الحقيقية إذا وجدت
  return parseFloat(num.toFixed(4)).toString();
}

function currentUserName() {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('userName') || pb.authStore.model?.name || pb.authStore.model?.email || 'مسؤول النظام';
  }
  return 'مسؤول النظام';
}

function checkIfAdmin() {
  if (typeof window !== 'undefined') {
    const user = pb.authStore.model;
    return user?.role === 'admin' || user?.email === 'mohamedfrf@icloud.com';
  }
  return false;
}

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [adjustmentMaterialId, setAdjustmentMaterialId] = useState('');
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [adjustmentStartDate, setAdjustmentStartDate] = useState('');
  const [adjustmentEndDate, setAdjustmentEndDate] = useState('');

  const isAdmin = checkIfAdmin();

  const [openAdjustmentLogs, setOpenAdjustmentLogs] = useState({});

  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
  });

  const [editModal, setEditModal] = useState({
    isOpen: false,
    product: null,
    newName: '',
  });

  const [stockModal, setStockModal] = useState({
    isOpen: false,
    product: null,
    stock: '',
  });

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['khamat_moashe'],
    queryFn: async () => {
      const records = await pb.collection('khamat_moashe').getList(1, 50, {
        sort: '-created',
      });
      return records.items;
    },
  });

  const { data: adjustments = [] } = useQuery({
    queryKey: ['material_adjustments'],
    queryFn: async () => await pb.collection('material_adjustments').getFullList().catch(() => []),
  });

  const addProductMutation = useMutation({
    mutationFn: async (newProduct) => {
      return await pb.collection('khamat_moashe').create(newProduct);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['khamat_moashe'] });
      toast.success('تمت إضافة الصنف بنجاح! 🚀');
      setName('');
      setPrice('');
      setStock('');
    },
    onError: (error) => {
      toast.error('حدث خطأ أثناء الإضافة: ' + (error.message || 'فشل الحفظ'));
    },
  });

  const updateProductNameMutation = useMutation({
    mutationFn: async ({ id, newName }) => {
      const trimmedName = newName.trim();
      const nameExists = products.some(p => p.id !== id && p.name.trim().toLowerCase() === trimmedName.toLowerCase());
      if (nameExists) {
        throw new Error('هذا الاسم مستخدم بالفعل لصنف آخر!');
      }
      return await pb.collection('khamat_moashe').update(id, { name: trimmedName });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['khamat_moashe'] });
      queryClient.invalidateQueries({ queryKey: ['material_adjustments'] });
      toast.success('تم تعديل اسم الخامة بنجاح!');
      setEditModal({ isOpen: false, product: null, newName: '' });
    },
    onError: (error) => {
      toast.error('فشل التعديل: ' + (error.message || 'خطأ غير معروف'));
    },
  });

  const updateStockMutation = useMutation({
    mutationFn: async ({ id, stock }) => {
      if (!isAdmin) throw new Error('عفواً، تعديل الكمية المتاحة متاح للأدمن فقط!');
      const value = Number(stock);
      if (!Number.isFinite(value) || value < 0) throw new Error('أدخل كمية متاحة صحيحة.');
      return await pb.collection('khamat_moashe').update(id, { stock: value, actor_name: currentUserName() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['khamat_moashe'] });
      toast.success('تم تعديل الكمية المتاحة بنجاح!');
      setStockModal({ isOpen: false, product: null, stock: '' });
    },
    onError: (error) => toast.error('فشل تعديل الكمية المتاحة: ' + (error.message || 'خطأ غير معروف')),
  });

  const deleteProductMutation = useMutation({
    mutationFn: async (id) => {
      return await pb.collection('khamat_moashe').delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['khamat_moashe'] });
      toast.success('تم حذف الصنف بنجاح!');
      setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
    },
    onError: (error) => {
      toast.error('حدث خطأ أثناء الحذف: ' + (error.message || 'فشل الحذف'));
      setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
    },
  });

  const deleteAdjustmentMutation = useMutation({
    mutationFn: async (adjustmentId) => {
      if (!isAdmin) {
        throw new Error('عفواً، حذف التسويات متاح للأدمن فقط!');
      }
      return await pb.collection('material_adjustments').delete(adjustmentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['material_adjustments'] });
      toast.success('تم حذف التسوية بنجاح!');
      setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
    },
    onError: (error) => {
      toast.error(error.message || 'فشل حذف التسوية');
      setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
    },
  });

  const adjustmentMutation = useMutation({
    mutationFn: async () => {
      const material = products.find(item => item.id === adjustmentMaterialId);
      const quantity = Number(adjustmentQuantity);
      if (!material) throw new Error('اختر الخامة أولاً');
      if (!quantity || !adjustmentReason.trim()) throw new Error('أدخل كمية التسوية والسبب');
      const oldStock = Number(material.stock || 0);
      const newStock = oldStock + quantity;
      if (newStock < 0) throw new Error('لا يمكن أن تكون كمية المخزون أقل من صفر');
      await pb.collection('khamat_moashe').update(material.id, { stock: newStock });
      return pb.collection('material_adjustments').create({
        material_id: material.id,
        material_name: material.name,
        quantity,
        old_stock: oldStock,
        new_stock: newStock,
        reason: adjustmentReason.trim(),
        actor_name: currentUserName(),
        date: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['khamat_moashe'] });
      queryClient.invalidateQueries({ queryKey: ['material_adjustments'] });
      setAdjustmentMaterialId('');
      setAdjustmentQuantity('');
      setAdjustmentReason('');
      toast.success('تم تنفيذ التسوية وتسجيلها بنجاح!');
    },
    onError: error => toast.error(error.message || 'فشل تنفيذ التسوية'),
  });

  function handleAddProduct(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || !price || !stock) {
      toast.error('الرجاء إدخال جميع البيانات المطلوبة!');
      return;
    }

    const nameExists = products.some(p => p.name.trim().toLowerCase() === trimmedName.toLowerCase());
    if (nameExists) {
      toast.error('هذا الصنف موجود بالفعل ولا يمكن تكرار اسمه!');
      return;
    }

    addProductMutation.mutate({
      name: trimmedName,
      price: Number(price),
      stock: Number(stock),
      actor_name: currentUserName(),
    });
  }

  function handleDeleteClick(product) {
    setConfirmModal({
      isOpen: true,
      title: 'تأكيد حذف الصنف',
      message: `هل أنت متأكد من حذف الصنف "${product.name}" من المخزن بشكل نهائي؟`,
      onConfirm: () => deleteProductMutation.mutate(product.id),
    });
  }

  function handleDeleteAdjustmentClick(adjustment) {
    if (!isAdmin) {
      toast.error('عفواً، حذف التسويات متاح للأدمن فقط!');
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: 'تأكيد حذف التسوية',
      message: `هل أنت متأكد من حذف سجل التسوية الخاصة بالخامة "${adjustment.material_name}" بقيمة (${formatNumber(adjustment.quantity)})؟`,
      onConfirm: () => deleteAdjustmentMutation.mutate(adjustment.id),
    });
  }

  function handleAdjustmentSubmit(event) {
    event.preventDefault();
    adjustmentMutation.mutate();
  }

  const filteredAdjustments = adjustments.filter((adjustment) => {
    const dateValue = String(adjustment.date || adjustment.created || '').slice(0, 10);
    return (!adjustmentStartDate || dateValue >= adjustmentStartDate) && (!adjustmentEndDate || dateValue <= adjustmentEndDate);
  });

  const totalIncrease = filteredAdjustments
    .filter(adjustment => Number(adjustment.quantity || 0) > 0)
    .reduce((sum, adjustment) => sum + Number(adjustment.quantity || 0), 0);

  const totalDecrease = filteredAdjustments
    .filter(adjustment => Number(adjustment.quantity || 0) < 0)
    .reduce((sum, adjustment) => sum + Math.abs(Number(adjustment.quantity || 0)), 0);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 relative" dir="rtl">
      <Toaster position="top-center" reverseOrder={false} />

      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-gray-100 space-y-4">
            <h3 className="text-lg font-black text-gray-800 flex items-center gap-2">⚠️ {confirmModal.title}</h3>
            <p className="text-sm text-gray-600 leading-relaxed">{confirmModal.message}</p>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null })} className="px-4 py-2 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 transition">إلغاء</button>
              <button type="button" disabled={deleteProductMutation.isPending || deleteAdjustmentMutation.isPending} onClick={confirmModal.onConfirm} className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white transition shadow-md disabled:opacity-50">
                {deleteProductMutation.isPending || deleteAdjustmentMutation.isPending ? 'جاري الحذف...' : 'تأكيد الحذف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-gray-100 space-y-4">
            <h3 className="text-lg font-black text-gray-800 flex items-center gap-2">✏️ تعديل اسم الخامة</h3>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-600">اسم الخامة الجديد</label>
              <input
                type="text"
                value={editModal.newName}
                onChange={(e) => setEditModal({ ...editModal, newName: e.target.value })}
                className="w-full border border-gray-300 p-2.5 rounded-xl text-black bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-600 text-xs"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditModal({ isOpen: false, product: null, newName: '' })} className="px-4 py-2 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 transition">إلغاء</button>
              <button
                type="button"
                disabled={updateProductNameMutation.isPending}
                onClick={() => updateProductNameMutation.mutate({ id: editModal.product.id, newName: editModal.newName })}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition shadow-md disabled:opacity-50"
              >
                {updateProductNameMutation.isPending ? 'جاري الحفظ...' : 'حفظ التعديل'}
              </button>
            </div>
          </div>
        </div>
      )}

      {stockModal.isOpen && stockModal.product && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-gray-100 space-y-4">
            <h3 className="text-lg font-black text-gray-800 flex items-center gap-2">📦 تعديل الكمية المتاحة</h3>
            <p className="text-xs text-gray-500">الخامة: <span className="font-black text-gray-800">{stockModal.product.name}</span></p>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-600">الكمية المتاحة الحالية</label>
              <input
                type="number"
                min="0"
                step="any"
                value={stockModal.stock}
                onChange={(event) => setStockModal({ ...stockModal, stock: event.target.value })}
                className="w-full border border-gray-300 p-2.5 rounded-xl text-black bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-600 text-xs"
                required
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setStockModal({ isOpen: false, product: null, stock: '' })} className="px-4 py-2 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 transition">إلغاء</button>
              <button
                type="button"
                disabled={updateStockMutation.isPending}
                onClick={() => updateStockMutation.mutate({ id: stockModal.product.id, stock: stockModal.stock })}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition shadow-md disabled:opacity-50"
              >
                {updateStockMutation.isPending ? 'جاري الحفظ...' : 'حفظ الكمية المتاحة'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-3 border-b pb-4">
        <h1 className="text-2xl font-black text-gray-800">📦 إدارة خامات المواشى</h1>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="bg-blue-100 text-blue-800 text-sm font-semibold px-4 py-1.5 rounded-full shadow-sm">
            إجمالي العناصر: {products.length}
          </span>
          {isAdmin && (
            <span className="bg-purple-100 text-purple-800 text-xs font-bold px-3 py-1.5 rounded-full">
              👑 صلاحيات الأدمن مفعلة
            </span>
          )}
        </div>
      </div>

      <form onSubmit={handleAddProduct} className="bg-white p-6 shadow-xl rounded-2xl border border-gray-100 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-600 mr-1">اسم الصنف</label>
          <input type="text" placeholder="اكتب الاسم" value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-gray-300 p-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 text-black bg-gray-50/50" required />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-600 mr-1">السعر (جنيه)</label>
          <input type="number" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} className="w-full border border-gray-300 p-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 text-black bg-gray-50/50" step="any" min="0" required />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-600 mr-1">الكمية بالمخزن</label>
          <input type="number" placeholder="0" value={stock} onChange={(e) => setStock(e.target.value)} className="w-full border border-gray-300 p-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 text-black bg-gray-50/50" step="any" min="0" required />
        </div>
        <button type="submit" disabled={addProductMutation.isPending} className="bg-blue-600 text-white p-2.5 rounded-xl hover:bg-blue-700 transition font-bold shadow-lg shadow-blue-600/20 active:scale-95 disabled:opacity-50">
          {addProductMutation.isPending ? 'جاري الحفظ...' : '+ إضافة للصنف'}
        </button>
      </form>

      <form onSubmit={handleAdjustmentSubmit} className="bg-amber-50 p-6 shadow-xl rounded-2xl border border-amber-100 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
        <div className="md:col-span-4"><h2 className="text-lg font-black text-amber-900">⚖️ تسوية مخزون خامة</h2><p className="text-xs text-amber-700 mt-1">استخدم رقمًا موجبًا للزيادة ورقمًا سالبًا للنقص.</p></div>
        <select required value={adjustmentMaterialId} onChange={e => setAdjustmentMaterialId(e.target.value)} className="border border-amber-200 p-2.5 rounded-xl text-xs bg-white"><option value="">-- اختر الخامة --</option>{products.map(product => <option key={product.id} value={product.id}>{product.name} (الرصيد: {formatNumber(product.stock)})</option>)}</select>
        <input required type="number" step="any" value={adjustmentQuantity} onChange={e => setAdjustmentQuantity(e.target.value)} placeholder="كمية التسوية (+ / -)" className="border border-amber-200 p-2.5 rounded-xl text-xs bg-white" />
        <input required type="text" value={adjustmentReason} onChange={e => setAdjustmentReason(e.target.value)} placeholder="سبب التسوية" className="border border-amber-200 p-2.5 rounded-xl text-xs bg-white" />
        <button disabled={adjustmentMutation.isPending} className="bg-amber-600 hover:bg-amber-700 text-white p-2.5 rounded-xl font-bold text-xs">{adjustmentMutation.isPending ? 'جاري التنفيذ...' : 'حفظ التسوية'}</button>
      </form>

      <div className="bg-white shadow-xl rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-800">قائمة المخزون الحالي</h2>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-gray-400 font-medium">جاري تحميل البيانات...</div>
        ) : products.length === 0 ? (
          <div className="p-12 text-center text-gray-400 font-medium">لا توجد خامات مسجلة حتى الآن.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-gray-50/70 text-gray-500 text-xs font-bold uppercase tracking-wider border-b border-gray-100">
                  <th className="py-3 px-6">#</th>
                  <th className="py-3 px-6">اسم الصنف</th>
                  <th className="py-3 px-6">السعر</th>
                  <th className="py-3 px-6">الكمية المتاحة</th>
                  <th className="py-3 px-6">إجمالي القيمة</th>
                  <th className="py-3 px-6">أضيفت بواسطة</th>
                  <th className="py-3 px-6 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700 font-medium">
                {products.map((p, index) => (
                  <tr key={p.id} className="hover:bg-blue-50/40 transition duration-150">
                    <td className="py-4 px-6 text-gray-400 text-sm">{index + 1}</td>
                    <td className="py-4 px-6 font-bold text-gray-900">{p.name}</td>
                    <td className="py-4 px-6 text-blue-600 font-bold">{Number(p.price || 0).toLocaleString('ar-EG', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} <span className="text-xs text-gray-400 font-normal">ج.م</span></td>
                    <td className="py-4 px-6">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${Number(p.stock) > 10 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {formatNumber(p.stock)} طن
                      </span>
                    </td>
                    <td className="py-4 px-6 text-gray-900 font-bold">
                      {(Number(p.price) * Number(p.stock)).toLocaleString('ar-EG', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} <span className="text-xs text-gray-400 font-normal">ج.م</span>
                    </td>
                    <td className="py-4 px-6 text-xs font-bold text-gray-700">{p.actor_name || 'غير معروف'}</td>
                    <td className="py-4 px-6 text-center flex items-center justify-center gap-2">
                      {isAdmin && (
                        <button
                          onClick={() => setStockModal({ isOpen: true, product: p, stock: p.stock ?? 0 })}
                          className="text-emerald-600 hover:text-emerald-800 text-xs font-bold bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-xl border border-emerald-100 transition"
                        >
                          📦 تعديل الكمية
                        </button>
                      )}
                      <button
                        onClick={() => setEditModal({ isOpen: true, product: p, newName: p.name })}
                        className="text-blue-600 hover:text-blue-800 text-xs font-bold bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-xl border border-blue-100 transition"
                      >
                        ✏️ تعديل
                      </button>
                      <button
                        onClick={() => handleDeleteClick(p)}
                        className="text-red-500 hover:text-red-700 text-xs font-bold bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-xl border border-red-100 transition"
                      >
                        🗑️ حذف
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white shadow-xl rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-bold text-gray-800">📜 سجل تسويات الخامات</h2>
          <div className="flex flex-wrap gap-2">
            <input type="date" value={adjustmentStartDate} onChange={(e) => setAdjustmentStartDate(e.target.value)} className="border border-gray-200 rounded-xl p-2 text-xs bg-white" />
            <input type="date" value={adjustmentEndDate} onChange={(e) => setAdjustmentEndDate(e.target.value)} className="border border-gray-200 rounded-xl p-2 text-xs bg-white" />
            <button type="button" onClick={() => { setAdjustmentStartDate(''); setAdjustmentEndDate(''); }} className="bg-gray-900 text-white px-3 py-2 rounded-xl text-xs font-bold">إعادة تعيين</button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 border-b border-gray-100 bg-gray-50/50">
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
            <p className="text-[11px] font-bold text-emerald-700">إجمالي الزيادة</p>
            <p className="text-xl font-black text-emerald-700 mt-1">{formatNumber(totalIncrease)} طن</p>
          </div>
          <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
            <p className="text-[11px] font-bold text-red-700">إجمالي الخصم</p>
            <p className="text-xl font-black text-red-700 mt-1">{formatNumber(totalDecrease)} طن</p>
          </div>
        </div>

        {products.map((product) => {
          const productAdjustments = filteredAdjustments.filter((adjustment) => adjustment.material_name === product.name);
          const productIncrease = productAdjustments.filter(a => Number(a.quantity || 0) > 0).reduce((sum, a) => sum + Number(a.quantity || 0), 0);
          const productDecrease = productAdjustments.filter(a => Number(a.quantity || 0) < 0).reduce((sum, a) => sum + Math.abs(Number(a.quantity || 0)), 0);
          const isLogOpen = !!openAdjustmentLogs[product.id];

          return (
            <div key={product.id} className="border-b border-gray-100 last:border-b-0">
              <div className="bg-slate-50 px-6 py-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-base font-black text-gray-900">{product.name}</span>
                  <button
                    type="button"
                    onClick={() => setOpenAdjustmentLogs(prev => ({ ...prev, [product.id]: !prev[product.id] }))}
                    className={`px-3 py-1 rounded-xl text-xs font-bold transition flex items-center gap-1 ${
                      isLogOpen ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                    }`}
                  >
                    {isLogOpen ? 'إخفاء السجل ✕' : '👁️ عرض سجل التسويات'}
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-[11px] font-bold">زيادة: {formatNumber(productIncrease)} طن</span>
                  <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-[11px] font-bold">خصم: {formatNumber(productDecrease)} طن</span>
                </div>
              </div>

              {isLogOpen && (
                <div className="overflow-x-auto bg-white p-2 animate-fadeIn">
                  <table className="w-full text-right text-xs border border-gray-100 rounded-xl">
                    <thead className="bg-gray-100 text-gray-600">
                      <tr>
                        <th className="p-3">التاريخ</th>
                        <th className="p-3">التسوية</th>
                        <th className="p-3">قبل</th>
                        <th className="p-3">بعد</th>
                        <th className="p-3">السبب</th>
                        <th className="p-3">بواسطة</th>
                        {isAdmin && <th className="p-3 text-center">إجراء</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {productAdjustments.length ? productAdjustments.map((adjustment) => (
                        <tr key={adjustment.id} className="hover:bg-gray-50">
                          <td className="p-3">{String(adjustment.date || adjustment.created || '').slice(0, 10)}</td>
                          <td className={`p-3 font-black ${Number(adjustment.quantity) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {Number(adjustment.quantity) >= 0 ? '+' : ''}{formatNumber(adjustment.quantity)}
                          </td>
                          <td className="p-3">{formatNumber(adjustment.old_stock)}</td>
                          <td className="p-3 font-bold">{formatNumber(adjustment.new_stock)}</td>
                          <td className="p-3 text-gray-500">{adjustment.reason}</td>
                          <td className="p-3 font-bold text-gray-700">{adjustment.actor_name || 'غير معروف'}</td>
                          
                          {isAdmin && (
                            <td className="p-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleDeleteAdjustmentClick(adjustment)}
                                className="bg-red-50 hover:bg-red-100 text-red-600 px-2.5 py-1 rounded-lg text-xs font-bold transition"
                              >
                                🗑️ حذف التسوية
                              </button>
                            </td>
                          )}
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={isAdmin ? "7" : "6"} className="p-4 text-center text-gray-400">لا توجد تسويات مسجلة لهذه الخامة في هذه الفترة.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}