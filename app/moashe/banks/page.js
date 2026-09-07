'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';

export default function BanksPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState({ text: '', type: '' });

  // حالات نافذة الحذف (للمسؤولين فقط)
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, bankId: null });

  // حالات نافذة التعديل (للمسؤولين فقط)
  const [editModal, setEditModal] = useState({ isOpen: false, bank: null });
  const [editName, setEditName] = useState('');
  const [editOpeningBalance, setEditOpeningBalance] = useState('');
  const [editBalance, setEditBalance] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const [reconciliationModal, setReconciliationModal] = useState({ isOpen: false, bank: null });
  const [reconciledBalance, setReconciledBalance] = useState('');
  const [reconciliationNotes, setReconciliationNotes] = useState('');

  // حالات نافذة عرض سجل حركات البنك
  const [historyModal, setHistoryModal] = useState({ isOpen: false, bank: null });
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');

  // حالات نموذج إضافة بنك جديد (متاحة للجميع)
  const [bankName, setBankName] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [notes, setNotes] = useState('');

  // التحقق مما إذا كان المستخدم الحالي مسؤولاً (Admin)
  const currentUser = pb.authStore.model;
  const isAdmin = currentUser?.role === 'admin' || currentUser?.email === 'mohamedfrf@icloud.com';

  const currentUserName = () => {
    return currentUser?.name || currentUser?.email || 'مستخدم النظام';
  };

  const showFeedback = (text, type = 'success') => {
    setFeedbackMessage({ text, type });
    setTimeout(() => {
      setFeedbackMessage({ text: '', type: '' });
    }, 4000);
  };

  // 1. جلب قائمة البنوك
  const { data: banks = [] } = useQuery({
    queryKey: ['banks'],
    queryFn: async () => {
      return await pb.collection('banks').getFullList({ sort: '-created' }).catch(() => []);
    },
  });

  // 2. جلب المصروفات
  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: async () => {
      return await pb.collection('expenses').getFullList({ 
        sort: '-created',
        expand: 'category_id' 
      }).catch(() => []);
    },
  });

  // 3. جلب حركات العملاء
  const { data: clientTransactions = [] } = useQuery({
    queryKey: ['client_transactions_banks'],
    queryFn: async () => {
      return await pb.collection('client_transactions').getFullList({
        filter: 'destination = "banks"',
        expand: 'client_id',
      }).catch(() => []);
    },
  });

  // 4. جلب حركات الموردين
  const { data: supplierTransactions = [] } = useQuery({
    queryKey: ['supplier_transactions_banks'],
    queryFn: async () => {
      return await pb.collection('supplier_transactions').getFullList({
        filter: 'destination = "banks"',
        expand: 'supplier_id',
      }).catch(() => []);
    },
  });

  const { data: treasuryTransactions = [] } = useQuery({
    queryKey: ['treasury_transactions_banks'],
    queryFn: async () => {
      return await pb.collection('treasury_transactions').getFullList({ sort: '-date' }).catch(() => []);
    },
  });

  // إضافة بنك جديد (متاحة للجميع)
  const addBankMutation = useMutation({
    mutationFn: async (newBank) => {
      const amount = Number(newBank.opening_balance || 0);
      return await pb.collection('banks').create({
        ...newBank,
        balance: amount,
        actor_name: currentUserName(),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banks'] });
      setBankName('');
      setOpeningBalance('');
      setNotes('');
      showFeedback('🏦 تم إضافة البنك والرصيد بنجاح!', 'success');
    },
    onError: (error) => {
      showFeedback('❌ حدث خطأ أثناء حفظ البنك: ' + error.message, 'error');
    },
  });

  // تعديل بنك (للمسؤولين فقط)
  const updateBankMutation = useMutation({
    mutationFn: async ({ id, name, opening_balance, balance, notes }) => {
      if (!isAdmin) throw new Error('عذراً، التعديل مقتصر على المسؤولين فقط.');
      return await pb.collection('banks').update(id, {
        name,
        opening_balance: Number(opening_balance || 0),
        balance: Number(balance || 0),
        notes,
        actor_name: currentUserName(),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banks'] });
      setEditModal({ isOpen: false, bank: null });
      showFeedback('✨ تم تحديث بيانات البنك بنجاح!', 'success');
    },
    onError: (error) => {
      showFeedback('❌ فشل تحديث البنك: ' + error.message, 'error');
    },
  });

  const reconcileBankMutation = useMutation({
    mutationFn: async () => {
      if (!isAdmin) throw new Error('عذراً، التسوية مقتصرة على المسؤولين فقط.');
      const bank = reconciliationModal.bank;
      const actualBalance = Number(reconciledBalance);
      const currentBalance = Number(bank?.balance || 0);
      const difference = actualBalance - currentBalance;

      if (!bank) throw new Error('اختر البنك المراد تسويته.');
      if (!Number.isFinite(actualBalance) || actualBalance < 0) throw new Error('اكتب الرصيد الفعلي بشكل صحيح.');
      if (difference === 0) throw new Error('الرصيد الفعلي يساوي الرصيد الحالي، لا توجد تسوية.');

      await pb.collection('banks').update(bank.id, {
        balance: actualBalance,
        actor_name: currentUserName(),
      });
      return await pb.collection('treasury_transactions').create({
        type: 'purchase',
        movement_type: 'bank_adjustment',
        source_type: 'bank',
        bank_id: bank.id,
        amount: difference,
        title: `تسوية رصيد البنك: ${bank.name}`,
        notes: reconciliationNotes.trim() || 'تسوية رصيد البنك',
        date: new Date().toISOString(),
        actor_name: currentUserName(),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banks'] });
      await queryClient.invalidateQueries({ queryKey: ['treasury_transactions_banks'] });
      setReconciliationModal({ isOpen: false, bank: null });
      setReconciledBalance('');
      setReconciliationNotes('');
      showFeedback('✅ تمت تسوية رصيد البنك وتسجيلها في السجل.', 'success');
    },
    onError: (error) => showFeedback('❌ فشل تنفيذ التسوية: ' + error.message, 'error'),
  });

  // حذف بنك (للمسؤولين فقط)
  const deleteBankMutation = useMutation({
    mutationFn: async (id) => {
      if (!isAdmin) throw new Error('عذراً، الحذف مقتصر على المسؤولين فقط.');
      return await pb.collection('banks').delete(id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['banks'] });
      showFeedback('🗑️ تم حذف البنك بنجاح.', 'success');
      setDeleteModal({ isOpen: false, bankId: null });
    },
    onError: (error) => {
      showFeedback('❌ فشل حذف البنك: ' + error.message, 'error');
      setDeleteModal({ isOpen: false, bankId: null });
    },
  });

  const handleAddBank = (e) => {
    e.preventDefault();
    if (!bankName.trim()) {
      showFeedback('يرجى إدخال اسم البنك على الأقل.', 'error');
      return;
    }
    addBankMutation.mutate({
      name: bankName.trim(),
      opening_balance: openingBalance === '' ? 0 : Number(openingBalance),
      notes: notes.trim(),
    });
  };

  const handleEditSubmit = (e) => {
    e.preventDefault();
    if (!isAdmin) {
      showFeedback('❌ ليس لديك صلاحية لتعديل البيانات.', 'error');
      return;
    }
    if (!editName.trim()) {
      showFeedback('اسم البنك مطلوب', 'error');
      return;
    }
    updateBankMutation.mutate({
      id: editModal.bank.id,
      name: editName.trim(),
      opening_balance: editOpeningBalance,
      balance: editBalance,
      notes: editNotes.trim(),
    });
  };

  const filteredBanks = banks.filter(bank =>
    bank.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalCurrentBalances = banks.reduce((sum, bank) => sum + Number(bank.balance || 0), 0);

  const currentBankExpenses = historyModal.bank 
    ? expenses.filter(item => String(item.bank_id || '').trim() === String(historyModal.bank.id))
    : [];

  const currentBankPayments = historyModal.bank
    ? clientTransactions.filter((transaction) => {
        const bankId = typeof transaction.bank_id === 'string' ? transaction.bank_id : transaction.bank_id?.id;
        const transactionDate = String(transaction.date || transaction.created || '').slice(0, 10);
        return bankId === historyModal.bank.id &&
          (!historyStartDate || transactionDate >= historyStartDate) &&
          (!historyEndDate || transactionDate <= historyEndDate);
      }).map((transaction) => ({ ...transaction, movementType: 'client_payment' }))
    : [];

  const currentSupplierPayments = historyModal.bank
    ? supplierTransactions.filter((transaction) => {
        const bankId = typeof transaction.bank_id === 'string' ? transaction.bank_id : transaction.bank_id?.id;
        const transactionDate = String(transaction.date || transaction.created || '').slice(0, 10);
        return bankId === historyModal.bank.id &&
          (!historyStartDate || transactionDate >= historyStartDate) &&
          (!historyEndDate || transactionDate <= historyEndDate);
      }).map((transaction) => ({ ...transaction, movementType: 'supplier_payment' }))
    : [];

  const currentBankOtherAdvanceTransactions = historyModal.bank
    ? treasuryTransactions.filter(transaction => {
        const bankId = typeof transaction.bank_id === 'string' ? transaction.bank_id : transaction.bank_id?.id;
        const transactionDate = String(transaction.date || transaction.created || '').slice(0, 10);
        return ['other_advance', 'other_advance_return'].includes(String(transaction.movement_type || '').toLowerCase()) &&
          transaction.source_type === 'bank' &&
          bankId === historyModal.bank.id &&
          (!historyStartDate || transactionDate >= historyStartDate) &&
          (!historyEndDate || transactionDate <= historyEndDate);
      }).map(transaction => ({
        ...transaction,
        movementType: transaction.movement_type === 'other_advance_return' ? 'other_advance_return' : 'other_advance',
      }))
    : [];

  const currentBankDeposits = historyModal.bank
    ? treasuryTransactions.filter(transaction => {
        const bankId = typeof transaction.bank_id === 'string' ? transaction.bank_id : transaction.bank_id?.id;
        const transactionDate = String(transaction.date || transaction.created || '').slice(0, 10);
        return String(transaction.movement_type || '').toLowerCase() === 'bank_deposit' &&
          transaction.source_type === 'treasury' &&
          bankId === historyModal.bank.id &&
          (!historyStartDate || transactionDate >= historyStartDate) &&
          (!historyEndDate || transactionDate <= historyEndDate);
      }).map(transaction => ({ ...transaction, movementType: 'bank_deposit' }))
    : [];

  const currentBankAdjustments = historyModal.bank
    ? treasuryTransactions.filter(transaction => {
        const bankId = typeof transaction.bank_id === 'string' ? transaction.bank_id : transaction.bank_id?.id;
        const transactionDate = String(transaction.date || transaction.created || '').slice(0, 10);
        return String(transaction.movement_type || '').toLowerCase() === 'bank_adjustment' &&
          transaction.source_type === 'bank' &&
          bankId === historyModal.bank.id &&
          (!historyStartDate || transactionDate >= historyStartDate) &&
          (!historyEndDate || transactionDate <= historyEndDate);
      }).map(transaction => ({ ...transaction, movementType: 'bank_adjustment' }))
    : [];

  const currentBankTransactions = [
    ...currentBankExpenses.map((expense) => ({ ...expense, movementType: 'expense' })),
    ...currentBankPayments,
    ...currentSupplierPayments,
    ...currentBankOtherAdvanceTransactions,
    ...currentBankDeposits,
    ...currentBankAdjustments,
  ].sort((first, second) => new Date(second.date || second.created) - new Date(first.date || first.created));

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-8 relative" dir="rtl">

      {/* نافذة حذف البنك (للمسؤولين فقط) */}
      {deleteModal.isOpen && isAdmin && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <h3 className="text-base font-black text-gray-800">تأكيد الحذف</h3>
            <p className="text-xs text-gray-500">هل أنت متأكد من حذف هذا البنك؟</p>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setDeleteModal({ isOpen: false, bankId: null })} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl text-xs font-bold">إلغاء</button>
              <button disabled={deleteBankMutation.isPending} onClick={() => deleteBankMutation.mutate(deleteModal.bankId)} className="flex-1 bg-red-600 text-white py-2.5 rounded-xl text-xs font-bold">حذف</button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة تعديل البنك (للمسؤولين فقط) */}
      {editModal.isOpen && editModal.bank && isAdmin && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-base font-black text-gray-800">✏️ تعديل بيانات البنك</h3>
              <button onClick={() => setEditModal({ isOpen: false, bank: null })} className="text-gray-400 font-bold hover:text-gray-700">✕</button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-700">اسم البنك</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full border p-3 rounded-xl text-xs mt-1 outline-none focus:border-blue-500" required />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700">الرصيد الافتتاحي</label>
                <input type="number" step="0.01" value={editOpeningBalance} onChange={(e) => setEditOpeningBalance(e.target.value)} className="w-full border p-3 rounded-xl text-xs mt-1 outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700">الرصيد الحالي</label>
                <input type="number" step="0.01" value={editBalance} onChange={(e) => setEditBalance(e.target.value)} className="w-full border p-3 rounded-xl text-xs mt-1 outline-none focus:border-blue-500 font-black text-emerald-600" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700">ملاحظات</label>
                <input type="text" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="w-full border p-3 rounded-xl text-xs mt-1 outline-none focus:border-blue-500" />
              </div>
              <div className="flex gap-2 pt-3">
                <button type="button" onClick={() => setEditModal({ isOpen: false, bank: null })} className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl text-xs font-bold">إلغاء</button>
                <button type="submit" disabled={updateBankMutation.isPending} className="flex-1 bg-blue-600 text-white py-3 rounded-xl text-xs font-bold">حفظ التعديلات</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {reconciliationModal.isOpen && reconciliationModal.bank && isAdmin && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="text-base font-black text-gray-800">⚖️ تسوية رصيد البنك</h3>
                <p className="text-xs text-gray-500 mt-1">البنك: {reconciliationModal.bank.name}</p>
              </div>
              <button onClick={() => setReconciliationModal({ isOpen: false, bank: null })} className="text-gray-400 font-bold text-lg hover:text-gray-700">✕</button>
            </div>
            <p className="text-xs text-gray-600">الرصيد الحالي: <span className="font-black text-blue-600">{Number(reconciliationModal.bank.balance || 0).toLocaleString()} ج.م</span></p>
            <form onSubmit={(event) => { event.preventDefault(); reconcileBankMutation.mutate(); }} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-700">الرصيد الفعلي بعد التسوية</label>
                <input type="number" min="0" step="0.01" value={reconciledBalance} onChange={(event) => setReconciledBalance(event.target.value)} className="w-full border p-3 rounded-xl text-xs mt-1 outline-none focus:border-blue-500 font-black" required />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700">بيان التسوية</label>
                <input type="text" value={reconciliationNotes} onChange={(event) => setReconciliationNotes(event.target.value)} placeholder="مثال: مطابقة كشف البنك" className="w-full border p-3 rounded-xl text-xs mt-1 outline-none focus:border-blue-500" />
              </div>
              <div className="flex gap-2 pt-3">
                <button type="button" onClick={() => setReconciliationModal({ isOpen: false, bank: null })} className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl text-xs font-bold">إلغاء</button>
                <button type="submit" disabled={reconcileBankMutation.isPending} className="flex-1 bg-emerald-600 text-white py-3 rounded-xl text-xs font-bold">{reconcileBankMutation.isPending ? 'جارٍ الحفظ...' : 'حفظ التسوية'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* نافذة سجل الحركات */}
      {historyModal.isOpen && historyModal.bank && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-2xl w-full shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="text-base font-black text-gray-800">📜 سجل حركات البنك: {historyModal.bank.name}</h3>
                <p className="text-[11px] text-gray-500 mt-0.5">الرصيد الحالي: <span className="font-black text-emerald-600">{Number(historyModal.bank.balance || 0).toLocaleString()} ج.م</span></p>
              </div>
              <button onClick={() => setHistoryModal({ isOpen: false, bank: null })} className="text-gray-400 font-bold text-lg hover:text-gray-700">✕</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-gray-700">من تاريخ</label>
                <input type="date" value={historyStartDate} onChange={(e) => setHistoryStartDate(e.target.value)} className="w-full border border-gray-200 bg-gray-50 p-3 rounded-xl text-xs font-bold outline-none mt-1" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700">إلى تاريخ</label>
                <input type="date" value={historyEndDate} onChange={(e) => setHistoryEndDate(e.target.value)} className="w-full border border-gray-200 bg-gray-50 p-3 rounded-xl text-xs font-bold outline-none mt-1" />
              </div>
            </div>
            <div className="overflow-y-auto flex-1 border border-gray-100 rounded-2xl">
              <table className="w-full text-right text-xs">
                <thead className="bg-gray-50 text-gray-500 sticky top-0">
                  <tr>
                    <th className="p-3">التاريخ</th>
                    <th className="p-3">نوع الحركة</th>
                    <th className="p-3">المبلغ</th>
                    <th className="p-3">ملاحظات</th>
                    <th className="p-3">بواسطة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {currentBankTransactions.length > 0 ? (
                    currentBankTransactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-gray-50/60">
                        <td className="p-3 text-gray-600">{String(tx.date || tx.created || '').slice(0, 10) || '-'}</td>
                        <td className="p-3 font-bold text-blue-600">
                          {tx.movementType === 'client_payment' ? `تحصيل من عميل: ${tx.expand?.client_id?.name || 'عميل'}` : tx.movementType === 'supplier_payment' ? `سداد مورد: ${tx.expand?.supplier_id?.name || 'مورد'}` : tx.movementType === 'other_advance' ? tx.title || 'صرف عهدة' : tx.movementType === 'other_advance_return' ? tx.title || 'رد عهدة' : tx.movementType === 'bank_deposit' ? tx.title || 'إيداع من الخزنة' : tx.movementType === 'bank_adjustment' ? tx.title || 'تسوية رصيد البنك' : tx.expand?.category_id?.name || 'مصروف'}
                        </td>
                        <td className={`p-3 font-black ${tx.movementType === 'bank_adjustment' ? (Number(tx.amount || 0) >= 0 ? 'text-emerald-600' : 'text-red-600') : tx.movementType === 'client_payment' || tx.movementType === 'other_advance_return' || tx.movementType === 'bank_deposit' ? 'text-emerald-600' : 'text-red-600'}`}>
                          {tx.movementType === 'bank_adjustment' ? (Number(tx.amount || 0) >= 0 ? '+' : '-') : tx.movementType === 'client_payment' || tx.movementType === 'other_advance_return' || tx.movementType === 'bank_deposit' ? '+' : '-'} {Math.abs(Number(tx.amount || 0)).toLocaleString()} ج.م
                        </td>
                        <td className="p-3 text-gray-500">{tx.notes || '-'}</td>
                        <td className="p-3 font-bold text-gray-700">{tx.actor_name || 'غير معروف'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan="5" className="p-8 text-center text-gray-400 font-bold">لا توجد حركات مسجلة لهذا البنك في الفترة المحددة.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="pt-2 flex justify-end">
              <button onClick={() => setHistoryModal({ isOpen: false, bank: null })} className="bg-gray-900 text-white px-6 py-2.5 rounded-xl text-xs font-bold">إغلاق</button>
            </div>
          </div>
        </div>
      )}

      {/* الهيدر */}
      <div className="border-b pb-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-gray-800">💳 إدارة البنوك والمصروفات</h1>
          <p className="text-sm text-gray-500">متابعة الحسابات البنكية، الأرصدة، وسجل الحركات المرتبطة بها</p>
        </div>
        <button onClick={() => { queryClient.invalidateQueries({ queryKey: ['banks'] }); }} className="bg-gray-100 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold">🔄 تحديث</button>
      </div>

      {feedbackMessage.text && (
        <div className={`p-4 rounded-2xl text-xs font-bold ${feedbackMessage.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
          {feedbackMessage.text}
        </div>
      )}

      {/* إحصائيات سريعة */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-gray-400">إجمالي البنوك المسجلة</p>
            <h3 className="text-xl font-black text-blue-600 mt-1">{banks.length} بنوك</h3>
          </div>
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl font-bold">🏛️</div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-gray-400">إجمالي الأرصدة الحالية بالبنوك</p>
            <h3 className="text-xl font-black text-emerald-600 mt-1">{totalCurrentBalances.toLocaleString()} ج.م</h3>
          </div>
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl font-bold">💰</div>
        </div>
      </div>

      {/* نموذج إضافة بنك جديد (متاح للجميع) */}
      <div className="bg-white p-6 rounded-2xl shadow-xl border border-gray-100">
        <h2 className="text-lg font-bold text-gray-800 mb-4">➕ إضافة بنك جديد</h2>
        <form onSubmit={handleAddBank} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            type="text"
            placeholder="اسم البنك (مثال: البنك الأهلي المصري) *"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            className="border p-3 rounded-xl text-xs outline-none focus:border-blue-500"
            required
          />
          <input
            type="number"
            step="0.01"
            placeholder="الرصيد الافتتاحي (ج.م) *"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            className="border p-3 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
            required
          />
          <input
            type="text"
            placeholder="ملاحظات (اختياري)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="border p-3 rounded-xl text-xs outline-none focus:border-blue-500"
          />
          <div className="md:col-span-3 flex justify-end">
            <button
              type="submit"
              disabled={addBankMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 py-3 rounded-xl text-xs transition shadow-lg shadow-blue-600/20"
            >
              حفظ البنك الجديد
            </button>
          </div>
        </form>
      </div>

      {/* جدول عرض البنوك */}
      <div className="bg-white shadow-xl rounded-2xl border border-gray-100 overflow-hidden">
        <div className="p-4 bg-gray-50 border-b flex justify-between items-center gap-4">
          <h2 className="text-lg font-bold text-gray-800">📋 قائمة الحسابات البنكية</h2>
          <input
            type="text"
            placeholder="🔍 بحث باسم البنك..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="border px-3 py-2 rounded-xl text-xs w-64 bg-white outline-none"
          />
        </div>

        <div className="p-4 overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="border-b text-xs text-gray-500 bg-gray-50">
                <th className="p-3">اسم البنك</th>
                <th className="p-3">الرصيد الافتتاحي</th>
                <th className="p-3">الرصيد الحالي</th>
                <th className="p-3">ملاحظات</th>
                <th className="p-3">أُضيف/عُدِّل بواسطة</th>
                <th className="p-3 text-center">الإجراءات والسجل</th>
              </tr>
            </thead>
            <tbody className="divide-y text-sm">
              {filteredBanks.map((bank) => (
                <tr key={bank.id} className="hover:bg-gray-50/50 transition">
                  <td className="p-3 font-black text-gray-900">{bank.name}</td>
                  <td className="p-3 font-bold text-gray-600">{Number(bank.opening_balance || 0).toLocaleString()} ج.م</td>
                  <td className="p-3 font-black text-emerald-600">{Number(bank.balance || 0).toLocaleString()} ج.م</td>
                  <td className="p-3 text-xs text-gray-500">{bank.notes || '-'}</td>
                  <td className="p-3 text-xs font-bold text-gray-700">{bank.actor_name || 'غير معروف'}</td>
                  <td className="p-3 text-center">
                    <div className="flex justify-center gap-2">
                      {/* زر السجل متاح للجميع */}
                      <button
                        onClick={() => {
                          setHistoryStartDate('');
                          setHistoryEndDate('');
                          setHistoryModal({ isOpen: true, bank });
                        }}
                        className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1"
                      >
                        📜 السجل
                      </button>

                      {isAdmin && (
                        <button
                          onClick={() => {
                            setReconciledBalance(bank.balance ?? '');
                            setReconciliationNotes('');
                            setReconciliationModal({ isOpen: true, bank });
                          }}
                          className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-lg text-xs font-bold transition"
                        >
                          ⚖️ تسوية
                        </button>
                      )}
                      
                      {/* أزرار التعديل والحذف تظهر للمسؤولين فقط (isAdmin) */}
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => {
                              setEditName(bank.name || '');
                              setEditOpeningBalance(bank.opening_balance ?? '');
                              setEditBalance(bank.balance ?? '');
                              setEditNotes(bank.notes || '');
                              setEditModal({ isOpen: true, bank });
                            }}
                            className="bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 px-3 py-1.5 rounded-lg text-xs font-bold transition"
                          >
                            ✏️ تعديل
                          </button>
                          <button
                            onClick={() => setDeleteModal({ isOpen: true, bankId: bank.id })}
                            className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg text-xs font-bold transition"
                          >
                            🗑️ حذف
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredBanks.length === 0 && (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-gray-400 text-xs font-bold">
                    لا توجد بنوك مسجلة حتى الآن.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}