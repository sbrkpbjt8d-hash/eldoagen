import { pb } from './pocketbase';

export const ARCHIVABLE_COLLECTIONS = new Set([
  'advances',
  'banks',
  'client_transactions',
  'clientsmoashe',
  'expense_categories',
  'expenses',
  'khamat_moashe',
  'material_adjustments',
  'product_stock_transactions',
  'products_recipes',
  'products_stock',
  'production_orders',
  'purchase_invoices',
  'sales_invoices',
  'spend_authorizations',
  'supplier_transactions',
  'suppliers',
  'treasury_transactions',
]);

export function isFactoryAdmin(user = pb.authStore.model) {
  return user?.collectionName === '_superusers'
    || user?.role === 'admin'
    || user?.email === 'mohamedfrf@icloud.com';
}

const SYSTEM_FIELDS = new Set([
  'collectionId',
  'collectionName',
  'created',
  'expand',
  'updated',
]);

export function getDeletedRecordLabel(recordData) {
  return recordData.name
    || recordData.product_name
    || recordData.invoice_number
    || recordData.title
    || recordData.notes
    || recordData.id
    || 'سجل بدون اسم';
}

export async function archiveAndDeleteRecord(collectionName, recordId, displayName) {
  if (!ARCHIVABLE_COLLECTIONS.has(collectionName)) {
    throw new Error(`أرشفة الحذف غير مفعلة للمجموعة ${collectionName}`);
  }
  if (!isFactoryAdmin()) {
    throw new Error('أرشفة المحذوفات متاحة للأدمن فقط.');
  }

  const record = await pb.collection(collectionName).getOne(recordId);
  const recordData = Object.fromEntries(
    Object.entries(record).filter(([field]) => !SYSTEM_FIELDS.has(field)),
  );
  const archivedRecord = await pb.collection('deleted_records').create({
    collection_name: collectionName,
    record_id: record.id,
    record_data: recordData,
    display_name: displayName || getDeletedRecordLabel(recordData),
    deleted_by: pb.authStore.model?.email || pb.authStore.model?.name || 'مسؤول النظام',
  });

  try {
    return await pb.collection(collectionName).delete(recordId);
  } catch (deleteError) {
    try {
      await pb.collection('deleted_records').delete(archivedRecord.id);
    } catch (archiveCleanupError) {
      throw new Error(
        `فشل حذف السجل بعد حفظ نسخة في المحذوفات، وتعذر تنظيف النسخة: ${archiveCleanupError.message}`,
        { cause: deleteError },
      );
    }
    throw deleteError;
  }
}

export async function restoreDeletedRecord(archivedRecord) {
  const collectionName = archivedRecord.collection_name;
  const recordId = archivedRecord.record_id;
  const recordData = archivedRecord.record_data;

  if (!ARCHIVABLE_COLLECTIONS.has(collectionName)) {
    throw new Error('مجموعة السجل غير مسموح باستعادتها من الأرشيف.');
  }
  if (!isFactoryAdmin()) {
    throw new Error('استعادة المحذوفات متاحة للأدمن فقط.');
  }
  if (!recordId || !recordData || typeof recordData !== 'object' || Array.isArray(recordData)) {
    throw new Error('بيانات السجل المؤرشف غير مكتملة أو غير صالحة.');
  }
  if (recordData.id && recordData.id !== recordId) {
    throw new Error('معرّف السجل المؤرشف لا يطابق معرّف النسخة المحفوظة.');
  }

  let existingRecord = null;
  try {
    existingRecord = await pb.collection(collectionName).getOne(recordId);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (existingRecord) {
    throw new Error('يوجد سجل حالي بهذا المعرّف؛ لم يتم تغيير أي بيانات.');
  }

  const restoredRecord = await pb.collection(collectionName).create({
    ...recordData,
    id: recordId,
  });
  if (restoredRecord.id !== recordId) {
    try {
      await pb.collection(collectionName).delete(restoredRecord.id);
    } catch (cleanupError) {
      throw new Error(
        `أنشأ PocketBase السجل بمعرّف مختلف، وتعذر تنظيفه: ${cleanupError.message}. النسخة الأصلية ما زالت في المحذوفات.`,
      );
    }
    throw new Error('PocketBase لم يقبل المعرّف الأصلي؛ بقيت النسخة محفوظة في المحذوفات دون حذفها.');
  }
  await pb.collection('deleted_records').delete(archivedRecord.id);
}
