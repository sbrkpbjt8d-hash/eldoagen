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
    item.product_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const adjustmentMutation = useMutation({
    mutationFn: async () => {
      if (!isAdmin) throw new Error('عفواً، تسوية مخزن المنتجات متاحة للأدمن فقط!');
      const product = adjustmentModal.product;
      const quantity = Number(adjustmentQuantity);
      if (!product) throw new Error('اختر المنتج أولاً');
      if (!Number.isFinite(quantity) || quantity === 0) throw new Error('أدخل كمية تسوية صحيحة');

      const newStock = product.stock + quantity;
      if (newStock < 0) throw new Error('لا يمكن أن تكون كمية المخزون أقل من صفر');

      return pb.collection('products_stock').update(product.id, {
        stock: newStock,
        total_cost: product.unit_cost * newStock,
        actor_name: pb.authStore.model?.name || pb.authStore.model?.email || 'مستخدم',
      });
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
    </div>
  );
}