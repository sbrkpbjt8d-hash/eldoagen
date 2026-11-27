export const isSupplierSettlement = (transaction) => (
  String(transaction?.notes || '').startsWith('تسوية (')
);
