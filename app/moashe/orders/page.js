'use client';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';
import toast, { Toaster } from 'react-hot-toast';

export default function ProductionOrdersPage() {
  const queryClient = useQueryClient();
  const [selectedProduct, setSelectedProduct] = useState('');
  const [productionQty, setProductionQty] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [userEmail, setUserEmail] = useState('');

  // جلب إيميل المستخدم الحالي للتحقق من الصلاحيات
  useEffect(() => {
    const user = pb.authStore.model;
    setUserEmail(user?.email || '');

    const unsubscribe = pb.authStore.onChange(() => {
      setUserEmail(pb.authStore.model?.email || '');
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  // تحديد من هو الأدمن (للتحكم في صلاحيات الحذف فقط إن أردت)
  const isAdmin = userEmail === 'mohamedfrf@icloud.com'; 

  // حالة نافذة التأكيد الاحترافية (Modal) للحذف أو التنفيذ
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
  });

  // جلب البيانات باستخدام TanStack Query بشكل متوازي
  const { data: materials = [] } = useQuery({
    queryKey: ['khamat_moashe'],
    queryFn: async () => {
      return await pb.collection('khamat_moashe').getFullList().catch(() => []);
    },
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: allRecipes = [] } = useQuery({
    queryKey: ['products_recipes'],
    queryFn: async () => {
      return await pb.collection('products_recipes').getFullList({ sort: '-created' }).catch(() => []);
    },
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: productionOrders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['production_orders'],
    queryFn: async () => {
      return await pb.collection('production_orders').getFullList({ sort: '-created' }).catch(() => []);
    },
  });

  const { data: productsStock = [] } = useQuery({
    queryKey: ['products_stock'],
    queryFn: async () => {
      return await pb.collection('products_stock').getFullList().catch(() => []);
    },
  });

  const normalizeProductName = (value) => String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // الحصول على اسم أو إيميل المستخدم الحالي لتسجيله في العمليات
  const getCurrentActorName = () => {
    return pb.authStore.model?.name || pb.authStore.model?.email || 'مستخدم';
  };

  // تنفيذ أمر التصنيع، خصم الخامات، وتحديث مخزن المنتجات النهائية (products_stock)
  const executeProductionMutation = useMutation({
    mutationFn: async ({ qtyToProduce, currentRecipe }) => {
      const costToAdd = currentRecipe.reduce((sum, item) => {
        const matId = item.raw_material_id || item.material_id;
        const matInfo = materials.find(m => m.id === matId);
        const matPrice = matInfo ? Number(matInfo.price || 0) : 0;
        const qtyPerUnit = Number(item.quantity_needed || item.quantity || 0);
        const totalQtyNeeded = qtyPerUnit * qtyToProduce;
        return sum + (matPrice * totalQtyNeeded);
      }, 0);

      for (const item of currentRecipe) {
        const matId = item.raw_material_id || item.material_id;
        const matInfo = materials.find(m => m.id === matId);
        const qtyPerUnit = Number(item.quantity_needed || item.quantity || 0);
        const totalNeeded = qtyPerUnit * qtyToProduce;
        const currentStock = Number(matInfo?.stock || matInfo?.quantity || 0);
        const newStock = currentStock - totalNeeded;

        await pb.collection('khamat_moashe').update(matId, {
          stock: newStock
        });
      }

      const existingProductStock = productsStock.find(p => normalizeProductName(p.product_name || p.name) === normalizeProductName(selectedProduct));

      if (existingProductStock) {
        const updatedStock = Number(existingProductStock.stock || 0) + qtyToProduce;
        const updatedCost = Number(existingProductStock.total_cost || 0) + costToAdd;
        await pb.collection('products_stock').update(existingProductStock.id, {
          stock: updatedStock,
          total_cost: updatedCost,
          actor_name: getCurrentActorName(),
        });
      } else {
        await pb.collection('products_stock').create({
          product_name: selectedProduct,
          stock: qtyToProduce,
          total_cost: costToAdd,
          actor_name: getCurrentActorName(),
        });
      }

      return await pb.collection('production_orders').create({
        product_name: selectedProduct,
        batch_quantity: qtyToProduce,
        total_cost: costToAdd,
        status: 'مكتمل',
        actor_name: getCurrentActorName()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production_orders'] });
      queryClient.invalidateQueries({ queryKey: ['khamat_moashe'] });
      queryClient.invalidateQueries({ queryKey: ['products_stock'] });
      toast.success('تم تنفيذ أمر التصنيع وتحديث المخازن بنجاح! 🚀');
      setSelectedProduct('');
      setProductionQty('');
      setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
    },
    onError: (error) => {
      console.error("خطأ أثناء تنفيذ التصنيع:", error);
      toast.error('حدث خطأ: ' + (error.message || 'فشل التنفيذ'));
      setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
    },
  });

  // حذف أمر التصنيع وإرجاع الخامات والمنتجات لحالتها السابقة
  const deleteProductionMutation = useMutation({
    mutationFn: async (order) => {
      const productName = order.product_name;
      const qtyProduced = Number(order.batch_quantity || 0);
      const orderCost = Number(order.total_cost || 0);

      const recipe = allRecipes.filter(r => normalizeProductName(r.product_name || r.name || r.product) === normalizeProductName(productName));
      for (const item of recipe) {
        const matId = item.raw_material_id || item.material_id;
        const matInfo = materials.find(m => m.id === matId);
        if (matInfo) {
          const qtyPerUnit = Number(item.quantity_needed || item.quantity || 0);
          const totalToRestore = qtyPerUnit * qtyProduced;
          const currentStock = Number(matInfo.stock || matInfo.quantity || 0);
          
          await pb.collection('khamat_moashe').update(matId, {
            stock: currentStock + totalToRestore
          });
        }
      }

      const freshProductsStock = await pb.collection('products_stock').getFullList();
      const matchingProductStocks = freshProductsStock.filter(p => (
        normalizeProductName(p.product_name || p.name) === normalizeProductName(productName)
      ));
      const totalCurrentStock = matchingProductStocks.reduce((sum, productStock) => sum + Number(productStock.stock || 0), 0);
      const totalCurrentCost = matchingProductStocks.reduce((sum, productStock) => sum + Number(productStock.total_cost || 0), 0);
      const updatedStock = Math.max(0, totalCurrentStock - qtyProduced);
      const updatedCost = Math.max(0, totalCurrentCost - orderCost);

      if (matchingProductStocks.length > 0) {
        await pb.collection('products_stock').update(matchingProductStocks[0].id, {
          stock: updatedStock,
          total_cost: updatedCost,
        });
        for (const duplicateStock of matchingProductStocks.slice(1)) {
          await pb.collection('products_stock').update(duplicateStock.id, {
            stock: 0,
            total_cost: 0,
          });
        }
      }

      await pb.collection('production_orders').delete(order.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production_orders'] });
      queryClient.invalidateQueries({ queryKey: ['khamat_moashe'] });
      queryClient.invalidateQueries({ queryKey: ['products_stock'] });
      toast.success('تم حذف أمر التصنيع وإرجاع الخامات بنجاح!');
      setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
    },
    onError: (error) => {
      console.error("خطأ أثناء الحذف:", error);
      toast.error('حدث خطأ أثناء الحذف: ' + (error.message || 'فشل الحذف'));
      setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
    }
  });

  const uniqueProductNames = Array.from(
    new Map(
      allRecipes
        .map(item => {
          const productNameValue = normalizeProductName(item.product_name || item.name || item.product);
          return [productNameValue, productNameValue];
        })
        .filter(([key]) => key)
    ).values()
  );

  const currentRecipe = allRecipes.filter(r => normalizeProductName(r.product_name || r.name || r.product) === normalizeProductName(selectedProduct));

  const calculatedTotalCost = currentRecipe.reduce((sum, item) => {
    const matId = item.raw_material_id || item.material_id;
    const matInfo = materials.find(m => m.id === matId);
    const matPrice = matInfo ? Number(matInfo.price || 0) : 0;
    const qtyPerUnit = Number(item.quantity_needed || item.quantity || 0);
    const totalQtyNeeded = qtyPerUnit * (Number(productionQty) || 0);
    return sum + (matPrice * totalQtyNeeded);
  }, 0);

  const handleExecuteProduction = (e) => {
    e.preventDefault();

    const qtyToProduce = Number(productionQty);

    if (!selectedProduct || !qtyToProduce || qtyToProduce <= 0) {
      toast.error('الرجاء اختيار المنتج وتحديد كمية صحيحة للإنتاج!');
      return;
    }

    if (currentRecipe.length === 0) {
      toast.error('هذا المنتج ليس له تركيبة مسجلة!');
      return;
    }

    for (const item of currentRecipe) {
      const matId = item.raw_material_id || item.material_id;
      const matInfo = materials.find(m => m.id === matId);
      const qtyPerUnit = Number(item.quantity_needed || item.quantity || 0);
      const totalNeeded = qtyPerUnit * qtyToProduce;
      const availableStock = matInfo ? Number(matInfo.stock || matInfo.quantity || 0) : 0;

      if (!matInfo || availableStock < totalNeeded) {
        toast.error(`الخامة "${matInfo?.name || 'غير معروفة'}" غير متوفرة بالكمية الكافية! (المتوفر: ${availableStock}, المطلوب: ${totalNeeded})`);
        return;
      }
    }

    setConfirmModal({
      isOpen: true,
      title: 'تأكيد إصدار أمر التصنيع',
      message: `هل أنت متأكد من إنتاج (${qtyToProduce}) وحدة من المنتج "${selectedProduct}"؟ سيتم خصم الخامات وتحديث المخزن فوراً.`,
      onConfirm: () => executeProductionMutation.mutate({ qtyToProduce, currentRecipe })
    });
  };

  const handleDeleteOrder = (order) => {
    if (!isAdmin) {
      toast.error('عذراً، الحذف مسموح للأدمن فقط.');
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: 'تأكيد الحذف والإرجاع',
      message: `هل تريد حقاً حذف أمر التصنيع للمنتج "${order.product_name}"؟ سيتم إرجاع الخامات وخصم المنتجات من المخزن.`,
      onConfirm: () => deleteProductionMutation.mutate(order)
    });
  };

  const filteredOrders = productionOrders.filter(item => {
    const nameMatches = item.product_name?.toLowerCase().includes(searchTerm.toLowerCase());
    const createdDate = String(item.created || '').slice(0, 10);
    const matchesStart = !startDate || createdDate >= startDate;
    const matchesEnd = !endDate || createdDate <= endDate;
    return nameMatches && matchesStart && matchesEnd;
  });

  // حساب إجمالي الكمية المصنعة بناءً على الأوامر المفلترة حالياً
  const totalProducedQty = filteredOrders.reduce((sum, order) => sum + Number(order.batch_quantity || 0), 0);
  
  // حساب يومية العمال (إجمالي الكمية المصنعة × 75)
  const workerDailyPay = totalProducedQty * 75;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 relative" dir="rtl">
      <Toaster position="top-center" reverseOrder={false} />

      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-gray-100 space-y-4">
            <h3 className="text-lg font-black text-gray-800 flex items-center gap-2">
              ⚠️ {confirmModal.title}
            </h3>
            <p className="text-sm text-gray-600 leading-relaxed">
              {confirmModal.message}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null })}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 transition"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={executeProductionMutation.isPending || deleteProductionMutation.isPending}
                onClick={confirmModal.onConfirm}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-md disabled:opacity-50"
              >
                {executeProductionMutation.isPending || deleteProductionMutation.isPending ? 'جاري التنفيذ...' : 'تأكيد ومتابعة'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="border-b pb-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-gray-800">🏭 أوامر التصنيع وحساب الخامات</h1>
          <p className="text-sm text-gray-500">إدارة أوامر التصنيع، الخصم، والإضافة للمخازن بطريقة احترافية</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        <div className="lg:col-span-5 bg-white p-6 shadow-xl rounded-2xl border border-gray-100 sticky top-6 space-y-6">
          <h2 className="text-lg font-bold text-gray-800 border-b pb-2">⚙️ إصدار أمر تصنيع جديد</h2>

          <form onSubmit={handleExecuteProduction} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-gray-600 block mb-1">اختر المنتج</label>
              <select 
                value={selectedProduct}
                onChange={(e) => setSelectedProduct(e.target.value)}
                className="w-full border border-gray-300 p-2.5 rounded-xl text-black bg-gray-50 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">-- اضغط لاختيار المنتج --</option>
                {uniqueProductNames.map((prod, idx) => (
                  <option key={idx} value={prod}>{prod}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-600 block mb-1">الكمية المراد إنتاجها</label>
              <input
                type="number"
                placeholder="مثال: 2"
                value={productionQty}
                onChange={(e) => setProductionQty(e.target.value)}
                className="w-full border border-gray-300 p-2.5 rounded-xl text-black bg-gray-50 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                step="any"
                min="0.001"
                required
              />
            </div>

            {selectedProduct && currentRecipe.length > 0 && (
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-200 space-y-3">
                <div className="flex justify-between items-center text-xs border-b pb-2">
                  <span className="font-bold text-gray-700">إجمالي التكلفة المتوقعة:</span>
                  <span className="font-black text-emerald-600 text-sm">{calculatedTotalCost.toLocaleString()} ج.م</span>
                </div>

                <span className="text-xs font-bold text-gray-700 block">📦 تفاصيل الخامات التي سيتم خصمها:</span>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {currentRecipe.map((item, idx) => {
                    const matId = item.raw_material_id || item.material_id;
                    const matInfo = materials.find(m => m.id === matId);
                    const qtyPerUnit = Number(item.quantity_needed || item.quantity || 0);
                    const totalNeeded = qtyPerUnit * (Number(productionQty) || 0);
                    const available = matInfo ? Number(matInfo.stock || matInfo.quantity || 0) : 0;
                    const isEnough = available >= totalNeeded;

                    return (
                      <div key={idx} className="flex justify-between items-center text-xs bg-white p-2 rounded border">
                        <span className="font-bold text-gray-800">{matInfo?.name || 'خامة'}</span>
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${isEnough ? 'text-emerald-600' : 'text-red-600'}`}>
                            المطلوب: {totalNeeded}
                          </span>
                          <span className="text-gray-400 text-[10px]">(المخزن: {available})</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={executeProductionMutation.isPending}
              className="w-full p-3 rounded-xl font-bold transition text-sm shadow-lg bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {executeProductionMutation.isPending ? 'جاري التنفيذ...' : '🚀 تنفيذ أمر التصنيع وتحديث المخازن'}
            </button>
          </form>
        </div>

        <div className="lg:col-span-7 bg-white shadow-xl rounded-2xl border border-gray-100 overflow-hidden flex flex-col">
          <div className="p-4 bg-gray-50 border-b flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
            <div className="flex items-center gap-4 flex-wrap">
              <h2 className="text-lg font-bold text-gray-800">📋 سجل أوامر التصنيع</h2>
              
              {/* بطاقة عرض إجمالي الكمية المصنعة */}
              <div className="bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-xl text-xs flex items-center gap-2">
                <span className="text-emerald-700 font-bold">إجمالي الكمية:</span>
                <span className="font-black text-emerald-800 text-sm">{totalProducedQty.toLocaleString()} طن</span>
              </div>

              {/* بطاقة عرض يومية العمال الجديدة */}
              <div className="bg-amber-50 border border-amber-200 px-3 py-1 rounded-xl text-xs flex items-center gap-2">
                <span className="text-amber-700 font-bold">👷 يومية العمال:</span>
                <span className="font-black text-amber-800 text-sm">{Math.round(workerDailyPay).toLocaleString()} ج.م</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border border-gray-300 px-2 py-1.5 rounded-xl text-xs text-black bg-white outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="border border-gray-300 px-2 py-1.5 rounded-xl text-xs text-black bg-white outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => { setStartDate(''); setEndDate(''); }}
                className="bg-gray-900 text-white px-3 py-1.5 rounded-xl text-[11px] font-bold"
              >
                كل الفترات
              </button>
              <input
                type="text"
                placeholder="🔍 بحث بالاسم..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="border border-gray-300 px-3 py-1.5 rounded-xl text-xs text-black bg-white outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="p-4 space-y-3 max-h-175 overflow-y-auto divide-y">
            {loadingOrders ? (
              <div className="p-12 text-center text-blue-600 text-sm font-bold">جاري تحميل أوامر التصنيع...</div>
            ) : filteredOrders.length === 0 ? (
              <div className="p-12 text-center text-gray-400 text-sm">لا توجد أوامر تصنيع مسجلة.</div>
            ) : (
              filteredOrders.map((order, index) => (
                <div key={order.id || index} className="pt-3 first:pt-0 flex justify-between items-center">
                  <div>
                    <h3 className="text-base font-black text-gray-900">{order.product_name}</h3>
                    <span className="text-xs text-gray-500">الحالة: <strong className="text-emerald-600">{order.status || 'مكتمل'}</strong></span>
                    <span className="block text-[10px] text-gray-400 mt-1">بواسطة: {order.actor_name || 'غير معروف'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="bg-blue-50 border px-3 py-1.5 rounded-xl text-center">
                      <span className="text-[10px] text-blue-600 block">الكمية المصنعة</span>
                      <span className="font-bold text-blue-700 text-sm">{Number(order.batch_quantity || 0)} طن</span>
                    </div>
                    <div className="bg-amber-50 border px-3 py-1.5 rounded-xl text-center">
                      <span className="text-[10px] text-amber-700 block">التكلفة</span>
                      <span className="font-bold text-amber-800 text-sm">{Number(order.total_cost || 0).toLocaleString()} ج.م</span>
                    </div>
                    <button
                      onClick={() => handleDeleteOrder(order)}
                      disabled={deleteProductionMutation.isPending}
                      className={`border p-2.5 rounded-xl transition text-xs font-bold ${isAdmin ? 'bg-red-50 hover:bg-red-100 text-red-600 border-red-200' : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'}`}
                      title={isAdmin ? "حذف الأمر" : "متاح للأدمن فقط"}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}