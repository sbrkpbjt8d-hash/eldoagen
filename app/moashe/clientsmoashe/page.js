'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';

export default function ClientsPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');

  const [feedbackMessage, setFeedbackMessage] = useState({ text: '', type: '' });
  const [deleteModal, setDeleteModal] = useState({ isOpen: false, clientId: null });
  
  // نافذة التحصيل
  const [paymentModal, setPaymentModal] = useState({ isOpen: false, client: null });
  const [payAmount, setPayAmount] = useState('');
  const [selectedSalesAgent, setSelectedSalesAgent] = useState('');
  const [payDestination, setPayDestination] = useState('treasury');
  const [payBankId, setPayBankId] = useState('');
  const [payNotes, setPayNotes] = useState('');

  // نافذة تسوية الحساب
  const [settlementModal, setSettlementModal] = useState({ isOpen: false, client: null });
  const [settlementAmount, setSettlementAmount] = useState('');
  const [settlementType, setSettlementType] = useState('minus'); // minus لخصم من المديونية، plus لزيادة المديونية
  const [settlementNotes, setSettlementNotes] = useState('');

  // نافذة كشف الحساب
  const [statementModal, setStatementModal] = useState({ isOpen: false, client: null });
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // نافذة إضافة / تعديل الرصيد الافتتاحي
  const [openingModal, setOpeningModal] = useState({ isOpen: false, client: null });
  const [openingAmount, setOpeningAmount] = useState('');

  // حالات نموذج إضافة عميل جديد
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [balance, setBalance] = useState('');

  // فحص صلاحيات الأدمن
  const isAdmin = pb.authStore.model?.collectionName === '_superusers' || pb.authStore.model?.role === 'admin';

  // دالة جلب اسم المستخدم الحالي لتلافي خطأ عدم التعريف
  const currentUserName = () => {
    return pb.authStore.model?.name || pb.authStore.model?.email || 'مسؤول النظام';
  };

  const showFeedback = (text, type = 'success') => {
    setFeedbackMessage({ text, type });
    setTimeout(() => {
      setFeedbackMessage({ text: '', type: '' });
    }, 4000);
  };

  // 1. جلب قائمة العملاء
  const { data: clients = [], isLoading: loading } = useQuery({
    queryKey: ['clientsmoashe'],
    queryFn: async () => {
      return await pb.collection('clientsmoashe').getFullList({ sort: '-created' });
    },
  });

  // 2. جلب الخزنة للربط معها
  const { data: treasuryRecords = [] } = useQuery({
    queryKey: ['treasury'],
    queryFn: async () => {
      return await pb.collection('treasury').getFullList().catch(() => []);
    },
  });
  const treasury = treasuryRecords[0] || null;

  const { data: banks = [] } = useQuery({
    queryKey: ['banks'],
    queryFn: async () => {
      return await pb.collection('banks').getFullList().catch(() => []);
    },
  });

  const { data: salesAgents = [] } = useQuery({
    queryKey: ['sales_agents'],
    queryFn: async () => {
      return await pb.collection('sales_agents').getFullList({ sort: '-created' }).catch(() => []);
    },
  });

  // جلب كافة حركات العملاء (لإيجاد آخر تحصيل لكل عميل)
  const { data: allTransactions = [] } = useQuery({
    queryKey: ['all_client_transactions_summary'],
    queryFn: async () => {
      return await pb.collection('client_transactions').getFullList({
        sort: '-created',
      }).catch(() => []);
    },
  });

  // جلب كافة فواتير المبيعات (لإيجاد آخر فاتورة لكل عميل)
  const { data: allInvoices = [] } = useQuery({
    queryKey: ['all_sales_invoices_summary'],
    queryFn: async () => {
      return await pb.collection('sales_invoices').getFullList({
        sort: '-created',
      }).catch(() => []);
    },
  });

  // 3. جلب حركات كشف الحساب للعميل المحدد (التحصيل، التسويات، والأرصدة الافتتاحية)
  const { data: transactions = [], isLoading: loadingTransactions } = useQuery({
    queryKey: ['client_transactions', statementModal.client?.id],
    enabled: !!statementModal.isOpen && !!statementModal.client?.id,
    queryFn: async () => {
      return await pb.collection('client_transactions').getFullList({
        filter: `client_id = "${statementModal.client.id}"`,
        sort: '-created',
      });
    },
  });

  // 4. جلب فواتير المبيعات الخاصة بالعميل المحدد من جدول sales_invoices
  const { data: invoices = [] } = useQuery({
    queryKey: ['sales_invoices', statementModal.client?.name],
    enabled: !!statementModal.isOpen && !!statementModal.client?.name,
    queryFn: async () => {
      return await pb.collection('sales_invoices').getFullList({
        filter: `customer_name = "${statementModal.client.name}"`,
        sort: '-created',
      }).catch(() => []);
    },
  });

  // دمج الحركات والفواتير في قائمة واحدة لكشف الحساب وترتيبها حسب الأحدث
  const formattedTransactions = transactions.map(tx => ({
    id: tx.id,
    date: tx.created || tx.date,
    type: tx.type === 'opening_balance' ? 'opening_balance' : tx.type === 'settlement' ? 'settlement' : 'payment',
    amount: Number(tx.amount || 0),
    destination: tx.destination,
    notes: tx.notes || '-',
    actorName: tx.actor_name || 'غير معروف',
  }));

  const formattedInvoices = invoices.map(inv => ({
    id: inv.id,
    date: inv.created,
    type: 'invoice',
    amount: Number(inv.total_amount || 0),
    destination: '-',
    notes: `فاتورة مبيعات`,
  }));

  const statementByDate = [...formattedTransactions, ...formattedInvoices].sort((a, b) => new Date(a.date) - new Date(b.date));
  const statementWithBalance = statementByDate.reduce((statement, tx) => {
    const amountChange = tx.type === 'payment'
      ? -tx.amount
      : tx.type === 'settlement' && tx.notes.includes('خصم/تخفيض')
        ? -tx.amount
        : tx.amount;
    const previousBalance = statement[statement.length - 1]?.accountValue || 0;

    return [...statement, { ...tx, accountValue: previousBalance + amountChange }];
  }, []);
  const combinedStatement = statementWithBalance.reverse();

  // تنسيق التاريخ للجدول الرئيسي
  const formatLastDate = (dateString) => {
    if (!dateString) return 'لا يوجد';
    const date = new Date(dateString);
    return date.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
  };

  // إضافة عميل جديد
  const addClientMutation = useMutation({
    mutationFn: async (newClient) => {
      const clientRecord = await pb.collection('clientsmoashe').create(newClient);
      
      if (newClient.balance && Number(newClient.balance) !== 0) {
        await pb.collection('client_transactions').create({
          client_id: clientRecord.id,
          type: 'opening_balance',
          amount: Number(newClient.balance),
          notes: 'رصيد افتتاحى عند إنشاء العميل',
          date: new Date().toISOString()
        });
      }
      return clientRecord;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clientsmoashe'] });
      setName('');
      setPhone('');
      setAddress('');
      setNotes('');
      setBalance('');
      showFeedback('تم إضافة العميل بنجاح! 👤', 'success');
    },
    onError: () => {
      showFeedback('حدث خطأ أثناء حفظ العميل.', 'error');
    },
  });

  // تنفيذ عملية التحصيل
  const payMutation = useMutation({
    mutationFn: async ({ client, amount, destination, notes }) => {
      const numericAmount = Number(amount);
      const currentClientBalance = Number(client.balance || 0);
      const newClientBalance = currentClientBalance - numericAmount;

      if (!selectedSalesAgent) {
        throw new Error('اختر المندوب الذي قام بالتحصيل');
      }

      if (destination === 'banks' && !payBankId) {
        throw new Error('اختر البنك الذي تم استلام التحصيل عليه');
      }

      const agentInfo = salesAgents.find((agent) => agent.id === selectedSalesAgent);

      await pb.collection('clientsmoashe').update(client.id, {
        balance: newClientBalance,
      });

      await pb.collection('client_transactions').create({
        client_id: client.id,
        type: 'payment',
        amount: numericAmount,
        destination: destination,
        bank_id: destination === 'banks' ? payBankId : '',
        sales_agent_id: selectedSalesAgent,
        sales_agent_name: agentInfo?.name || '',
        sales_agent_region: agentInfo?.region || '',
        actor_name: currentUserName(),
        notes: notes || 'تحصيل مديونية',
        date: new Date().toISOString()
      });

      if (destination === 'treasury') {
        const currentTreasuryBalance = treasury ? Number(treasury.balance || 0) : 0;
        const newTreasuryBalance = currentTreasuryBalance + numericAmount;

        if (treasury) {
          await pb.collection('treasury').update(treasury.id, { balance: newTreasuryBalance });
        } else {
          await pb.collection('treasury').create({ balance: newTreasuryBalance, opening_balance: 0 });
        }
      } else {
        const bank = banks.find(item => item.id === payBankId);
        if (!bank) throw new Error('البنك المختار غير موجود');
        await pb.collection('banks').update(bank.id, {
          balance: Number(bank.balance || 0) + numericAmount,
        });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clientsmoashe'] });
      await queryClient.invalidateQueries({ queryKey: ['treasury'] });
      await queryClient.invalidateQueries({ queryKey: ['client_transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['all_client_transactions_summary'] });
      showFeedback('💵 تم تسجيل التحصيل وتحديث الحسابات بنجاح!', 'success');
      setPaymentModal({ isOpen: false, client: null });
      setPayAmount('');
      setSelectedSalesAgent('');
      setPayNotes('');
      setPayDestination('treasury');
      setPayBankId('');
    },
    onError: (error) => {
      showFeedback('❌ فشل عملية التحصيل: ' + error.message, 'error');
    },
  });

  // تنفيذ عملية التسوية
  const settlementMutation = useMutation({
    mutationFn: async ({ client, amount, type, notes }) => {
      const numericAmount = Number(amount);
      const currentClientBalance = Number(client.balance || 0);
      
      const newClientBalance = type === 'minus' 
        ? currentClientBalance - numericAmount 
        : currentClientBalance + numericAmount;

      await pb.collection('clientsmoashe').update(client.id, {
        balance: newClientBalance,
      });

      await pb.collection('client_transactions').create({
        client_id: client.id,
        type: 'settlement',
        amount: numericAmount,
        destination: '-',
        actor_name: currentUserName(),
        notes: `تسوية (${type === 'minus' ? 'خصم/تخفيض' : 'إضافة/زيادة'}): ${notes || 'تسوية حساب'}`,
        date: new Date().toISOString()
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clientsmoashe'] });
      await queryClient.invalidateQueries({ queryKey: ['client_transactions'] });
      showFeedback('⚙️ تم إجراء التسوية وتحديث الحساب بنجاح!', 'success');
      setSettlementModal({ isOpen: false, client: null });
      setSettlementAmount('');
      setSettlementNotes('');
      setSettlementType('minus');
    },
    onError: (error) => {
      showFeedback('❌ فشل عملية التسوية: ' + error.message, 'error');
    },
  });

  // إضافة أو تعديل الرصيد الافتتاحي للعميل (محمي للأدمن فقط)
  const openingBalanceMutation = useMutation({
    mutationFn: async ({ client, amount }) => {
      if (!isAdmin) throw new Error('تعديل الرصيد الافتتاحي متاح للأدمن فقط');
      const numericAmount = Number(amount);
      
      await pb.collection('clientsmoashe').update(client.id, {
        balance: numericAmount,
      });

      await pb.collection('client_transactions').create({
        client_id: client.id,
        type: 'opening_balance',
        amount: numericAmount,
        notes: 'إضافة/تعديل الرصيد الافتتاحي',
        date: new Date().toISOString()
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clientsmoashe'] });
      await queryClient.invalidateQueries({ queryKey: ['client_transactions'] });
      showFeedback('✨ تم تحديث الرصيد الافتتاحي بنجاح', 'success');
      setOpeningModal({ isOpen: false, client: null });
      setOpeningAmount('');
    },
    onError: (error) => {
      showFeedback(error.message || 'فشل تحديث الرصيد الافتتاحي', 'error');
    }
  });

  // حذف عميل
  const deleteClientMutation = useMutation({
    mutationFn: async (id) => {
      return await pb.collection('clientsmoashe').delete(id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['clientsmoashe'] });
      showFeedback('تم حذف العميل بنجاح.', 'success');
      setDeleteModal({ isOpen: false, clientId: null });
    },
    onError: () => {
      showFeedback('فشل حذف العميل.', 'error');
      setDeleteModal({ isOpen: false, clientId: null });
    },
  });

  const handleAddClient = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      showFeedback('يرجى إدخال اسم العميل على الأقل.', 'error');
      return;
    }
    addClientMutation.mutate({
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim(),
      notes: notes.trim(),
      balance: balance === '' ? 0 : Number(balance),
      actor_name: currentUserName()
    });
  };

  const handlePaymentSubmit = (e) => {
    e.preventDefault();
    if (!payAmount || Number(payAmount) <= 0) {
      showFeedback('الرجاء إدخال مبلغ صحيح للتحصيل', 'error');
      return;
    }
    if (!selectedSalesAgent) {
      showFeedback('اختر المندوب الذي قام بالتحصيل أولاً', 'error');
      return;
    }
    payMutation.mutate({
      client: paymentModal.client,
      amount: payAmount,
      destination: payDestination,
      notes: payNotes,
    });
  };

  const handleSettlementSubmit = (e) => {
    e.preventDefault();
    settlementMutation.mutate({
      client: settlementModal.client,
      amount: settlementAmount,
      type: settlementType,
      notes: settlementNotes,
    });
  };

  const handleOpeningSubmit = (e) => {
    e.preventDefault();
    if (!isAdmin) {
      showFeedback('عذراً، تعديل الرصيد الافتتاحي متاح للمشرف (Admin) فقط.', 'error');
      setOpeningModal({ isOpen: false, client: null });
      return;
    }
    openingBalanceMutation.mutate({
      client: openingModal.client,
      amount: openingAmount
    });
  };

  // تصفية كشف الحساب بالتاريخ
  const filteredStatement = combinedStatement.filter(tx => {
    if (!startDate && !endDate) return true;
    const txDate = new Date(tx.date).toISOString().split('T')[0];
    if (startDate && txDate < startDate) return false;
    if (endDate && txDate > endDate) return false;
    return true;
  });

  const filteredClients = clients.filter(client =>
    client.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.phone?.includes(searchTerm)
  );

  const totalBalances = clients.reduce((sum, client) => sum + Number(client.balance || 0), 0);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-8 relative" dir="rtl">
      
      {/* نافذة حذف العميل */}
      {deleteModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <h3 className="text-base font-black text-gray-800">تأكيد الحذف</h3>
            <p className="text-xs text-gray-500">هل أنت متأكد من حذف هذا العميل؟</p>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setDeleteModal({ isOpen: false, clientId: null })} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl text-xs font-bold">إلغاء</button>
              <button disabled={deleteClientMutation.isPending} onClick={() => deleteClientMutation.mutate(deleteModal.clientId)} className="flex-1 bg-red-600 text-white py-2.5 rounded-xl text-xs font-bold">حذف</button>
            </div>
          </div>
        </div>
      )}

      {/* نافذة الرصيد الافتتاحي (محمية للأدمن فقط) */}
      {openingModal.isOpen && isAdmin && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-base font-black text-gray-800">إضافة/تعديل رصيد افتتاحى لـ: {openingModal.client?.name}</h3>
              <button onClick={() => setOpeningModal({ isOpen: false, client: null })} className="text-gray-400 font-bold">✕</button>
            </div>
            <form onSubmit={handleOpeningSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-700">قيمة الرصيد الافتتاحي (ج.م)</label>
                <input
                  type="number"
                  step="0.01"
                  value={openingAmount}
                  onChange={(e) => setOpeningAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full border border-gray-300 p-3 rounded-xl text-xs font-bold outline-none mt-1"
                  required
                />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setOpeningModal({ isOpen: false, client: null })} className="flex-1 bg-gray-100 py-3 rounded-xl text-xs font-bold">إلغاء</button>
                <button type="submit" disabled={openingBalanceMutation.isPending} className="flex-1 bg-blue-600 text-white py-3 rounded-xl text-xs font-bold">حفظ الرصيد</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* نافذة التحصيل */}
      {paymentModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-base font-black text-gray-800">💵 تحصيل مديونية: {paymentModal.client?.name}</h3>
              <button onClick={() => setPaymentModal({ isOpen: false, client: null })} className="text-gray-400 font-bold">✕</button>
            </div>
            <form onSubmit={handlePaymentSubmit} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-600">المديونية الحالية:</label>
                <p className="text-lg font-black text-red-600">{Number(paymentModal.client?.balance || 0).toLocaleString()} ج.م</p>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700">المندوب المسئول عن التحصيل</label>
                <select
                  value={selectedSalesAgent}
                  onChange={(e) => setSelectedSalesAgent(e.target.value)}
                  className="w-full border p-3 rounded-xl text-xs font-bold bg-white outline-none mt-1"
                >
                  <option value="">-- اختر المندوب --</option>
                  {salesAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700">المبلغ المراد تحصيله</label>
                <input
                  type="number"
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full border p-3 rounded-xl text-xs font-bold outline-none mt-1"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700">التوريد إلى:</label>
                <select
                  value={payDestination}
                  onChange={(e) => { setPayDestination(e.target.value); setPayBankId(''); }}
                  className="w-full border p-3 rounded-xl text-xs font-bold bg-white outline-none mt-1"
                >
                  <option value="treasury">🏦 الخزنة (تحديث رصيد الخزنة تلقائياً)</option>
                  <option value="banks">💳 بنك محدد</option>
                </select>
              </div>
              {payDestination === 'banks' && (
                <div>
                  <label className="text-xs font-bold text-gray-700">البنك المستلم للتحصيل:</label>
                  <select
                    value={payBankId}
                    onChange={(e) => setPayBankId(e.target.value)}
                    className="w-full border p-3 rounded-xl text-xs font-bold bg-white outline-none mt-1"
                  >
                    <option value="">-- اختر البنك --</option>
                    {banks.map(bank => (
                      <option key={bank.id} value={bank.id}>{bank.name} (الرصيد: {Number(bank.balance || 0).toLocaleString()} ج.م)</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs font-bold text-gray-700">ملاحظات التحصيل</label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="سبب التحصيل أو تفاصيل..."
                  className="w-full border p-3 rounded-xl text-xs outline-none mt-1"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setPaymentModal({ isOpen: false, client: null })} className="flex-1 bg-gray-100 py-3 rounded-xl text-xs font-bold">إلغاء</button>
                <button type="submit" disabled={payMutation.isPending} className="flex-1 bg-emerald-600 text-white py-3 rounded-xl text-xs font-bold">تأكيد التحصيل</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* نافذة تسوية الحساب */}
      {settlementModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4" dir="rtl">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-base font-black text-gray-800">⚙️ تسوية حساب العميل: {settlementModal.client?.name}</h3>
              <button onClick={() => setSettlementModal({ isOpen: false, client: null })} className="text-gray-400 font-bold">✕</button>
            </div>
            <form onSubmit={handleSettlementSubmit} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-gray-600">المديونية الحالية:</label>
                <p className="text-lg font-black text-red-600">{Number(settlementModal.client?.balance || 0).toLocaleString()} ج.م</p>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700">نوع التسوية</label>
                <select
                  value={settlementType}
                  onChange={(e) => setSettlementType(e.target.value)}
                  className="w-full border p-3 rounded-xl text-xs font-bold bg-white outline-none mt-1"
                >
                  <option value="minus">📉 خصم من المديونية (تخفيض الحساب / مرتجع)</option>
                  <option value="plus">📈 زيادة المديونية (إضافة على الحساب)</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700">مبلغ التسوية</label>
                <input
                  type="number"
                  step="0.01"
                  value={settlementAmount}
                  onChange={(e) => setSettlementAmount(e.target.value)}
                  className="w-full border p-3 rounded-xl text-xs font-bold outline-none mt-1"
                  placeholder="0.00"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700">سبب التسوية / ملاحظات</label>
                <input
                  type="text"
                  value={settlementNotes}
                  onChange={(e) => setSettlementNotes(e.target.value)}
                  placeholder="أدخل سبب التسوية بالتفصيل..."
                  className="w-full border p-3 rounded-xl text-xs outline-none mt-1"
                  required
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setSettlementModal({ isOpen: false, client: null })} className="flex-1 bg-gray-100 py-3 rounded-xl text-xs font-bold">إلغاء</button>
                <button type="submit" disabled={settlementMutation.isPending} className="flex-1 bg-amber-600 text-white py-3 rounded-xl text-xs font-bold">حفظ التسوية</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* نافذة كشف الحساب الشاملة */}
      {statementModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-4xl w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b pb-3">
              <div>
                <h3 className="text-lg font-black text-gray-800">📄 كشف حساب العميل: {statementModal.client?.name}</h3>
                <p className="text-xs text-gray-500">المديونية الحالية: <span className="font-bold text-red-600">{Number(statementModal.client?.balance || 0).toLocaleString()} ج.م</span></p>
              </div>
              <button onClick={() => setStatementModal({ isOpen: false, client: null })} className="text-gray-400 font-bold text-lg">✕</button>
            </div>

            <div className="bg-gray-50 p-4 rounded-2xl flex flex-wrap gap-4 items-center justify-between">
              <div className="flex gap-4 items-center flex-1">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-gray-600">من تاريخ:</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border p-2 rounded-xl text-xs bg-white" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-gray-600">إلى تاريخ:</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border p-2 rounded-xl text-xs bg-white" />
                </div>
              </div>
              <div>
                <button onClick={() => { setStartDate(''); setEndDate(''); }} className="bg-gray-200 text-gray-700 px-3 py-2 rounded-xl text-xs font-bold mt-5">إلغاء الفلترة</button>
              </div>
            </div>

            <div className="overflow-x-auto">
              {loadingTransactions ? (
                <div className="p-8 text-center text-blue-600 text-xs font-bold">جاري تحميل كشف الحساب...</div>
              ) : filteredStatement.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-xs">لا توجد معاملات أو فواتير مسجلة في هذه الفترة.</div>
              ) : (
                <table className="w-full text-right border-collapse text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b text-gray-500">
                      <th className="p-3">التاريخ</th>
                      <th className="p-3">نوع الحركة</th>
                      <th className="p-3">المبلغ</th>
                      <th className="p-3">قيمة الحساب</th>
                      <th className="p-3">الوجهة</th>
                      <th className="p-3">ملاحظات</th>
                      <th className="p-3">بواسطة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredStatement.map((tx) => (
                      <tr key={tx.id} className="hover:bg-gray-50">
                        <td className="p-3 text-gray-600">{new Date(tx.date).toLocaleString()}</td>
                        <td className="p-3 font-bold">
                          {tx.type === 'opening_balance' ? (
                            <span className="text-blue-600 bg-blue-50 px-2 py-1 rounded-md">رصيد افتتاحى</span>
                          ) : tx.type === 'invoice' ? (
                            <span className="text-purple-700 bg-purple-50 px-2 py-1 rounded-md">فاتورة مبيعات</span>
                          ) : tx.type === 'settlement' ? (
                            <span className="text-amber-700 bg-amber-50 px-2 py-1 rounded-md">تسوية حساب</span>
                          ) : (
                            <span className="text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md">تحصيل</span>
                          )}
                        </td>
                        <td className={`p-3 font-black ${tx.type === 'invoice' ? 'text-purple-600' : 'text-gray-900'}`}>
                          {Number(tx.amount).toLocaleString()} ج.م
                        </td>
                        <td className={`p-3 font-black ${tx.accountValue > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {Number(tx.accountValue).toLocaleString()} ج.م
                        </td>
                        <td className="p-3 text-gray-600">{tx.destination === 'treasury' ? 'الخزنة' : tx.destination === 'banks' ? 'البنوك' : '-'}</td>
                        <td className="p-3 text-gray-500">{tx.notes}</td>
                        <td className="p-3 font-bold text-gray-700">{tx.actorName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* الهيدر */}
      <div className="border-b pb-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-gray-800">👥 إدارة العملاء والمديونيات</h1>
          <p className="text-sm text-gray-500">متابعة حسابات العملاء، الفواتير، التحصيل، والتسويات</p>
        </div>
        <button onClick={() => queryClient.invalidateQueries({ queryKey: ['clientsmoashe'] })} className="bg-gray-100 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold">🔄 تحديث</button>
      </div>

      {feedbackMessage.text && (
        <div className={`p-4 rounded-2xl text-xs font-bold ${feedbackMessage.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
          {feedbackMessage.text}
        </div>
      )}

      {/* الإحصائيات */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-gray-400">إجمالي العملاء</p>
            <h3 className="text-xl font-black text-blue-600 mt-1">{clients.length} عميل</h3>
          </div>
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl font-bold">👤</div>
        </div>
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-gray-400">إجمالي المديونيات</p>
            <h3 className="text-xl font-black text-red-600 mt-1">{totalBalances.toLocaleString()} ج.م</h3>
          </div>
          <div className="p-3 bg-red-50 text-red-600 rounded-xl font-bold">💰</div>
        </div>
      </div>

      {/* نموذج إضافة عميل جديد */}
      <div className="bg-white p-6 rounded-2xl shadow-xl border border-gray-100">
        <h2 className="text-lg font-bold text-gray-800 mb-4">➕ إضافة عميل جديد</h2>
        <form onSubmit={handleAddClient} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <input type="text" placeholder="اسم العميل *" value={name} onChange={(e) => setName(e.target.value)} className="border p-2.5 rounded-xl text-xs" required />
          <input type="text" placeholder="رقم الهاتف" value={phone} onChange={(e) => setPhone(e.target.value)} className="border p-2.5 rounded-xl text-xs" />
          <input type="text" placeholder="العنوان" value={address} onChange={(e) => setAddress(e.target.value)} className="border p-2.5 rounded-xl text-xs" />
          <input type="number" step="0.01" placeholder="رصيد افتتاحى (مديونية)" value={balance} onChange={(e) => setBalance(e.target.value)} className="border p-2.5 rounded-xl text-xs font-bold" />
          <input type="text" placeholder="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} className="border p-2.5 rounded-xl text-xs" />
          <div className="md:col-span-2 lg:col-span-5 flex justify-end">
            <button type="submit" disabled={addClientMutation.isPending} className="bg-blue-600 text-white font-bold px-6 py-2.5 rounded-xl text-xs">حفظ وإضافة العميل</button>
          </div>
        </form>
      </div>

      {/* جدول العرض الرئيسي */}
      <div className="bg-white shadow-xl rounded-2xl border border-gray-100 overflow-hidden">
        <div className="p-4 bg-gray-50 border-b flex justify-between items-center gap-4">
          <h2 className="text-lg font-bold text-gray-800">📋 قائمة العملاء والمديونيات</h2>
          <input type="text" placeholder="🔍 بحث بالاسم أو الهاتف..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="border px-3 py-2 rounded-xl text-xs w-64 bg-white" />
        </div>

        <div className="p-4 overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="border-b text-xs text-gray-500 bg-gray-50">
                <th className="p-3">اسم العميل</th>
                <th className="p-3">الهاتف</th>
                <th className="p-3">العنوان</th>
                <th className="p-3">المديونية</th>
                <th className="p-3">آخر تحصيل</th>
                <th className="p-3">آخر فاتورة</th>
                <th className="p-3">ملاحظات</th>
                <th className="p-3">بواسطة</th>
                <th className="p-3 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y text-sm">
              {filteredClients.map((client) => {
                // إيجاد آخر تحصيل للعميل
                const lastPayment = allTransactions.find(
                  (tx) => tx.client_id === client.id && tx.type === 'payment'
                );
                // إيجاد آخر فاتورة للعميل
                const lastInvoice = allInvoices.find(
                  (inv) => inv.customer_name === client.name
                );

                const lastPaymentDate = lastPayment ? formatLastDate(lastPayment.created || lastPayment.date) : 'لا يوجد';
                const lastInvoiceDate = lastInvoice ? formatLastDate(lastInvoice.created) : 'لا يوجد';

                return (
                  <tr key={client.id} className="hover:bg-gray-50/50 transition">
                    <td className="p-3 font-black text-gray-900">{client.name}</td>
                    <td className="p-3 font-bold text-gray-700">{client.phone || '-'}</td>
                    <td className="p-3 text-gray-600">{client.address || '-'}</td>
                    <td className="p-3 font-black text-red-600">{Number(client.balance || 0).toLocaleString()} ج.م</td>
                    
                    {/* عمود آخر تحصيل */}
                    <td className="p-3 text-xs">
                      <span className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-md font-bold whitespace-nowrap">
                        {lastPaymentDate}
                      </span>
                    </td>

                    {/* عمود آخر فاتورة */}
                    <td className="p-3 text-xs">
                      <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-md font-bold whitespace-nowrap">
                        {lastInvoiceDate}
                      </span>
                    </td>

                    <td className="p-3 text-xs text-gray-500">{client.notes || '-'}</td>
                    <td className="p-3 text-xs font-bold text-gray-700">{client.actor_name || 'غير معروف'}</td>
                    <td className="p-3 text-center">
                      <div className="flex justify-center gap-1.5 flex-wrap">
                        <button
                          onClick={() => setStatementModal({ isOpen: true, client })}
                          className="bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 px-2.5 py-1 rounded-lg text-xs font-bold transition"
                        >
                          📄 كشف حساب
                        </button>
                        <button
                          onClick={() => setPaymentModal({ isOpen: true, client })}
                          className="bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-200 px-2.5 py-1 rounded-lg text-xs font-bold transition"
                        >
                          💵 تحصيل
                        </button>
                        <button
                          onClick={() => setSettlementModal({ isOpen: true, client })}
                          className="bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-lg text-xs font-bold transition"
                        >
                          ⚙️ تسوية
                        </button>
                        {/* <button
                          onClick={() => {
                            if (!isAdmin) {
                              showFeedback('عذراً، تعديل الرصيد الافتتاحي متاح للمشرف (Admin) فقط.', 'error');
                              return;
                            }
                            setOpeningModal({ isOpen: true, client });
                            setOpeningAmount(client.balance || '');
                          }}
                          className="bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 px-2.5 py-1 rounded-lg text-xs font-bold transition"
                        >
                          ⚙️ الرصيد الافتتاحي
                        </button> */}
                        <button
                          onClick={() => setDeleteModal({ isOpen: true, clientId: client.id })}
                          className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-2.5 py-1 rounded-lg text-xs font-bold transition"
                        >
                          🗑️ حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredClients.length === 0 && (
                <tr><td colSpan="9" className="p-6 text-center text-gray-400">لا توجد عملاء مسجلين.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}