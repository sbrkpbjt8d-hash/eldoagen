import { pb } from './pocketbase';

export const PURCHASE_INVOICE_PENDING = 'معلقة للاعتماد';
export const PURCHASE_INVOICE_REJECTED = 'مرفوضة';
export const PURCHASE_INVOICE_APPROVED = 'مكتملة';

export function isPurchaseInvoiceApproved(invoice) {
  return invoice?.status !== PURCHASE_INVOICE_PENDING
    && invoice?.status !== PURCHASE_INVOICE_REJECTED;
}

export async function approvePurchaseInvoice(invoiceId) {
  const invoice = await pb.collection('purchase_invoices').getOne(invoiceId);
  if (invoice.status !== PURCHASE_INVOICE_PENDING) {
    throw new Error('الفاتورة لم تعد معلقة للاعتماد.');
  }

  const [materials, suppliers, allInvoices, supplierTransactions] = await Promise.all([
    pb.collection('khamat_moashe').getFullList(),
    pb.collection('suppliers').getFullList(),
    pb.collection('purchase_invoices').getFullList(),
    pb.collection('supplier_transactions').getFullList(),
  ]);
  const supplier = suppliers.find((record) => record.id === invoice.supplier_id);
  if (!supplier) throw new Error('المورد المرتبط بالفاتورة غير موجود.');

  const materialById = new Map(materials.map((material) => [material.id, material]));
  const invoiceItemsByMaterial = new Map();
  for (const item of invoice.items || []) {
    const materialId = String(item.materialId || item.material_id || '');
    const material = materialById.get(materialId);
    const quantity = Number(item.qty || item.quantity || 0);
    const price = Number(item.price || 0);
    if (!material) throw new Error(`الخامة ${item.name || materialId} غير موجودة.`);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0) {
      throw new Error(`بيانات الكمية أو السعر للخامة ${item.name || material.name} غير صحيحة.`);
    }

    const groupedItem = invoiceItemsByMaterial.get(materialId) || { quantity: 0, totalCost: 0 };
    groupedItem.quantity += quantity;
    groupedItem.totalCost += quantity * price;
    invoiceItemsByMaterial.set(materialId, groupedItem);
  }
  if (!invoiceItemsByMaterial.size) throw new Error('الفاتورة لا تحتوي على خامات صالحة.');

  const updatedMaterials = [];
  let updatedSupplier = false;
  const currentSupplierTransactions = supplierTransactions.filter(
    (transaction) => String(transaction.supplier_id || '') === String(supplier.id),
  );
  const approvedSupplierInvoices = allInvoices.filter(
    (record) => String(record.supplier_id || '') === String(supplier.id)
      && record.id !== invoice.id
      && isPurchaseInvoiceApproved(record),
  );
  const hasSupplierMovements = currentSupplierTransactions.length > 0 || approvedSupplierInvoices.length > 0;
  const currentSupplierBalance = hasSupplierMovements
    ? currentSupplierTransactions.reduce((balance, transaction) => {
      const amount = Number(transaction.amount || 0);
      return balance + (transaction.type === 'payment' ? -amount : amount);
    }, 0) + approvedSupplierInvoices.reduce((balance, record) => balance + Number(record.total_amount || 0), 0)
    : Number(supplier.balance || 0);

  try {
    for (const [materialId, item] of invoiceItemsByMaterial) {
      const material = materialById.get(materialId);
      const oldStock = Number(material.stock || 0);
      const newStock = oldStock + item.quantity;
      const averagePrice = oldStock > 0
        ? ((oldStock * Number(material.price || 0)) + item.totalCost) / newStock
        : item.totalCost / item.quantity;
      await pb.collection('khamat_moashe').update(materialId, { stock: newStock, price: averagePrice });
      updatedMaterials.push({ materialId, stock: material.stock, price: material.price });
    }

    if (invoice.payment_type === 'credit') {
      await pb.collection('suppliers').update(supplier.id, {
        balance: currentSupplierBalance + Number(invoice.total_amount || 0),
      });
      updatedSupplier = true;
    }

    await pb.collection('purchase_invoices').update(invoice.id, {
      status: PURCHASE_INVOICE_APPROVED,
    });
  } catch (error) {
    const rollbackErrors = [];
    if (updatedSupplier) {
      try {
        await pb.collection('suppliers').update(supplier.id, { balance: supplier.balance });
      } catch (rollbackError) {
        rollbackErrors.push(`رصيد المورد: ${rollbackError.message}`);
      }
    }
    for (const material of updatedMaterials.reverse()) {
      try {
        await pb.collection('khamat_moashe').update(material.materialId, {
          stock: material.stock,
          price: material.price,
        });
      } catch (rollbackError) {
        rollbackErrors.push(`الخامة ${material.materialId}: ${rollbackError.message}`);
      }
    }
    if (rollbackErrors.length) {
      throw new Error(`${error.message} وتعذر التراجع عن بعض التغييرات: ${rollbackErrors.join('، ')}`);
    }
    throw error;
  }

  return invoice;
}
