import { pb } from './pocketbase';

export const APPROVAL_REQUEST_COLLECTION = 'manager_approvals';
export const APPROVAL_PENDING = 'pending';
export const APPROVAL_APPROVED = 'approved';
export const APPROVAL_REJECTED = 'rejected';

const SYSTEM_FIELDS = new Set(['collectionId', 'collectionName', 'created', 'expand', 'updated']);
const BALANCE_COLLECTIONS = new Set(['banks', 'clientsmoashe', 'suppliers', 'treasury']);

const currentUserLabel = () => (
  pb.authStore.model?.name
  || pb.authStore.model?.email
  || pb.authStore.model?.username
  || 'مستخدم'
);

function getRequestTargetKeys(request) {
  const actions = request.operation === 'compound'
    ? request.request_data?.actions || []
    : request.target_id
      ? [{ collection: request.collection_name, id: request.target_id }]
      : [];
  const keys = actions
    .filter((action) => action.collection && action.id)
    .map((action) => `${action.collection}/${action.id}`);

  if (keys.length) return keys;
  if (request.operation !== 'compound') return [];

  return [`new:${request.record_label}:${JSON.stringify(request.request_data?.actions || [])}`];
}

function getPendingRequestTargetKeys(requests) {
  return requests
    .filter((record) => [APPROVAL_PENDING, 'processing'].includes(record.payload?.status))
    .flatMap((record) => getRequestTargetKeys(record.payload));
}

export async function getPendingReviewActionKeys() {
  const records = await pb.collection(APPROVAL_REQUEST_COLLECTION).getFullList({ sort: '-created' });
  return records
    .filter((record) => record.payload?.execution_mode === 'immediate'
      && record.payload?.status === APPROVAL_PENDING)
    .flatMap((record) => (record.payload?.request_data?.actions || [])
      .filter((action) => action.id && action.type !== 'delete')
      .map((action) => `${action.collection}/${action.id}`));
}

export async function getPendingDeletionActionKeys() {
  const records = await pb.collection(APPROVAL_REQUEST_COLLECTION).getFullList({ sort: '-created' });
  return records
    .filter((record) => record.payload?.status === APPROVAL_PENDING
      && record.payload?.execution_mode === 'on_approval')
    .flatMap((record) => (record.payload?.request_data?.actions || [])
      .filter((action) => action.type === 'delete' && action.id)
      .map((action) => `${action.collection}/${action.id}`));
}

async function createApprovalRequest(request) {
  const userId = pb.authStore.model?.id;
  if (!userId) throw new Error('يجب تسجيل الدخول لإرسال طلب الاعتماد.');

  return await pb.collection(APPROVAL_REQUEST_COLLECTION).create({
    requested_by_id: userId,
    payload: { ...request, requested_by_id: userId },
  });
}

export async function requestRecordUpdate(collectionName, recordId, changes, recordLabel) {
  const record = await pb.collection(collectionName).getOne(recordId);
  return createApprovalRequest({
    collection_name: collectionName,
    operation: 'update',
    target_id: recordId,
    record_label: recordLabel || record.name || record.title || record.invoice_number || record.id,
    requested_by: currentUserLabel(),
    status: APPROVAL_PENDING,
    request_data: { changes, original_updated: record.updated || '' },
  });
}

export async function requestRecordDeletion(collectionName, recordId, recordLabel) {
  const record = await pb.collection(collectionName).getOne(recordId);
  await pb.collection(collectionName).delete(recordId);
  return record;
}

export async function requestSettlement({
  collectionName,
  recordId,
  recordLabel,
  changes,
  transactionCollection,
  transactionData,
}) {
  const record = await pb.collection(collectionName).getOne(recordId);
  return createApprovalRequest({
    collection_name: collectionName,
    operation: 'settlement',
    target_id: recordId,
    record_label: recordLabel || record.name || record.id,
    requested_by: currentUserLabel(),
    status: APPROVAL_PENDING,
    request_data: {
      changes,
      original_updated: record.updated || '',
      transaction_collection: transactionCollection,
      transaction_data: transactionData,
    },
  });
}

async function validateCompoundActions(actions, snapshots, keyPrefix = '') {
  return Promise.all(actions.map(async (action, index) => {
    if (!action || !['create', 'update', 'delete', 'balance_delta'].includes(action.type) || !action.collection) {
      throw new Error('بيانات عملية الاعتماد غير مكتملة.');
    }

    if (action.type === 'create') {
      if (!action.data || typeof action.data !== 'object') {
        throw new Error('بيانات السجل الجديد غير صحيحة.');
      }
      return action;
    }

    if (!action.id) throw new Error('معرّف السجل المطلوب تغييره غير موجود.');
    if (action.type === 'balance_delta' && !Number.isFinite(Number(action.delta))) {
      throw new Error('قيمة تعديل الرصيد غير صحيحة.');
    }
    snapshots[`${keyPrefix}${index}`] = await pb.collection(action.collection).getOne(action.id);
    return action;
  }));
}

export async function requestCompoundOperation(actions, recordLabel, options = {}) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error('لا توجد تغييرات لإرسالها للاعتماد.');
  }

  const snapshots = {};
  const validatedActions = await validateCompoundActions(actions, snapshots);

  if (validatedActions.some((action) => action.type === 'delete')) {
    return applyCompoundApproval({
      collection_name: 'multiple',
      operation: 'compound',
      record_label: recordLabel || 'حذف مباشر',
      request_data: {
        actions: validatedActions,
        snapshots,
        rejection_actions: [],
        rejection_snapshots: {},
        compensation_actions: [],
      },
    }, { directDelete: true });
  }

  const rejectionSnapshots = {};
  const validatedRejectionActions = options.rejectionActions?.length
    ? await validateCompoundActions(options.rejectionActions, rejectionSnapshots)
    : [];

  const request = {
    collection_name: 'multiple',
    operation: 'compound',
    review_type: options.reviewType || '',
    target_id: '',
    record_label: recordLabel || 'عملية متعددة',
    requested_by: currentUserLabel(),
    status: options.reviewType ? 'processing' : APPROVAL_PENDING,
    execution_mode: options.reviewType ? 'immediate' : 'on_approval',
    request_data: {
      actions: validatedActions,
      snapshots,
      rejection_actions: validatedRejectionActions,
      rejection_snapshots: rejectionSnapshots,
      compensation_actions: [],
    },
  };
  const approvalRecord = await createApprovalRequest(request);
  if (!options.reviewType) return approvalRecord;

  let execution;
  try {
    execution = await applyCompoundApproval(request);
    await pb.collection(APPROVAL_REQUEST_COLLECTION).update(approvalRecord.id, {
      payload: {
        ...request,
        status: APPROVAL_PENDING,
        request_data: {
          ...request.request_data,
          actions: execution.actions,
          compensation_actions: execution.compensationActions,
        },
      },
    });
    return approvalRecord;
  } catch (error) {
    let rollbackError = null;
    if (execution) {
      try {
        await applyCompensationActions(execution.compensationActions);
      } catch (compensationError) {
        rollbackError = compensationError;
      }
    }
    try {
      await pb.collection(APPROVAL_REQUEST_COLLECTION).update(approvalRecord.id, {
        payload: {
          ...request,
          status: 'failed',
          failure_reason: error.message,
          rollback_failure: rollbackError?.message || '',
        },
      });
    } catch (statusError) {
      throw new Error(
        `${error.message}${rollbackError ? ` وتعذر التراجع عن العملية: ${rollbackError.message}` : ''} وتعذر تحديث حالة طلب المراجعة: ${statusError.message}`,
        { cause: error },
      );
    }
    if (rollbackError) {
      throw new Error(
        `${error.message} وتعذر التراجع عن العملية: ${rollbackError.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}

export async function executeCompoundOperation(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error('لا توجد تغييرات لتنفيذها.');
  }

  const snapshots = {};
  const validatedActions = await validateCompoundActions(actions, snapshots);
  return applyCompoundApproval({
    collection_name: 'multiple',
    operation: 'compound',
    record_label: 'عملية مباشرة',
    request_data: {
      actions: validatedActions,
      snapshots,
    },
  }, { directDelete: true });
}

async function ensureRecordHasNotChanged(request) {
  const data = request.request_data || {};
  const currentRecord = await pb.collection(request.collection_name).getOne(request.target_id);
  if (data.original_updated && currentRecord.updated !== data.original_updated) {
    throw new Error('تم تعديل السجل بعد إرسال الطلب. ارفض الطلب واطلب من المستخدم إرساله مرة أخرى.');
  }
  return currentRecord;
}

async function deleteWithArchive(request, currentRecord) {
  const recordData = Object.fromEntries(
    Object.entries(currentRecord).filter(([field]) => !SYSTEM_FIELDS.has(field)),
  );
  const archivedRecord = await pb.collection('deleted_records').create({
    collection_name: request.collection_name,
    record_id: currentRecord.id,
    record_data: recordData,
    display_name: request.record_label || recordData.name || recordData.title || currentRecord.id,
    deleted_by: currentUserLabel(),
  });

  try {
    await pb.collection(request.collection_name).delete(currentRecord.id);
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
  return archivedRecord.id;
}

function getRestorableRecordData(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([field]) => field !== 'id' && !SYSTEM_FIELDS.has(field)),
  );
}

function valuesMatch(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function getCompoundUpdateData(action, originalRecord, currentRecord) {
  const data = {};
  for (const [field, requestedValue] of Object.entries(action.data || {})) {
    const originalValue = originalRecord?.[field];
    const currentValue = currentRecord[field];

    if (valuesMatch(currentValue, originalValue) || valuesMatch(currentValue, requestedValue)) {
      data[field] = requestedValue;
      continue;
    }

    if (
      field === 'balance'
      && BALANCE_COLLECTIONS.has(action.collection)
      && Number.isFinite(Number(originalValue))
      && Number.isFinite(Number(currentValue))
      && Number.isFinite(Number(requestedValue))
    ) {
      const delta = Number(requestedValue) - Number(originalValue);
      data[field] = Math.round((Number(currentValue) + delta + Number.EPSILON) * 100) / 100;
      continue;
    }

    throw new Error(`تم تعديل السجل ${action.id} بعد إرسال الطلب.`);
  }
  return data;
}

async function findPreviouslyCreatedExpense(action, requestCreatedAt) {
  const createdAfter = Date.parse(requestCreatedAt || '');
  if (!Number.isFinite(createdAfter)) return null;

  const expenses = await pb.collection('expenses').getFullList({ sort: '-created' });
  return expenses.find((expense) => (
    Date.parse(expense.created || '') >= createdAfter
    && Object.entries(action.data || {}).every(([field, value]) => valuesMatch(expense[field], value))
  )) || null;
}

function getCompensationForUpdate(action, beforeRecord, afterData) {
  const compensation = [];
  const restoreData = {};
  const expectedData = {};

  for (const [field, nextValue] of Object.entries(afterData)) {
    if (
      field === 'balance'
      && BALANCE_COLLECTIONS.has(action.collection)
      && Number.isFinite(Number(beforeRecord[field]))
      && Number.isFinite(Number(nextValue))
    ) {
      const delta = Number(nextValue) - Number(beforeRecord[field]);
      if (delta !== 0) {
        compensation.push({
          type: 'balance_delta',
          collection: action.collection,
          id: action.id,
          delta: Math.round((-delta + Number.EPSILON) * 100) / 100,
        });
      }
      continue;
    }
    restoreData[field] = beforeRecord[field];
    expectedData[field] = nextValue;
  }

  if (Object.keys(restoreData).length) {
    compensation.push({
      type: 'restore_fields',
      collection: action.collection,
      id: action.id,
      data: restoreData,
      expected: expectedData,
    });
  }
  return compensation;
}

async function applyCompensationActions(actions = []) {
  for (const action of actions) {
    if (action.type === 'delete_created') {
      try {
        await pb.collection(action.collection).delete(action.id);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      continue;
    }

    if (action.type === 'balance_delta') {
      const record = await pb.collection(action.collection).getOne(action.id);
      const balance = Number(record.balance || 0);
      if (!Number.isFinite(balance) || !Number.isFinite(Number(action.delta))) {
        throw new Error(`تعذر عكس الرصيد في ${action.collection}/${action.id}.`);
      }
      await pb.collection(action.collection).update(action.id, {
        balance: Math.round((balance + Number(action.delta) + Number.EPSILON) * 100) / 100,
      });
      continue;
    }

    if (action.type === 'restore_fields') {
      const record = await pb.collection(action.collection).getOne(action.id);
      const restoreData = {};
      for (const [field, previousValue] of Object.entries(action.data || {})) {
        if (valuesMatch(record[field], previousValue)) continue;
        if (!valuesMatch(record[field], action.expected?.[field])) {
          throw new Error(`تعذر عكس الحقل ${field} في ${action.collection}/${action.id} لأنه تغيّر بعد العملية.`);
        }
        restoreData[field] = previousValue;
      }
      if (Object.keys(restoreData).length) {
        await pb.collection(action.collection).update(action.id, restoreData);
      }
      continue;
    }

    if (action.type === 'restore_deleted') {
      try {
        await pb.collection(action.collection).getOne(action.recordId);
      } catch (error) {
        if (error.status !== 404) throw error;
        await pb.collection(action.collection).create({ ...action.record, id: action.recordId });
      }
      if (action.archiveId) {
        try {
          await pb.collection('deleted_records').delete(action.archiveId);
        } catch (error) {
          if (error.status !== 404) throw error;
        }
      }
      continue;
    }

    throw new Error(`نوع إجراء العكس غير معروف: ${action.type}`);
  }
}

async function applyCompoundApproval(request, options = {}) {
  const { actions = [], snapshots = {} } = request.request_data || {};
  const directDelete = Boolean(options.directDelete);
  const appliedActions = [];
  const preparedActions = [];
  const completedActions = actions.map((action) => ({ ...action }));

  try {
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      const originalRecord = snapshots[index];
      let currentRecord = null;
      if (action.type !== 'create') {
        currentRecord = await pb.collection(action.collection).getOne(action.id);
        if (action.type === 'delete' && originalRecord && currentRecord.updated !== originalRecord.updated) {
          throw new Error(`تم تعديل السجل ${action.id} بعد إرسال الطلب.`);
        }
        if (action.type === 'update') {
          getCompoundUpdateData(action, originalRecord, currentRecord);
        }
        if (action.type === 'balance_delta' && !Number.isFinite(Number(currentRecord.balance || 0))) {
          throw new Error(`رصيد السجل ${action.id} غير صالح.`);
        }
      }
      preparedActions.push({ action, originalRecord, currentRecord, index });
    }

    preparedActions.sort((first, second) => {
      const order = { update: 0, balance_delta: 0, create: 1, delete: 2 };
      return order[first.action.type] - order[second.action.type];
    });

    for (const prepared of preparedActions) {
      const { action, originalRecord, index } = prepared;
      if (action.type === 'create') {
        if (action.collection === 'expenses') {
          const existingExpense = await findPreviouslyCreatedExpense(action, options.requestCreatedAt);
          if (existingExpense) {
            completedActions[index] = { ...action, id: existingExpense.id };
            appliedActions.push({ type: 'create', collection: action.collection, id: existingExpense.id });
            continue;
          }
        }
        const createdRecord = await pb.collection(action.collection).create(action.data);
        completedActions[index] = { ...action, id: createdRecord.id };
        appliedActions.push({ type: 'create', collection: action.collection, id: createdRecord.id });
      } else if (action.type === 'update') {
        const currentRecord = await pb.collection(action.collection).getOne(action.id);
        const updateData = getCompoundUpdateData(action, originalRecord, currentRecord);
        const compensationActions = getCompensationForUpdate(action, currentRecord, updateData);
        await pb.collection(action.collection).update(action.id, updateData);
        appliedActions.push({
          type: 'update',
          collection: action.collection,
          id: action.id,
          originalRecord: currentRecord,
          changedFields: Object.keys(updateData),
          compensationActions,
        });
      } else if (action.type === 'balance_delta') {
        const currentRecord = await pb.collection(action.collection).getOne(action.id);
        const delta = Number(action.delta);
        const updateData = {
          ...(action.data || {}),
          balance: Math.round((Number(currentRecord.balance || 0) + delta + Number.EPSILON) * 100) / 100,
        };
        const compensationActions = getCompensationForUpdate(action, currentRecord, updateData);
        await pb.collection(action.collection).update(action.id, updateData);
        appliedActions.push({
          type: 'update',
          collection: action.collection,
          id: action.id,
          originalRecord: currentRecord,
          changedFields: Object.keys(updateData),
          compensationActions,
        });
      } else if (action.type === 'delete') {
        const currentRecord = await pb.collection(action.collection).getOne(action.id);
        let archiveId = null;
        if (directDelete) {
          await pb.collection(action.collection).delete(action.id);
        } else {
          archiveId = await deleteWithArchive({
            collection_name: action.collection,
            target_id: action.id,
            record_label: action.record_label || request.record_label,
          }, currentRecord);
        }
        appliedActions.push({
          type: 'delete',
          collection: action.collection,
          id: action.id,
          originalRecord: currentRecord,
          archiveId,
        });
      }
    }
    const compensationActions = appliedActions.flatMap((action) => {
      if (action.type === 'create') {
        return [{ type: 'delete_created', collection: action.collection, id: action.id }];
      }
      if (action.type === 'update') return action.compensationActions;
      return [{
        type: 'restore_deleted',
        collection: action.collection,
        recordId: action.id,
        record: getRestorableRecordData(action.originalRecord),
        archiveId: action.archiveId,
      }];
    }).reverse();
    return { actions: completedActions, compensationActions };
  } catch (error) {
    const rollbackErrors = [];
    for (const action of appliedActions.reverse()) {
      try {
        if (action.type === 'create') {
          await pb.collection(action.collection).delete(action.id).catch((deleteError) => {
            if (deleteError.status !== 404) throw deleteError;
          });
        } else if (action.type === 'update') {
          if (action.compensationActions?.length) {
            await applyCompensationActions(action.compensationActions);
          } else {
            await pb.collection(action.collection).update(
              action.id,
              Object.fromEntries(
                action.changedFields.map((field) => [field, action.originalRecord[field]]),
              ),
            );
          }
        } else {
          await pb.collection(action.collection).create({
            ...getRestorableRecordData(action.originalRecord),
            id: action.id,
          });
          if (action.archiveId) {
            await pb.collection('deleted_records').delete(action.archiveId);
          }
        }

      } catch (rollbackError) {
        rollbackErrors.push(`${action.collection}/${action.id}: ${rollbackError.message}`);
      }
    }

    if (rollbackErrors.length) {
      throw new Error(
        `${error.message} وتعذر التراجع عن بعض التغييرات: ${rollbackErrors.join('، ')}`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function applyApproval(request, options = {}) {
  const data = request.request_data || {};
  if (request.operation === 'update') {
    await ensureRecordHasNotChanged(request);
    await pb.collection(request.collection_name).update(request.target_id, data.changes || {});
    return;
  }

  if (request.operation === 'delete') {
    const currentRecord = await ensureRecordHasNotChanged(request);
    await deleteWithArchive(request, currentRecord);
    return;
  }

  if (request.operation === 'settlement') {
    await ensureRecordHasNotChanged(request);
    const transaction = await pb.collection(data.transaction_collection).create(data.transaction_data);
    try {
      await pb.collection(request.collection_name).update(request.target_id, data.changes || {});
    } catch (error) {
      try {
        await pb.collection(data.transaction_collection).delete(transaction.id);
      } catch (rollbackError) {
        throw new Error(
          `${error.message} وتعذر التراجع عن حركة التسوية: ${rollbackError.message}`,
          { cause: error },
        );
      }
      throw error;
    }
    return;
  }

  if (request.operation === 'compound') {
    await applyCompoundApproval(request, options);
    return;
  }

  throw new Error('نوع طلب غير معروف.');
}

export async function decideApprovalRequest(record, decision) {
  if (![APPROVAL_APPROVED, APPROVAL_REJECTED].includes(decision)) {
    throw new Error('قرار الاعتماد غير صحيح.');
  }

  const collection = pb.collection(APPROVAL_REQUEST_COLLECTION);
  const currentRecord = await collection.getOne(record.id);
  const request = currentRecord.payload;
  if (!request || request.status !== APPROVAL_PENDING) {
    throw new Error('تمت معالجة هذا الطلب بالفعل.');
  }

  if (decision === APPROVAL_REJECTED) {
    await collection.delete(currentRecord.id);
    return APPROVAL_REJECTED;
  }

  const processingRequest = {
    ...request,
    status: 'processing',
  };
  await collection.update(currentRecord.id, { payload: processingRequest });

  try {
    await applyApproval(request);
    await collection.update(currentRecord.id, {
      payload: {
        ...processingRequest,
        status: APPROVAL_APPROVED,
        decided_by: currentUserLabel(),
      },
    });
  } catch (error) {
    try {
      await collection.update(currentRecord.id, { payload: request });
    } catch (resetError) {
      throw new Error(
        `${error.message} وتعذر إعادة الطلب إلى حالة الانتظار: ${resetError.message}`,
        { cause: error },
      );
    }
    throw error;
  }

  return APPROVAL_APPROVED;
}

export async function decideReviewRequest(record, decision, reviewNote = '') {
  if (![APPROVAL_APPROVED, APPROVAL_REJECTED].includes(decision)) {
    throw new Error('قرار المراجعة غير صحيح.');
  }

  const collection = pb.collection(APPROVAL_REQUEST_COLLECTION);
  const currentRecord = await collection.getOne(record.id);
  const request = currentRecord.payload;
  if (!request || !['bank', 'treasury'].includes(request.review_type) || request.status !== APPROVAL_PENDING) {
    throw new Error('طلب المراجعة لم يعد متاحاً.');
  }

  const decidedRequest = {
    ...request,
    status: decision,
    decided_by: currentUserLabel(),
    review_note: reviewNote.trim(),
    decided_at: new Date().toISOString(),
  };

  if (decision === APPROVAL_REJECTED) {
    await collection.update(currentRecord.id, {
      payload: { ...decidedRequest, status: 'processing' },
    });
    try {
      if (request.execution_mode === 'immediate') {
        await applyCompensationActions(request.request_data?.compensation_actions || []);
      } else if (request.operation === 'compound' && request.request_data?.rejection_actions?.length) {
        await applyCompoundApproval({
          ...request,
          request_data: {
            actions: request.request_data.rejection_actions,
            snapshots: request.request_data.rejection_snapshots || {},
          },
        });
      }
      await collection.update(currentRecord.id, { payload: decidedRequest });
    } catch (error) {
      try {
        await collection.update(currentRecord.id, { payload: request });
      } catch (resetError) {
        throw new Error(
          `${error.message} وتعذر إعادة الطلب إلى حالة الانتظار: ${resetError.message}`,
          { cause: error },
        );
      }
      throw error;
    }
    return APPROVAL_REJECTED;
  }

  await collection.update(currentRecord.id, {
    payload: { ...decidedRequest, status: 'processing' },
  });

  try {
    if (request.execution_mode !== 'immediate') {
      await applyApproval(request, { requestCreatedAt: currentRecord.created });
    }
    await collection.update(currentRecord.id, { payload: decidedRequest });
  } catch (error) {
    try {
      await collection.update(currentRecord.id, { payload: request });
    } catch (resetError) {
      throw new Error(
        `${error.message} وتعذر إعادة الطلب إلى حالة الانتظار: ${resetError.message}`,
        { cause: error },
      );
    }
    throw error;
  }

  return APPROVAL_APPROVED;
}
