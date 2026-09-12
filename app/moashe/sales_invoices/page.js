'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';
const currentUserName = localStorage.getItem('userName') || 'مسؤول النظام';

export default function SalesInvoicesPage() {
  const queryClient = useQueryClient();
  
  const [customerType, setCustomerType] = useState('walk-in');
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedSalesAgent, setSelectedSalesAgent] = useState('');
  const [walkInName, setWalkInName] = useState('عميل فوري');
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [discountAmount, setDiscountAmount] = useState('');
  
  // إضافة حالة نوع الدفع (كاش / آجل)
  const [paymentType, setPaymentType] = useState('cash'); // 'cash' or 'credit'

  const [searchTerm, setSearchTerm] = useState('');
  
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // فلاتر سجل الحركات (للحذف والتعديل فقط)
  const [logSearchTerm, setLogSearchTerm] = useState('');
  const [logStartDate, setLogStartDate] = useState('');
  const [logEndDate, setLogEndDate] = useState('');

  const [editingInvoiceId, setEditingInvoiceId] = useState(null);
  const [oldInvoiceItems, setOldInvoiceItems] = useState([]);
  const [oldInvoiceData, setOldInvoiceData] = useState(null);

  const [viewInvoiceModal, setViewInvoiceModal] = useState({ show: false, invoice: null });
  const [viewLogModal, setViewLogModal] = useState({ show: false, log: null });
  const [returnModal, setReturnModal] = useState({ show: false, invoice: null, items: [] });

  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [confirmModal, setConfirmModal] = useState({ show: false, title: '', message: '', onConfirm: null });

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 4500);
  };

  const normalizeCustomerName = (value = '') =>
    String(value)
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const { data: materials = [] } = useQuery({
    queryKey: ['khamat_moashe'],
    queryFn: async () => {
      return await pb.collection('khamat_moashe').getFullList().catch(() => []);
    },
  });

  const { data: productsStock = [] } = useQuery({
    queryKey: ['products_stock'],
    queryFn: async () => {
      return await pb.collection('products_stock').getFullList().catch(() => []);
    },
  });

  const { data: allRecipes = [] } = useQuery({
    queryKey: ['products_recipes'],
    queryFn: async () => {
      return await pb.collection('products_recipes').getFullList({ sort: '-created' }).catch(() => []);
    },
  });

  const { data: clientsList = [] } = useQuery({
    queryKey: ['clientsList'],
    queryFn: async () => {
      return await pb.collection('clientsmoashe').getFullList().catch(() => []);
    },
  });

  const { data: salesAgents = [] } = useQuery({
    queryKey: ['sales_agents'],
    queryFn: async () => {
      return await pb.collection('sales_agents').getFullList({ sort: '-created' }).catch(() => []);
    },
  });

  const customers = clientsList;

  const { data: salesInvoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ['sales_invoices'],
    queryFn: async () => {
      return await pb.collection('sales_invoices').getFullList({ sort: '-created' }).catch(() => []);
    },
  });

  const { data: invoiceLogs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ['invoices_logs'],
    queryFn: async () => {
      return await pb.collection('invoices_logs').getFullList({ sort: '-created' }).catch(() => []);
    },
  });

  const uniqueProductsMap = {};
  allRecipes.forEach(item => {
    const name = item.product_name || item.name;
    if (name && !uniqueProductsMap[name]) {
      uniqueProductsMap[name] = Number(item.selling_price || item.sellingPrice || item.price || 0);
    }
  });
  const uniqueProductsList = Object.keys(uniqueProductsMap);

  const uniqueMaterialsMap = materials.reduce((result, material) => {
    const name = material.name || material.material_name || material.title;
    if (name && !result[name]) {
      result[name] = {
        id: material.id,
        price: Number(material.selling_price || material.sellingPrice || material.price || 0),
        stock: Number(material.stock ?? material.quantity ?? 0),
      };
    }
    return result;
  }, {});
  const uniqueMaterialsList = Object.keys(uniqueMaterialsMap);

  const getNextInvoiceNumber = () => {
    const existingNumbers = [
      ...salesInvoices.map((invoice) => invoice.invoice_number),
    ]
      .map((value) => String(value || '').trim())
      .filter((value) => /^\d+$/.test(value))
      .map(Number);

    return String(Math.max(0, ...existingNumbers) + 1);
  };

  function handleAddProduct(productName) {
    if (!productName) return;
    const price = uniqueProductsMap[productName] || 0;
    
    const existing = selectedProducts.find(p => p.name === productName);
    if (existing) {
      setSelectedProducts(selectedProducts.map(p => 
        p.name === productName ? { ...p, qty: p.qty + 1 } : p
      ));
    } else {
      setSelectedProducts([
        ...selectedProducts,
        { name: productName, price, qty: 1, itemKey: `product:${productName}` }
      ]);
    }
  }

  function handleAddMaterial(materialName) {
    if (!materialName) return;
    const material = uniqueMaterialsMap[materialName];
    const itemKey = `material:${material.id}`;
    const existing = selectedProducts.find((item) => item.itemKey === itemKey);

    if (existing) {
      setSelectedProducts(selectedProducts.map((item) => (
        item.itemKey === itemKey ? { ...item, qty: item.qty + 1 } : item
      )));
      return;
    }

    setSelectedProducts([
      ...selectedProducts,
      {
        name: materialName,
        price: material.price,
        qty: 1,
        itemType: 'material',
        materialId: material.id,
        itemKey,
      },
    ]);
  }

 function handleQtyChange(productName, qty) {
  const val = parseFloat(qty);
  setSelectedProducts(selectedProducts.map(p => 
    (p.itemKey || p.name) === productName ? { ...p, qty: isNaN(val) || val < 0 ? 0 : val } : p
  ));
}

  function handleRemoveProduct(productName) {
    setSelectedProducts(selectedProducts.filter((p) => (p.itemKey || p.name) !== productName));
  }

  const updateMaterialStock = async (materialId, quantityChange) => {
    const material = materials.find((item) => item.id === materialId);
    if (!material) return;
    const currentStock = Number(material.stock ?? material.quantity ?? 0);
    await pb.collection('khamat_moashe').update(materialId, {
      stock: currentStock + quantityChange,
    });
  };

  const subTotal = selectedProducts.reduce((sum, p) => sum + (p.price * p.qty), 0);
  const discount = Number(discountAmount) || 0;
  const netTotal = Math.max(0, subTotal - discount);

  const saveInvoiceMutation = useMutation({
    mutationFn: async () => {
      if (editingInvoiceId && oldInvoiceItems.length > 0) {
        for (const oldProd of oldInvoiceItems) {
          if (oldProd.itemType === 'material' && oldProd.materialId) {
            await updateMaterialStock(oldProd.materialId, Number(oldProd.qty || 0));
            continue;
          }
          const matchedStockProd = productsStock.find(p => (p.product_name || p.name) === oldProd.name);
          if (matchedStockProd) {
            const currentStock = Number(matchedStockProd.stock || 0);
            await pb.collection('products_stock').update(matchedStockProd.id, {
              stock: currentStock + Number(oldProd.qty || 0)
            });
          }
        }

        for (const oldProd of oldInvoiceItems) {
          const prodRecipe = allRecipes.filter(r => (r.product_name || r.name) === oldProd.name);
          for (const item of prodRecipe) {
            const matId = item.raw_material_id || item.material_id;
            const matInfo = materials.find(m => m.id === matId);
            if (matInfo) {
              const qtyPerUnit = Number(item.quantity_needed || item.quantity || 0);
              const totalToRestore = qtyPerUnit * Number(oldProd.qty || 0);
              const currentStock = Number(matInfo.stock || matInfo.quantity || 0);
              
              await pb.collection('khamat_moashe').update(matId, {
                stock: currentStock + totalToRestore
              });
            }
          }
        }

        if (oldInvoiceData?.payment_type === 'credit' && oldInvoiceData?.customer_type === 'registered') {
          const oldCustId = customers.find(c => c.name === oldInvoiceData.customer_name)?.id;
          if (oldCustId) {
            const custRecord = await pb.collection('clientsmoashe').getOne(oldCustId);
            const currentDebt = Number(custRecord.balance || custRecord.debt || custRecord.total_debt || 0);
            const oldAmount = Number(oldInvoiceData.total_amount || 0);
            await pb.collection('clientsmoashe').update(oldCustId, {
              balance: Math.max(0, currentDebt - oldAmount)
            }).catch(() => {});
          }
        }
      }

      for (const prod of selectedProducts) {
        if (prod.itemType === 'material' && prod.materialId) {
          await updateMaterialStock(prod.materialId, -Number(prod.qty || 0));
          continue;
        }
        const matchedStockProd = productsStock.find(p => (p.product_name || p.name) === prod.name);
        if (matchedStockProd) {
          const currentStock = Number(matchedStockProd.stock || 0);
          await pb.collection('products_stock').update(matchedStockProd.id, {
            stock: currentStock - Number(prod.qty || 0)
          });
        }
      }

      const customerName = customerType === 'walk-in' 
        ? (walkInName.trim() || 'عميل فوري') 
        : (customers.find(c => c.id === selectedCustomer)?.name || 'عميل مسجل');

      let matchedCustomerById = null;
      if (customerType === 'registered' && selectedCustomer) {
        matchedCustomerById = clientsList.find(c => c.id === selectedCustomer) || await pb.collection('clientsmoashe').getOne(selectedCustomer).catch(() => null);
      }

      const currentCustomer = matchedCustomerById || clientsList.find(c => {
        if (!c?.name || !customerName) return false;
        return normalizeCustomerName(c.name) === normalizeCustomerName(customerName);
      });

      const previousBalance = currentCustomer
        ? Number(currentCustomer.balance ?? currentCustomer.debt ?? currentCustomer.total_debt ?? 0)
        : 0;

      const selectedAgent = salesAgents.find((agent) => agent.id === selectedSalesAgent);

      const invoiceData = {
        customer_name: customerName,
        customer_type: customerType,
        sales_agent_id: selectedSalesAgent || '',
        sales_agent_name: selectedAgent?.name || '',
        sales_agent_region: selectedAgent?.region || '',
        items: selectedProducts,
        sub_total: subTotal,
        discount: Number(discountAmount) || 0,
        total_amount: netTotal,
        payment_type: paymentType,
        actor_name: currentUserName,
        status: 'مكتملة',
        previous_balance: previousBalance
      };

      let savedInvoice;
      if (editingInvoiceId) {
        savedInvoice = await pb.collection('sales_invoices').update(editingInvoiceId, invoiceData);
        
        const invDiscountOld = oldInvoiceData?.discount !== undefined ? oldInvoiceData.discount : (oldInvoiceData?.discount_amount || 0);

        await pb.collection('invoices_logs').create({
          action_type: 'تعديل',
          actor_name: currentUserName,
          invoice_number: savedInvoice.invoice_number || editingInvoiceId.slice(-6),
          details: JSON.stringify({
            customer_name: customerName,
            customer_type: customerType,
            payment_type: paymentType,
            old_data: {
              customer_name: oldInvoiceData?.customer_name || 'غير متوفر',
              payment_type: oldInvoiceData?.payment_type || 'cash',
              items: oldInvoiceItems,
              sub_total: oldInvoiceData?.sub_total || 0,
              discount: invDiscountOld,
              total_amount: oldInvoiceData?.total_amount || 0
            },
            new_data: {
              customer_name: customerName,
              payment_type: paymentType,
              items: selectedProducts,
              sub_total: subTotal,
              discount: discount,
              total_amount: netTotal
            },
            message: `تم تعديل الفاتورة للعميل: ${customerName} (${paymentType === 'credit' ? 'آجل' : 'كاش'}) | الإجمالي السابق: ${oldInvoiceData?.total_amount || 0} ج.م ➔ الإجمالي الجديد: ${netTotal} ج.م`
          })
        }).catch(() => {});

      } else {
        invoiceData.invoice_number = getNextInvoiceNumber();
        savedInvoice = await pb.collection('sales_invoices').create(invoiceData);
      }

      if (paymentType === 'credit' && customerType === 'registered' && selectedCustomer) {
        const custRecord = customers.find(c => c.id === selectedCustomer);
        if (custRecord) {
          const currentDebt = Number(custRecord.balance || custRecord.debt || custRecord.total_debt || 0);
          await pb.collection('clientsmoashe').update(selectedCustomer, {
            balance: currentDebt + netTotal
          }).catch(async () => {
            await pb.collection('clientsmoashe').update(selectedCustomer, {
              debt: currentDebt + netTotal
            }).catch(() => {});
          });
        }
      }

      if (!editingInvoiceId && paymentType === 'cash') {
        const treasuryRecords = await pb.collection('treasury').getFullList().catch(() => []);
        const treasury = treasuryRecords[0];
        const newBalance = Number(treasury?.balance || 0) + netTotal;
        if (treasury) {
          await pb.collection('treasury').update(treasury.id, { balance: newBalance });
        } else {
          await pb.collection('treasury').create({ balance: newBalance, opening_balance: 0 });
        }
        await pb.collection('treasury_transactions').create({
          type: 'sale',
          amount: netTotal,
          title: `فاتورة بيع: ${customerName}`,
          notes: `تحصيل نقدي من العميل: ${customerName}`,
          actor_name: currentUserName,
          date: new Date().toISOString(),
        });
      }

      return savedInvoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales_invoices'] });
      queryClient.invalidateQueries({ queryKey: ['khamat_moashe'] });
      queryClient.invalidateQueries({ queryKey: ['products_stock'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['clientsList'] });
      queryClient.invalidateQueries({ queryKey: ['clientsmoashe'] });
      queryClient.invalidateQueries({ queryKey: ['treasury'] });
      queryClient.invalidateQueries({ queryKey: ['invoices_logs'] });
      showToast(editingInvoiceId ? '✨ تم تعديل الفاتورة وتحديث المخازن وسجل التعديلات بنجاح!' : `🚀 تم إصدار الفاتورة (${paymentType === 'credit' ? 'آجل وتسجيلها على العميل' : 'كاش'}) بنجاح!`);
      resetForm();
    },
    onError: (error) => {
      console.error("خطأ أثناء الحفظ:", error);
      showToast('❌ حدث خطأ: ' + (error.message || JSON.stringify(error)), 'error');
    }
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: async (invoice) => {
      const itemsList = Array.isArray(invoice.items) ? invoice.items : [];
      
      for (const prod of itemsList) {
        if (prod.itemType === 'material' && prod.materialId) {
          await updateMaterialStock(prod.materialId, Number(prod.qty || 0));
          continue;
        }
        const matchedStockProd = productsStock.find(p => (p.product_name || p.name) === prod.name);
        if (matchedStockProd) {
          const currentStock = Number(matchedStockProd.stock || 0);
          await pb.collection('products_stock').update(matchedStockProd.id, {
            stock: currentStock + Number(prod.qty || 0)
          });
        }
      }

      for (const prod of itemsList) {
        if (prod.itemType === 'material') continue;
        const prodRecipe = allRecipes.filter(r => (r.product_name || r.name) === prod.name);
        for (const item of prodRecipe) {
          const matId = item.raw_material_id || item.material_id;
          const matInfo = materials.find(m => m.id === matId);
          if (matInfo) {
            const qtyPerUnit = Number(item.quantity_needed || item.quantity || 0);
            const totalToRestore = qtyPerUnit * Number(prod.qty || 0);
            const currentStock = Number(matInfo.stock || matInfo.quantity || 0);
            
            await pb.collection('khamat_moashe').update(matId, {
              stock: currentStock + totalToRestore
            });
          }
        }
      }

      if (invoice.payment_type === 'credit' && invoice.customer_type === 'registered') {
        const matchedCust = customers.find(c => c.name === invoice.customer_name);
        if (matchedCust) {
          const currentDebt = Number(matchedCust.balance || matchedCust.debt || matchedCust.total_debt || 0);
          const invAmount = Number(invoice.total_amount || 0);
          await pb.collection('clientsmoashe').update(matchedCust.id, {
            balance: Math.max(0, currentDebt - invAmount)
          }).catch(() => {});
        }
      }

      const deletedRes = await pb.collection('sales_invoices').delete(invoice.id);

      const invDiscount = invoice.discount !== undefined ? invoice.discount : (invoice.discount_amount || 0);

      await pb.collection('invoices_logs').create({
        action_type: 'حذف',
        actor_name: currentUserName,
        invoice_number: invoice.invoice_number || invoice.id.slice(-6),
        details: JSON.stringify({
          customer_name: invoice.customer_name,
          customer_type: invoice.customer_type,
          payment_type: invoice.payment_type || 'cash',
          items: invoice.items || [],
          sub_total: invoice.sub_total || 0,
          discount: invDiscount,
          total_amount: invoice.total_amount || 0,
          message: `تم حذف الفاتورة الخاصة بالعميل: ${invoice.customer_name} بقيمة: ${invoice.total_amount} ج.م وتم استرجاع المنتجات والخامات وتعديل المديونية.`
        })
      }).catch(() => {});

      return deletedRes;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales_invoices'] });
      queryClient.invalidateQueries({ queryKey: ['khamat_moashe'] });
      queryClient.invalidateQueries({ queryKey: ['products_stock'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['invoices_logs'] });
      showToast('🗑️ تم حذف الفاتورة واسترجاع المخزون وتحديث حساب العميل وتسجيل حركة الحذف بنجاح.');
    },
    onError: (error) => {
      showToast('❌ فشل الحذف: ' + error.message, 'error');
    }
  });

  const getReturnItemKey = (item) => item.itemType === 'material'
    ? `material:${item.materialId}`
    : `product:${item.name}`;

  const getReturnedQuantities = (invoice) => {
    const invoiceNumber = invoice.invoice_number || invoice.id.slice(-6);
    return invoiceLogs
      .filter((log) => log.action_type === 'مرتجع' && log.invoice_number === invoiceNumber)
      .reduce((quantities, log) => {
        try {
          const details = JSON.parse(log.details || '{}');
          (details.items || []).forEach((item) => {
            const key = getReturnItemKey(item);
            quantities[key] = (quantities[key] || 0) + Number(item.qty || 0);
          });
        } catch {
          return quantities;
        }
        return quantities;
      }, {});
  };

  const isInvoiceFullyReturned = (invoice) => {
    if (invoice.status === 'مرتجع') return true;
    const items = Array.isArray(invoice.items) ? invoice.items : [];
    const returnedQuantities = getReturnedQuantities(invoice);
    return items.length > 0 && items.every((item) => (
      Number(returnedQuantities[getReturnItemKey(item)] || 0) >= Number(item.qty || 0) - 0.000000001
    ));
  };

  const returnInvoiceMutation = useMutation({
    mutationFn: async ({ invoice, returnItems }) => {
      const invoiceNumber = invoice.invoice_number || invoice.id.slice(-6);
      const originalItems = Array.isArray(invoice.items) ? invoice.items : [];
      const returnedQuantities = getReturnedQuantities(invoice);
      const itemsList = returnItems
        .map((item) => {
          const originalItem = originalItems.find((sourceItem) => getReturnItemKey(sourceItem) === item.key);
          return originalItem ? { ...originalItem, qty: Number(item.qty || 0) } : null;
        })
        .filter((item) => item && item.qty > 0);
      if (!itemsList.length) throw new Error('اكتب كمية مرتجع لصنف واحد على الأقل.');

      for (const item of itemsList) {
        const alreadyReturnedQty = returnedQuantities[getReturnItemKey(item)] || 0;
        const originalItem = originalItems.find((sourceItem) => getReturnItemKey(sourceItem) === getReturnItemKey(item));
        const remainingQty = Number(originalItem?.qty || 0) - alreadyReturnedQty;
        if (item.qty > remainingQty + 0.000000001) {
          throw new Error(`كمية المرتجع للصنف "${item.name}" أكبر من الكمية المتبقية.`);
        }
        if (item.itemType === 'material' && item.materialId) {
          await updateMaterialStock(item.materialId, item.qty);
          continue;
        }

        const matchedStockProduct = productsStock.find((product) => (
          (product.product_name || product.name) === item.name
        ));
        if (matchedStockProduct) {
          await pb.collection('products_stock').update(matchedStockProduct.id, {
            stock: Number(matchedStockProduct.stock || 0) + item.qty,
          });
        }
      }

      const originalSubtotal = Number(invoice.sub_total || 0) || originalItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
      const returnedSubtotal = itemsList.reduce((sum, item) => sum + Number(item.price || 0) * item.qty, 0);
      const discountRatio = originalSubtotal > 0 ? Number(invoice.total_amount || 0) / originalSubtotal : 1;
      const invoiceAmount = Number((returnedSubtotal * discountRatio).toFixed(6));
      if (invoice.payment_type === 'credit' && invoice.customer_type === 'registered') {
        const customer = customers.find((item) => normalizeCustomerName(item.name) === normalizeCustomerName(invoice.customer_name));
        if (customer) {
          const currentDebt = Number(customer.balance ?? customer.debt ?? customer.total_debt ?? 0);
          await pb.collection('clientsmoashe').update(customer.id, {
            balance: Math.max(0, currentDebt - invoiceAmount),
          });
        }
      }

      if (invoice.payment_type !== 'credit') {
        const treasuryRecords = await pb.collection('treasury').getFullList().catch(() => []);
        const treasury = treasuryRecords[0];
        if (treasury) {
          await pb.collection('treasury').update(treasury.id, {
            balance: Number(treasury.balance || 0) - invoiceAmount,
          });
        }
        await pb.collection('treasury_transactions').create({
          type: 'sale',
          movement_type: 'sales_return',
          amount: -invoiceAmount,
          title: `مرتجع فاتورة: ${invoiceNumber}`,
          notes: `رد قيمة فاتورة العميل: ${invoice.customer_name || 'عميل'}`,
          actor_name: currentUserName,
          date: new Date().toISOString(),
        });
      }

      const allReturned = originalItems.every((item) => {
        const returnedQty = (returnedQuantities[getReturnItemKey(item)] || 0)
          + (itemsList.find((returnedItem) => getReturnItemKey(returnedItem) === getReturnItemKey(item))?.qty || 0);
        return returnedQty >= Number(item.qty || 0) - 0.000000001;
      });
      const updatedInvoice = await pb.collection('sales_invoices').update(invoice.id, {
        status: allReturned ? 'مرتجع' : 'مرتجع جزئي',
      });

      await pb.collection('invoices_logs').create({
        action_type: 'مرتجع',
        actor_name: currentUserName,
        invoice_number: invoiceNumber,
        details: JSON.stringify({
          customer_name: invoice.customer_name,
          payment_type: invoice.payment_type || 'cash',
          items: itemsList,
          total_amount: invoiceAmount,
          message: `${allReturned ? 'تم عمل مرتجع كامل' : 'تم عمل مرتجع جزئي'} للفاتورة بقيمة ${invoiceAmount} ج.م وإرجاع الأصناف وتحديث الحسابات.`,
        }),
      });

      return updatedInvoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales_invoices'] });
      queryClient.invalidateQueries({ queryKey: ['products_stock'] });
      queryClient.invalidateQueries({ queryKey: ['khamat_moashe'] });
      queryClient.invalidateQueries({ queryKey: ['clientsList'] });
      queryClient.invalidateQueries({ queryKey: ['clientsmoashe'] });
      queryClient.invalidateQueries({ queryKey: ['treasury'] });
      queryClient.invalidateQueries({ queryKey: ['invoices_logs'] });
      showToast('✅ تم عمل المرتجع وإرجاع الأصناف وتحديث الحسابات بنجاح.');
    },
    onError: (error) => showToast('❌ فشل عمل المرتجع: ' + error.message, 'error'),
  });

  function handleEditClick(invoice) {
    setEditingInvoiceId(invoice.id);
    setOldInvoiceItems(invoice.items || []);
    setOldInvoiceData(invoice);
    setCustomerType(invoice.customer_type || 'walk-in');
    setPaymentType(invoice.payment_type || 'cash');
    const matchedAgent = salesAgents.find((agent) => agent.id === invoice.sales_agent_id || agent.name === invoice.sales_agent_name);
    setSelectedSalesAgent(matchedAgent ? matchedAgent.id : invoice.sales_agent_id || '');
    if (invoice.customer_type === 'registered') {
      const matchedCustomer = customers.find(c => c.name === invoice.customer_name);
      setSelectedCustomer(matchedCustomer ? matchedCustomer.id : '');
      setWalkInName('عميل فوري');
    } else {
      setWalkInName(invoice.customer_name || 'عميل فوري');
      setSelectedCustomer('');
    }
    setSelectedProducts(invoice.items || []);
    const invDiscount = invoice.discount !== undefined ? invoice.discount : (invoice.discount_amount || 0);
    setDiscountAmount(invDiscount ? invDiscount.toString() : '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    setEditingInvoiceId(null);
    setOldInvoiceItems([]);
    setOldInvoiceData(null);
    setSelectedProducts([]);
    setCustomerType('walk-in');
    setWalkInName('عميل فوري');
    setSelectedCustomer('');
    setSelectedSalesAgent('');
    setDiscountAmount('');
    setPaymentType('cash');
  }

  function handleReturnClick(invoice) {
    const returnedQuantities = getReturnedQuantities(invoice);
    const items = (invoice.items || []).map((item) => {
      const remaining = Math.max(0, Number(item.qty || 0) - Number(returnedQuantities[getReturnItemKey(item)] || 0));
      return { key: getReturnItemKey(item), name: item.name, itemType: item.itemType, qty: '', remaining };
    }).filter((item) => item.remaining > 0);

    if (!items.length) {
      showToast('تم عمل مرتجع لكل أصناف هذه الفاتورة بالفعل.', 'error');
      return;
    }
    setReturnModal({ show: true, invoice, items });
  }

  function handleSaveInvoice(e) {
    e.preventDefault();
    if (selectedProducts.length === 0) {
      showToast('⚠️ الرجاء إضافة منتج واحد على الأقل!', 'error');
      return;
    }
    if (customerType === 'registered' && !selectedCustomer) {
      showToast('⚠️ الرجاء اختيار العميل من القائمة!', 'error');
      return;
    }
    if (!selectedSalesAgent) {
      showToast('⚠️ الرجاء اختيار المندوب المسؤول عن البيع!', 'error');
      return;
    }
    if (paymentType === 'credit' && customerType === 'walk-in') {
      showToast('⚠️ البيع الآجل مخصص للعملاء المسجلين فقط لضمان تسجيل المديونية!', 'error');
      return;
    }

    for (const prod of selectedProducts) {
      if (prod.itemType === 'material') {
        const material = materials.find((item) => item.id === prod.materialId);
        const availableStock = Number(material?.stock ?? material?.quantity ?? 0);
        let adjustedStock = availableStock;

        if (editingInvoiceId && oldInvoiceItems.length > 0) {
          const oldMaterial = oldInvoiceItems.find((item) => item.itemType === 'material' && item.materialId === prod.materialId);
          adjustedStock += Number(oldMaterial?.qty || 0);
        }

        if (!material || adjustedStock < Number(prod.qty || 0)) {
          showToast(`⚠️ الخامة "${prod.name}" غير متوفرة بالكمية المطلوبة! (المتوفر: ${adjustedStock}، المطلوب: ${prod.qty})`, 'error');
          return;
        }
        continue;
      }
      const matchedStockProd = productsStock.find(p => (p.product_name || p.name) === prod.name);
      
      if (matchedStockProd) {
        let availableProdStock = Number(matchedStockProd.stock || 0);

        if (editingInvoiceId && oldInvoiceItems.length > 0) {
          const oldProdItem = oldInvoiceItems.find(op => op.name === prod.name);
          if (oldProdItem) {
            availableProdStock += Number(oldProdItem.qty || 0);
          }
        }

        if (availableProdStock < Number(prod.qty)) {
          showToast(`⚠️ المنتج "${prod.name}" غير متوفر بالكمية المطلوبة في المخزن! (المتوفر: ${availableProdStock}، المطلوب: ${prod.qty})`, 'error');
          return;
        }
      }
    }

    for (const prod of selectedProducts) {
      if (prod.itemType === 'material') continue;
      const prodRecipe = allRecipes.filter(r => (r.product_name || r.name) === prod.name);
      if (prodRecipe.length === 0) {
        showToast(`⚠️ المنتج "${prod.name}" ليس له تركيبة/وصفة مسجلة، لا يمكن إتمام البيع!`, 'error');
        return;
      }
    }

    const title = editingInvoiceId ? 'تأكيد تعديل الفاتورة' : 'تأكيد إصدار الفاتورة';
    const message = editingInvoiceId 
      ? `هل تريد حفظ التعديلات على الفاتورة (${paymentType === 'credit' ? 'آجل' : 'كاش'}) بالقيمة (${netTotal.toLocaleString()} ج.م) وتحديث المخازن وحساب العميل؟`
      : `هل أنت متأكد من حفظ الفاتورة (${paymentType === 'credit' ? 'آجل وتسجيل مديونية على العميل' : 'كاش'}) بقيمة صافية (${netTotal.toLocaleString()} ج.م)؟`;

    setConfirmModal({
      show: true,
      title,
      message,
      onConfirm: () => {
        setConfirmModal({ show: false });
        saveInvoiceMutation.mutate();
      }
    });
  }

  const filteredInvoices = salesInvoices.filter(inv => {
    const matchesName = inv.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        inv.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (!matchesName) return false;

    if (startDate || endDate) {
      const invDate = new Date(inv.created).toISOString().split('T')[0];
      if (startDate && invDate < startDate) return false;
      if (endDate && invDate > endDate) return false;
    }

    return true;
  });

  const filteredLogs = invoiceLogs.filter(log => {
    const matchesLog = log.invoice_number?.toLowerCase().includes(logSearchTerm.toLowerCase()) ||
                       log.action_type?.toLowerCase().includes(logSearchTerm.toLowerCase()) ||
                       log.details?.toLowerCase().includes(logSearchTerm.toLowerCase());

    if (!matchesLog) return false;

    if (logStartDate || logEndDate) {
      const logDate = new Date(log.created).toISOString().split('T')[0];
      if (logStartDate && logDate < logStartDate) return false;
      if (logEndDate && logDate > logEndDate) return false;
    }

    return true;
  });

  const totalSalesAmount = filteredInvoices.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
  const totalDiscountsAmount = filteredInvoices.reduce((sum, inv) => {
    const invDiscount = inv.discount !== undefined ? inv.discount : (inv.discount_amount || 0);
    return sum + Number(invDiscount || 0);
  }, 0);

  const parseLogDetails = (detailsStr) => {
    try {
      const parsed = JSON.parse(detailsStr);
      return parsed;
    } catch {
      return { message: detailsStr, items: [] };
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 relative" dir="rtl">
      
      {toast.show && (
        <div className={`fixed top-5 left-5 z-50 px-5 py-3 rounded-2xl shadow-2xl text-white font-bold text-sm flex items-center gap-3 transition-all animate-bounce ${
          toast.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
        }`}>
          <span>{toast.message}</span>
        </div>
      )}

      {confirmModal.show && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4 text-center">
            <h3 className="text-lg font-black text-gray-900">{confirmModal.title}</h3>
            <p className="text-xs text-gray-600 leading-relaxed">{confirmModal.message}</p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                onClick={confirmModal.onConfirm}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-2xl font-bold text-xs shadow-md transition"
              >
                تأكيد
              </button>
              <button
                onClick={() => setConfirmModal({ show: false })}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-2xl font-bold text-xs transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {returnModal.show && returnModal.invoice && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="text-lg font-black text-gray-900">↩️ مرتجع من الفاتورة</h3>
                <p className="text-xs text-gray-500 mt-1">اكتب الكمية المرتجعة لكل صنف، واترك الباقي فارغًا.</p>
              </div>
              <button type="button" onClick={() => setReturnModal({ show: false, invoice: null, items: [] })} className="text-gray-400 font-bold text-lg">✕</button>
            </div>
            <div className="border border-gray-200 rounded-2xl overflow-hidden">
              <table className="w-full text-right text-xs">
                <thead className="bg-gray-100 text-gray-600">
                  <tr><th className="p-3">الصنف</th><th className="p-3">المتاح للمرتجع</th><th className="p-3">كمية المرتجع</th></tr>
                </thead>
                <tbody className="divide-y">
                  {returnModal.items.map((item) => (
                    <tr key={item.key}>
                      <td className="p-3 font-bold">{item.itemType === 'material' ? 'خامة: ' : 'منتج: '}{item.name}</td>
                      <td className="p-3 text-gray-500">{item.remaining}</td>
                      <td className="p-3">
                        <input
                          type="number"
                          min="0"
                          max={item.remaining}
                          step="any"
                          value={item.qty}
                          onChange={(event) => setReturnModal((previous) => ({
                            ...previous,
                            items: previous.items.map((row) => row.key === item.key ? { ...row, qty: event.target.value } : row),
                          }))}
                          className="w-28 border border-gray-200 rounded-xl px-2 py-1.5 text-center font-bold"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setReturnModal({ show: false, invoice: null, items: [] })} className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-2xl text-xs font-bold">إلغاء</button>
              <button
                type="button"
                disabled={returnInvoiceMutation.isPending}
                onClick={() => {
                  returnInvoiceMutation.mutate({ invoice: returnModal.invoice, returnItems: returnModal.items });
                  setReturnModal({ show: false, invoice: null, items: [] });
                }}
                className="flex-1 bg-violet-600 hover:bg-violet-700 text-white py-3 rounded-2xl text-xs font-bold disabled:opacity-50"
              >
                {returnInvoiceMutation.isPending ? 'جارٍ تنفيذ المرتجع...' : 'حفظ المرتجع'}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewInvoiceModal.show && viewInvoiceModal.invoice && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-6 border border-gray-100 animate-in fade-in zoom-in max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-lg font-black text-gray-900">📄 تفاصيل الفاتورة: {viewInvoiceModal.invoice.invoice_number || viewInvoiceModal.invoice.id.slice(-6)}</h3>
              <button 
                onClick={() => setViewInvoiceModal({ show: false, invoice: null })}
                className="text-gray-400 hover:text-gray-700 font-bold text-base bg-gray-100 w-8 h-8 rounded-full flex items-center justify-center transition"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between bg-gray-50 p-3 rounded-2xl">
                <span className="text-gray-500">اسم العميل:</span>
                <span className="font-bold text-gray-800">{viewInvoiceModal.invoice.customer_name}</span>
              </div>
              <div className="flex justify-between bg-gray-50 p-3 rounded-2xl">
                <span className="text-gray-500">نوع العميل:</span>
                <span className="font-bold text-gray-800">{viewInvoiceModal.invoice.customer_type === 'walk-in' ? 'عميل فوري' : 'عميل مسجل'}</span>
              </div>
              {(() => {
                const modalCustomer = clientsList.find(c =>
                  c?.name && viewInvoiceModal.invoice?.customer_name && normalizeCustomerName(c.name) === normalizeCustomerName(viewInvoiceModal.invoice.customer_name)
                );
                const modalPreviousBalance = Number(
                  viewInvoiceModal.invoice.previous_balance ?? modalCustomer?.balance ?? modalCustomer?.debt ?? modalCustomer?.total_debt ?? 0
                );

                return modalPreviousBalance > 0 ? (
                  <div className="flex justify-between bg-red-50 p-3 rounded-2xl border border-red-200">
                    <span className="text-red-600 font-bold">💳 المديونية السابقة:</span>
                    <span className="font-bold text-red-700">{modalPreviousBalance.toLocaleString()} ج.م</span>
                  </div>
                ) : null;
              })()}
              <div className="flex justify-between bg-gray-50 p-3 rounded-2xl">
                <span className="text-gray-500">طريقة الدفع:</span>
                <span className={`font-bold px-2 py-0.5 rounded-lg text-white ${viewInvoiceModal.invoice.payment_type === 'credit' ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                  {viewInvoiceModal.invoice.payment_type === 'credit' ? '⏳ آجل (على الحساب)' : '💵 كاش'}
                </span>
              </div>
              <div className="flex justify-between bg-gray-50 p-3 rounded-2xl">
                <span className="text-gray-500">تاريخ الإصدار:</span>
                <span className="font-bold text-gray-800">{new Date(viewInvoiceModal.invoice.created).toLocaleString('ar-EG')}</span>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-black text-gray-700 mb-2">المنتجات المطلوبة:</h4>
              <div className="border border-gray-200 rounded-2xl overflow-hidden">
                <table className="w-full text-right text-xs">
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="p-2.5">المنتج</th>
                      <th className="p-2.5">السعر</th>
                      <th className="p-2.5">الكمية</th>
                      <th className="p-2.5">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {Array.isArray(viewInvoiceModal.invoice.items) && viewInvoiceModal.invoice.items.map((it, i) => (
                      <tr key={i}>
                        <td className="p-2.5 font-bold text-gray-800">{it.name}</td>
                        <td className="p-2.5 text-gray-600">{it.price} ج.م</td>
                        <td className="p-2.5 text-gray-600 font-bold">{it.qty}</td>
                        <td className="p-2.5 font-bold text-emerald-600">{(it.price * it.qty).toLocaleString()} ج.م</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-2xl space-y-2 text-xs border border-gray-200/60">
              <div className="flex justify-between text-gray-600">
                <span>إجمالي المنتجات:</span>
                <span className="font-bold">{(viewInvoiceModal.invoice.sub_total || 0).toLocaleString()} ج.م</span>
              </div>
              {Number(viewInvoiceModal.invoice.discount !== undefined ? viewInvoiceModal.invoice.discount : (viewInvoiceModal.invoice.discount_amount || 0)) > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>الخصم المطبق:</span>
                  <span className="font-bold">- {(viewInvoiceModal.invoice.discount !== undefined ? viewInvoiceModal.invoice.discount : (viewInvoiceModal.invoice.discount_amount || 0)).toLocaleString()} ج.م</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t text-emerald-800 font-black text-sm">
                <span>الصافي النهائي:</span>
                <span>{(viewInvoiceModal.invoice.total_amount || 0).toLocaleString()} ج.م</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition"
              >
                🖨️ طباعة الفاتورة
              </button>
              <button
                onClick={() => setViewInvoiceModal({ show: false, invoice: null })}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-xs rounded-xl transition"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {viewLogModal.show && viewLogModal.log && (() => {
        const detailsData = parseLogDetails(viewLogModal.log.details);
        const isEditAction = viewLogModal.log.action_type === 'تعديل';

        return (
          <div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl p-6 max-w-2xl w-full shadow-2xl space-y-6 border border-gray-100 animate-in fade-in zoom-in max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center border-b pb-3">
                <h3 className="text-lg font-black text-gray-900">
                  📋 تفاصيل السجل ({viewLogModal.log.action_type}) - فاتورة: {viewLogModal.log.invoice_number}
                </h3>
                <button 
                  onClick={() => setViewLogModal({ show: false, log: null })}
                  className="text-gray-400 hover:text-gray-700 font-bold text-base bg-gray-100 w-8 h-8 rounded-full flex items-center justify-center transition"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex justify-between bg-gray-50 p-3 rounded-2xl">
                  <span className="text-gray-500">نوع الحركة:</span>
                  <span className={`font-bold px-2.5 py-1 rounded-xl text-white ${
                    viewLogModal.log.action_type === 'حذف' ? 'bg-red-500' : 'bg-amber-500'
                  }`}>
                    {viewLogModal.log.action_type}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* قسم إنشاء أو تعديل الفاتورة */}
      <div className="bg-white p-6 rounded-3xl shadow-xl border border-gray-100 space-y-6">
        <div className="flex justify-between items-center border-b pb-4">
          <h2 className="text-xl font-black text-gray-800">
            {editingInvoiceId ? '✏️ تعديل فاتورة بيع' : '🧾 إصدار فاتورة بيع جديدة'}
          </h2>
          {editingInvoiceId && (
            <button
              onClick={resetForm}
              className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition"
            >
              إلغاء التعديل
            </button>
          )}
        </div>

        <form onSubmit={handleSaveInvoice} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-2">نوع العميل:</label>
              <select
                value={customerType}
                onChange={(e) => {
                  setCustomerType(e.target.value);
                  if (e.target.value === 'walk-in') {
                    setSelectedCustomer('');
                  } else {
                    setWalkInName('عميل فوري');
                  }
                }}
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="walk-in">عميل فوري</option>
                <option value="registered">عميل مسجل</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-2">المندوب:</label>
              <select
                value={selectedSalesAgent}
                onChange={(e) => setSelectedSalesAgent(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">-- اختر المندوب --</option>
                {salesAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </div>

            {customerType === 'walk-in' ? (
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-2">اسم العميل الفوري:</label>
                <input
                  type="text"
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  placeholder="عميل فوري"
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-2">اختر العميل المسجل:</label>
                <select
                  value={selectedCustomer}
                  onChange={(e) => setSelectedCustomer(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">-- اختر العميل --</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-2">طريقة الدفع:</label>
              <select
                value={paymentType}
                onChange={(e) => setPaymentType(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="cash">💵 كاش (نقدي)</option>
                <option value="credit">⏳ آجل (على الحساب)</option>
              </select>
            </div>
          </div>

          <div className="space-y-4">
            <label className="block text-xs font-bold text-gray-700">إضافة أصناف للفاتورة:</label>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* <select
                defaultValue=""
                onChange={(event) => {
                  handleAddProduct(event.target.value);
                  event.target.value = '';
                }}
                className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-800 outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="">-- اختر منتجًا --</option>
                {uniqueProductsList.map((prodName) => (
                  <option key={prodName} value={prodName}>{prodName} ({uniqueProductsMap[prodName]} ج.م)</option>
                ))}
              </select> */}
              <select
                defaultValue=""
                onChange={(event) => {
                  handleAddMaterial(event.target.value);
                  event.target.value = '';
                }}
                className="w-full rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-800 outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="">-- اختر خامة --</option>
                {uniqueMaterialsList.map((materialName) => {
                  const material = uniqueMaterialsMap[materialName];
                  return <option key={material.id} value={materialName}>{materialName} ({material.price} ج.م - متاح {material.stock})</option>;
                })}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              {uniqueProductsList.map((prodName, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleAddProduct(prodName)}
                  className="px-4 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-2xl text-xs font-bold transition shadow-sm"
                >
                  + {prodName} ({uniqueProductsMap[prodName]} ج.م)
                </button>
              ))}
            </div>
          </div>

          {selectedProducts.length > 0 && (
            <div className="border border-gray-200 rounded-2xl overflow-hidden">
              <table className="w-full text-right text-xs">
                <thead className="bg-gray-100 text-gray-600">
                  <tr>
                    <th className="p-3">المنتج</th>
                    <th className="p-3">السعر</th>
                    <th className="p-3">الكمية</th>
                    <th className="p-3">الإجمالي</th>
                    <th className="p-3 text-center">حذف</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selectedProducts.map((p, index) => {
                    const itemKey = p.itemKey || p.name;
                    return (
                    <tr key={itemKey || index}>
                      <td className="p-3 font-bold text-gray-800">{p.itemType === 'material' ? 'خامة: ' : 'منتج: '}{p.name}</td>
                      <td className="p-3 text-gray-600">{p.price} ج.م</td>
                      <td className="p-3">
                        <input
                          type="number"
                          step="any"
                          min="0.0001"
                          value={p.qty}
                          onChange={(e) => handleQtyChange(itemKey, e.target.value)}
                          className="w-20 bg-gray-50 border border-gray-200 rounded-xl px-2 py-1 text-xs font-bold text-center focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </td>
                      <td className="p-3 font-bold text-emerald-600">{(p.price * p.qty).toLocaleString()} ج.م</td>
                      <td className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveProduct(itemKey)}
                          className="text-red-500 hover:text-red-700 font-bold bg-red-50 w-7 h-7 rounded-xl flex items-center justify-center mx-auto transition"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-2">مبلغ الخصم (إن وجد):</label>
              <input
                type="number"
                min="0"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                placeholder="0"
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200/60 space-y-1 text-xs">
              <div className="flex justify-between text-gray-600">
                <span>الإجمالي الفرعي:</span>
                <span className="font-bold">{subTotal.toLocaleString()} ج.م</span>
              </div>
              <div className="flex justify-between text-red-600">
                <span>الخصم:</span>
                <span className="font-bold">- {discount.toLocaleString()} ج.م</span>
              </div>
              <div className="flex justify-between pt-2 border-t text-emerald-800 font-black text-sm">
                <span>الصافي النهائي:</span>
                <span>{netTotal.toLocaleString()} ج.م</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saveInvoiceMutation.isPending}
              className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-2xl shadow-lg transition flex items-center gap-2"
            >
              {saveInvoiceMutation.isPending ? 'جاري الحفظ...' : (editingInvoiceId ? '💾 حفظ تعديلات الفاتورة' : '🚀 إصدار وحفظ الفاتورة')}
            </button>
          </div>
        </form>
      </div>

      {/* قسم عرض سجل الفواتير */}
      <div className="bg-white p-6 rounded-3xl shadow-xl border border-gray-100 space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-b pb-4">
          <h2 className="text-xl font-black text-gray-800">📋 سجل فواتير المبيعات</h2>
          <div className="flex flex-wrap gap-3 w-full md:w-auto">
            <input
              type="text"
              placeholder="بحث برقم الفاتورة أو العميل..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100 flex justify-between items-center">
            <span className="text-emerald-700 font-bold text-xs">إجمالي المبيعات المحققة:</span>
            <span className="text-emerald-900 font-black text-base">{totalSalesAmount.toLocaleString()} ج.م</span>
          </div> */}
          <div className="bg-red-50 p-4 rounded-2xl border border-red-100 flex justify-between items-center">
            <span className="text-red-700 font-bold text-xs">إجمالي الخصومات الممنوحة:</span>
            <span className="text-red-900 font-black text-base">{totalDiscountsAmount.toLocaleString()} ج.م</span>
          </div>
        </div>

        {loadingInvoices ? (
          <p className="text-center text-xs text-gray-500 py-6">جاري تحميل الفواتير...</p>
        ) : filteredInvoices.length === 0 ? (
          <p className="text-center text-xs text-gray-500 py-6">لا توجد فواتير مطابقة للبحث.</p>
        ) : (
          <div className="border border-gray-200 rounded-2xl overflow-hidden">
            <table className="w-full text-right text-xs">
              <thead className="bg-gray-100 text-gray-600">
                <tr>
                  <th className="p-3">رقم الفاتورة</th>
                  <th className="p-3">اسم العميل</th>
                  <th className="p-3">المديونية السابقة</th>
                  <th className="p-3">الإجمالي الفرعي</th>
                  <th className="p-3">الخصم</th>
                  <th className="p-3">الصافي النهائي</th>
                  <th className="p-3">طريقة الدفع</th>
                  <th className="p-3">التاريخ</th>
                  <th className="p-3 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredInvoices.map((inv) => {
                  const isReturned = isInvoiceFullyReturned(inv);
                  const isPartiallyReturned = inv.status === 'مرتجع جزئي';
                  const isClosed = isReturned || isPartiallyReturned;
                  const invDiscount = Number(inv.discount !== undefined ? inv.discount : (inv.discount_amount || 0));
                  const invSubTotal = (inv.sub_total !== undefined && inv.sub_total !== null && inv.sub_total !== 0) 
                    ? inv.sub_total 
                    : (Array.isArray(inv.items) ? inv.items.reduce((s, item) => s + (Number(item.price || 0) * Number(item.qty || 0)), 0) : 0);

                  const customerMatch = clientsList.find(c =>
                    c?.name && inv?.customer_name && normalizeCustomerName(c.name) === normalizeCustomerName(inv.customer_name)
                  );
                  const previousBalance = Number(
                    inv.previous_balance ?? customerMatch?.balance ?? customerMatch?.debt ?? customerMatch?.total_debt ?? 0
                  );

                  return (
                    <tr key={inv.id} className="hover:bg-gray-50/50 transition">
                      <td className="p-3 font-bold text-gray-800">{inv.invoice_number || inv.id.slice(-6)}</td>
                      <td className="p-3 text-gray-700">{inv.customer_name}</td>
                      <td className="p-3 font-bold" style={{ color: previousBalance > 0 ? '#dc2626' : '#059669' }}>
                        {previousBalance > 0 ? '💳 ' + previousBalance.toLocaleString() + ' جنيه' : 'نظيف'}
                      </td>
                      <td className="p-3 text-gray-600">{invSubTotal.toLocaleString()} ج.م</td>
                      <td className="p-3 font-bold text-red-600">
                        {invDiscount > 0 ? `- ${invDiscount.toLocaleString()} ج.م` : '0 ج.م'}
                      </td>
                      <td className="p-3 font-bold text-emerald-600">{(inv.total_amount || 0).toLocaleString()} ج.م</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded-xl text-white text-[10px] ${isReturned || isPartiallyReturned ? 'bg-red-600' : inv.payment_type === 'credit' ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                          {isReturned ? 'مرتجع' : isPartiallyReturned ? 'مرتجع جزئي' : inv.payment_type === 'credit' ? 'آجل' : 'كاش'}
                        </span>
                      </td>
                      <td className="p-3 text-gray-500">{new Date(inv.created).toLocaleDateString('ar-EG')}</td>
                      <td className="p-3 text-center space-x-2 space-x-reverse">
                        <button
                          onClick={() => setViewInvoiceModal({ show: true, invoice: inv })}
                          className="px-2.5 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl font-bold transition"
                        >
                          عرض
                        </button>
                        <button
                          onClick={() => handleEditClick(inv)}
                          disabled={isClosed}
                          className="px-2.5 py-1 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-xl font-bold transition"
                        >
                          تعديل
                        </button>
                        <button
                          disabled={isClosed || returnInvoiceMutation.isPending}
                          onClick={() => handleReturnClick(inv)}
                          className="px-2.5 py-1 bg-violet-50 text-violet-600 hover:bg-violet-100 rounded-xl font-bold transition disabled:opacity-50"
                        >
                          مرتجع
                        </button>
                        <button
                          disabled={isClosed}
                          onClick={() => {
                            setConfirmModal({
                              show: true,
                              title: 'تأكيد الحذف',
                              message: `هل أنت متأكد من حذف فاتورة العميل (${inv.customer_name})؟`,
                              onConfirm: () => {
                                setConfirmModal({ show: false });
                                deleteInvoiceMutation.mutate(inv);
                              }
                            });
                          }}
                          className="px-2.5 py-1 bg-red-50 text-red-600 hover:bg-red-100 rounded-xl font-bold transition disabled:opacity-50"
                        >
                          حذف
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* قسم سجل التعديلات والحذف */}
      <div className="bg-white p-6 rounded-3xl shadow-xl border border-gray-100 space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-b pb-4">
          <h2 className="text-xl font-black text-gray-800">📜 سجل الحركات (التعديل والحذف)</h2>
          <div className="flex flex-wrap gap-3 w-full md:w-auto">
            <input
              type="text"
              placeholder="بحث في السجل..."
              value={logSearchTerm}
              onChange={(e) => setLogSearchTerm(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <input
              type="date"
              value={logStartDate}
              onChange={(e) => setLogStartDate(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <input
              type="date"
              value={logEndDate}
              onChange={(e) => setLogEndDate(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {loadingLogs ? (
          <p className="text-center text-xs text-gray-500 py-6">جاري تحميل السجلات...</p>
        ) : filteredLogs.length === 0 ? (
          <p className="text-center text-xs text-gray-500 py-6">لا توجد سجلات مطابقة.</p>
        ) : (
          <div className="border border-gray-200 rounded-2xl overflow-hidden">
            <table className="w-full text-right text-xs">
              <thead className="bg-gray-100 text-gray-600">
                <tr>
                  <th className="p-3">نوع الحركة</th>
                  <th className="p-3">رقم الفاتورة</th>
                  <th className="p-3">المستخدم</th>
                  <th className="p-3">التفاصيل</th>
                  <th className="p-3">التاريخ والوقت</th>
                  <th className="p-3 text-center">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredLogs.map((log) => {
                  const detailsData = parseLogDetails(log.details);
                  return (
                    <tr key={log.id} className="hover:bg-gray-50/50 transition">
                      <td className="p-3">
                        <span className={`px-2.5 py-1 rounded-xl text-white font-bold text-[10px] ${
                          log.action_type === 'حذف' ? 'bg-red-500' : 'bg-amber-500'
                        }`}>
                          {log.action_type}
                        </span>
                      </td>
                      <td className="p-3 font-bold text-gray-800">{log.invoice_number}</td>
                      <td className="p-3 text-gray-600">{log.actor_name}</td>
                      <td className="p-3 text-gray-700 max-w-xs truncate">{detailsData.message || log.details}</td>
                      <td className="p-3 text-gray-500">{new Date(log.created).toLocaleString('ar-EG')}</td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => setViewLogModal({ show: true, log })}
                          className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold transition"
                        >
                          عرض
                        </button>
                      </td>
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
}







