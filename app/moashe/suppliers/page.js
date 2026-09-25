'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [feedback, setFeedback] = useState({ text: '', type: '' });
  const [form, setForm] = useState({ name: '', phone: '', address: '', notes: '', balance: '' });
  const [editingId, setEditingId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  
  const [paymentModal, setPaymentModal] = useState({ open: false, supplier: null });
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentDestination, setPaymentDestination] = useState('treasury');
  const [paymentBankId, setPaymentBankId] = useState('');

  // نافذة تسوية حساب المورد
  const [settlementModal, setSettlementModal] = useState({ open: false, supplier: null });
  const [settlementAmount, setSettlementAmount] = useState('');
  const [settlementType, setSettlementType] = useState('minus'); // minus لخفض المستحق، plus لزيادة المستحق
  const [settlementNotes, setSettlementNotes] = useState('');

  const [statementModal, setStatementModal] = useState({ open: false, supplier: null });
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [deletePaymentId, setDeletePaymentId] = useState(null);

  // فحص صلاحيات الأدمن
  const isAdmin = pb.authStore.model?.collectionName === '_superusers' || pb.authStore.model?.role === 'admin';

  // دالة جلب اسم المستخدم الحالي لتلافي خطأ عدم التعريف
  const currentUserName = () => {
    return pb.authStore.model?.name || pb.authStore.model?.email || 'مسؤول النظام';
  };

  const showFeedback = (text, type = 'success') => {
    setFeedback({ text, type });
    setTimeout(() => setFeedback({ text: '', type: '' }), 4000);
  };

  const { data: suppliers = [], isLoading, isError: suppliersError } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => pb.collection('suppliers').getFullList(),
    retry: 5,
    retryDelay: 500,
  });

  const { data: treasuryRecords = [] } = useQuery({
    queryKey: ['treasury'],
    queryFn: () => pb.collection('treasury').getFullList({ sort: '-updated,-created' }).catch(() => []),
  });
  const sortedTreasuryRecords = [...treasuryRecords].sort((a, b) => new Date(b.updated || b.created || 0) - new Date(a.updated || a.created || 0));
  const treasury = sortedTreasuryRecords.find((record) => Object.prototype.hasOwnProperty.call(record, 'opening_balance')) || sortedTreasuryRecords[0] || null;

  const { data: banks = [] } = useQuery({
    queryKey: ['banks'],
    queryFn: () => pb.collection('banks').getFullList().catch(() => []),
  });

  // جلب كافة فواتير الشراء وحركات الموردين دفعة واحدة لتحسين الأداء وإظهار (آخر فاتورة شراء) و(آخر مرة سداد) في الجدول الرئيسي
  const { data: allTransactions = [] } = useQuery({
    queryKey: ['all_supplier_transactions'],
    queryFn: () => pb.collection('supplier_transactions').getFullList({ sort: '-date,-created' }).catch(() => []),
  });

  const { data: allPurchaseInvoices = [] } = useQuery({
    queryKey: ['all_purchase_invoices'],
    queryFn: () => pb.collection('purchase_invoices').getFullList({ sort: '-created' }).catch(() => []),
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['supplier_transactions', statementModal.supplier?.id],
    enabled: statementModal.open && !!statementModal.supplier?.id,
    queryFn: () => pb.collection('supplier_transactions').getFullList({
      filter: `supplier_id = "${statementModal.supplier.id}"`,
    }).catch(() => []),
  });

  // استعلام جلب فواتير الشراء الخاصة بالمورد المعروض في كشف الحساب
  const { data: purchaseInvoices = [] } = useQuery({
    queryKey: ['purchase_invoices', statementModal.supplier?.id],
    enabled: statementModal.open && !!statementModal.supplier?.id,
    queryFn: () => pb.collection('purchase_invoices').getFullList({
      filter: `supplier_id = "${statementModal.supplier.id}"`,
    }).catch(() => []),
  });




 const saveMutation = useMutation({
    mutationFn: async () => {
      const data = { ...form, name: form.name.trim(), balance: Number(form.balance || 0), actor_name: currentUserName() };
      if (editingId) return pb.collection('suppliers').update(editingId, data);
      const supplier = await pb.collection('suppliers').create(data);
      if (data.balance !== 0) {
        await pb.collection('supplier_transactions').create({
          supplier_id: supplier.id,
          type: 'opening_balance',
          amount: data.balance,
          notes: 'رصيد افتتاحي عند إنشاء المورد',
          date: new Date().toISOString(),
        });
      }
      return supplier;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setForm({ name: '', phone: '', address: '', notes: '', balance: '' });
      setEditingId(null);
      showFeedback(editingId ? 'تم تعديل المورد بنجاح.' : 'تم إضافة المورد بنجاح.');
    },
    onError: (error) => showFeedback(`فشل حفظ المورد: ${error.message}`, 'error'),
  });







  const deleteMutation = useMutation({
    mutationFn: (id) => pb.collection('suppliers').delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setDeleteId(null);
      showFeedback('تم حذف المورد بنجاح.');
    },
    onError: (error) => showFeedback(`فشل حذف المورد: ${error.message}`, 'error'),
  });

  const paymentMutation = useMutation({
    mutationFn: async () => {
      const supplier = paymentModal.supplier;
      const amount = Number(paymentAmount);
      const currentDue = getSupplierDerivedBalance(supplier.id);
      if (paymentDestination === 'banks' && !paymentBankId) {
        throw new Error('اختر البنك الذي سيتم السداد منه');
      }
      await pb.collection('suppliers').update(supplier.id, {
        balance: currentDue - amount,
      });
      await pb.collection('supplier_transactions').create({
        supplier_id: supplier.id,
        type: 'payment',
        amount,
        destination: paymentDestination,
        bank_id: paymentDestination === 'banks' ? paymentBankId : '',
        actor_name: currentUserName(),
        notes: paymentNotes.trim() || 'سداد للمورد',
        date: new Date().toISOString(),
      });

      if (paymentDestination === 'treasury') {
        const currentBalance = Number(treasury?.balance || 0);
        if (treasury) {
          await pb.collection('treasury').update(treasury.id, { balance: currentBalance - amount });
        } else {
          await pb.collection('treasury').create({ balance: -amount, opening_balance: 0 });
        }
      } else {
        const bank = banks.find((item) => item.id === paymentBankId);
        if (!bank) throw new Error('البنك المختار غير موجود');
        await pb.collection('banks').update(bank.id, {
          balance: Number(bank.balance || 0) - amount,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['supplier_transactions'] });
      queryClient.invalidateQueries({ queryKey: ['all_supplier_transactions'] });
      queryClient.invalidateQueries({ queryKey: ['treasury'] });
      queryClient.invalidateQueries({ queryKey: ['banks'] });
      setPaymentModal({ open: false, supplier: null });
      setPaymentAmount('');
      setPaymentNotes('');
      setPaymentDestination('treasury');
      setPaymentBankId('');
      showFeedback('تم تسجيل السداد وتحديث رصيد المورد.');
    },
    onError: (error) => showFeedback(`فشل تسجيل السداد: ${error.message}`, 'error'),
  });

  // تسوية حساب المورد
  const settlementMutation = useMutation({
    mutationFn: async () => {
      const supplier = settlementModal.supplier;
      const amount = Number(settlementAmount);
      const currentBalance = getSupplierDerivedBalance(supplier.id);

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('اكتب مبلغ تسوية صحيح');
      }
      
      const newBalance = settlementType === 'minus'
        ? currentBalance - amount
        : currentBalance + amount;

      const transaction = await pb.collection('supplier_transactions').create({
        supplier_id: supplier.id,
        type: settlementType === 'minus' ? 'payment' : 'opening_balance',
        amount,
        actor_name: currentUserName(),
        notes: `تسوية (${settlementType === 'minus' ? 'خصم/تخفيض مستحق' : 'إضافة/زيادة مستحق'}): ${settlementNotes.trim() || 'تسوية حساب'}`,
        date: new Date().toISOString(),
      });

      try {
        await pb.collection('suppliers').update(supplier.id, {
          balance: newBalance,
        });
      } catch (error) {
        await pb.collection('supplier_transactions').delete(transaction.id).catch(() => {});
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['supplier_transactions'] });
      queryClient.invalidateQueries({ queryKey: ['all_supplier_transactions'] });
      setSettlementModal({ open: false, supplier: null });
      setSettlementAmount('');
      setSettlementNotes('');
      setSettlementType('minus');
      showFeedback('تم إجراء تسوية حساب المورد بنجاح.');
    },
    onError: (error) => showFeedback(`فشل إجراء التسوية: ${error.message}`, 'error'),
  });




  
 const deletePaymentMutation = useMutation({
  mutationFn: async (transactionId) => {
    if (!isAdmin) {
      throw new Error('حذف السداد متاح للأدمن فقط.');
    }

    const transaction = await pb.collection('supplier_transactions').getOne(transactionId);
    if (String(transaction.type || '').toLowerCase() !== 'payment') {
      throw new Error('هذه الحركة ليست سداداً للمورد.');
    }

    const amount = Number(transaction.amount || 0);
    const destination = String(transaction.destination || '').trim();
    const bankId = String(transaction.bank_id || '').trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('مبلغ السداد غير صحيح.');
    }

    // 1. استرجاع المبلغ للخزينة أو البنك أولاً
    if (destination === 'treasury') {
      const treasuryRecords = await pb.collection('treasury').getFullList().catch(() => []);
      const treasuryRecord = treasuryRecords[0] || null;
      if (treasuryRecord) {
        await pb.collection('treasury').update(treasuryRecord.id, {
          balance: Number(treasuryRecord.balance || 0) + amount,
        });
      } else {
        await pb.collection('treasury').create({
          balance: amount,
          opening_balance: 0,
        });
      }
    } else if (destination === 'banks' && bankId) {
      const bank = await pb.collection('banks').getOne(bankId).catch(() => null);
      if (bank) {
        await pb.collection('banks').update(bank.id, {
          balance: Number(bank.balance || 0) + amount,
        });
      }
    }

    // 2. حذف معاملة السداد نهائياً من الجدول
    await pb.collection('supplier_transactions').delete(transactionId);

    // 3. عمل Invalidate للـ Queries عشان الـ State تتحدث والـ UI يحسب الأرصدة الجديدة تلقائياً
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
      queryClient.invalidateQueries({ queryKey: ['supplier_transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['all_supplier_transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['treasury'] }),
      queryClient.invalidateQueries({ queryKey: ['banks'] }),
    ]);

    return transaction;
  },
  onSuccess: () => {
    setDeletePaymentId(null);
    showFeedback('تم حذف السداد واسترجاع رصيد الخزينة/البنك وتحديث الأرصدة بنجاح.');
  },
  onError: (error) => {
    setDeletePaymentId(null);
    showFeedback(`فشل حذف السداد: ${error.message}`, 'error');
  },
});


  // ظظظ

  const formatDisplayDate = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  };

  const getSupplierMovementRows = (supplierId) => {
    const normalizedSupplierId = String(supplierId || '');

    const supplierTransactions = (allTransactions || [])
      .filter((transaction) => String(transaction.supplier_id || '') === normalizedSupplierId)
      .map((transaction) => {
        const type = String(transaction.type || '').toLowerCase();
        const amount = Number(transaction.amount || 0);
        const notes = String(transaction.notes || '');
        const negativeAdjustment = /خصم|تخفيض|مرتجع|cancel/i.test(notes);
        const positiveAdjustment = /إضافة|زيادة|مكافأة|credit/i.test(notes);

        let effect = 0;
        if (type === 'opening_balance') {
          effect = amount;
        } else if (type === 'payment') {
          effect = -amount;
        } else if (negativeAdjustment) {
          effect = -amount;
        } else if (positiveAdjustment) {
          effect = amount;
        } else {
          effect = amount;
        }

        return {
          ...transaction,
          date: transaction.date || transaction.created,
          effectAmount: Number.isFinite(effect) ? effect : 0,
        };
      });

    const supplierPurchases = (allPurchaseInvoices || [])
      .filter((invoice) => String(invoice.supplier_id || '') === normalizedSupplierId)
      .map((invoice) => ({
        ...invoice,
        date: invoice.created || invoice.date,
        effectAmount: Number(invoice.total_amount || invoice.amount || 0),
      }));

    return [...supplierTransactions, ...supplierPurchases]
      .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
      .reduce((acc, row) => {
        const previous = acc.length ? acc[acc.length - 1].runningBalance : 0;
        const runningBalance = previous + Number(row.effectAmount || 0);
        return [...acc, { ...row, runningBalance }];
      }, []);
  };



const getSupplierDerivedBalance = (supplierId) => {
  // 1. هات كل معاملات وسدادات المورد من الـ state العامة
  const supTransactions = (transactionsList || []).filter(t => t.supplier === supplierId || t.supplierId === supplierId);
  // 2. هات كل فواتير الشراء الخاصة بالمورد
  const supPurchases = (purchasesList || []).filter(p => p.supplier === supplierId || p.supplierId === supplierId);

  // 3. هات الرصيد الافتتاحي الأساسي المسجل للمورد من جدول الموردين
  const currentSupplier = (suppliers || []).find((item) => item.id === supplierId);
  const openingBalance = Number(currentSupplier?.balance || 0);

  // 4. ادمج كل الحركات (فواتير + معاملات وسداد وتسويات) مع بعض
  const allRows = [...supTransactions, ...supPurchases];

  // 5. ترتيب الحركات تصاعدياً حسب التاريخ لضمان دقة التراكم
  const sortedRows = allRows.flat().sort((a, b) => 
    new Date(a.date || a.created) - new Date(b.date || b.created)
  );

  // 6. ابدأ الرصيد التراكمي بـ "الرصيد الافتتاحي" مش بـ صفر
  let runningBalance = openingBalance;
  for (const row of sortedRows) {
    runningBalance += Number(row.effectAmount || 0);
  }

  return Number.isFinite(runningBalance) ? runningBalance : 0;
};




  const filteredSuppliers = suppliers.filter((supplier) => {
    const query = searchTerm.toLowerCase();
    return supplier.name?.toLowerCase().includes(query) || supplier.phone?.includes(searchTerm);
  });

  // معالجة وحساب الرصيد التراكمي تصاعدياً (من الأقدم للأحدث)
  const transactionsList = transactions.map(t => {
    let effect = 0;
    const isSettlement = String(t.notes || '').startsWith('تسوية (');
    const paymentSource = String(t.destination || '').trim();
    const bankName = banks.find((bank) => bank.id === t.bank_id)?.name || '';
    const paymentSourceLabel = (t.type === 'payment')
      ? (paymentSource === 'banks' || Boolean(t.bank_id)
        ? `البنك${bankName ? `: ${bankName}` : ''}`
        : 'الخزنة')
      : '';

    if (t.type === 'opening_balance') {
      effect = Number(t.amount || 0);
    } else if (t.type === 'payment') {
      effect = -Number(t.amount || 0);
    } else {
      effect = Number(t.amount || 0);
    }
    return {
      ...t,
      source: 'transaction',
      displayType: isSettlement ? 'تسوية حساب' : t.type === 'payment' ? 'سداد' : t.type === 'opening_balance' ? 'رصيد افتتاحي' : 'إضافة على الحساب',
      paymentSourceLabel,
      effectAmount: effect,
      displayAmount: Number(t.amount || 0),
    };
  });

  const purchasesList = purchaseInvoices.map(inv => ({
    ...inv,
    source: 'purchase',
    displayType: `فاتورة شراء (${inv.invoice_number || 'بدون رقم'})`,
    effectAmount: Number(inv.total_amount || 0), // فواتير الشراء تزيد المديونية
    displayAmount: Number(inv.total_amount || 0),
    date: inv.created,
    notes: `إجمالي الفاتورة: ${Number(inv.total_amount || 0).toLocaleString()} ج.م`,
    actor_name: 'النظام (مشتريات)'
  }));

  // الترتيب تصاعدياً لحساب الرصيد التراكمي الصحيح
  const sortedStatementRows = [...transactionsList, ...purchasesList].sort((a, b) => 
    new Date(a.date || a.created) - new Date(b.date || b.created)
  );

  const statementRowsWithBalance = sortedStatementRows.reduce((rows, row) => {
    const previousBalance = rows.length ? rows[rows.length - 1].runningBalance : 0;
    const runningBalance = previousBalance + row.effectAmount;
    return [...rows, { ...row, runningBalance }];
  }, []);

  const statementOpeningBalance = (() => {
    if (!startDate) return 0;
    const openingRows = statementRowsWithBalance.filter((row) => {
      const date = String(row.date || row.created || '').slice(0, 10);
      return date < startDate;
    });
    return openingRows.length
      ? Number(openingRows[openingRows.length - 1].runningBalance || 0)
      : 0;
  })();

  const statementRows = statementRowsWithBalance.filter((row) => {
    const date = String(row.date || row.created || '').slice(0, 10);
    return (!startDate || date >= startDate) && (!endDate || date <= endDate);
  });

  const statementRowsForDisplay = [...statementRows].sort((a, b) => new Date(a.date || a.created) - new Date(b.date || b.created));
  const statementCurrentBalance = statementRowsWithBalance.length
    ? Number(statementRowsWithBalance[statementRowsWithBalance.length - 1].runningBalance || 0)
    : 0;

  const statementTotals = statementRows.reduce((totals, row) => {
    const amount = Math.abs(Number(row.effectAmount || 0));
    if (Number(row.effectAmount || 0) >= 0) {
      totals.increase += amount;
    } else {
      totals.decrease += amount;
    }
    return totals;
  }, { increase: 0, decrease: 0 });

  const statementPeriodBalance = statementOpeningBalance + statementTotals.increase - statementTotals.decrease;

  const getSupplierStatementRunningBalance = (supplierId) => {
    const normalizedSupplierId = String(supplierId || '');
    const supplierTransactions = allTransactions
      .filter((transaction) => String(transaction.supplier_id || '') === normalizedSupplierId)
      .map((transaction) => {
        const isSettlement = String(transaction.notes || '').startsWith('تسوية (');
        const paymentSource = String(transaction.destination || '').trim();
        const bankName = banks.find((bank) => bank.id === transaction.bank_id)?.name || '';
        const paymentSourceLabel = (transaction.type === 'payment')
          ? (paymentSource === 'banks' || Boolean(transaction.bank_id)
            ? `البنك${bankName ? `: ${bankName}` : ''}`
            : 'الخزنة')
          : '';

        let effect = 0;
        if (transaction.type === 'opening_balance') {
          effect = Number(transaction.amount || 0);
        } else if (transaction.type === 'payment') {
          effect = -Number(transaction.amount || 0);
        } else {
          effect = Number(transaction.amount || 0);
        }

        return {
          ...transaction,
          source: 'transaction',
          displayType: isSettlement ? 'تسوية حساب' : transaction.type === 'payment' ? 'سداد' : transaction.type === 'opening_balance' ? 'رصيد افتتاحي' : 'إضافة على الحساب',
          paymentSourceLabel,
          effectAmount: effect,
          date: transaction.date || transaction.created,
          actor_name: transaction.actor_name || 'غير معروف',
        };
      });

    const supplierPurchases = allPurchaseInvoices
      .filter((invoice) => String(invoice.supplier_id || '') === normalizedSupplierId)
      .map((invoice) => ({
        ...invoice,
        source: 'purchase',
        displayType: `فاتورة شراء (${invoice.invoice_number || 'بدون رقم'})`,
        effectAmount: Number(invoice.total_amount || 0),
        date: invoice.created,
        notes: `إجمالي الفاتورة: ${Number(invoice.total_amount || 0).toLocaleString()} ج.م`,
        actor_name: 'النظام (مشتريات)',
        paymentSourceLabel: '',
      }));

    const supplierStatementRows = [...supplierTransactions, ...supplierPurchases]
      .sort((a, b) => new Date(a.date || a.created) - new Date(b.date || b.created))
      .reduce((rows, row) => {
        const previousBalance = rows.length ? rows[rows.length - 1].runningBalance : 0;
        const runningBalance = previousBalance + Number(row.effectAmount || 0);
        return [...rows, { ...row, runningBalance }];
      }, []);

    return supplierStatementRows.length
      ? Number(supplierStatementRows[supplierStatementRows.length - 1].runningBalance || 0)
      : Number(suppliers.find((supplier) => supplier.id === supplierId)?.balance || 0);
  };

 const totalBalances = suppliers.reduce((sum, supplier) => sum + getSupplierDerivedBalance(supplier.id), 0);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!form.name.trim()) return showFeedback('يرجى إدخال اسم المورد.', 'error');
    saveMutation.mutate();
  };

  const startEdit = (supplier) => {
    if (!isAdmin) {
      showFeedback('عذراً، تعديل بيانات الموردين متاح للأدمن فقط.', 'error');
      return;
    }
    setEditingId(supplier.id);
    setForm({
      name: supplier.name || '', phone: supplier.phone || '', address: supplier.address || '',
      notes: supplier.notes || '', balance: String(getSupplierDerivedBalance(supplier.id) || 0),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
 <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 relative" dir="rtl">
      {feedback.text && <div className={`p-4 rounded-2xl text-xs font-bold ${feedback.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>{feedback.text}</div>}

      {paymentModal.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between border-b pb-3"><h3 className="font-black">سداد للمورد: {paymentModal.supplier?.name}</h3><button onClick={() => setPaymentModal({ open: false, supplier: null })}>✕</button></div>
            <p className="text-xs text-gray-500">الرصيد المستحق: <b className="text-red-600">{Number(getSupplierDerivedBalance(paymentModal.supplier?.id || '') || 0).toLocaleString()} ج.م</b></p>
            <input type="number" min="0.01" step="0.01" placeholder="مبلغ السداد" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="w-full border p-3 rounded-xl text-xs" />
            <select value={paymentDestination} onChange={(e) => { setPaymentDestination(e.target.value); setPaymentBankId(''); }} className="w-full border p-3 rounded-xl text-xs">
              <option value="treasury">الخزنة الرئيسية (الرصيد: {Number(treasury?.balance || 0).toLocaleString()} ج.م)</option>
              <option value="banks">البنوك</option>
            </select>
            {paymentDestination === 'banks' && <select value={paymentBankId} onChange={(e) => setPaymentBankId(e.target.value)} className="w-full border p-3 rounded-xl text-xs"><option value="">اختر البنك</option>{banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name} (الرصيد: {Number(bank.balance || 0).toLocaleString()} ج.م)</option>)}</select>}
            <input type="text" placeholder="ملاحظات السداد" value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} className="w-full border p-3 rounded-xl text-xs" />
            <div className="flex gap-2"><button onClick={() => setPaymentModal({ open: false, supplier: null })} className="flex-1 bg-gray-100 py-3 rounded-xl text-xs font-bold">إلغاء</button><button disabled={paymentMutation.isPending || !paymentAmount || Number(paymentAmount) <= 0} onClick={() => paymentMutation.mutate()} className="flex-1 bg-emerald-600 text-white py-3 rounded-xl text-xs font-bold">تأكيد السداد</button></div>
          </div>
        </div>
      )}

      {/* نافذة تسوية الحساب */}
      {settlementModal.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between border-b pb-3"><h3 className="font-black">⚙️ تسوية حساب المورد: {settlementModal.supplier?.name}</h3><button onClick={() => setSettlementModal({ open: false, supplier: null })}>✕</button></div>
            <p className="text-xs text-gray-500">الرصيد المستحق الحالي: <b className="text-red-600">{Number(getSupplierDerivedBalance(settlementModal.supplier?.id || '') || 0).toLocaleString()} ج.م</b></p>
            <div>
              <label className="text-xs font-bold text-gray-700">نوع التسوية</label>
              <select value={settlementType} onChange={(e) => setSettlementType(e.target.value)} className="w-full border p-3 rounded-xl text-xs mt-1 bg-white">
                <option value="minus">📉 خصم / تخفيض المستحق (مرتجع أو تسوية دائنة)</option>
                <option value="plus">📈 زيادة المستحق (إضافة على الحساب)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-700">مبلغ التسوية</label>
              <input type="number" min="0.01" step="0.01" placeholder="0.00" value={settlementAmount} onChange={(e) => setSettlementAmount(e.target.value)} className="w-full border p-3 rounded-xl text-xs mt-1" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-700">سبب التسوية / ملاحظات</label>
              <input type="text" placeholder="أدخل سبب التسوية بالتفصيل..." value={settlementNotes} onChange={(e) => setSettlementNotes(e.target.value)} className="w-full border p-3 rounded-xl text-xs mt-1" />
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setSettlementModal({ open: false, supplier: null })} className="flex-1 bg-gray-100 py-3 rounded-xl text-xs font-bold">إلغاء</button>
              <button disabled={settlementMutation.isPending || !settlementAmount || Number(settlementAmount) <= 0} onClick={() => settlementMutation.mutate()} className="flex-1 bg-amber-600 text-white py-3 rounded-xl text-xs font-bold">حفظ التسوية</button>
            </div>
          </div>
        </div>
      )}

      {statementModal.open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-[96vw] max-w-5xl shadow-2xl space-y-4 h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="font-black text-base">كشف حساب المورد: {statementModal.supplier?.name}</h3>
                <div className="flex flex-wrap gap-3 mt-2 text-xs">
                  <p className="text-gray-500">رصيد أول المدة: <b className="text-blue-600">{statementOpeningBalance.toLocaleString()} ج.م</b></p>
                  {/* <p className="text-gray-500">الرصيد الحالي: <b className="text-red-600">{statementCurrentBalance.toLocaleString()} ج.م</b></p> */}
                </div>
              </div>
              <button onClick={() => setStatementModal({ open: false, supplier: null })}>✕</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-bold text-slate-700">رصيد أول المدة</p>
                <p className="mt-1 text-base font-black text-slate-700">{statementOpeningBalance.toLocaleString()} ج.م</p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-[10px] font-bold text-emerald-700">إجمالي الإضافات</p>
                <p className="mt-1 text-base font-black text-emerald-700">{statementTotals.increase.toLocaleString()} ج.م</p>
              </div>
              <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
                <p className="text-[10px] font-bold text-red-700">إجمالي المسحوبات</p>
                <p className="mt-1 text-base font-black text-red-700">{statementTotals.decrease.toLocaleString()} ج.م</p>
              </div>
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3">
                <p className="text-[10px] font-bold text-blue-700">الرصيد الحالي</p>
                <p className={`mt-1 text-base font-black ${statementPeriodBalance >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                  {statementPeriodBalance.toLocaleString()} ج.م
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border p-3 rounded-xl text-xs" />
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border p-3 rounded-xl text-xs" />
            </div>
            <div className="border rounded-2xl overflow-hidden">
              <table className="w-full text-right text-xs">
                <thead className="bg-gray-100 text-gray-700">
                  <tr>
                    <th className="p-3">التاريخ</th>
                    <th className="p-3">نوع الحركة</th>
                    <th className="p-3">مصدر السداد</th>
                    <th className="p-3">المبلغ</th>
                    <th className="p-3">الرصيد بعد كل معاملة</th>
                    <th className="p-3">ملاحظات</th>
                    <th className="p-3">بواسطة</th>
                    <th className="p-3">الإجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {statementRowsForDisplay.length ? statementRowsForDisplay.map((row) => (
                    <tr key={row.id} className={row.source === 'purchase' ? 'bg-blue-50/30' : 'hover:bg-gray-50'}>
                      <td className="p-3">{formatDisplayDate(row.date || row.created)}</td>
                      <td className="p-3 font-bold">{row.displayType}</td>
                      <td className="p-3 font-bold text-emerald-700">{row.type === 'payment' ? (row.paymentSourceLabel || 'غير محدد') : '-'}</td>
                      <td className="p-3 font-black">{Number(row.displayAmount || 0).toLocaleString()} ج.م</td>
                      <td className={`p-3 font-black ${Number(row.runningBalance || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {Number(row.runningBalance || 0).toLocaleString()} ج.م
                      </td>
                      <td className="p-3 text-gray-500">{row.notes || '-'}</td>
                      <td className="p-3 font-bold text-gray-700">{row.actor_name || 'غير معروف'}</td>
                      <td className="p-3">
                        {row.source !== 'purchase' && row.type === 'payment' && isAdmin && (
                          <button
                            onClick={() => setDeletePaymentId(row.id)}
                            className="bg-red-50 text-red-700 px-2 py-1.5 rounded-lg font-bold"
                          >
                            حذف السداد
                          </button>
                        )}
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="8" className="p-8 text-center text-gray-400">لا توجد حركات أو فواتير في هذه الفترة.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="border-b pb-4 flex justify-between items-center"><div><h1 className="text-2xl font-black text-gray-800">🏢 إدارة الموردين</h1><p className="text-sm text-gray-500">متابعة الموردين والأرصدة والمدفوعات وكشوف الحساب والفواتير والتسويات</p></div><button onClick={() => queryClient.invalidateQueries({ queryKey: ['suppliers'] })} className="bg-gray-100 px-4 py-2 rounded-xl text-xs font-bold">🔄 تحديث</button></div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div className="bg-white p-5 rounded-2xl shadow-sm border flex justify-between"><div><p className="text-xs font-bold text-gray-400">إجمالي الموردين</p><h3 className="text-xl font-black text-blue-600">{suppliers.length} مورد</h3></div><span className="p-3 bg-blue-50 rounded-xl">🏢</span></div><div className="bg-white p-5 rounded-2xl shadow-sm border flex justify-between"><div><p className="text-xs font-bold text-gray-400">إجمالي المستحقات</p><h3 className="text-xl font-black text-red-600">{totalBalances.toLocaleString()} ج.م</h3></div><span className="p-3 bg-red-50 rounded-xl">💰</span></div></div>

      <div className="bg-white p-6 rounded-2xl shadow-xl border"><h2 className="text-lg font-bold mb-4">{editingId ? '✏️ تعديل بيانات المورد' : '➕ إضافة مورد جديد'}</h2><form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4"><input required placeholder="اسم المورد *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border p-2.5 rounded-xl text-xs" /><input type="number" step="0.01" placeholder="الرصيد الافتتاحي" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} className="border p-2.5 rounded-xl text-xs" /><input placeholder="ملاحظات" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="border p-2.5 rounded-xl text-xs" /><div className="md:col-span-2 lg:col-span-5 flex justify-end gap-2"><button type="submit" disabled={saveMutation.isPending} className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-xs font-bold">{editingId ? 'حفظ التعديل' : 'حفظ وإضافة المورد'}</button>{editingId && <button type="button" onClick={() => { setEditingId(null); setForm({ name: '', phone: '', address: '', notes: '', balance: '' }); }} className="bg-gray-100 px-6 py-2.5 rounded-xl text-xs font-bold">إلغاء</button>}</div></form></div>

      <div className="bg-white shadow-xl rounded-2xl border overflow-hidden">
        <div className="p-4 bg-gray-50 border-b flex justify-between items-center gap-4">
          <h2 className="text-lg font-bold">📋 جدول الموردين</h2>
          <input placeholder="🔍 بحث بالاسم..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="border px-3 py-2 rounded-xl text-xs w-64 bg-white" />
        </div>
        {suppliersError && <p className="p-4 text-xs font-bold text-red-600 bg-red-50">تعذر تحميل الموردين. اضغط تحديث للمحاولة مرة أخرى.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-gray-100 text-gray-600">
              <tr>
                <th className="p-3">المورد</th>
                {/* <th className="p-3">الرصيد المستحق</th> */}
                <th className="p-3">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredSuppliers.map((supplier) => {
                const derivedBalance = getSupplierDerivedBalance(supplier.id);

                return (
                  <tr key={supplier.id} className="hover:bg-gray-50">
                    <td className="p-3 font-bold">{supplier.name}</td>                    
              {/* <td className="p-3 font-black text-red-600">
  {Number(getSupplierDerivedBalance(supplier.id) || 0).toLocaleString()} ج.م
</td> */}
                    <td className="p-3 flex flex-wrap gap-1">
                      <button onClick={() => { setStartDate(''); setEndDate(''); setStatementModal({ open: true, supplier }); }} className="bg-blue-50 text-blue-700 px-2.5 py-1.5 rounded-lg font-bold">كشف الحساب</button>
                      <button onClick={() => { setPaymentAmount(''); setPaymentNotes(''); setPaymentDestination('treasury'); setPaymentBankId(''); setPaymentModal({ open: true, supplier }); }} className="bg-emerald-50 text-emerald-700 px-2.5 py-1.5 rounded-lg font-bold">سداد</button>
                      <button onClick={() => { setSettlementAmount(''); setSettlementNotes(''); setSettlementType('minus'); setSettlementModal({ open: true, supplier }); }} className="bg-amber-50 text-amber-700 px-2.5 py-1.5 rounded-lg font-bold">تسوية</button>
                      <button onClick={() => startEdit(supplier)} className="bg-purple-50 text-purple-700 px-2.5 py-1.5 rounded-lg font-bold">تعديل</button>
                      <button onClick={() => {
                        if (!isAdmin) {
                          showFeedback('عذراً، حذف الموردين متاح للأدمن فقط.', 'error');
                          return;
                        }
                        setDeleteId(supplier.id);
                      }} className="bg-red-50 text-red-600 px-2.5 py-1.5 rounded-lg font-bold">حذف</button>
                    </td>
                  </tr>
                );
              })}
              {!filteredSuppliers.length && <tr><td colSpan="3" className="p-8 text-center text-gray-400">{isLoading ? 'جاري التحميل...' : 'لا يوجد موردون مطابقون.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {deleteId && <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4"><h3 className="font-black">تأكيد حذف المورد</h3><p className="text-xs text-gray-500">هل أنت متأكد من حذف هذا المورد؟</p><div className="flex gap-2"><button onClick={() => setDeleteId(null)} className="flex-1 bg-gray-100 py-3 rounded-xl text-xs font-bold">إلغاء</button><button onClick={() => deleteMutation.mutate(deleteId)} className="flex-1 bg-red-600 text-white py-3 rounded-xl text-xs font-bold">حذف</button></div></div></div>}

      {deletePaymentId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-black">تأكيد حذف السداد</h3>
            <p className="text-xs text-gray-500">هل تريد حذف هذا السداد؟ سيتم استرجاع رصيد المورد وباقي الحسابات حسب مصدر السداد.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeletePaymentId(null)} className="flex-1 bg-gray-100 py-3 rounded-xl text-xs font-bold">إلغاء</button>
              <button
                onClick={() => deletePaymentMutation.mutate(deletePaymentId)}
                disabled={deletePaymentMutation.isPending}
                className="flex-1 bg-red-600 text-white py-3 rounded-xl text-xs font-bold"
              >
                {deletePaymentMutation.isPending ? 'جاري الحذف...' : 'حذف السداد'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}