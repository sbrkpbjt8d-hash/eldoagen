'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';

export default function TreasuryPage() {
  const queryClient = useQueryClient();

  const [openingBalanceInput, setOpeningBalanceInput] = useState('');
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [confirmation, setConfirmation] = useState(null);

  // حالات فلترة السجل بالتاريخ
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const currentUser = pb.authStore.model;
  const isAdmin = currentUser?.role === 'admin' || currentUser?.isAdmin === true || currentUser?.email === 'mohamedfrf@icloud.com'; 

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 4500);
  };

  const requestConfirmation = (message) => new Promise((resolve) => {
    setConfirmation({ message, resolve });
  });

  const closeConfirmation = (value) => {
    confirmation?.resolve(value);
    setConfirmation(null);
  };

  // 1. جلب بيانات الخزنة (للرصيد الافتتاحي فقط)
  const { data: treasuryRecords = [] } = useQuery({
    queryKey: ['treasury'],
    queryFn: async () => {
      return await pb.collection('treasury').getFullList().catch(() => []);
    },
  });
  const treasury = treasuryRecords.find((record) => Object.prototype.hasOwnProperty.call(record, 'opening_balance')) || null;
  const openingBalance = treasury ? Number(treasury.opening_balance || 0) : 0;

  // 2. جلب المصروفات
  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses'],
    queryFn: async () => {
      return await pb.collection('expenses').getFullList({
        sort: '-created',
        expand: 'category_id',
      }).catch(() => []);
    },
  });

  // 3. جلب جدول العملاء (clientsmoashe) بالكامل
  const { data: clientsList = [] } = useQuery({
    queryKey: ['clientsmoashe'],
    queryFn: async () => {
      return await pb.collection('clientsmoashe').getFullList().catch(() => []);
    },
  });

  // 4. جلب حركات العملاء النقدية الفعلية
  const { data: clientTransactions = [] } = useQuery({
    queryKey: ['client_transactions_treasury'],
    queryFn: async () => {
      return await pb.collection('client_transactions').getFullList({
        filter: '(destination = "treasury" || destination = "خزنة" || destination = "كاش" || destination = "") && type != "opening_balance" && type != "opening"',
        expand: 'client_id,clientsmoashe,client',
      }).catch(() => []);
    },
  });

  // 5. جلب حركات الموردين النقدية
  const { data: supplierTransactions = [] } = useQuery({
    queryKey: ['supplier_transactions_treasury'],
    queryFn: async () => {
      return await pb.collection('supplier_transactions').getFullList({
        filter: '(destination = "treasury" || destination = "خزنة" || destination = "كاش" || destination = "") && type != "opening_balance" && type != "opening"',
        expand: 'supplier_id',
      }).catch(() => []);
    },
  });

  // 6. جلب فواتير البيع
  const { data: salesInvoices = [] } = useQuery({
    queryKey: ['sales_invoices_treasury'],
    queryFn: async () => {
      return await pb.collection('sales_invoices').getFullList().catch(() => []);
    },
  });

  // 7. جلب سلف الموظفين لتأثيرها على الخزنة
  const { data: employeeAdvances = [] } = useQuery({
    queryKey: ['advances_treasury'],
    queryFn: async () => {
      return await pb.collection('advances').getFullList({
        expand: 'employee_id',
      }).catch(() => []);
    },
  });

  // 8. جلب صرف المرتبات لتأثيرها على الخزنة
  const { data: salariesPayouts = [] } = useQuery({
    queryKey: ['salaries_payouts_treasury'],
    queryFn: async () => {
      return await pb.collection('salaries_payouts').getFullList({
        expand: 'employee_id',
      }).catch(() => []);
    },
  });
  const { data: treasuryTransactions = [] } = useQuery({
    queryKey: ['treasury_transactions_treasury'],
    queryFn: async () => {
      return await pb.collection('treasury_transactions').getFullList().catch(() => []);
    },
  });

  // Mutation لحفظ الرصيد الافتتاحي
  const saveOpeningBalanceMutation = useMutation({
    mutationFn: async () => {
      if (!isAdmin) {
        throw new Error('عذراً، غير مسموح لك بتعديل الرصيد الافتتاحي. هذه الصلاحية للأدمن فقط.');
      }

      const val = parseFloat(openingBalanceInput);
      if (isNaN(val)) throw new Error('الرصيد الافتتاحي غير صالح');

      if (treasury) {
        return await pb.collection('treasury').update(treasury.id, {
          opening_balance: val,
        });
      } else {
        return await pb.collection('treasury').create({
          opening_balance: val,
          balance: val,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['treasury'] });
      showToast('✨ تم حفظ الرصيد الافتتاحي بنجاح!');
    },
    onError: (err) => showToast('❌ خطأ: ' + err.message, 'error'),
  });

  // Mutation لحذف أي حركة معلقة للأدمن فقط
  const deleteTransactionMutation = useMutation({
    mutationFn: async ({ id, collectionName }) => {
      if (!isAdmin) {
        throw new Error('عذراً، هذه الصلاحية للأدمن فقط.');
      }
      return await pb.collection(collectionName).delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['client_transactions_treasury'] });
      queryClient.invalidateQueries({ queryKey: ['supplier_transactions_treasury'] });
      queryClient.invalidateQueries({ queryKey: ['sales_invoices_treasury'] });
      queryClient.invalidateQueries({ queryKey: ['advances_treasury'] });
      queryClient.invalidateQueries({ queryKey: ['salaries_payouts_treasury'] });
      queryClient.invalidateQueries({ queryKey: ['treasury_transactions_treasury'] });
      queryClient.invalidateQueries({ queryKey: ['treasury'] });
      showToast('🗑️ تم حذف الحركة بنجاح وتحديث الرصيد!');
    },
    onError: (err) => showToast('❌ فشل الحذف: ' + err.message, 'error'),
  });

  // تصفية المصروفات
  const formattedExpenses = expenses
    .filter(exp => {
      const itemBankId = String(exp.bank_id || '').trim().toLowerCase();
      const itemBank = String(exp.bank || '').trim().toLowerCase();
      const itemNotes = String(exp.notes || '').toLowerCase();
      const categoryName = String(exp.expand?.category_id?.name || '').toLowerCase();

      const isBankExpense = itemBankId !== '' && itemBankId !== 'null' && itemBankId !== 'treasury' && itemBankId !== 'الخزنة';
      const isBankNamed = itemBank !== '' && itemBank !== 'null' && !itemBank.includes('خزن');
      const isBankNote = itemNotes.includes('بنك') || itemNotes.includes('تحويل بنكي') || itemNotes.includes('visa');
      const isBankCategory = categoryName.includes('بنك');

      if (isBankExpense || isBankNamed || isBankNote || isBankCategory) {
        return false;
      }

      const expDate = String(exp.date || exp.created || '').slice(0, 10);
      if (startDate && expDate < startDate) return false;
      if (endDate && expDate > endDate) return false;

      return true;
    })
    .map(exp => ({
      id: exp.id,
      collection: 'expenses',
      date: exp.created || exp.date,
      movementType: 'expense',
      title: exp.expand?.category_id?.name || 'مصروف خزن عام',
      amount: Number(exp.amount || 0),
      signedAmount: -Number(exp.amount || 0),
      notes: exp.notes || '-',
      actor: exp.actor_name || 'غير معروف',
    }));

  // تجهيز تحصيلات العملاء
  const formattedClientPayments = clientTransactions
    .filter(tx => {
      const isOpening = String(tx.type || '').toLowerCase().includes('open') || String(tx.notes || '').toLowerCase().includes('افتتاحي');
      if (isOpening) return false;

      const txDate = String(tx.date || tx.created || '').slice(0, 10);
      if (startDate && txDate < startDate) return false;
      if (endDate && txDate > endDate) return false;

      return true;
    })
    .map(tx => {
      const expandedClient = tx.expand?.client_id || tx.expand?.clientsmoashe || tx.expand?.client;
      
      const clientName = 
        expandedClient?.name || 
        expandedClient?.full_name || 
        tx.client_name || 
        tx.clientName || 
        tx.name || 
        (clientsList.find(c => c.id === tx.client_id || c.id === tx.client || c.id === tx.clientsmoashe))?.name || 
        'عميل غير معروف';

      return {
        id: tx.id,
        collection: 'client_transactions',
        date: tx.date || tx.created,
        movementType: 'client_payment',
        title: `تحصيل نقدي من عميل: ${clientName}`,
        amount: Number(tx.amount || 0),
        signedAmount: Number(tx.amount || 0),
        notes: tx.notes || '-',
        actor: tx.actor_name || 'غير معروف',
      };
    });

  // تجهيز مدفوعات الموردين
  const formattedSupplierPayments = supplierTransactions
    .filter(tx => {
      const isOpening = String(tx.type || '').toLowerCase().includes('open') || String(tx.notes || '').toLowerCase().includes('افتتاحي');
      if (isOpening) return false;

      const txDate = String(tx.date || tx.created || '').slice(0, 10);
      if (startDate && txDate < startDate) return false;
      if (endDate && txDate > endDate) return false;

      return true;
    })
    .map(tx => {
      const supplierObj = tx.expand?.supplier_id;
      const supplierName = supplierObj?.name || supplierObj?.full_name || supplierObj?.supplier_name || tx.supplier_name || 'مورد غير معروف';

      return {
        id: tx.id,
        collection: 'supplier_transactions',
        date: tx.date || tx.created,
        movementType: 'supplier_payment',
        title: `سداد نقدي لمورد: ${supplierName}`,
        amount: Number(tx.amount || 0),
        signedAmount: -Number(tx.amount || 0),
        notes: tx.notes || '-',
        actor: tx.actor_name || 'غير معروف',
      };
    });

  // تجهيز فواتير البيع الكاش
  const formattedSalesInvoices = salesInvoices
    .filter(inv => {
      const paymentType = String(inv.payment_type || inv.payment_method || inv.type || '').toLowerCase();
      const isCash = paymentType.includes('cash') || paymentType.includes('كاش') || paymentType.includes('نقدي') || paymentType === '';
      
      if (!isCash) return false;

      const invDate = String(inv.date || inv.created || '').slice(0, 10);
      if (startDate && invDate < startDate) return false;
      if (endDate && invDate > endDate) return false;

      return true;
    })
    .map(inv => {
      const customerName = inv.customer_name || inv.client_name || 'عميل نقدي';

      return {
        id: inv.id,
        collection: 'sales_invoices',
        date: inv.date || inv.created,
        movementType: 'sales_invoice',
        title: `فاتورة بيع كاش: ${customerName}`,
        amount: Number(inv.total_amount || inv.amount || 0),
        signedAmount: Number(inv.total_amount || inv.amount || 0),
        notes: inv.notes || 'مبيعات كاش',
        actor: inv.actor_name || 'غير معروف',
      };
    });

  // تجهيز سلف الموظفين
  const formattedAdvances = employeeAdvances
    .filter(adv => {
      const advDate = String(adv.date || adv.created || '').slice(0, 10);
      if (startDate && advDate < startDate) return false;
      if (endDate && advDate > endDate) return false;
      return true;
    })
    .map(adv => {
      const empName = adv.expand?.employee_id?.name || 'موظف';
      return {
        id: adv.id,
        collection: 'advances',
        date: adv.date || adv.created,
        movementType: 'employee_advance',
        title: `صرف سلفة موظف: ${empName}`,
        amount: Number(adv.amount || 0),
        signedAmount: -Number(adv.amount || 0),
        notes: adv.notes || 'سلفة نقدية',
        actor: adv.actor_name || 'غير معروف',
      };
    });

  // تجهيز صرف المرتبات
  const formattedSalaries = salariesPayouts
    .filter(sal => {
      const salDate = String(sal.date || sal.created || '').slice(0, 10);
      if (startDate && salDate < startDate) return false;
      if (endDate && salDate > endDate) return false;
      return true;
    })
    .map(sal => {
      const empName = sal.expand?.employee_id?.name || sal.employee_name || 'موظف';
      const payoutAmount = Number(sal.amount || sal.total_amount || sal.net_salary || 0);

      return {
        id: sal.id,
        collection: 'salaries_payouts',
        date: sal.date || sal.created,
        movementType: 'salary_payout',
        title: `صرف مرتب: ${empName}`,
        amount: payoutAmount,
        signedAmount: -payoutAmount,
        notes: sal.notes || sal.description || 'مرتبات',
        actor: sal.actor_name || 'غير معروف',
      };
    });

  // صرف المرتبات المسجل في مجموعة treasury عند عدم وجود مجموعة مستقلة للمرتبات
  const formattedTreasurySalaries = treasuryRecords
    .filter(record => String(record.type || '').toLowerCase().includes('مرتبات'))
    .filter(record => {
      const salaryDate = String(record.date || record.created || '').slice(0, 10);
      if (startDate && salaryDate < startDate) return false;
      if (endDate && salaryDate > endDate) return false;
      return true;
    })
    .map(record => ({
      id: record.id,
      collection: 'treasury',
      date: record.date || record.created,
      movementType: 'salary_payout',
      title: record.description || 'صرف مرتب',
      amount: Number(record.amount || 0),
      signedAmount: -Number(record.amount || 0),
      notes: record.notes || 'مرتبات',
      actor: record.actor_name || 'غير معروف',
    }));

  const formattedTreasuryTransactionSalaries = treasuryTransactions
    .filter(transaction => String(transaction.type || '').toLowerCase() === 'salary')
    .filter(transaction => {
      const salaryDate = String(transaction.date || transaction.created || '').slice(0, 10);
      if (startDate && salaryDate < startDate) return false;
      if (endDate && salaryDate > endDate) return false;
      return true;
    })
    .map(transaction => ({
      id: transaction.id,
      collection: 'treasury_transactions',
      date: transaction.date || transaction.created,
      movementType: 'salary_payout',
      title: transaction.title || 'صرف مرتب',
      amount: Number(transaction.amount || 0),
      signedAmount: -Number(transaction.amount || 0),
      notes: transaction.notes || 'مرتبات',
      actor: transaction.actor_name || 'غير معروف',
    }));

  const formattedOtherAdvanceTransactions = treasuryTransactions
    .filter(transaction => ['other_advance', 'other_advance_return'].includes(String(transaction.movement_type || '').toLowerCase()))
    .filter(transaction => String(transaction.source_type || 'treasury') === 'treasury')
    .filter(transaction => {
      const transactionDate = String(transaction.date || transaction.created || '').slice(0, 10);
      if (startDate && transactionDate < startDate) return false;
      if (endDate && transactionDate > endDate) return false;
      return true;
    })
    .map(transaction => {
      const isReturn = String(transaction.movement_type || '').toLowerCase() === 'other_advance_return';
      return {
        id: transaction.id,
        collection: 'treasury_transactions',
        date: transaction.date || transaction.created,
        movementType: isReturn ? 'other_advance_return' : 'other_advance',
        title: transaction.title || (isReturn ? 'رد عهدة' : 'صرف عهدة'),
        amount: Number(transaction.amount || 0),
        signedAmount: isReturn ? Number(transaction.amount || 0) : -Number(transaction.amount || 0),
        notes: transaction.notes || 'عهدة',
        actor: transaction.actor_name || 'غير معروف',
      };
    });

  // دمج وترتيب الحركات (تصاعدياً أولاً لحساب الرصيد التراكمي بدقة)
  const sortedAscTransactions = [
    ...formattedExpenses,
    ...formattedClientPayments,
    ...formattedSupplierPayments,
    ...formattedSalesInvoices,
    ...formattedAdvances,
    ...formattedSalaries,
    ...formattedTreasurySalaries,
    ...formattedTreasuryTransactionSalaries,
    ...formattedOtherAdvanceTransactions,
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  // حساب الرصيد التراكمي
  const transactionsWithTreasuryBalance = sortedAscTransactions.reduce((transactions, tx) => {
    const previousBalance = transactions.length
      ? transactions[transactions.length - 1].treasuryBalance
      : openingBalance;
    return [
      ...transactions,
      {
        ...tx,
        treasuryBalance: previousBalance + tx.signedAmount,
      },
    ];
  }, []);

  // عكس الترتيب لعرض الأحدث في الأعلى
  const allTransactions = [...transactionsWithTreasuryBalance].reverse();

  // حساب الرصيد الحالي
  const currentBalance = transactionsWithTreasuryBalance.length > 0 
    ? transactionsWithTreasuryBalance[transactionsWithTreasuryBalance.length - 1].treasuryBalance 
    : openingBalance;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-8 relative" dir="rtl">
      
      {toast.show && (
        <div className={`fixed top-5 left-5 z-50 px-5 py-3 rounded-2xl shadow-2xl text-white font-bold text-sm ${
          toast.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
        }`}>
          {toast.message}
        </div>
      )}

      <div className="flex justify-between items-center border-b pb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-gray-800">إدارة الخزنة والنقدية الفعلية</h1>
          <p className="text-xs text-gray-500 mt-1">متابعة النقدية، تحصيلات العملاء، المبيعات، الموردين، المصروفات، السلف، ومرتبات الموظفين</p>
        </div>
        <button onClick={() => { 
          queryClient.invalidateQueries({ queryKey: ['treasury'] }); 
          queryClient.invalidateQueries({ queryKey: ['expenses'] }); 
          queryClient.invalidateQueries({ queryKey: ['client_transactions_treasury'] }); 
          queryClient.invalidateQueries({ queryKey: ['clientsmoashe'] });
          queryClient.invalidateQueries({ queryKey: ['sales_invoices_treasury'] });
          queryClient.invalidateQueries({ queryKey: ['advances_treasury'] });
          queryClient.invalidateQueries({ queryKey: ['salaries_payouts_treasury'] });
          queryClient.invalidateQueries({ queryKey: ['treasury_transactions_treasury'] });
        }} className="bg-gray-100 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold">🔄 تحديث</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className={`p-6 rounded-3xl shadow-xl text-white ${currentBalance < 0 ? 'bg-red-600' : 'bg-blue-600'}`}>
          <h2 className="text-xs font-bold opacity-80 uppercase tracking-wider">إجمالي الرصيد الحالي بالخزنة</h2>
          <p className="text-4xl font-black mt-2">{currentBalance.toLocaleString()} ج.م</p>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-xl border border-gray-100 flex flex-col justify-between">
          <div>
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">الرصيد الافتتاحي للخزنة</h2>
            <p className="text-3xl font-black text-gray-800 mt-1">{openingBalance.toLocaleString()} ج.م</p>
          </div>

          {isAdmin ? (
            <div className="mt-4 flex gap-2">
              <input
                type="number"
                step="0.01"
                value={openingBalanceInput !== '' ? openingBalanceInput : treasury?.opening_balance ?? ''}
                onChange={(e) => setOpeningBalanceInput(e.target.value)}
                placeholder="تعديل الافتتاحي..."
                className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2 text-xs font-bold text-gray-800 focus:outline-none"
              />
              <button
                onClick={() => saveOpeningBalanceMutation.mutate()}
                disabled={saveOpeningBalanceMutation.isPending}
                className="bg-gray-900 text-white px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap hover:bg-gray-800"
              >
                حفظ
              </button>
            </div>
          ) : (
            <div className="mt-4 bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded-xl text-xs font-bold text-center">
              🔒 تعديل الرصيد الافتتاحي متاح لمسؤول النظام (الأدمن) فقط.
            </div>
          )}
        </div>
      </div>

      {/* شريط الفلترة بالتاريخ */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-bold text-gray-700">من تاريخ</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full border border-gray-200 bg-gray-50 p-2.5 rounded-xl text-xs font-bold outline-none mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-700">إلى تاريخ</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full border border-gray-200 bg-gray-50 p-2.5 rounded-xl text-xs font-bold outline-none mt-1"
          />
        </div>
      </div>

      <div className="bg-white p-6 rounded-3xl shadow-xl border border-gray-100 space-y-4">
        <h2 className="text-base font-black text-gray-800 border-b pb-3">📋 سجل الحركات النقدية الفعلية للخزنة</h2>
        <div className="border border-gray-200 rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-gray-100 text-gray-600">
              <tr>
                <th className="p-3">التاريخ</th>
                <th className="p-3">نوع الحركة</th>
                <th className="p-3">البيان / الوصف</th>
                <th className="p-3">المبلغ</th>
                <th className="p-3 bg-emerald-50 text-emerald-900">قيمة الخزنة (بعد الحركة)</th>
                <th className="p-3">ملاحظات</th>
                <th className="p-3">بواسطة</th>
                {isAdmin && <th className="p-3 text-center">إجراءات</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {allTransactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-gray-50 transition">
                  <td className="p-3 text-gray-600">{new Date(tx.date).toLocaleString()}</td>
                  <td className="p-3">
                    {tx.movementType === 'client_payment' ? (
                      <span className="bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-xl text-[10px] font-bold">
                        📥 تحصيل نقدي (+)
                      </span>
                    ) : tx.movementType === 'sales_invoice' ? (
                      <span className="bg-blue-100 text-blue-800 px-2.5 py-1 rounded-xl text-[10px] font-bold">
                        🛒 مبيعات كاش (+)
                      </span>
                    ) : tx.movementType === 'supplier_payment' ? (
                      <span className="bg-amber-100 text-amber-800 px-2.5 py-1 rounded-xl text-[10px] font-bold">
                        📤 سداد لمورد (-)
                      </span>
                    ) : tx.movementType === 'employee_advance' ? (
                      <span className="bg-purple-100 text-purple-800 px-2.5 py-1 rounded-xl text-[10px] font-bold">
                        💸 سلفة موظف (-)
                      </span>
                    ) : tx.movementType === 'salary_payout' ? (
                      <span className="bg-indigo-100 text-indigo-800 px-2.5 py-1 rounded-xl text-[10px] font-bold">
                        💰 صرف مرتبات (-)
                      </span>
                    ) : tx.movementType === 'other_advance_return' ? (
                      <span className="bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-xl text-[10px] font-bold">
                        ↩️ رد عهدة (+)
                      </span>
                    ) : tx.movementType === 'other_advance' ? (
                      <span className="bg-orange-100 text-orange-800 px-2.5 py-1 rounded-xl text-[10px] font-bold">
                        💼 صرف عهدة (-)
                      </span>
                    ) : (
                      <span className="bg-red-100 text-red-800 px-2.5 py-1 rounded-xl text-[10px] font-bold">
                        💸 مصروف نقدية (-)
                      </span>
                    )}
                  </td>
                  <td className="p-3 font-bold text-gray-900">{tx.title}</td>
                  <td className={`p-3 font-black ${tx.signedAmount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {tx.signedAmount > 0 ? `+ ${tx.amount.toLocaleString()}` : `- ${tx.amount.toLocaleString()}`} ج.م
                  </td>
                  <td className="p-3 font-black text-emerald-800 bg-emerald-50/40">
                    {tx.treasuryBalance.toLocaleString()} ج.م
                  </td>
                  <td className="p-3 text-gray-500">{tx.notes}</td>
                  <td className="p-3 font-bold text-gray-700">{tx.actor}</td>
                  {isAdmin && (
                    <td className="p-3 text-center">
                      <button
                        onClick={async () => {
                          const confirmed = await requestConfirmation('هل أنت متأكد من حذف هذه الحركة نهائياً وتحديث رصيد الخزنة؟');
                          if (confirmed) deleteTransactionMutation.mutate({ id: tx.id, collectionName: tx.collection });
                        }}
                        className="bg-red-50 text-red-600 hover:bg-red-600 hover:text-white px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition"
                        title="حذف الحركة"
                      >
                        🗑️ حذف
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {allTransactions.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} className="p-8 text-center text-gray-400 font-bold">لا توجد حركات نقدية مسجلة للخزنة في الفترة المحددة.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {confirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" dir="rtl">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <p className="mb-1 text-xs font-bold text-emerald-600">تأكيد العملية</p>
            <h2 className="mb-3 text-lg font-black text-slate-900">حذف حركة الخزنة</h2>
            <p className="mb-5 text-sm leading-6 text-slate-600">{confirmation.message}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => closeConfirmation(true)} className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white hover:bg-red-700">حذف الحركة</button>
              <button type="button" onClick={() => closeConfirmation(false)} className="flex-1 rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-200">إلغاء</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}