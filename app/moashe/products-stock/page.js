'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';

export default function ProductionStockPage() {
  const [searchTerm, setSearchTerm] = useState('');

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

  // تجهيز وتنظيف البيانات المأخوذة من جدول الـ Stock (مع دعم حقول التكلفة)
  const inventoryList = productsStock.map(item => ({
    id: item.id,
    product_name: item.product_name || item.name || 'منتج بدون اسم',
    stock: Number(item.stock || item.quantity || 0),
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

  // حساب الإجماليات للمنتجات المصفاة
  const totalQuantity = filteredOrders.reduce((sum, item) => sum + item.stock, 0);
  const totalCostSum = filteredOrders.reduce((sum, item) => sum + item.total_cost, 0);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-8" dir="rtl">
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
                      <td className="p-3 font-bold text-emerald-700">{item.stock.toLocaleString()}</td>
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