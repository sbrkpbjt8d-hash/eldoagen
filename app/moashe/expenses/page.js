'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';

export default function ExpensesPage() {
  const queryClient = useQueryClient();

  // تعريف اسم المستخدم الحالي كمتغير نصي وليس كدالة
  const currentUserName = typeof window !== 'undefined' ? (localStorage.getItem('userName') || 'مسؤول النظام') : 'مسؤول النظام';

  // حالات نماذج الإدخال
  const [catName, setCatName] = useState('');
  const [catType, setCatType] = useState('operational');

  const [selectedCategory, setSelectedCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentSource, setPaymentSource] = useState('treasury'); // 'treasury' أو id البنك
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  // حالات الفلترة والبحث
  const [filterType, setFilterType] = useState('all'); // 'all', 'operational', 'non_operational'
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // حالات النوافذ التأكيديه والإشعارات الداخلية
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [deleteConfirmModal, setDeleteConfirmModal] = useState({ show: false, type: '', data: null });

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 4500);
  };

  // 1. جلب الخزنة
  const { data: treasuryRecords = [] } = useQuery({
    queryKey: ['treasury'],
    queryFn: async () => {
      return await pb.collection('treasury').getFullList().catch(() => []);
    },
  });
  const treasury = treasuryRecords.find((record) => Object.prototype.hasOwnProperty.call(record, 'opening_balance')) || treasuryRecords[0] || null;

  // 2. جلب قائمة البنوك
  const { data: banks = [] } = useQuery({
    queryKey: ['banks'],
    queryFn: async () => {
      return await pb.collection('banks').getFullList().catch(() => []);
    },
  });

  // 3. جلب أنواع المصروفات الفرعية
  const { data: categories = [] } = useQuery({
    queryKey: ['expense_categories'],
    queryFn: async () => {
      return await pb.collection('expense_categories').getFullList({ sort: '-created' }).catch(() => []);
    },
  });

  // 4. جلب سجل المصروفات
  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: async () => {
      return await pb.collection('expenses').getFullList({
        sort: '-created',
        expand: 'category_id,bank_id',
      }).catch(() => []);
    },
  });

  const { data: clientTransactions = [] } = useQuery({
    queryKey: ['client_transactions_expenses_balance'],
    queryFn: async () => pb.collection('client_transactions').getFullList().catch(() => []),
  });

  const { data: supplierTransactions = [] } = useQuery({
    queryKey: ['supplier_transactions_expenses_balance'],
    queryFn: async () => pb.collection('supplier_transactions').getFullList().catch(() => []),
  });

  const { data: salesInvoices = [] } = useQuery({
    queryKey: ['sales_invoices_expenses_balance'],
    queryFn: async () => pb.collection('sales_invoices').getFullList().catch(() => []),
  });

  const { data: employeeAdvances = [] } = useQuery({
    queryKey: ['advances_expenses_balance'],
    queryFn: async () => pb.collection('advances').getFullList().catch(() => []),
  });

  const { data: salariesPayouts = [] } = useQuery({
    queryKey: ['salaries_payouts_expenses_balance'],
    queryFn: async () => pb.collection('salaries_payouts').getFullList().catch(() => []),
  });

  const { data: treasuryTransactions = [] } = useQuery({
    queryKey: ['treasury_transactions_expenses_balance'],
    queryFn: async () => pb.collection('treasury_transactions').getFullList().catch(() => []),
  });

  // Mutation إضافة نوع مصروف فرعي
  const addCategoryMutation = useMutation({
    mutationFn: async () => {
      return await pb.collection('expense_categories').create({
        name: catName.trim(),
        type: catType,
        actor_name: currentUserName,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense_categories'] });
      showToast('✨ تم إضافة نوع المصروف الفرعي بنجاح!');
      setCatName('');
    },
    onError: (error) => {
      showToast('❌ فشل إضافة نوع المصروف: ' + error.message, 'error');
    }
  });

  // Mutation حذف نوع مصروف فرعي
  const deleteCategoryMutation = useMutation({
    mutationFn: async (categoryId) => {
      return await pb.collection('expense_categories').delete(categoryId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense_categories'] });
      showToast('🗑️ تم حذف نوع المصروف بنجاح!');
      setDeleteConfirmModal({ show: false, type: '', data: null });
    },
    onError: (error) => {
      showToast('❌ فشل الحذف (قد يكون مرتبطاً بمصروفات مسجلة): ' + error.message, 'error');
      setDeleteConfirmModal({ show: false, type: '', data: null });
    }
  });

  // Mutation تسجيل مصروف جديد (مع التعديل الآمن لتحديث الرصيد)
  const addExpenseMutation = useMutation({
    mutationFn: async () => {
      const expenseAmount = parseFloat(amount);
      if (isNaN(expenseAmount) || expenseAmount <= 0) {
        throw new Error('الرجاء إدخال مبلغ صحيح.');
      }

      const isTreasury = paymentSource === 'treasury';

      const expenseData = {
        category_id: selectedCategory,
        amount: expenseAmount,
        notes: notes.trim(),
        date: date,
        payment_source: isTreasury ? 'treasury' : 'bank',
        bank_id: isTreasury ? '' : paymentSource,
        actor_name: currentUserName,
      };

      const newExpense = await pb.collection('expenses').create(expenseData);

      if (isTreasury) {
        if (treasury) {
          const currentBalance = Number(treasury.balance || 0);
          const newBalance = currentBalance - expenseAmount;
          await pb.collection('treasury').update(treasury.id, { balance: newBalance });
        } else {
          // إذا لم يكن سجل الخزنة موجوداً، ننشئه بالرصيد بالسالب
          await pb.collection('treasury').create({ balance: -expenseAmount, opening_balance: 0 });
        }
      } else {
        const targetBank = banks.find(b => b.id === paymentSource);
        if (targetBank) {
          const currentBankBalance = Number(targetBank.balance || 0);
          const newBankBalance = currentBankBalance - expenseAmount;
          await pb.collection('banks').update(targetBank.id, { balance: newBankBalance });
        } else {
          throw new Error('البنك المختار غير موجود.');
        }
      }

      return newExpense;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['treasury'] });
      queryClient.invalidateQueries({ queryKey: ['banks'] });
      showToast('🚀 تم تسجيل المصروف وخصمه من مصدر الدفع بنجاح!');
      setAmount('');
      setNotes('');
      setSelectedCategory('');
      setPaymentSource('treasury');
    },
    onError: (error) => {
      showToast('❌ خطأ: ' + error.message, 'error');
    }
  });

  // Mutation حذف مصروف وإرجاع قيمته للمصدر الأصلي (تم تصحيح المنطق تماماً هنا)
  const deleteExpenseMutation = useMutation({
    mutationFn: async (expenseObj) => {
      const expenseAmount = Number(expenseObj.amount || 0);
      const isBankPayment = expenseObj.payment_source === 'bank' || Boolean(expenseObj.bank_id);
      const bankId = typeof expenseObj.bank_id === 'string' ? expenseObj.bank_id : expenseObj.bank_id?.id;

      // 1. حذف المصروف من جدول expenses أولاً
      await pb.collection('expenses').delete(expenseObj.id);

      // 2. إرجاع المبلغ للمصدر الصحيح (بنك أو خزنة)
      if (isBankPayment && bankId) {
        const targetBank = banks.find(b => b.id === bankId);
        if (targetBank) {
          const restoredBalance = Number(targetBank.balance || 0) + expenseAmount;
          await pb.collection('banks').update(targetBank.id, { balance: restoredBalance });
        }
      } else {
        // إذا لم يكن بنك إذن فهو خزنة رئيسية
        if (treasury) {
          const currentBalance = Number(treasury.balance || 0);
          const restoredBalance = currentBalance + expenseAmount;
          await pb.collection('treasury').update(treasury.id, { balance: restoredBalance });
        } else {
          await pb.collection('treasury').create({ balance: expenseAmount, opening_balance: 0 });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['treasury'] });
      queryClient.invalidateQueries({ queryKey: ['banks'] });
      showToast('🗑️ تم حذف المصروف وإرجاع المبلغ إلى مصدره بنجاح!');
      setDeleteConfirmModal({ show: false, type: '', data: null });
    },
    onError: (error) => {
      showToast('❌ فشل الحذف: ' + error.message, 'error');
      setDeleteConfirmModal({ show: false, type: '', data: null });
    }
  });

  function handleCategorySubmit(e) {
    e.preventDefault();
    if (!catName.trim()) {
      showToast('⚠️ الرجاء إدخال اسم المصروف الفرعي', 'error');
      return;
    }
    addCategoryMutation.mutate();
  }

  function handleExpenseSubmit(e) {
    e.preventDefault();
    if (!selectedCategory || !amount) {
      showToast('⚠️ الرجاء اختيار نوع المصروف وإدخال المبلغ', 'error');
      return;
    }
    addExpenseMutation.mutate();
  }

  const filteredExpenses = expenses.filter((exp) => {
    const catInfo = exp.expand?.category_id;
    const catTypeName = catInfo?.type || '';
    const catNameStr = catInfo?.name || '';
    const notesStr = exp.notes || '';

    if (filterType !== 'all' && catTypeName !== filterType) return false;

    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      const matchName = catNameStr.toLowerCase().includes(q);
      const matchNotes = notesStr.toLowerCase().includes(q);
      if (!matchName && !matchNotes) return false;
    }

    if (startDate && exp.date < startDate) return false;
    if (endDate && exp.date > endDate) return false;

    return true;
  });

  const cashExpensesTotal = expenses.reduce((sum, expense) => {
    const bankId = String(expense.bank_id || '').trim().toLowerCase();
    const bankName = String(expense.bank || '').trim().toLowerCase();
    const notesValue = String(expense.notes || '').toLowerCase();
    const isBankExpense = (bankId && bankId !== 'treasury' && bankId !== 'الخزنة') || (bankName && !bankName.includes('خزن')) || notesValue.includes('بنك') || notesValue.includes('visa');
    return isBankExpense ? sum : sum + Number(expense.amount || 0);
  }, 0);

  const cashClientPayments = clientTransactions
    .filter(transaction => ['treasury', 'خزنة', 'كاش', ''].includes(String(transaction.destination || '')) && !String(transaction.type || '').toLowerCase().includes('open'))
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

  const cashSupplierPayments = supplierTransactions
    .filter(transaction => ['treasury', 'خزنة', 'كاش', ''].includes(String(transaction.destination || '')) && !String(transaction.type || '').toLowerCase().includes('open'))
    .reduce((sum, transaction) => sum - Number(transaction.amount || 0), 0);

  const cashSales = salesInvoices.reduce((sum, invoice) => {
    const paymentType = String(invoice.payment_type || invoice.payment_method || invoice.type || '').toLowerCase();
    const isCash = paymentType.includes('cash') || paymentType.includes('كاش') || paymentType.includes('نقدي') || paymentType === '';
    return isCash ? sum + Number(invoice.total_amount || invoice.amount || 0) : sum;
  }, 0);

  const cashAdvances = employeeAdvances.reduce((sum, advance) => sum - Number(advance.amount || 0), 0);
  const cashSalaries = salariesPayouts.reduce((sum, salary) => sum - Number(salary.amount || salary.total_amount || salary.net_salary || 0), 0);
  const treasurySalaryTransactions = treasuryRecords
    .filter(record => String(record.type || '').toLowerCase().includes('مرتبات'))
    .reduce((sum, record) => sum - Number(record.amount || 0), 0);
  const treasuryMovementTotal = treasuryTransactions.reduce((sum, transaction) => {
    const movementType = String(transaction.movement_type || '').toLowerCase();
    const sourceType = String(transaction.source_type || 'treasury');
    if (movementType === 'salary' || (sourceType === 'treasury' && movementType === 'other_advance')) return sum - Number(transaction.amount || 0);
    if (sourceType === 'treasury' && movementType === 'other_advance_return') return sum + Number(transaction.amount || 0);
    if (sourceType === 'treasury' && movementType === 'bank_deposit') return sum - Number(transaction.amount || 0);
    return sum;
  }, 0);

  const currentTreasuryBalance = (treasury ? Number(treasury.opening_balance || 0) : 0) + cashClientPayments + cashSupplierPayments + cashSales + cashExpensesTotal * -1 + cashAdvances + cashSalaries + treasurySalaryTransactions + treasuryMovementTotal;
  const totalBanksBalance = banks.reduce((sum, b) => sum + Number(b.balance || 0), 0);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 relative" dir="rtl">
      
      {/* Toast Notification */}
      {toast.show && (
        <div className={`fixed top-5 left-5 z-50 px-5 py-3 rounded-2xl shadow-2xl text-white font-bold text-sm flex items-center gap-3 transition-all animate-bounce ${
          toast.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
        }`}>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Custom Confirmation Modal */}
      {deleteConfirmModal.show && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white p-6 rounded-3xl shadow-2xl max-w-md w-full space-y-4 text-center">
            <h3 className="text-lg font-black text-gray-800">⚠️ تأكيد الحذف</h3>
            <p className="text-xs font-bold text-gray-600">
              {deleteConfirmModal.type === 'category'
                ? `هل أنت متأكد من حذف نوع المصروف "${deleteConfirmModal.data?.name}"؟`
                : 'هل أنت متأكد من حذف هذا المصروف وإرجاع قيمته لمصدره الأصلي؟'}
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (deleteConfirmModal.type === 'category') {
                    deleteCategoryMutation.mutate(deleteConfirmModal.data.id);
                  } else {
                    deleteExpenseMutation.mutate(deleteConfirmModal.data);
                  }
                }}
                disabled={deleteCategoryMutation.isPending || deleteExpenseMutation.isPending}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-2xl font-bold text-xs transition"
              >
                تأكيد الحذف
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirmModal({ show: false, type: '', data: null })}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-2xl font-bold text-xs transition"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      <h1 className="text-2xl md:text-3xl font-black text-gray-800">إدارة المصروفات والخزنة والبنوك</h1>

      {/* الكارتات العلوية */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className={`p-6 rounded-3xl shadow-xl flex flex-col justify-between text-white ${
          currentTreasuryBalance < 0 ? 'bg-red-600' : 'bg-blue-600'
        }`}>
          <h2 className="text-xs font-bold opacity-80 uppercase tracking-wider">رصيد الخزنة الحالي</h2>
          <p className="text-3xl font-black mt-2">{currentTreasuryBalance.toLocaleString()} ج.م</p>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-xl border border-gray-100 flex flex-col justify-between">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">إجمالي أرصدة البنوك</h2>
          <p className="text-3xl font-black text-emerald-600 mt-2">{totalBanksBalance.toLocaleString()} ج.م</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* قسم إضافة وإدارة أنواع المصروفات الفرعية */}
        <div className="bg-white p-6 rounded-3xl shadow-xl border border-gray-100 space-y-6">
          <div className="space-y-4">
            <h2 className="text-base font-black text-gray-800 border-b pb-3">➕ إضافة نوع مصروف فرعي جديد</h2>
            <form onSubmit={handleCategorySubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700">اسم المصروف الفرعي (مثال: إيجار، كهرباء...)</label>
                <input
                  type="text"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="اسم المصروف..."
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-3 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700">التصنيف الرئيسي</label>
                <select
                  value={catType}
                  onChange={(e) => setCatType(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-3 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="operational">⚙️ مصروفات تشغيلية (Operational)</option>
                  <option value="non_operational">📊 مصروفات غير تشغيلية (Non-Operational)</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={addCategoryMutation.isPending}
                className="w-full bg-gray-900 hover:bg-gray-800 text-white py-3 rounded-2xl font-bold text-xs transition shadow-md"
              >
                {addCategoryMutation.isPending ? 'جاري الحفظ...' : 'حفظ النوع الفرعي'}
              </button>
            </form>
          </div>

          {/* قائمة عرض أنواع المصروفات مع زر الحذف الآمن */}
          <div className="space-y-3 pt-4 border-t border-gray-100">
            <h3 className="text-sm font-black text-gray-800">📂 أنواع المصروفات المسجلة</h3>
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
              {categories.map((cat) => (
                <div key={cat.id} className="flex justify-between items-center bg-gray-50 p-3 rounded-2xl border border-gray-200">
                  <div>
                    <span className="font-bold text-xs text-gray-900">{cat.name}</span>
                    <span className={`mr-2 px-2 py-0.5 rounded-lg text-[9px] font-bold ${
                      cat.type === 'operational' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {cat.type === 'operational' ? 'تشغيلية' : 'غير تشغيلية'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmModal({ show: true, type: 'category', data: cat })}
                    className="bg-red-50 hover:bg-red-600 text-red-600 hover:text-white px-2.5 py-1 rounded-xl text-[10px] font-bold transition"
                  >
                    حذف
                  </button>
                </div>
              ))}
              {categories.length === 0 && (
                <p className="text-center text-xs text-gray-400 py-2">لا توجد أنواع مصروفات مسجلة.</p>
              )}
            </div>
          </div>
        </div>

        {/* قسم تسجيل مصروف جديد */}
        <div className="bg-white p-6 rounded-3xl shadow-xl border border-gray-100 space-y-4">
          <h2 className="text-base font-black text-gray-800 border-b pb-3">💸 تسجيل مصروف جديد (مع السداد)</h2>
          <form onSubmit={handleExpenseSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700">اختر المصروف الفرعي</label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-3 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">-- اختر التصنيف الفرعي --</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name} ({cat.type === 'operational' ? 'تشغيلية' : 'غير تشغيلية'})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700">المبلغ (ج.م)</label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-3 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700">التاريخ</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-3 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* اختيار مصدر السداد (الخزنة أو البنوك) */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700">مصدر السداد (يخصم منه)</label>
              <select
                value={paymentSource}
                onChange={(e) => setPaymentSource(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-3 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="treasury">🏛️ الخزنة الرئيسية (الرصيد: {currentTreasuryBalance.toLocaleString()} ج.م)</option>
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    💳 بنك: {bank.name} (الرصيد: {Number(bank.balance || 0).toLocaleString()} ج.م)
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700">ملاحظات أو بيان (اختياري)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="تفاصيل إضافية للمصروف..."
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-3 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={addExpenseMutation.isPending}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-2xl font-black text-xs transition shadow-lg shadow-blue-600/20"
            >
              {addExpenseMutation.isPending ? 'جاري الخصم والحفظ...' : 'حفظ المصروف وخصمه من المصدر'}
            </button>
          </form>
        </div>

      </div>

      {/* قسم الفلاتر والبحث المتقدم */}
      <div className="bg-white p-6 rounded-3xl shadow-xl border border-gray-100 space-y-4">
        <h2 className="text-base font-black text-gray-800 border-b pb-3">🔍 تصفية وبحث في سجل المصروفات</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="space-y-1.5 md:col-span-1">
            <label className="text-xs font-bold text-gray-700">نوع المصروف</label>
            <div className="flex bg-gray-50 p-1 rounded-2xl border border-gray-200">
              <button
                type="button"
                onClick={() => setFilterType('all')}
                className={`flex-1 py-2 text-[11px] font-bold rounded-xl transition ${filterType === 'all' ? 'bg-gray-900 text-white shadow' : 'text-gray-600 hover:bg-gray-200'}`}
              >
                الكل
              </button>
              <button
                type="button"
                onClick={() => setFilterType('operational')}
                className={`flex-1 py-2 text-[11px] font-bold rounded-xl transition ${filterType === 'operational' ? 'bg-emerald-600 text-white shadow' : 'text-gray-600 hover:bg-gray-200'}`}
              >
                تشغيلية
              </button>
              <button
                type="button"
                onClick={() => setFilterType('non_operational')}
                className={`flex-1 py-2 text-[11px] font-bold rounded-xl transition ${filterType === 'non_operational' ? 'bg-amber-600 text-white shadow' : 'text-gray-600 hover:bg-gray-200'}`}
              >
                غير تشغيلية
              </button>
            </div>
          </div>

          <div className="space-y-1.5 md:col-span-1">
            <label className="text-xs font-bold text-gray-700">بحث بالاسم أو الملاحظات</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="اكتب للبحث..."
              className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-3 text-xs font-bold text-gray-800 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-700">من تاريخ</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-3 text-xs font-bold text-gray-800 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-700">إلى تاريخ</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-3 text-xs font-bold text-gray-800 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* جدول سجل المصروفات */}
      <div className="bg-white p-6 rounded-3xl shadow-xl border border-gray-100 space-y-4">
        <div className="flex justify-between items-center border-b pb-3">
          <h2 className="text-base font-black text-gray-800">📋 سجل المصروفات</h2>
          <span className="text-xs font-bold bg-gray-100 px-3 py-1 rounded-xl text-gray-600">
            عدد النتائج: {filteredExpenses.length}
          </span>
        </div>

        <div className="border border-gray-200 rounded-2xl overflow-hidden">
          <table className="w-full text-right text-xs">
            <thead className="bg-gray-100 text-gray-600">
              <tr>
                <th className="p-3">التاريخ</th>
                <th className="p-3">المصروف الفرعي</th>
                <th className="p-3">النوع الرئيسي</th>
                <th className="p-3">مصدر السداد</th>
                <th className="p-3">المبلغ</th>
                <th className="p-3">ملاحظات</th>
                <th className="p-3">بواسطة</th>
                <th className="p-3 text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredExpenses.map((exp) => {
                const catInfo = exp.expand?.category_id;
                const isOperational = catInfo?.type === 'operational';
                const bankId = typeof exp.bank_id === 'string' ? exp.bank_id : exp.bank_id?.id;
                const isBankPayment = Boolean(bankId) || exp.payment_source === 'bank';
                const targetBank = isBankPayment ? (exp.expand?.bank_id || banks.find(b => b.id === bankId)) : null;

                return (
                  <tr key={exp.id} className="hover:bg-gray-50/50 transition">
                    <td className="p-3 text-gray-600">{exp.date}</td>
                    <td className="p-3 font-bold text-gray-900">{catInfo?.name || 'مصروف محذوف'}</td>
                    <td className="p-3">
                      <span className={`px-2.5 py-1 rounded-xl text-[10px] font-bold ${
                        isOperational ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {isOperational ? '⚙️ تشغيلية' : '📊 غير تشغيلية'}
                      </span>
                    </td>
                    <td className="p-3 font-bold text-gray-700">
                      {isBankPayment ? `💳 بنك: ${targetBank?.name || 'بنك محذوف'}` : '🏛️ الخزنة الرئيسية'}
                    </td>
                    <td className="p-3 font-black text-red-600">- {Number(exp.amount || 0).toLocaleString()} ج.م</td>
                    <td className="p-3 text-gray-500">{exp.notes || '-'}</td>
                    <td className="p-3 font-bold text-gray-700">{exp.actor_name || 'غير معروف'}</td>
                    <td className="p-3 text-center">
                      <button
                        onClick={() => setDeleteConfirmModal({ show: true, type: 'expense', data: exp })}
                        className="bg-red-50 hover:bg-red-600 text-red-600 hover:text-white px-3 py-1.5 rounded-xl font-bold text-[11px] transition shadow-sm"
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredExpenses.length === 0 && (
                <tr>
                  <td colSpan="8" className="p-6 text-center text-gray-400">لا توجد مصروفات تطابق خيارات البحث والفلترة.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}