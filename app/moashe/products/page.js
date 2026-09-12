'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';
import toast, { Toaster } from 'react-hot-toast';

function formatQuantity(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '0';
  return numberValue.toLocaleString('en-US', {
    useGrouping: false,
    maximumFractionDigits: 15,
  });
}

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const isAdmin = pb.authStore.model?.collectionName === '_superusers';

  const [productName, setProductName] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [otherCost, setOtherCost] = useState('');
  const [selectedMaterials, setSelectedMaterials] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [materialSearchTerm, setMaterialSearchTerm] = useState('');
  const [editMaterialSearchTerm, setEditMaterialSearchTerm] = useState('');

  // حالات خاصة بتعديل سعر البيع
  const [editingPriceProd, setEditingPriceProd] = useState(null);
  const [newSellingPrice, setNewSellingPrice] = useState('');
  const [editingMaterialsProd, setEditingMaterialsProd] = useState(null);
  const [editingMaterials, setEditingMaterials] = useState([]);
  const [editingProductName, setEditingProductName] = useState('');
  const [expandedProductRecipes, setExpandedProductRecipes] = useState({});

  // حالة نافذة التأكيد الاحترافية (Modal) للحذف
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
  });

  // 1. جلب البيانات باستخدام useQuery لجدولي الخامات والتراكيب
  const { data: materials = [] } = useQuery({
    queryKey: ['khamat_moashe'],
    queryFn: async () => {
      const res = await pb.collection('khamat_moashe').getFullList();
      return res;
    },
    retry: 1,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const { data: allRecipes = [] } = useQuery({
    queryKey: ['products_recipes'],
    queryFn: async () => {
      const res = await pb.collection('products_recipes').getFullList({ sort: '-created' });
      return res;
    },
    retry: 1,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const normalizeProductName = (value) => String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // 2. استخدام Mutation لحفظ المنتج والتركيبة وتحديث الكاش تلقائياً
  const saveProductMutation = useMutation({
    mutationFn: async () => {
      const cleanProductName = normalizeProductName(productName);
      const createdRecords = [];

      for (const item of selectedMaterials) {
        const created = await pb.collection('products_recipes').create({
          product_name: cleanProductName,
          selling_price: Number(sellingPrice),
          other_cost: Number(otherCost || 0),
          actor_name: pb.authStore.model?.name || pb.authStore.model?.email || 'مستخدم',
          raw_material_id: item.id,
          quantity_needed: Number(item.qtyNeeded)
        });
        createdRecords.push(created);
      }

      return createdRecords;
    },
    onSuccess: async (createdRecords) => {
      queryClient.setQueryData(['products_recipes'], (previousRecords = []) => [
        ...createdRecords,
        ...previousRecords,
      ]);
      await queryClient.invalidateQueries({
        queryKey: ['products_recipes'],
        refetchType: 'active',
      });
      toast.success('تم حفظ المنتج والتركيبة بنجاح! 🚀');
      setProductName('');
      setSellingPrice('');
      setOtherCost('');
      setSelectedMaterials([]);
    },
    onError: (error) => {
      console.error("Error saving recipe:", error);
      toast.error('حدث خطأ أثناء الحفظ: ' + (error.message || 'فشل الحفظ'));
    }
  });

  // 3. استخدام Mutation لتحديث سعر البيع لكل صفوف المنتج في قاعدة البيانات
  const updatePriceMutation = useMutation({
    mutationFn: async ({ prodName, newPrice }) => {
      const prodRecipes = allRecipes.filter(r => (r.product_name || r.name) === prodName);
      for (const record of prodRecipes) {
        await pb.collection('products_recipes').update(record.id, {
          selling_price: Number(newPrice),
          actor_name: pb.authStore.model?.name || pb.authStore.model?.email || 'مستخدم',
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products_recipes'] });
      toast.success('تم تحديث سعر البيع بنجاح! 🎯');
      setEditingPriceProd(null);
      setNewSellingPrice('');
    },
    onError: (error) => {
      console.error("Error updating price:", error);
      toast.error('حدث خطأ أثناء تحديث السعر: ' + (error.message || 'فشل التعديل'));
    }
  });

  const updateRecipeMaterialsMutation = useMutation({
    mutationFn: async ({ prodName, nextProductName, nextMaterials }) => {
      const prodRecipes = allRecipes.filter(r => normalizeProductName(r.product_name ?? r.name ?? r.product ?? '') === normalizeProductName(prodName));
      if (!prodRecipes.length) throw new Error('لا توجد بيانات لهذا المنتج');

      const cleanProductName = normalizeProductName(nextProductName);
      if (!cleanProductName) throw new Error('اسم المنتج مطلوب');
      const cleanedMaterials = nextMaterials;

      const firstRow = prodRecipes[0];
      const sellingPriceValue = Number(firstRow.selling_price ?? firstRow.sellingPrice ?? firstRow.price ?? 0);
      const otherCostValue = Number(firstRow.other_cost ?? firstRow.otherCost ?? 0);

      for (const record of prodRecipes) {
        await pb.collection('products_recipes').delete(record.id);
      }

      for (const item of cleanedMaterials) {
        await pb.collection('products_recipes').create({
          product_name: cleanProductName,
          selling_price: sellingPriceValue,
          other_cost: otherCostValue,
          actor_name: pb.authStore.model?.name || pb.authStore.model?.email || 'مستخدم',
          raw_material_id: item.id,
          quantity_needed: Number(item.qtyNeeded || 0)
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products_recipes'] });
      toast.success('تم تحديث اسم المنتج والخامات المستخدمة بنجاح! ✅');
      setEditingMaterialsProd(null);
      setEditingMaterials([]);
      setEditingProductName('');
      setEditMaterialSearchTerm('');
    },
    onError: (error) => {
      console.error('Error updating recipe materials:', error);
      toast.error('حدث خطأ أثناء تحديث الخامات: ' + (error.message || 'فشل التعديل'));
    }
  });

  // 4. استخدام Mutation لحذف المنتج وكل تراكيبه وتحديث الكاش تلقائياً
  const deleteProductMutation = useMutation({
    mutationFn: async (prodName) => {
      const prodRecipes = allRecipes.filter(r => (r.product_name || r.name) === prodName);
      for (const record of prodRecipes) {
        await pb.collection('products_recipes').delete(record.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products_recipes'] });
      toast.success('تم حذف المنتج بنجاح!');
      setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
    },
    onError: (error) => {
      console.error("Error deleting product:", error);
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

  const filteredProducts = uniqueProductNames.filter(prod => 
    normalizeProductName(prod).toLowerCase().includes(normalizeProductName(searchTerm).toLowerCase())
  );

  const availableMaterials = materials.filter(material =>
    !selectedMaterials.some(selected => selected.id === material.id) &&
    material.name.toLowerCase().includes(materialSearchTerm.toLowerCase())
  );

  function handleAddMaterial(materialId) {
    if (!materialId) return;
    const mat = materials.find(m => m.id === materialId);
    if (!mat || selectedMaterials.some(m => m.id === materialId)) return;

    setSelectedMaterials([
      ...selectedMaterials,
      { id: mat.id, name: mat.name, price: Number(mat.price || 0), qtyNeeded: 1 }
    ]);
  }

  function handleQtyChange(id, qty) {
    setSelectedMaterials(selectedMaterials.map(item => 
      item.id === id ? { ...item, qtyNeeded: Number(qty) } : item
    ));
  }

  function handleRemoveMaterial(id) {
    setSelectedMaterials(selectedMaterials.filter(item => item.id !== id));
  }

  function handleSaveProduct(e) {
    e.preventDefault();
    const cleanProductName = normalizeProductName(productName);

    if (!cleanProductName || !sellingPrice || selectedMaterials.length === 0) {
      toast.error('الرجاء كتابة اسم المنتج، سعر البيع، وإضافة خامة واحدة على الأقل!');
      return;
    }

    setProductName(cleanProductName);
    saveProductMutation.mutate();
  }

  function handleUpdatePriceSubmit(prodName) {
    if (!newSellingPrice || isNaN(newSellingPrice)) {
      toast.error('الرجاء إدخال سعر بيع صحيح!');
      return;
    }
    updatePriceMutation.mutate({ prodName, newPrice: newSellingPrice });
  }

  function handleDeleteProduct(prodName) {
    setConfirmModal({
      isOpen: true,
      title: 'تأكيد حذف المنتج',
      message: `هل أنت متأكد من حذف المنتج "${prodName}" بكل خاماته وتراكيبه المسجلة؟`,
      onConfirm: () => deleteProductMutation.mutate(prodName)
    });
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 relative" dir="rtl">
      {/* إشعارات الـ Toasts */}
      <Toaster position="top-center" reverseOrder={false} />

      {/* نافذة التأكيد المنبثقة (Modal) للحذف */}
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
                disabled={deleteProductMutation.isPending}
                onClick={confirmModal.onConfirm}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white transition shadow-md disabled:opacity-50"
              >
                {deleteProductMutation.isPending ? 'جاري الحذف...' : 'تأكيد الحذف'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* رأس الصفحة */}
      <div className="border-b pb-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-800">📦 إدارة المنتجات والتراكيب</h1>
          <p className="text-sm text-gray-500">نظام متكامل لإدارة المنتجات وحساب التكاليف والأرباح بدقة</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold px-4 py-2 rounded-xl">
            إجمالي المنتجات: {uniqueProductNames.length}
          </span>
        </div>
      </div>

      {/* تخطيط الشبكة */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* قسم إضافة منتج جديد */}
        <div className="lg:col-span-5 bg-white p-6 shadow-xl rounded-2xl border border-gray-100 sticky top-6 space-y-6">
          <h2 className="text-lg font-bold text-gray-800 border-b pb-2 flex items-center gap-2">
            <span>➕</span> إضافة منتج جديد
          </h2>

          <form onSubmit={handleSaveProduct} className="space-y-4">
            <div>
              <label className="text-xs font-bold text-gray-600 block mb-1">اسم المنتج</label>
              <input
                type="text"
                placeholder="مثال: علف بادي 23%"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="w-full border border-gray-300 p-2.5 rounded-xl focus:ring-2 focus:ring-blue-600 text-black bg-gray-50/50 text-sm outline-none"
                required
              />
            </div>

            <div>
              <label className="text-xs font-bold text-gray-600 block mb-1">سعر البيع (جنيه)</label>
              <input
                type="number"
                placeholder="0.00"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                className="w-full border border-gray-300 p-2.5 rounded-xl focus:ring-2 focus:ring-blue-600 text-black bg-gray-50/50 text-sm outline-none"
                step="any"
                min="0"
                required
              />
            </div>

            <div>
              <label className="text-xs font-bold text-gray-600 block mb-1">تكلفة أخرى (جنيه)</label>
              <input
                type="number"
                placeholder="0.00"
                value={otherCost}
                onChange={(e) => setOtherCost(e.target.value)}
                className="w-full border border-gray-300 p-2.5 rounded-xl focus:ring-2 focus:ring-blue-600 text-black bg-gray-50/50 text-sm outline-none"
                step="any"
                min="0"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-gray-600 block mb-1">اختر الخامات الداخلة في التركيبة:</label>
              <input type="search" value={materialSearchTerm} onChange={e => setMaterialSearchTerm(e.target.value)} placeholder="ابحث عن خامة..." className="w-full border border-gray-300 p-2.5 rounded-xl text-black bg-gray-50/50 text-sm outline-none" />
              <div className="mt-2 border border-gray-200 rounded-xl max-h-52 overflow-y-auto grid grid-cols-2 md:grid-cols-3 gap-2 p-2">
                {availableMaterials.length ? availableMaterials.map(material => (
                  <button type="button" key={material.id} onClick={() => handleAddMaterial(material.id)} className="w-full min-h-16 flex items-center justify-between gap-2 p-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-right border border-blue-100 transition">
                    <span className="text-xs font-bold text-gray-800">{material.name}<span className="block text-gray-400 font-normal mt-1">{Number(material.price || 0).toFixed(1)} ج.م</span></span>
                    <span className="w-8 h-8 shrink-0 rounded-lg bg-blue-600 text-white text-lg font-black leading-8 text-center" aria-hidden="true">+</span>
                  </button>
                )) : <p className="p-3 text-xs text-gray-400 text-center">لا توجد خامات متاحة للإضافة.</p>}
              </div>
            </div>

            {selectedMaterials.length > 0 && (
              <div className="border rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-gray-50 text-gray-600 sticky top-0">
                    <tr>
                      <th className="p-2">الخامة</th>
                      <th className="p-2">الكمية</th>
                      <th className="p-2">التكلفة</th>
                      <th className="p-2">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {selectedMaterials.map(item => (
                      <tr key={item.id}>
                        <td className="p-2 font-bold text-gray-800">{item.name}</td>
                        <td className="p-2">
                          <input 
                            type="number" 
                            value={item.qtyNeeded} 
                            onChange={(e) => handleQtyChange(item.id, e.target.value)}
                            className="w-16 border p-1 rounded text-center text-black font-bold text-xs outline-none focus:ring-1 focus:ring-blue-600"
                            step="any"
                            min="0.000000"
                            required
                          />
                        </td>
                        <td className="p-2 font-bold text-emerald-600">
                          {(item.price * item.qtyNeeded).toFixed(1)} ج.م
                        </td>
                        <td className="p-2">
                          <button type="button" onClick={() => handleRemoveMaterial(item.id)} className="text-red-500 font-bold">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button
              type="submit"
              disabled={saveProductMutation.isPending}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-xl font-bold transition shadow-lg shadow-blue-600/20 text-sm disabled:opacity-50"
            >
              {saveProductMutation.isPending ? 'جاري الحفظ...' : '💾 حفظ المنتج والتركيبة'}
            </button>
          </form>
        </div>

        {/* قسم استعراض المنتجات والبحث */}
        <div className="lg:col-span-7 bg-white shadow-xl rounded-2xl border border-gray-100 overflow-hidden flex flex-col">
          <div className="p-4 bg-gray-50 border-b flex flex-col sm:flex-row justify-between items-center gap-3">
            <h2 className="text-lg font-bold text-gray-800">قائمة المنتجات والتراكيب المسجلة</h2>
            
            <div className="w-full sm:w-64">
              <input
                type="text"
                placeholder="🔍 ابحث عن اسم المنتج..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full border border-gray-300 px-3 py-1.5 rounded-xl text-xs text-black bg-white focus:ring-2 focus:ring-blue-600 outline-none"
              />
            </div>
          </div>

          <div className="p-4 space-y-4 max-h-[750px] overflow-y-auto divide-y">
            {filteredProducts.length === 0 ? (
              <div className="p-12 text-center text-gray-400 text-sm">
                {searchTerm ? 'لا توجد نتائج مطابقة للبحث.' : 'لا توجد منتجات مسجلة حتى الآن.'}
              </div>
            ) : (
              filteredProducts.map((prodName, index) => {
                const prodRecipes = allRecipes.filter(r => normalizeProductName(r.product_name || r.name) === normalizeProductName(prodName));
                const firstRow = prodRecipes[0] || {};
                const sellingPriceVal = Number(firstRow.selling_price || firstRow.sellingPrice || firstRow.price || 0);
                const otherCostVal = Number(firstRow.other_cost || 0);

                const liveCost = prodRecipes.reduce((sum, item) => {
                  const matId = item.raw_material_id || item.material_id;
                  const currentMat = materials.find(m => m.id === matId);
                  const currentPrice = currentMat ? Number(currentMat.price || 0) : 0;
                  const qty = Number(item.quantity_needed || item.qtyNeeded || item.quantity || 0);
                  return sum + (currentPrice * qty);
                }, 0);

                const totalCost = liveCost + otherCostVal;
                const profit = sellingPriceVal - totalCost;
                const isEditing = editingPriceProd === prodName;
                const areRecipesVisible = !!expandedProductRecipes[prodName];
                const totalMaterialQuantity = prodRecipes.reduce((sum, item) => {
                  const matId = item.raw_material_id || item.material_id;
                  const matInfo = materials.find(m => m.id === matId);
                  const materialName = matInfo?.name || '';
                  if (materialName.includes('شكاير')) return sum;
                  return sum + Number(item.quantity_needed || item.qtyNeeded || item.quantity || 0);
                }, 0);

                return (
                  <div key={index} className="pt-4 first:pt-0 space-y-3">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                      <h3 className="text-base font-black text-gray-900">{prodName}</h3>
                      <span className="text-[10px] text-gray-400">بواسطة: {firstRow.actor_name || 'غير معروف'}</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setEditingPriceProd(prodName);
                            setNewSellingPrice(sellingPriceVal);
                          }}
                          className="text-blue-600 hover:text-blue-800 text-xs font-bold bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100 transition"
                        >
                          ✏️ تعديل سعر البيع
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => {
                              setEditingMaterialsProd(prodName);
                              setEditingProductName(prodName);
                              const draft = Object.values(
                                prodRecipes.reduce((acc, row) => {
                                  const matId = row.raw_material_id || row.material_id;
                                  if (!matId) return acc;
                                  const qty = Number(row.quantity_needed || row.qtyNeeded || row.quantity || 0);
                                  const materialInfo = materials.find((m) => m.id === matId);
                                  if (!acc[matId]) {
                                    acc[matId] = { id: matId, name: materialInfo?.name || 'خامة', price: Number(materialInfo?.price || 0), qtyNeeded: 0 };
                                  }
                                  acc[matId].qtyNeeded += qty;
                                  return acc;
                                }, {})
                              );
                              setEditingMaterials(draft);
                              setEditMaterialSearchTerm('');
                            }}
                            className="text-violet-600 hover:text-violet-800 text-xs font-bold bg-violet-50 px-2.5 py-1 rounded-lg border border-violet-100 transition"
                          >
                            🧩 تعديل الخامات
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteProduct(prodName)}
                          disabled={deleteProductMutation.isPending}
                          className="text-red-500 hover:text-red-700 text-xs font-bold bg-red-50 px-2.5 py-1 rounded-lg border border-red-100 transition"
                        >
                          🗑️ حذف المنتج
                        </button>
                      </div>
                    </div>

                    {/* حقل التعديل السريع لسعر البيع */}
                    {isEditing && (
                      <div className="bg-blue-50/80 border border-blue-200 p-3 rounded-xl flex items-center gap-3 animate-fadeIn">
                        <span className="text-xs font-bold text-blue-800">السعر الجديد:</span>
                        <input
                          type="number"
                          value={newSellingPrice}
                          onChange={(e) => setNewSellingPrice(e.target.value)}
                          className="w-32 border border-blue-300 p-1.5 rounded-lg text-xs font-bold text-black bg-white outline-none focus:ring-2 focus:ring-blue-600"
                          step="any"
                          min="0"
                        />
                        <button
                          onClick={() => handleUpdatePriceSubmit(prodName)}
                          disabled={updatePriceMutation.isPending}
                          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition shadow-sm"
                        >
                          {updatePriceMutation.isPending ? 'جاري الحفظ...' : 'حفظ'}
                        </button>
                        <button
                          onClick={() => setEditingPriceProd(null)}
                          className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-bold px-3 py-1.5 rounded-lg transition"
                        >
                          إلغاء
                        </button>
                      </div>
                    )}

                    {isAdmin && editingMaterialsProd === prodName && (
                      <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs font-black text-violet-800">تعديل اسم المنتج والخامات المستخدمة</span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMaterialsProd(null);
                              setEditingMaterials([]);
                              setEditingProductName('');
                              setEditMaterialSearchTerm('');
                            }}
                            className="text-xs font-bold text-violet-700 hover:text-violet-900"
                          >
                            إغلاق
                          </button>
                        </div>

                        <div>
                          <label className="text-xs font-bold text-violet-800">اسم المنتج</label>
                          <input
                            type="text"
                            value={editingProductName}
                            onChange={(e) => setEditingProductName(e.target.value)}
                            className="w-full border border-violet-200 p-2 rounded-xl text-black bg-white text-sm outline-none focus:ring-2 focus:ring-violet-600"
                            required
                          />
                        </div>

                        <input
                          type="search"
                          value={editMaterialSearchTerm}
                          onChange={(e) => setEditMaterialSearchTerm(e.target.value)}
                          placeholder="ابحث عن خامة لإضافتها..."
                          className="w-full border border-violet-200 p-2 rounded-xl text-black bg-white text-sm outline-none"
                        />

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {materials
                            .filter((material) => !editingMaterials.some((selected) => selected.id === material.id))
                            .filter((material) => material.name.toLowerCase().includes(editMaterialSearchTerm.toLowerCase()))
                            .map((material) => (
                              <button
                                key={material.id}
                                type="button"
                                onClick={() => {
                                  setEditingMaterials((prev) => [
                                    ...prev,
                                    { id: material.id, name: material.name, price: Number(material.price || 0), qtyNeeded: 1 }
                                  ]);
                                }}
                                className="w-full flex items-center justify-between gap-2 p-2 rounded-xl bg-white hover:bg-violet-100 text-right border border-violet-100 transition"
                              >
                                <span className="text-xs font-bold text-gray-800">{material.name}</span>
                                <span className="text-lg font-black text-violet-600">+</span>
                              </button>
                            ))}
                        </div>

                        {editingMaterials.length > 0 && (
                          <div className="border border-violet-200 rounded-xl overflow-hidden">
                            <table className="w-full text-right text-xs">
                              <thead className="bg-violet-100 text-violet-700">
                                <tr>
                                  <th className="p-2">الخامة</th>
                                  <th className="p-2">الكمية</th>
                                  <th className="p-2">إزالة</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y bg-white">
                                {editingMaterials.map((item) => (
                                  <tr key={item.id}>
                                    <td className="p-2 font-bold text-gray-800">{item.name}</td>
                                    <td className="p-2">
                                      <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={item.qtyNeeded}
                                        onChange={(e) => {
                                          const value = Number(e.target.value);
                                          setEditingMaterials((prev) => prev.map((m) => (m.id === item.id ? { ...m, qtyNeeded: Number(value || 0) } : m)));
                                        }}
                                        className="w-20 border border-violet-200 p-1 rounded text-center text-black font-bold text-xs outline-none"
                                      />
                                    </td>
                                    <td className="p-2">
                                      <button type="button" onClick={() => setEditingMaterials((prev) => prev.filter((m) => m.id !== item.id))} className="text-red-500 font-bold">✕</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            if (!editingMaterials.length) {
                              toast.error('يجب إضافة خامة واحدة على الأقل!');
                              return;
                            }
                            updateRecipeMaterialsMutation.mutate({
                              prodName,
                              nextProductName: editingProductName,
                              nextMaterials: editingMaterials,
                            });
                          }}
                          disabled={updateRecipeMaterialsMutation.isPending}
                          className="w-full bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold px-3 py-2.5 rounded-xl transition disabled:opacity-50"
                        >
                          {updateRecipeMaterialsMutation.isPending ? 'جاري الحفظ...' : '💾 حفظ الاسم والخامات'}
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-blue-50/60 border border-blue-100 p-2 rounded-xl">
                        <span className="text-[10px] text-blue-600 block">سعر البيع</span>
                        <span className="font-bold text-blue-700 text-xs sm:text-sm">{sellingPriceVal.toFixed(1)} ج.م</span>
                      </div>
                      <div className="bg-amber-50/60 border border-amber-100 p-2 rounded-xl">
                        <span className="text-[10px] text-amber-700 block">التكلفة</span>
                        <span className="font-bold text-amber-700 text-xs sm:text-sm">{totalCost.toFixed(1)} ج.م</span>
                        <span className="text-[9px] text-gray-500 block">منها أخرى: {otherCostVal.toFixed(1)} ج.م</span>
                      </div>
                      <div className="bg-emerald-50/60 border border-emerald-100 p-2 rounded-xl">
                        <span className="text-[10px] text-emerald-700 block">الربح</span>
                        <span className="font-bold text-emerald-700 text-xs sm:text-sm">{profit.toFixed(1)} ج.م</span>
                      </div>
                    </div>

                    <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                      <button
                        type="button"
                        onClick={() => setExpandedProductRecipes((previous) => ({ ...previous, [prodName]: !previous[prodName] }))}
                        className="text-[11px] font-bold text-blue-700 hover:text-blue-900"
                      >
                        {areRecipesVisible ? '🙈 إخفاء الخامات' : `📋 عرض الخامات المستخدمة (${prodRecipes.length} خامة، إجمالي ${formatQuantity(totalMaterialQuantity)} طن بدون الشكاير)`}
                      </button>
                      {areRecipesVisible && (
                        <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
                          <table className="w-full min-w-[420px] text-right text-[11px]">
                            <thead className="bg-blue-50 text-blue-900">
                              <tr>
                                <th className="p-2.5 font-black">#</th>
                                <th className="p-2.5 font-black">الخامة</th>
                                <th className="p-2.5 font-black">الكمية</th>
                                <th className="p-2.5 font-black">التكلفة</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {prodRecipes.map((item, idx) => {
                                const matId = item.raw_material_id || item.material_id;
                                const matInfo = materials.find(m => m.id === matId);
                                const matName = matInfo?.name || 'خامة';
                                const matPrice = Number(matInfo?.price || 0);
                                const qty = Number(item.quantity_needed || item.qtyNeeded || item.quantity || 0);
                                const itemTotalCost = matPrice * qty;

                                return (
                                  <tr key={idx} className="hover:bg-blue-50/40">
                                    <td className="p-2.5 text-gray-400">{idx + 1}</td>
                                    <td className="p-2.5 font-bold text-gray-800">{matName}</td>
                                    <td className="p-2.5 font-bold text-blue-700">{formatQuantity(qty)} طن</td>
                                    <td className="p-2.5 font-bold text-emerald-700">{itemTotalCost.toFixed(1)} ج.م</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
}