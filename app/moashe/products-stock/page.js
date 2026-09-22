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
  const [editStockModal, setEditStockModal] = useState({ isOpen: false, product: null });
  const [editStockQuantity, setEditStockQuantity] = useState('');
  const [deleteConfirmModal, setDeleteConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: null });
  const [historyModal, setHistoryModal] = useState({ isOpen: false, product: null });
  const [salesModal, setSalesModal] = useState({ isOpen: false, product: null });
  const [historyEditModal, setHistoryEditModal] = useState({ isOpen: false, item: null, product: null });
  const [historyEditQuantity, setHistoryEditQuantity] = useState('');
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');
  const [salesSearchTerm, setSalesSearchTerm] = useState('');
  const [salesStartDate, setSalesStartDate] = useState('');
  const [salesEndDate, setSalesEndDate] = useState('');
  const [salesModalStartDate, setSalesModalStartDate] = useState('');
  const [salesModalEndDate, setSalesModalEndDate] = useState('');

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

  const { data: stockTransactions = [] } = useQuery({
    queryKey: ['product_stock_transactions'],
    queryFn: () => pb.collection('product_stock_transactions').getFullList().catch(() => []),
  });

  const { data: salesInvoices = [] } = useQuery({
    queryKey: ['sales_invoices_products_stock'],
    queryFn: () => pb.collection('sales_invoices').getFullList({ sort: '-created' }).catch(() => []),
  });

  // تجهيز وتنظيف البيانات المأخوذة من جدول الـ Stock (مع دعم حقول التكلفة)
  const inventoryList = productsStock.map(item => {
    const productName = item.product_name || item.name || 'منتج بدون اسم';
    const stock = Number(item.stock ?? productionOrders
      .filter(order => (order.product_name || order.name) === productName)
      .reduce((sum, order) => sum + Number(order.batch_quantity || order.quantity || 0), 0));
    const productRecipes = recipes.filter(recipe => (recipe.product_name || recipe.name) === productName);
    const recipeUnitCost = productRecipes.reduce((sum, recipe) => {
      const materialId = recipe.raw_material_id || recipe.material_id;
      const material = materials.find(record => record.id === materialId);
      const quantity = Number(recipe.quantity_needed || recipe.quantity || 0);
      return sum + Number(material?.price || 0) * quantity;
    }, 0) + Number(productRecipes[0]?.other_cost || 0);
    const hasStoredTotalCost = item.total_cost !== undefined && item.total_cost !== null;
    const totalCost = hasStoredTotalCost ? Number(item.total_cost) : recipeUnitCost * stock;

    return {
      id: item.id,
      product_name: productName,
      stock,
      unit_cost: stock > 0 ? totalCost / stock : recipeUnitCost,
      total_cost: totalCost,
    };
  });

  // تصفية المنتجات بناءً على البحث بالاسم
  const filteredOrders = inventoryList.filter(item =>
    String(item.product_name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const salesSummary = inventoryList
    .map((product) => {
      const normalizeName = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const productName = normalizeName(product.product_name);
      const productSales = salesInvoices.flatMap((invoice) => {
        const invoiceDate = String(invoice.created || '').slice(0, 10);
        if (salesStartDate && invoiceDate < salesStartDate) return [];
        if (salesEndDate && invoiceDate > salesEndDate) return [];

        return (Array.isArray(invoice.items) ? invoice.items : [])
          .filter((item) => normalizeName(item.name || item.product_name) === productName)
          .map((item) => ({
            quantity: Number(item.qty || 0),
            total: Number(item.price || 0) * Number(item.qty || 0),
          }));
      });

      return {
        ...product,
        salesCount: productSales.length,
        soldQuantity: productSales.reduce((sum, sale) => sum + sale.quantity, 0),
        salesTotal: productSales.reduce((sum, sale) => sum + sale.total, 0),
      };
    })
    .filter((product) => String(product.product_name || '').toLowerCase().includes(salesSearchTerm.toLowerCase().trim()));

  const salesSummaryQuantity = salesSummary.reduce((sum, product) => sum + product.soldQuantity, 0);
  const salesSummaryTotal = salesSummary.reduce((sum, product) => sum + product.salesTotal, 0);

  const getProductHistory = (product) => {
    const normalizeName = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const productName = normalizeName(product.product_name);
    const history = stockTransactions
      .filter((transaction) => normalizeName(transaction.product_name) === productName)
      .filter((transaction) => transaction.product_stock_id === product.id || (
        !transaction.product_stock_id && new Date(transaction.created || 0) >= new Date(product.created || 0)
      ))
      .map((transaction) => ({
        id: transaction.id,
        date: transaction.movement_at || transaction.updated || transaction.created,
        type: transaction.quantity >= 0 ? 'إضافة' : 'سحب',
        title: transaction.title || 'حركة مخزن منتجات',
        quantity: Number(transaction.quantity || 0),
        balance: Number(transaction.balance_after ?? 0),
        actor: transaction.actor_name || 'غير معروف',
        notes: transaction.notes || '-',
        editable: ['adjustment', 'stock_edit'].includes(transaction.movement_type),
        sourceId: transaction.id,
      }))
      .sort((first, second) => {
        const timeDifference = new Date(second.date || 0) - new Date(first.date || 0);
        return timeDifference || String(second.id).localeCompare(String(first.id));
      });

    return history.filter(item => {
      const itemDate = String(item.date || '').slice(0, 10);
      return (!historyStartDate || itemDate >= historyStartDate) && (!historyEndDate || itemDate <= historyEndDate);
    });
  };

  const getProductSales = (product) => {
    const normalizeName = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const productName = normalizeName(product.product_name);

    return salesInvoices
      .filter((invoice) => {
        const invoiceDate = String(invoice.created || '').slice(0, 10);
        return (!salesModalStartDate || invoiceDate >= salesModalStartDate)
          && (!salesModalEndDate || invoiceDate <= salesModalEndDate);
      })
      .flatMap((invoice) => (Array.isArray(invoice.items) ? invoice.items : [])
        .filter((item) => normalizeName(item.name || item.product_name) === productName)
        .map((item, index) => ({
          id: `${invoice.id}-${index}`,
          invoiceNumber: invoice.invoice_number || invoice.id.slice(-6),
          customer: invoice.customer_name || 'عميل فوري',
          quantity: Number(item.qty || 0),
          unitPrice: Number(item.price || 0),
          total: Number(item.price || 0) * Number(item.qty || 0),
          date: invoice.created,
          paymentType: invoice.payment_type === 'credit' ? 'آجل' : 'كاش',
        })))
      .sort((first, second) => new Date(second.date || 0) - new Date(first.date || 0));
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
      await pb.collection('product_stock_transactions').create({
        product_name: product.product_name,
        quantity,
        movement_type: 'adjustment',
        title: 'تسوية مخزن المنتجات',
        notes: `تسوية كمية المخزن: ${quantity > 0 ? '+' : ''}${quantity}`,
        actor_name: pb.authStore.model?.name || pb.authStore.model?.email || 'مستخدم',
        source_type: 'stock_adjustment',
        source_id: product.id,
        product_stock_id: product.id,
        movement_at: new Date().toISOString(),
        balance_after: newStock,
      });
      return updatedProduct;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products_stock'] });
      queryClient.invalidateQueries({ queryKey: ['product_stock_transactions'] });
      setAdjustmentModal({ isOpen: false, product: null });
      setAdjustmentQuantity('');
      toast.success('تم تنفيذ تسوية مخزن المنتجات بنجاح!');
    },
    onError: (error) => toast.error(error.message || 'فشل تنفيذ التسوية'),
  });

  const editStockMutation = useMutation({
    mutationFn: async () => {
      if (!isAdmin) throw new Error('تعديل كمية المنتج متاح للأدمن فقط');
      const product = editStockModal.product;
      const nextStock = Number(editStockQuantity);
      if (!product || !Number.isFinite(nextStock) || nextStock < 0) {
        throw new Error('أدخل كمية صحيحة لا تقل عن صفر');
      }

      const previousStock = Number(product.stock || 0);
      const updatedProduct = await pb.collection('products_stock').update(product.id, {
        stock: nextStock,
        total_cost: product.unit_cost * nextStock,
        actor_name: pb.authStore.model?.name || pb.authStore.model?.email || 'مستخدم',
      });
      await pb.collection('product_stock_transactions').create({
        product_name: product.product_name,
        quantity: nextStock - previousStock,
        movement_type: 'stock_edit',
        title: 'تعديل الكمية الحالية',
        notes: `تم تعديل الكمية من ${previousStock} إلى ${nextStock}`,
        actor_name: pb.authStore.model?.name || pb.authStore.model?.email || 'مستخدم',
        source_type: 'stock_edit',
        source_id: product.id,
        product_stock_id: product.id,
        movement_at: new Date().toISOString(),
        balance_after: nextStock,
      });
      return updatedProduct;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products_stock'] });
      queryClient.invalidateQueries({ queryKey: ['product_stock_transactions'] });
      setEditStockModal({ isOpen: false, product: null });
      setEditStockQuantity('');
      toast.success('تم تعديل كمية المنتج الحالية بنجاح!');
    },
    onError: (error) => toast.error(error.message || 'فشل تعديل كمية المنتج'),
  });

  const deleteProductMutation = useMutation({
    mutationFn: async (product) => {
      if (!isAdmin) throw new Error('حذف المنتج متاح للأدمن فقط');
      await pb.collection('product_stock_transactions').create({
        product_name: product.product_name,
        quantity: -Number(product.stock || 0),
        movement_type: 'delete',
        title: 'حذف المنتج من المخزن',
        notes: `تم حذف المنتج وإخراج رصيد ${product.stock || 0} من المخزن`,
        actor_name: pb.authStore.model?.name || pb.authStore.model?.email || 'مستخدم',
        source_type: 'product_delete',
        source_id: product.id,
        product_stock_id: product.id,
        movement_at: new Date().toISOString(),
        balance_after: 0,
      });
      const deleted = await pb.collection('products_stock').delete(product.id);
      queryClient.setQueryData(['products_stock'], (records = []) => records.filter((record) => record.id !== product.id));
      return deleted;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products_stock'] });
      queryClient.invalidateQueries({ queryKey: ['product_stock_transactions'] });
      setHistoryModal({ isOpen: false, product: null });
      toast.success('تم حذف المنتج من مخزن المنتجات!');
    },
    onError: (error) => toast.error(error?.data?.message || error.message || 'فشل حذف المنتج'),
  });

  const editHistoryMutation = useMutation({
    mutationFn: async () => {
      if (!isAdmin) throw new Error('تعديل سجل المخزن متاح للأدمن فقط');
      const item = historyEditModal.item;
      const product = historyEditModal.product;
      const nextQuantity = Number(historyEditQuantity);
      if (!item || !product || !Number.isFinite(nextQuantity) || nextQuantity === 0) {
        throw new Error('أدخل كمية صحيحة غير صفرية');
      }

      const transaction = await pb.collection('product_stock_transactions').getOne(item.sourceId);
      const delta = nextQuantity - Number(transaction.quantity || 0);
      const nextStock = Number(product.stock || 0) + delta;
      if (nextStock < 0) throw new Error('لا يمكن أن تصبح كمية المخزن أقل من صفر');

      await pb.collection('products_stock').update(product.id, {
        stock: nextStock,
        total_cost: product.unit_cost * nextStock,
      });
      await pb.collection('product_stock_transactions').update(item.sourceId, {
        quantity: nextQuantity,
        notes: `تم تعديل حركة المخزن إلى كمية ${nextQuantity > 0 ? '+' : ''}${nextQuantity}`,
        balance_after: Number(transaction.balance_after || 0) + delta,
      });

      const normalizeName = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const relatedTransactions = (await pb.collection('product_stock_transactions').getFullList())
        .filter((record) => record.product_stock_id === product.id || (
          !record.product_stock_id && normalizeName(record.product_name) === normalizeName(product.product_name)
        ))
        .sort((first, second) => {
          const firstDate = new Date(first.movement_at || first.updated || first.created || 0).getTime();
          const secondDate = new Date(second.movement_at || second.updated || second.created || 0).getTime();
          return firstDate - secondDate || String(first.id).localeCompare(String(second.id));
        });
      let targetFound = false;
      for (const record of relatedTransactions) {
        if (record.id === item.sourceId) {
          targetFound = true;
          continue;
        }
        if (targetFound) {
          await pb.collection('product_stock_transactions').update(record.id, {
            balance_after: Number(record.balance_after || 0) + delta,
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products_stock'] });
      queryClient.invalidateQueries({ queryKey: ['product_stock_transactions'] });
      setHistoryEditModal({ isOpen: false, item: null, product: null });
      setHistoryEditQuantity('');
      toast.success('تم تعديل كمية حركة المخزن بنجاح!');
    },
    onError: (error) => toast.error(error.message || 'فشل تعديل حركة المخزن'),
  });

  const deleteHistoryMutation = useMutation({
    mutationFn: async (item) => {
      if (!isAdmin) throw new Error('حذف سجل المخزن متاح للأدمن فقط');
      const product = historyModal.product;
      if (!product) throw new Error('لم يتم اختيار منتج');
      const nextStock = Number(product.stock || 0) - Number(item.quantity || 0);
      if (nextStock < 0) throw new Error('لا يمكن أن تصبح كمية المخزن أقل من صفر');

      await pb.collection('products_stock').update(product.id, {
        stock: nextStock,
        total_cost: product.unit_cost * nextStock,
      });
      await pb.collection('product_stock_transactions').delete(item.sourceId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products_stock'] });
      queryClient.invalidateQueries({ queryKey: ['product_stock_transactions'] });
      toast.success('تم حذف حركة المخزن وتحديث الكمية!');
    },
    onError: (error) => toast.error(error.message || 'فشل حذف حركة المخزن'),
  });

  const deleteAllHistoryMutation = useMutation({
    mutationFn: async () => {
      if (!isAdmin) throw new Error('حذف سجل المخزن متاح للأدمن فقط');
      const product = historyModal.product;
      if (!product) throw new Error('لم يتم اختيار منتج');

      const historyItems = stockTransactions.filter((transaction) => (
        transaction.product_stock_id === product.id || (
          !transaction.product_stock_id
          && String(transaction.product_name || '').trim() === String(product.product_name || '').trim()
          && new Date(transaction.created || 0) >= new Date(product.created || 0)
        )
      ));

      await Promise.all(historyItems.map((transaction) => (
        pb.collection('product_stock_transactions').delete(transaction.id)
      )));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product_stock_transactions'] });
      setHistoryModal({ isOpen: false, product: null });
      toast.success('تم حذف سجل حركات المنتج بالكامل.');
    },
    onError: (error) => toast.error(error.message || 'فشل حذف سجل المنتج'),
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

      {editStockModal.isOpen && editStockModal.product && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              editStockMutation.mutate();
            }}
            className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4"
          >
            <div className="flex justify-between items-center border-b pb-3">
              <h2 className="text-lg font-black text-gray-800">تعديل الكمية الحالية</h2>
              <button type="button" onClick={() => setEditStockModal({ isOpen: false, product: null })} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
            </div>
            <p className="text-sm font-bold text-gray-700">{editStockModal.product.product_name}</p>
            <p className="text-xs text-gray-500">الكمية الحالية: {editStockModal.product.stock.toLocaleString()} طن</p>
            <input
              type="number"
              min="0"
              step="any"
              value={editStockQuantity}
              onChange={(event) => setEditStockQuantity(event.target.value)}
              className="w-full border border-gray-200 p-3 rounded-xl text-sm bg-white text-black"
              required
            />
            <div className="flex gap-3">
              <button type="button" onClick={() => setEditStockModal({ isOpen: false, product: null })} className="flex-1 bg-gray-100 text-gray-700 p-3 rounded-xl text-sm font-bold">إلغاء</button>
              <button type="submit" disabled={editStockMutation.isPending} className="flex-1 bg-amber-600 hover:bg-amber-700 text-white p-3 rounded-xl text-sm font-bold">حفظ الكمية</button>
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
                    <th className="p-3 font-bold">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y text-sm">
                  {filteredOrders.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50/50 transition">
                      <td className="p-3 font-black text-gray-900">{item.product_name}</td>
                      <td className="p-3 font-bold text-emerald-700">{item.stock.toLocaleString()}</td>
                      <td className="p-3 font-bold text-amber-700">{item.unit_cost.toLocaleString('ar-EG', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ج.م</td>
                      <td className="p-3 font-bold text-gray-700">{item.total_cost.toLocaleString()} ج.م</td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center gap-3 text-xs font-bold">
                          <button
                            type="button"
                            onClick={() => {
                              setHistoryStartDate('');
                              setHistoryEndDate('');
                              setHistoryModal({ isOpen: true, product: item });
                            }}
                            className="bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100 px-3 py-1 rounded-xl transition"
                          >
                            عرض السجل
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSalesModalStartDate('');
                              setSalesModalEndDate('');
                              setSalesModal({ isOpen: true, product: item });
                            }}
                            className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-100 px-3 py-1 rounded-xl transition"
                          >
                            قائمة المبيعات
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditStockModal({ isOpen: true, product: item });
                                  setEditStockQuantity(String(item.stock));
                                }}
                                className="bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-100 px-3 py-1 rounded-xl transition"
                              >
                                تعديل الكمية
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmModal({
                                  isOpen: true,
                                  title: 'حذف المنتج من المخزن',
                                  message: `هل تريد حذف المنتج ${item.product_name} بالكامل من المخزن؟`,
                                  onConfirm: () => deleteProductMutation.mutate(item),
                                })}
                                className="bg-red-50 text-red-600 hover:bg-red-100 border border-red-100 px-3 py-1 rounded-xl transition"
                              >
                                حذف
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white shadow-xl rounded-2xl border border-gray-100 overflow-hidden">
        <div className="p-4 bg-emerald-50 border-b border-emerald-100">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-black text-gray-800">📊 إجمالي مبيعات المنتجات</h2>
              <p className="text-xs text-gray-500 mt-1">تقرير مجمع للمبيعات حسب المنتج خلال الفترة المحددة</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full lg:w-auto">
              <input
                type="search"
                value={salesSearchTerm}
                onChange={(event) => setSalesSearchTerm(event.target.value)}
                placeholder="بحث باسم المنتج..."
                className="border border-gray-200 bg-white p-2.5 rounded-xl text-xs font-bold outline-none"
              />
              <input
                type="date"
                value={salesStartDate}
                onChange={(event) => setSalesStartDate(event.target.value)}
                className="border border-gray-200 bg-white p-2.5 rounded-xl text-xs font-bold outline-none"
              />
              <input
                type="date"
                value={salesEndDate}
                onChange={(event) => setSalesEndDate(event.target.value)}
                className="border border-gray-200 bg-white p-2.5 rounded-xl text-xs font-bold outline-none"
              />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 border-b border-gray-100">
          <div className="rounded-xl bg-gray-50 p-3 text-xs font-bold text-gray-600">المنتجات الظاهرة: <span className="text-gray-900">{salesSummary.length}</span></div>
          <div className="rounded-xl bg-blue-50 p-3 text-xs font-bold text-blue-700">إجمالي الكمية المباعة: <span className="font-black">{salesSummaryQuantity.toLocaleString()}</span></div>
          <div className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700">إجمالي قيمة المبيعات: <span className="font-black">{salesSummaryTotal.toLocaleString()} ج.م</span></div>
        </div>
        <div className="overflow-x-auto p-4">
          <table className="w-full text-right text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="p-3">المنتج</th>
                <th className="p-3">عدد الفواتير</th>
                <th className="p-3">إجمالي الكمية المباعة</th>
                {/* <th className="p-3">إجمالي المبيعات</th> */}
                <th className="p-3">الرصيد الحالي</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {salesSummary.map((product) => (
                <tr key={product.id} className="hover:bg-gray-50">
                  <td className="p-3 font-black text-gray-900">{product.product_name}</td>
                  <td className="p-3 font-bold text-blue-700">{product.salesCount.toLocaleString()}</td>
                  <td className="p-3 font-black text-red-700">{product.soldQuantity.toLocaleString()}</td>
                  {/* <td className="p-3 font-black text-emerald-700">{product.salesTotal.toLocaleString()} ج.م</td> */}
                  <td className="p-3 font-bold text-indigo-700">{product.stock.toLocaleString()}</td>
                </tr>
              ))}
              {!salesSummary.length && (
                <tr><td colSpan="5" className="p-8 text-center text-gray-400">لا توجد منتجات مطابقة للبحث أو الفترة المحددة.</td></tr>
              )}
            </tbody>
          </table>
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
              <div className="flex items-center gap-3">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmModal({
                      isOpen: true,
                      title: 'حذف سجل المنتج بالكامل',
                      message: 'هل تريد حذف كل حركات هذا المنتج من السجل؟ لن تتغير كمية المخزون الحالية.',
                      onConfirm: () => deleteAllHistoryMutation.mutate(),
                    })}
                    disabled={deleteAllHistoryMutation.isPending}
                    className="rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                  >
                    حذف السجل كله
                  </button>
                )}
                <button type="button" onClick={() => setHistoryModal({ isOpen: false, product: null })} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
              </div>
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
                      <td className="p-3 font-bold text-gray-700">
                        <div>{item.actor}</div>
                        {isAdmin && (
                          <div className="flex gap-2 mt-2 whitespace-nowrap">
                            {item.editable && (
                              <button
                                type="button"
                                onClick={() => {
                                  setHistoryEditModal({ isOpen: true, item, product: historyModal.product });
                                  setHistoryEditQuantity(String(item.quantity));
                                }}
                                className="text-amber-700 hover:text-amber-900 font-bold"
                              >
                                تعديل الكمية
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteConfirmModal({
                                  isOpen: true,
                                  title: 'حذف حركة المخزن',
                                  message: 'هل تريد حذف هذه الحركة وتحديث كمية المنتج؟',
                                  onConfirm: () => deleteHistoryMutation.mutate(item),
                                });
                              }}
                              className="text-red-700 hover:text-red-900 font-bold"
                            >
                              حذف السجل
                            </button>
                          </div>
                        )}
                      </td>
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

      {salesModal.isOpen && salesModal.product && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 max-w-5xl w-full max-h-[88vh] shadow-2xl flex flex-col gap-4">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h2 className="text-lg font-black text-gray-800">🧾 قائمة مبيعات: {salesModal.product.product_name}</h2>
                <p className="text-xs text-gray-500 mt-1">عدد مرات البيع: <span className="font-black text-emerald-700">{getProductSales(salesModal.product).length}</span></p>
              </div>
              <button type="button" onClick={() => setSalesModal({ isOpen: false, product: null })} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs font-bold text-gray-700">
                من تاريخ
                <input
                  type="date"
                  value={salesModalStartDate}
                  onChange={(event) => setSalesModalStartDate(event.target.value)}
                  className="mt-1 w-full border border-gray-200 bg-gray-50 p-3 rounded-xl text-xs font-bold"
                />
              </label>
              <label className="text-xs font-bold text-gray-700">
                إلى تاريخ
                <input
                  type="date"
                  value={salesModalEndDate}
                  onChange={(event) => setSalesModalEndDate(event.target.value)}
                  className="mt-1 w-full border border-gray-200 bg-gray-50 p-3 rounded-xl text-xs font-bold"
                />
              </label>
            </div>
            <div className="overflow-auto border border-gray-100 rounded-xl">
              <table className="w-full text-right text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="p-3">رقم الفاتورة</th>
                    <th className="p-3">العميل</th>
                    <th className="p-3">الكمية</th>
                    <th className="p-3">سعر الوحدة</th>
                    <th className="p-3">إجمالي المنتج</th>
                    <th className="p-3">طريقة الدفع</th>
                    <th className="p-3">تاريخ البيع</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {getProductSales(salesModal.product).map((sale) => (
                    <tr key={sale.id} className="hover:bg-gray-50">
                      <td className="p-3 font-bold text-blue-700">{sale.invoiceNumber}</td>
                      <td className="p-3 font-bold text-gray-800">{sale.customer}</td>
                      <td className="p-3 font-black text-red-700">{sale.quantity.toLocaleString()}</td>
                      <td className="p-3 text-gray-600">{sale.unitPrice.toLocaleString()} ج.م</td>
                      <td className="p-3 font-black text-emerald-700">{sale.total.toLocaleString()} ج.م</td>
                      <td className="p-3">{sale.paymentType}</td>
                      <td className="p-3 text-gray-600">{sale.date ? new Date(sale.date).toLocaleString('ar-EG') : '-'}</td>
                    </tr>
                  ))}
                  {!getProductSales(salesModal.product).length && (
                    <tr><td colSpan="7" className="p-8 text-center text-gray-400">لا توجد مبيعات مسجلة لهذا المنتج.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => setSalesModal({ isOpen: false, product: null })} className="bg-gray-900 text-white px-5 py-2 rounded-xl text-xs font-bold">إغلاق</button>
            </div>
          </div>
        </div>
      )}

      {historyEditModal.isOpen && historyEditModal.item && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              editHistoryMutation.mutate();
            }}
            className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4"
          >
            <h2 className="text-lg font-black text-gray-800">تعديل كمية حركة المخزن</h2>
            <p className="text-xs text-gray-500">{historyEditModal.product?.product_name}</p>
            <input
              type="number"
              step="any"
              value={historyEditQuantity}
              onChange={(event) => setHistoryEditQuantity(event.target.value)}
              className="w-full border border-gray-200 p-3 rounded-xl text-sm text-black"
              required
            />
            <div className="flex gap-3">
              <button type="button" onClick={() => setHistoryEditModal({ isOpen: false, item: null, product: null })} className="flex-1 bg-gray-100 text-gray-700 p-3 rounded-xl text-sm font-bold">إلغاء</button>
              <button type="submit" disabled={editHistoryMutation.isPending} className="flex-1 bg-amber-600 text-white p-3 rounded-xl text-sm font-bold">حفظ التعديل</button>
            </div>
          </form>
        </div>
      )}

      {deleteConfirmModal.isOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4 text-center">
            <h2 className="text-lg font-black text-gray-800">{deleteConfirmModal.title}</h2>
            <p className="text-sm text-gray-600">{deleteConfirmModal.message}</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null })} className="flex-1 bg-gray-100 text-gray-700 p-3 rounded-xl text-sm font-bold">إلغاء</button>
              <button
                type="button"
                onClick={() => {
                  const confirmAction = deleteConfirmModal.onConfirm;
                  setDeleteConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null });
                  confirmAction?.();
                }}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white p-3 rounded-xl text-sm font-bold"
              >
                حذف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}