'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';
import toast, { Toaster } from 'react-hot-toast';

export default function ProductionStockPage() {
  const queryClient = useQueryClient();
  const isAdmin = pb.authStore.model?.collectionName === '_superusers' || pb.authStore.model?.role === 'admin' || pb.authStore.model?.email === 'mohamedfrf@icloud.com';
  const [searchTerm, setSearchTerm] = useState('');
  const [adjustmentModal, setAdjustmentModal] = useState({ isOpen: false, product: null });
  const [adjustmentQuantity, setAdjustmentQuantity] = useState('');
  const [historyModal, setHistoryModal] = useState({ isOpen: false, product: null });
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');

  // جلب مخزن المنتجات الجاهزة مع تفعيل التحديث التلقائي عند الرجوع للصفحة
  const { data: productsStock = [], isLoading, refetch } = useQuery({
    queryKey: ['products_stock'],
    queryFn: async () => {
      return await pb.collection('products_stock').getFullList({ 
        sort: '-created', 
        requestKey: null 
      }).catch(() => []);
    },
    initialData: [],
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: materials = [] } = useQuery({
    queryKey: ['khamat_moashe'],
    queryFn: () => pb.collection('khamat_moashe').getFullList().catch(() => []),
  });

  const { data: recipes = [] } = useQuery({
    queryKey: ['products_recipes'],
    queryFn: () => pb.collection('products_recipes').getFullList().catch(() => []),
  });

  const { data: productionOrders = [] } = useQuery({
    queryKey: ['production_orders_products_stock'],
    queryFn: () => pb.collection('production_orders').getFullList().catch(() => []),
  });

  const { data: salesInvoices = [] } = useQuery({
    queryKey: ['sales_invoices_products_stock_history'],
    queryFn: () => pb.collection('sales_invoices').getFullList({ sort: 'created' }).catch(() => []),
  });

  const { data: invoiceLogs = [] } = useQuery({
    queryKey: ['invoices_logs_products_stock_history'],
    queryFn: () => pb.collection('invoices_logs').getFullList({ sort: 'created' }).catch(() => []),
  });

  // تجهيز وتنظيف البيانات المأخوذة من جدول الـ Stock (مع دعم حقول التكلفة)
  const inventoryList = productsStock.map(item => ({
    id: item.id,
    product_name: item.product_name || item.name || 'منتج بدون اسم',
    stock: Number(item.stock ?? productionOrders
      .filter(order => (order.product_name || order.name) === (item.product_name || item.name))
      .reduce((sum, order) => sum + Number(order.batch_quantity || order.quantity || 0), 0)),
    unit_cost: (() => {
      const productRecipes = recipes.filter(recipe => (recipe.product_name || recipe.name) === (item.product_name || item.name));
      const recipeCost = productRecipes.reduce((sum, recipe) => {
        const materialId = recipe.raw_material_id || recipe.material_id;
        const material = materials.find(record => record.id === materialId);
        const quantity = Number(recipe.quantity_needed || recipe.quantity || 0);
        return sum + Number(material?.price || 0) * quantity;
      }, 0);
      return recipeCost + Number(productRecipes[0]?.other_cost || 0);
    })(),
  })).map(item => ({
    ...item,
    total_cost: item.unit_cost * item.stock,
  }));

  // تصفية المنتجات بناءً على البحث بالاسم
  const filteredOrders = inventoryList.filter(item =>
    String(item.product_name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getProductHistory = (product) => {
    const normalizeName = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const productName = normalizeName(product.product_name);
    const history = [
      ...productionOrders
        .filter(order => normalizeName(order.product_name || order.name) === productName)
        .map(order => ({
          id: `production-${order.id}`,
          date: order.created,
          type: 'إضافة',
          title: 'أمر تصنيع',
          quantity: Number(order.batch_quantity || order.quantity || 0),
          actor: order.actor_name || 'غير معروف',
          notes: `تم تصنيع ${Number(order.batch_quantity || order.quantity || 0).toLocaleString()} من المنتج`,
        })),
      ...salesInvoices.flatMap(invoice => (invoice.items || [])
        .filter(item => item.itemType !== 'material' && normalizeName(item.name) === productName)
        .map(item => ({
          id: `sale-${invoice.id}-${item.name}`,
          date: invoice.created,
          type: 'سحب',
          title: `فاتورة بيع ${invoice.invoice_number || ''}`.trim(),
          quantity: -Number(item.qty || 0),
          actor: invoice.actor_name || 'غير معروف',
          notes: `بيع للعميل: ${invoice.customer_name || 'عميل'}`,
        }))),
      ...invoiceLogs.flatMap(log => {
        let details;
        try {
          details = JSON.parse(log.details || '{}');
        } catch {
          details = {};
        }
        const items = Array.isArray(details.items) ? details.items : [];
        const matchingItems = items.filter(item => item.itemType !== 'material' && normalizeName(item.name) === productName);
        if (log.action_type === 'تسوية مخزن منتجات') {
          if (normalizeName(details.product_name) !== productName) return [];
          return [{
            id: log.id,
            date: log.created,
            type: Number(details.quantity || 0) >= 0 ? 'تسوية إضافة' : 'تسوية سحب',
            title: 'تسوية مخزن المنتجات',
            quantity: Number(details.quantity || 0),
            actor: log.actor_name || 'غير معروف',
            notes: details.message || 'تسوية كمية المخزن',
          }];
        }
        if (log.action_type === 'مرتجع' || log.action_type === 'حذف') {
          return matchingItems.map((item, index) => ({
            id: `${log.id}-${index}`,
            date: log.created,
            type: 'إضافة',
            title: log.action_type === 'مرتجع' ? 'مرتجع فاتورة بيع' : 'إلغاء فاتورة بيع',
            quantity: Number(item.qty || 0),
            actor: log.actor_name || 'غير معروف',
            notes: details.message || `إرجاع ${Number(item.qty || 0).toLocaleString()} للمخزن`,
          }));
        }
        if (log.action_type === 'تعديل') {
          const oldItems = Array.isArray(details.old_data?.items) ? details.old_data.items : [];
          const newItems = Array.isArray(details.new_data?.items) ? details.new_data.items : [];
          return [
            ...oldItems.filter(item => item.itemType !== 'material' && normalizeName(item.name) === productName).map((item, index) => ({
              id: `${log.id}-old-${index}`,
              date: log.created,
              type: 'إضافة',
              title: 'تعديل فاتورة بيع - إرجاع القديم',
              quantity: Number(item.qty || 0),
              actor: log.actor_name || 'غير معروف',
              notes: 'إرجاع الكمية القديمة قبل تطبيق التعديل',
            })),
            ...newItems.filter(item => item.itemType !== 'material' && normalizeName(item.name) === productName).map((item, index) => ({
              id: `${log.id}-new-${index}`,
              date: log.created,
              type: 'سحب',
              title: 'تعديل فاتورة بيع - تطبيق الجديد',
              quantity: -Number(item.qty || 0),
              actor: log.actor_name || 'غير معروف',
              notes: 'خصم الكمية الجديدة بعد التعديل',
            })),
          ];
        }
        return [];
      }),
    ].filter(item => item.quantity !== 0).sort((first, second) => new Date(first.date || 0) - new Date(second.date || 0));

    const currentStock = Number(product.stock || 0);
    let runningStock = currentStock;
    const historyWithBalance = [...history].reverse().map((item) => {
      const balance = runningStock;
      runningStock -= item.quantity;
      return { ...item, balance };
    }).reverse();

    return historyWithBalance.reverse().filter(item => {
      const itemDate = String(item.date || '').slice(0, 10);
      return (!historyStartDate || itemDate >= historyStartDate) && (!historyEndDate || itemDate <= historyEndDate);
    });
  };

  const adjustmentMutation = useMutation({
    mutationFn: async () => {
      if (!isAdmin) throw new Error('عفواً، تسوية مخزن المنتجات متاحة للأدمن فقط!');
      const product = adjustmentModal.product;
      const quantity = Number(adjustmentQuantity);
      if (!product) throw new Error('اختر المنتج أولاً');
      if (!Number.isFinite(quantity) || quantity === 0) throw new Error('أدخل كمية تسوية صحيحة');

      const newStock = product.stock + quantity;
      if (newStock < 0) throw new Error('لا يمكن أن تكون كمية المخزون أقل من صفر');

      const updatedProduct = await pb.collection('products_stock').update(product.id, {
        stock: newStock,
        total_cost: product.unit_cost * newStock,
        actor_name: pb.authStore.model?.name || pb.authStore.model?.email || 'مستخدم',
      });
      await pb.collection('invoices_logs').create({
        action_type: 'تسوية مخزن منتجات',
        actor_name: pb.authStore.model?.name || pb.authStore.model?.email || 'مستخدم',
        invoice_number: `PRODUCT-STOCK-${product.id}`,
        details: JSON.stringify({
          product_name: product.product_name,
          quantity,
          old_stock: product.stock,
          new_stock: newStock,
          message: `تمت تسوية مخزن المنتج بكمية ${quantity > 0 ? '+' : ''}${quantity}`,
        }),
      });
      return updatedProduct;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products_stock'] });
      setAdjustmentModal({ isOpen: false, product: null });
      setAdjustmentQuantity('');
      toast.success('تم تنفيذ تسوية مخزن المنتجات بنجاح!');
    },
    onError: (error) => toast.error(error.message || 'فشل تنفيذ التسوية'),
  });

  function handleAdjustmentSubmit(event) {
    event.preventDefault();
    adjustmentMutation.mutate();
  }

  // حساب الإجماليات للمنتجات المصفاة
  const totalQuantity = filteredOrders.reduce((sum, item) => sum + item.stock, 0);
  const totalCostSum = filteredOrders.reduce((sum, item) => sum + item.total_cost, 0);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-8" dir="rtl">
      <Toaster position="top-center" reverseOrder={false} />

      {adjustmentModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <form onSubmit={handleAdjustmentSubmit} className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-lg font-black text-gray-800">⚖️ تسوية كمية المخزن</h2>
              <button type="button" onClick={() => setAdjustmentModal({ isOpen: false, product: null })} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
            </div>
            <select
              required
              value={adjustmentModal.product?.id || ''}
              onChange={(event) => setAdjustmentModal({
                ...adjustmentModal,
                product: inventoryList.find((item) => item.id === event.target.value) || null,
              })}
              className="w-full border border-gray-200 p-3 rounded-xl text-sm bg-white text-black"
            >
              <option value="">-- اختر المنتج --</option>
              {inventoryList.map((item) => (
                <option key={item.id} value={item.id}>{item.product_name} (الرصيد: {item.stock.toLocaleString()})</option>
              ))}
            </select>
            <p className="text-sm font-bold text-gray-700">{adjustmentModal.product?.product_name}</p>
            <p className="text-xs text-gray-500">الرصيد الحالي: {adjustmentModal.product?.stock?.toLocaleString()}</p>
            <input
              required
              type="number"
              step="any"
              value={adjustmentQuantity}
              onChange={(event) => setAdjustmentQuantity(event.target.value)}
              placeholder="كمية التسوية (+ / -)"
              className="w-full border border-amber-200 p-3 rounded-xl text-sm bg-white text-black"
            />
            <div className="flex gap-3">
              <button type="button" onClick={() => setAdjustmentModal({ isOpen: false, product: null })} className="flex-1 bg-gray-100 text-gray-700 p-3 rounded-xl text-sm font-bold">إلغاء</button>
              <button type="submit" disabled={adjustmentMutation.isPending} className="flex-1 bg-amber-600 hover:bg-amber-700 text-white p-3 rounded-xl text-sm font-bold disabled:opacity-50">
                {adjustmentMutation.isPending ? 'جاري التنفيذ...' : 'حفظ التسوية'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="border-b pb-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-gray-800">📋 مخزن المنتجات المصنعة</h1>
          <p className="text-sm text-gray-500">متابعة الكميات المتوفرة في المخزن والتكاليف بشكل دقيق وثابت</p>
        </div>
        <button 
          onClick={() => refetch()}
          className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
        >
          🔄 تحديث البيانات
        </button>
      </div>

      {isAdmin && (
        <div className="flex justify-start">
          <button
            type="button"
            onClick={() => setAdjustmentModal({ isOpen: true, product: null })}
            disabled={!filteredOrders.length}
            className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition disabled:opacity-50"
          >
            ⚖️ تسويه الكميه اللى ف المخزن
          </button>
        </div>
      )}

      {/* بطاقات الإجماليات (الكمية والتكلفة) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-gray-400">إجمالي الكميات المتوفرة</p>
            <h3 className="text-xl font-black text-emerald-700 mt-1">{totalQuantity.toLocaleString()} طن </h3>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl font-bold">📦</div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-gray-400">إجمالي قيمة التكلفة</p>
            <h3 className="text-xl font-black text-gray-800 mt-1">{totalCostSum.toLocaleString()} ج.م</h3>
          </div>
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl font-bold">💰</div>
        </div>
      </div>

      {/* جدول المخزون مع البحث */}
      <div className="bg-white shadow-xl rounded-2xl border border-gray-100 overflow-hidden flex flex-col">
        <div className="p-4 bg-gray-50 border-b flex flex-col sm:flex-row justify-between items-center gap-4">
          <h2 className="text-lg font-bold text-gray-800">رصيد المنتجات الجاهزة</h2>
          <input
            type="text"
            placeholder="🔍 بحث باسم المنتج..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="border border-gray-300 px-3 py-2 rounded-xl text-xs text-black bg-white w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="p-4">
          {isLoading ? (
            <div className="p-12 text-center text-blue-600 text-sm font-bold">جاري تحميل المخزن...</div>
          ) : filteredOrders.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">لا توجد منتجات مطابقة للبحث أو مسجلة في المخزن حتى الآن.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="border-b text-xs text-gray-500 bg-gray-50">
                    <th className="p-3 font-bold">اسم المنتج</th>
                    <th className="p-3 font-bold">الكمية المتوفرة بالمخزن</th>
                    <th className="p-3 font-bold">تكلفة الوحدة</th>
                    <th className="p-3 font-bold">إجمالي التكلفة</th>
                  </tr>
                </thead>
                <tbody className="divide-y text-sm">
                  {filteredOrders.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50/50 transition">
                      <td className="p-3 font-black text-gray-900">{item.product_name}</td>
                      <td className="p-3 font-bold text-emerald-700">
                        <div className="flex items-center gap-3">
                          <span>{item.stock.toLocaleString()}</span>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => setAdjustmentModal({ isOpen: true, product: item })}
                              className="text-amber-700 hover:text-amber-900 text-xs font-bold"
                            >
                              تسوية
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setHistoryStartDate('');
                              setHistoryEndDate('');
                              setHistoryModal({ isOpen: true, product: item });
                            }}
                            className="text-blue-700 hover:text-blue-900 text-xs font-bold"
                          >
                            عرض السجل
                          </button>
                        </div>
                      </td>
                      <td className="p-3 font-bold text-amber-700">{item.unit_cost.toLocaleString('ar-EG', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ج.م</td>
                      <td className="p-3 font-bold text-gray-700">{item.total_cost.toLocaleString()} ج.م</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {historyModal.isOpen && historyModal.product && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 max-w-5xl w-full max-h-[88vh] shadow-2xl flex flex-col gap-4">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h2 className="text-lg font-black text-gray-800">📜 سجل حركة المنتج: {historyModal.product.product_name}</h2>
                <p className="text-xs text-gray-500 mt-1">الرصيد الحالي: <span className="font-black text-emerald-700">{historyModal.product.stock.toLocaleString()} طن</span></p>
              </div>
              <button type="button" onClick={() => setHistoryModal({ isOpen: false, product: null })} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs font-bold text-gray-700">
                من تاريخ
                <input type="date" value={historyStartDate} onChange={(event) => setHistoryStartDate(event.target.value)} className="mt-1 w-full border border-gray-200 bg-gray-50 p-3 rounded-xl text-xs font-bold" />
              </label>
              <label className="text-xs font-bold text-gray-700">
                إلى تاريخ
                <input type="date" value={historyEndDate} onChange={(event) => setHistoryEndDate(event.target.value)} className="mt-1 w-full border border-gray-200 bg-gray-50 p-3 rounded-xl text-xs font-bold" />
              </label>
            </div>
            <div className="overflow-auto border border-gray-100 rounded-xl">
              <table className="w-full text-right text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="p-3">التاريخ</th>
                    <th className="p-3">نوع الحركة</th>
                    <th className="p-3">البيان</th>
                    <th className="p-3">الكمية</th>
                    <th className="p-3">رصيد المخزن بعد الحركة</th>
                    <th className="p-3">بواسطة</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {getProductHistory(historyModal.product).length ? getProductHistory(historyModal.product).map(item => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="p-3 text-gray-600">{new Date(item.date).toLocaleString('ar-EG')}</td>
                      <td className={`p-3 font-black ${item.quantity >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{item.type}</td>
                      <td className="p-3 font-bold text-blue-700">{item.title}<div className="text-[10px] text-gray-500 mt-1">{item.notes}</div></td>
                      <td className={`p-3 font-black ${item.quantity >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{item.quantity >= 0 ? '+' : '-'} {Math.abs(item.quantity).toLocaleString()} طن</td>
                      <td className="p-3 font-black text-indigo-700">{item.balance.toLocaleString()} طن</td>
                      <td className="p-3 font-bold text-gray-700">{item.actor}</td>
                    </tr>
                  )) : <tr><td colSpan="6" className="p-8 text-center text-gray-400">لا توجد حركات مسجلة لهذا المنتج.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => setHistoryModal({ isOpen: false, product: null })} className="bg-gray-900 text-white px-5 py-2 rounded-xl text-xs font-bold">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}