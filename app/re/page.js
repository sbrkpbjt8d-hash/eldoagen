'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';

const money = value => {
  const numericValue = Number(value || 0);
  const absValue = Math.abs(numericValue);
  return `${numericValue < 0 ? '-' : ''}${absValue.toLocaleString('ar-EG', { maximumFractionDigits: 1 })} ج.م`;
};

const dateValue = value => String(value || '').slice(0, 10);

// دالة تفقيط وتحويل الأرقام إلى كلمات عربية صحيحة
const convertToArabicWords = (num) => {
  const n = Math.round(Number(num || 0));
  if (n === 0) return 'صفر جنيه';
  if (n < 0) return 'سالب ' + convertToArabicWords(Math.abs(n));

  const ones = ['', 'واحد', 'إثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const hundreds = ['', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

  if (n < 20) return ones[n] + ' جنيه';
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return (o ? ones[o] + ' و' : '') + tens[t] + ' جنيه';
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    return hundreds[h] + (rest ? ' و' + convertToArabicWords(rest).replace(' جنيه', '') : '') + ' جنيه';
  }
  if (n < 1000000) {
    const th = Math.floor(n / 1000);
    const rest = n % 1000;
    let thText = '';
    if (th === 1) thText = 'ألف';
    else if (th === 2) thText = 'ألفان';
    else if (th >= 3 && th <= 10) thText = ones[th] + ' آلاف';
    else thText = convertToArabicWords(th).replace(' جنيه', '') + ' ألفاً';
    return thText + (rest ? ' و' + convertToArabicWords(rest) : ' جنيه');
  }
  const m = Math.floor(n / 1000000);
  const restM = n % 1000000;
  let mText = '';
  if (m === 1) mText = 'مليون';
  else if (m === 2) mText = 'مليونان';
  else mText = convertToArabicWords(m).replace(' جنيه', '') + ' ملايين';
  return mText + (restM ? ' و' + convertToArabicWords(restM) : ' جنيه');
};

export default function ReportsPage() {
  const queryClient = useQueryClient();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [openingCapitalInput, setOpeningCapitalInput] = useState(null);
  const [openingCapitalError, setOpeningCapitalError] = useState('');

  const fetchRecords = (collection, options = {}) => pb.collection(collection).getFullList(options).catch(() => []);
  const { data: materials = [] } = useQuery({ queryKey: ['report_materials'], queryFn: () => fetchRecords('khamat_moashe') });
  const { data: productsStock = [] } = useQuery({ queryKey: ['report_products_stock'], queryFn: () => fetchRecords('products_stock') });
  const { data: recipes = [] } = useQuery({ queryKey: ['report_recipes'], queryFn: () => fetchRecords('products_recipes') });
  const { data: treasuryRecords = [] } = useQuery({ queryKey: ['report_treasury'], queryFn: () => fetchRecords('treasury') });
  const { data: banks = [] } = useQuery({ queryKey: ['report_banks'], queryFn: () => fetchRecords('banks') });
  const { data: expenseCategories = [] } = useQuery({ queryKey: ['report_expense_categories'], queryFn: () => fetchRecords('expense_categories') });
  const { data: clients = [] } = useQuery({ queryKey: ['report_clients'], queryFn: () => fetchRecords('clientsmoashe') });
  const { data: suppliers = [] } = useQuery({ queryKey: ['report_suppliers'], queryFn: () => fetchRecords('suppliers') });
  const { data: salesAgents = [] } = useQuery({ queryKey: ['report_sales_agents'], queryFn: () => fetchRecords('sales_agents') });
  const { data: salesInvoices = [] } = useQuery({ queryKey: ['report_sales'], queryFn: () => fetchRecords('sales_invoices') });
  const { data: purchaseInvoices = [] } = useQuery({ queryKey: ['report_purchases'], queryFn: () => fetchRecords('purchase_invoices') });
  const { data: expenses = [] } = useQuery({ queryKey: ['report_expenses'], queryFn: () => fetchRecords('expenses') });
  const { data: clientTransactions = [] } = useQuery({ queryKey: ['report_client_transactions'], queryFn: () => fetchRecords('client_transactions') });
  const { data: supplierTransactions = [] } = useQuery({ queryKey: ['report_supplier_transactions'], queryFn: () => fetchRecords('supplier_transactions') });

  const treasury = treasuryRecords[0] || {};
  const openingCapital = Number(treasury.opening_balance || 0);

  const saveOpeningCapitalMutation = useMutation({
    mutationFn: async () => {
      const value = Number(openingCapitalInput);
      if (!Number.isFinite(value)) throw new Error('invalid_opening_capital');
      if (treasury.id) {
        return pb.collection('treasury').update(treasury.id, { opening_balance: value });
      }
      return pb.collection('treasury').create({ opening_balance: value, balance: 0 });
    },
    onSuccess: () => {
      setOpeningCapitalError('');
      queryClient.invalidateQueries({ queryKey: ['report_treasury'] });
    },
    onError: error => setOpeningCapitalError(error.message || 'تعذر حفظ رأس المال الأساسي.'),
  });

  const materialValue = materials.reduce((sum, item) => sum + Number(item.stock || 0) * Number(item.price || 0), 0);
  const recipeCost = productName => recipes.filter(item => (item.product_name || item.name) === productName).reduce((sum, item) => {
    const material = materials.find(record => record.id === (item.raw_material_id || item.material_id));
    return sum + Number(material?.price || 0) * Number(item.quantity_needed || item.quantity || 0);
  }, 0) + Number(recipes.find(item => (item.product_name || item.name) === productName)?.other_cost || 0);
  
  const productRows = productsStock.map(item => ({
    name: item.product_name || item.name || 'منتج بدون اسم',
    quantity: Number(item.stock || item.quantity || 0),
    unitCost: recipeCost(item.product_name || item.name),
  })).map(item => ({ ...item, value: item.quantity * item.unitCost }));

  const productValue = productRows.reduce((sum, item) => sum + item.value, 0);
  const treasuryBalance = Number(treasury.balance || 0);
  const banksBalance = banks.reduce((sum, bank) => sum + Number(bank.balance || 0), 0);
  const customerDebts = clients.reduce((sum, item) => sum + Number(item.balance || 0), 0);
  const supplierDebts = suppliers.reduce((sum, item) => sum + Number(item.balance || 0), 0);
  
  const currentCapital = materialValue + productValue + treasuryBalance + banksBalance + customerDebts - supplierDebts;
  const profitLossValue = currentCapital - openingCapital;
  const isProfit = profitLossValue >= 0;

  const inPeriod = record => {
    const date = dateValue(record.created || record.date);
    return (!startDate || date >= startDate) && (!endDate || date <= endDate);
  };

  const periodSales = salesInvoices.filter(inPeriod);
  const periodPurchases = purchaseInvoices.filter(inPeriod);
  const periodExpenses = expenses.filter(inPeriod);
  const periodClientTransactions = clientTransactions.filter(inPeriod).filter(item => item.type === 'payment');
  const periodSupplierTransactions = supplierTransactions.filter(inPeriod).filter(item => item.type === 'payment');
  
  const salesTotal = periodSales.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
  const purchasesTotal = periodPurchases.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
  const expensesTotal = periodExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  
  const operationalExpenses = periodExpenses.filter(expense => {
    const category = expenseCategories.find(item => item.id === expense.category_id);
    return category?.type === 'operational';
  }).reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const nonOperationalExpenses = periodExpenses.filter(expense => {
    const category = expenseCategories.find(item => item.id === expense.category_id);
    return category?.type === 'non_operational';
  }).reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const grossMovement = salesTotal - purchasesTotal - expensesTotal;
  const cashSales = periodSales.filter(item => item.payment_type !== 'credit').reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
  const creditSales = periodSales.filter(item => item.payment_type === 'credit').reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
  const collectionsTotal = periodClientTransactions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const supplierPaymentsTotal = periodSupplierTransactions.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const topProducts = Object.entries(periodSales.flatMap(invoice => invoice.items || []).reduce((map, item) => {
    map[item.name] = (map[item.name] || 0) + Number(item.qty || 0);
    return map;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const customerReport = Object.values(periodSales.reduce((map, invoice) => {
    const name = invoice.customer_name || 'عميل غير معروف';
    if (!map[name]) map[name] = { name, amount: 0, quantity: 0, invoices: 0 };
    map[name].amount += Number(invoice.total_amount || 0);
    map[name].invoices += 1;
    (invoice.items || []).forEach(item => { map[name].quantity += Number(item.qty || 0); });
    return map;
  }, {})).sort((a, b) => b.amount - a.amount).slice(0, 15);

  const supplierReport = Object.values(periodPurchases.reduce((map, invoice) => {
    const name = invoice.supplier_name || 'مورد غير معروف';
    if (!map[name]) map[name] = { name, amount: 0, quantity: 0, invoices: 0 };
    map[name].amount += Number(invoice.total_amount || 0);
    map[name].invoices += 1;
    (invoice.items || []).forEach(item => { map[name].quantity += Number(item.qty || 0); });
    return map;
  }, {})).sort((a, b) => b.amount - a.amount);

  const supplierPaymentsByName = periodSupplierTransactions.reduce((map, transaction) => {
    const supplier = suppliers.find(item => item.id === transaction.supplier_id);
    const name = supplier?.name || 'مورد غير معروف';
    map[name] = (map[name] || 0) + Number(transaction.amount || 0);
    return map;
  }, {});

  const agentReport = salesAgents.map(agent => {
    const agentSales = periodSales.filter(invoice => (
      invoice.sales_agent_id === agent.id || invoice.sales_agent_name === agent.name
    ));
    const agentCollections = periodClientTransactions.filter(transaction => (
      transaction.sales_agent_id === agent.id || transaction.sales_agent_name === agent.name
    ));

    return {
      id: agent.id,
      name: agent.name || 'مندوب بدون اسم',
      sales: agentSales.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0),
      collections: agentCollections.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0),
      invoiceCount: agentSales.length,
      collectionCount: agentCollections.length,
    };
  }).sort((first, second) => (second.sales + second.collections) - (first.sales + first.collections));

  const topExpenseCategories = Object.entries(periodExpenses.reduce((map, expense) => {
    const category = expenseCategories.find(item => item.id === expense.category_id);
    const name = category?.name || 'مصروف غير مصنف';
    map[name] = (map[name] || 0) + Number(expense.amount || 0);
    return map;
  }, {})).sort((first, second) => second[1] - first[1]);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8" dir="rtl">
      <div className="border-b pb-5 flex flex-col md:flex-row justify-between gap-4 md:items-center">
        <div>
          <h1 className="text-3xl font-black text-gray-900">📊 مركز التقارير</h1>
          <p className="text-sm text-gray-500 mt-1">صورة مالية وتشغيلية شاملة للمصنع في مكان واحد</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="border bg-white p-2.5 rounded-xl text-xs" />
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="border bg-white p-2.5 rounded-xl text-xs" />
          <button onClick={() => { setStartDate(''); setEndDate(''); }} className="bg-gray-900 text-white px-4 py-2 rounded-xl text-xs font-bold">كل الفترات</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* رأس المال الحالي */}
        <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-xl space-y-2">
          <p className="text-xs text-slate-300 font-bold">رأس المال الحالي</p>
          <h2 className="text-3xl font-black">{money(currentCapital)}</h2>
          <p className="text-xs text-amber-400 font-bold pt-1">({convertToArabicWords(currentCapital)})</p>
          <p className="text-xs text-slate-300 pt-2 border-t border-slate-800">الخامات + المنتجات + الخزنة +البنوك + مستحقات العملاء - مستحقات الموردين</p>
        </div>

        {/* رأس المال الأساسي */}
        <div className="bg-white p-6 rounded-3xl shadow-xl border border-gray-100 space-y-2">
          <p className="text-xs text-gray-500 font-bold">رأس المال الأساسي</p>
          <h2 className="text-3xl font-black text-blue-700">{money(openingCapital)}</h2>
          <p className="text-xs text-blue-600 font-bold">({convertToArabicWords(openingCapital)})</p>
          <p className="text-xs text-gray-400 pt-1">اكتب القيمة الأساسية يدويًا</p>
          <div className="mt-2 flex gap-2">
            <input 
              type="number" 
              min="0" 
              step="0.01" 
              value={openingCapitalInput ?? treasury.opening_balance ?? ''} 
              onChange={event => { setOpeningCapitalInput(event.target.value); setOpeningCapitalError(''); }} 
              placeholder="رأس المال الأساسي" 
              className="w-full border bg-gray-50 p-2 rounded-xl text-xs" 
            />
            <button 
              onClick={() => saveOpeningCapitalMutation.mutate()} 
              disabled={saveOpeningCapitalMutation.isPending || openingCapitalInput === null || openingCapitalInput === ''} 
              className="bg-gray-900 text-white px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap"
            >
              حفظ
            </button>
          </div>
          {openingCapitalError && <p className="text-xs text-red-600 mt-1">تعذر الحفظ: {openingCapitalError}</p>}
        </div>

        {/* الربح أو الخسارة */}
        <div className={`p-6 rounded-3xl shadow-xl text-white space-y-2 ${isProfit ? 'bg-emerald-600' : 'bg-red-600'}`}>
          <p className="text-xs font-bold opacity-80">الفرق / الربح أو الخسارة</p>
          <h2 className="text-3xl font-black">{money(profitLossValue)}</h2>
          <p className="text-xs font-bold opacity-90 pt-1">({convertToArabicWords(profitLossValue)})</p>
          <p className="text-xs opacity-80 pt-2 border-t border-white/20">{isProfit ? 'ربح' : 'خسارة'} • يتغير تلقائيًا مع تغير الأصول والالتزامات</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          ['قيمة الخامات', materialValue, 'text-amber-700'], 
          ['قيمة المنتجات', productValue, 'text-indigo-700'], 
          ['رصيد الخزنة', treasuryBalance, 'text-blue-700'], 
          ['أرصدة البنوك', banksBalance, 'text-cyan-700'], 
          ['مديونية العملاء', customerDebts, 'text-emerald-700'], 
          ['مستحقات الموردين', supplierDebts, 'text-red-700']
        ].map(([label, value, color]) => (
          <div key={label} className="bg-white border rounded-2xl p-4 space-y-1.5 flex flex-col justify-between">
            <div>
              <p className="text-[11px] text-gray-500 font-bold">{label}</p>
              <p className={`text-lg font-black mt-1 ${color}`}>{money(value)}</p>
            </div>
            <p className="text-[10px] text-gray-500 font-bold pt-1 border-t border-gray-100">({convertToArabicWords(value)})</p>
          </div>
        ))}
      </div>

      <section className="bg-white rounded-3xl shadow-xl border p-6 space-y-5">
        <div className="flex justify-between items-center border-b pb-3">
          <h2 className="text-lg font-black">📈 ملخص الفترة المحددة</h2>
          <span className="text-xs text-gray-400">{startDate || 'البداية'} إلى {endDate || 'اليوم'}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-emerald-50 p-4 rounded-2xl"><p className="text-xs font-bold text-emerald-800">المبيعات</p><p className="text-xl font-black text-emerald-700 mt-1">{money(salesTotal)}</p></div>
          <div className="bg-blue-50 p-4 rounded-2xl"><p className="text-xs font-bold text-blue-800">المشتريات</p><p className="text-xl font-black text-blue-700 mt-1">{money(purchasesTotal)}</p></div>
          <div className="bg-red-50 p-4 rounded-2xl"><p className="text-xs font-bold text-red-800">كل المصروفات</p><p className="text-xl font-black text-red-700 mt-1">{money(expensesTotal)}</p></div>
          <div className="bg-orange-50 p-4 rounded-2xl"><p className="text-xs font-bold text-orange-800">تشغيلية</p><p className="text-xl font-black text-orange-700 mt-1">{money(operationalExpenses)}</p></div>
          <div className="bg-violet-50 p-4 rounded-2xl"><p className="text-xs font-bold text-violet-800">غير تشغيلية</p><p className="text-xl font-black text-violet-700 mt-1">{money(nonOperationalExpenses)}</p></div>
          <div className={`${grossMovement >= 0 ? 'bg-emerald-50' : 'bg-red-50'} p-4 rounded-2xl`}><p className="text-xs font-bold">صافي الحركة</p><p className={`text-xl font-black mt-1 ${grossMovement >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{money(grossMovement)}</p></div>
        </div>
      </section>

      <section className="bg-white rounded-3xl shadow-xl border p-6">
        <div className="flex justify-between items-center border-b pb-3">
          <div>
            <h2 className="text-lg font-black">🧑‍💼 مبيعات وتحصيلات كل مندوب</h2>
            <p className="text-xs text-gray-500 mt-1">حسب الفترة المحددة بالأعلى</p>
          </div>
          <span className="text-xs text-gray-400">{agentReport.length} مندوب</span>
        </div>
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-right text-xs">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3">#</th>
                <th className="p-3">المندوب</th>
                <th className="p-3">عدد الفواتير</th>
                <th className="p-3">إجمالي المبيعات</th>
                <th className="p-3">عدد التحصيلات</th>
                <th className="p-3">إجمالي التحصيلات</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {agentReport.map((agent, index) => (
                <tr key={agent.id} className="hover:bg-gray-50">
                  <td className="p-3 text-gray-400">{index + 1}</td>
                  <td className="p-3 font-bold">{agent.name}</td>
                  <td className="p-3">{agent.invoiceCount}</td>
                  <td className="p-3 font-black text-emerald-700">{money(agent.sales)}</td>
                  <td className="p-3">{agent.collectionCount}</td>
                  <td className="p-3 font-black text-cyan-700">{money(agent.collections)}</td>
                </tr>
              ))}
              {!agentReport.length && <tr><td colSpan="6" className="p-8 text-center text-gray-400">لا توجد مناديب مسجلون.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white rounded-3xl shadow-xl border p-6">
        <h2 className="text-lg font-black border-b pb-3">🧾 كل أنواع المصروفات الفرعية</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 mt-4">
          {topExpenseCategories.length ? topExpenseCategories.map(([name, value], index) => (
            <div key={name} className="bg-gray-50 border rounded-2xl p-4">
              <p className="text-xs text-gray-500 font-bold">#{index + 1} {name}</p>
              <p className="text-lg font-black text-red-700 mt-2">{money(value)}</p>
            </div>
          )) : <p className="text-xs text-gray-400 md:col-span-5 text-center p-4">لا توجد مصروفات في الفترة.</p>}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-3xl shadow-xl border p-6">
          <h2 className="text-lg font-black border-b pb-3">💵 تحليل المبيعات والتحصيلات</h2>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-emerald-50 p-4 rounded-2xl"><p className="text-xs font-bold">مبيعات كاش</p><p className="text-lg font-black text-emerald-700 mt-1">{money(cashSales)}</p></div>
            <div className="bg-amber-50 p-4 rounded-2xl"><p className="text-xs font-bold">مبيعات آجل</p><p className="text-lg font-black text-amber-700 mt-1">{money(creditSales)}</p></div>
            <div className="bg-cyan-50 p-4 rounded-2xl col-span-2"><p className="text-xs font-bold text-cyan-800">تحصيلات العملاء</p><p className="text-lg font-black text-cyan-700 mt-1">{money(collectionsTotal)}</p></div>
          </div>
          <p className="text-xs text-gray-500 mt-4">عدد الفواتير: <b>{periodSales.length}</b> | عدد التحصيلات: <b>{periodClientTransactions.length}</b></p>
        </section>

        <section className="bg-white rounded-3xl shadow-xl border p-6">
          <h2 className="text-lg font-black border-b pb-3">🏆 أعلى 5 منتجات مبيعًا</h2>
          <div className="mt-3 space-y-2">
            {topProducts.length ? topProducts.map(([name, quantity], index) => (
              <div key={name} className="flex justify-between bg-gray-50 p-3 rounded-xl text-xs">
                <span className="font-bold">{index + 1}. {name}</span>
                <span className="font-black text-blue-700">{quantity.toLocaleString()} طن</span>
              </div>
            )) : <p className="text-xs text-gray-400 py-5 text-center">لا توجد مبيعات في الفترة.</p>}
          </div>
        </section>
      </div>

      <section className="bg-white rounded-3xl shadow-xl border p-6">
        <div className="flex justify-between items-center border-b pb-3">
          <h2 className="text-lg font-black">💳 تسديدات الموردين</h2>
          <span className="text-lg font-black text-red-700">{money(supplierPaymentsTotal)}</span>
        </div>
        <p className="text-xs text-gray-500 mt-3">عدد عمليات التسديد خلال الفترة: <b>{periodSupplierTransactions.length}</b></p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-3xl shadow-xl border p-6">
          <h2 className="text-lg font-black border-b pb-3">👥 أعلى 15 عميل شراء</h2>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-right text-xs">
              <thead className="bg-gray-100"><tr><th className="p-3">#</th><th className="p-3">العميل</th><th className="p-3">الكميات</th><th className="p-3">قيمة المشتريات</th></tr></thead>
              <tbody className="divide-y">
                {customerReport.map((row, index) => (
                  <tr key={row.name}>
                    <td className="p-3 text-gray-400">{index + 1}</td>
                    <td className="p-3 font-bold">{row.name}</td>
                    <td className="p-3">{row.quantity.toLocaleString()} وحدة</td>
                    <td className="p-3 font-black text-emerald-700">{money(row.amount)}</td>
                  </tr>
                ))}
                {!customerReport.length && <tr><td colSpan="4" className="p-6 text-center text-gray-400">لا توجد مشتريات عملاء في الفترة.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-white rounded-3xl shadow-xl border p-6">
          <h2 className="text-lg font-black border-b pb-3">🏢 تقرير الموردين</h2>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-right text-xs">
              <thead className="bg-gray-100"><tr><th className="p-3">المورد</th><th className="p-3">الكميات</th><th className="p-3">قيمة المشتريات</th><th className="p-3">التسديدات</th></tr></thead>
              <tbody className="divide-y">
                {supplierReport.map(row => (
                  <tr key={row.name}>
                    <td className="p-3 font-bold">{row.name}</td>
                    <td className="p-3">{row.quantity.toLocaleString()} وحدة</td>
                    <td className="p-3 font-black text-blue-700">{money(row.amount)}</td>
                    <td className="p-3 font-black text-red-700">{money(supplierPaymentsByName[row.name] || 0)}</td>
                  </tr>
                ))}
                {!supplierReport.length && <tr><td colSpan="4" className="p-6 text-center text-gray-400">لا توجد مشتريات موردين في الفترة.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="bg-white rounded-3xl shadow-xl border p-6">
        <h2 className="text-lg font-black border-b pb-3">📦 قيمة المخزون بالتفصيل</h2>
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-right text-xs">
            <thead className="bg-gray-100"><tr><th className="p-3">المنتج</th><th className="p-3">الكمية</th><th className="p-3">تكلفة الوحدة</th><th className="p-3">إجمالي القيمة</th></tr></thead>
            <tbody className="divide-y">
              {productRows.map(row => (
                <tr key={row.name}>
                  <td className="p-3 font-bold">{row.name}</td>
                  <td className="p-3">{row.quantity.toLocaleString()}</td>
                  <td className="p-3">{money(row.unitCost)}</td>
                  <td className="p-3 font-black text-indigo-700">{money(row.value)}</td>
                </tr>
              ))}
              {!productRows.length && <tr><td colSpan="4" className="p-6 text-center text-gray-400">لا توجد منتجات في المخزن.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}