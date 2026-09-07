'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';

const money = (value) => Number(value || 0).toLocaleString('en-US');
const safeNum = (value) => Number(value || 0);
const normalizeText = (value = '') =>
  String(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export default function SalesAgentsPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const [form, setForm] = useState({
    name: '',
    phone: '',
    region: '',
    notes: '',
    active: true,
  });

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    window.setTimeout(() => {
      setToast((prev) => ({ ...prev, show: false }));
    }, 3500);
  };

  const { data: agents = [] } = useQuery({
    queryKey: ['sales_agents'],
    queryFn: async () => {
      try {
        return await pb.collection('sales_agents').getFullList({ sort: '-created' });
      } catch {
        return [];
      }
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['sales_invoices_for_agents'],
    queryFn: async () => {
      try {
        return await pb.collection('sales_invoices').getFullList({ sort: '-created' });
      } catch {
        return [];
      }
    },
  });

  const { data: clientTransactions = [] } = useQuery({
    queryKey: ['client_transactions_for_agents'],
    queryFn: async () => {
      try {
        return await pb.collection('client_transactions').getFullList({ sort: '-created' });
      } catch {
        return [];
      }
    },
  });

  const agentsReport = useMemo(() => {
    return agents
      .map((agent) => {
        const agentInvoices = invoices.filter((invoice) => {
          const matchById = invoice.sales_agent_id === agent.id;
          const matchByName = normalizeText(invoice.sales_agent_name || '') === normalizeText(agent.name || '');
          return matchById || matchByName;
        });

        const filteredByDate = agentInvoices.filter((invoice) => {
          const date = String(invoice.created || '').slice(0, 10);
          if (startDate && date < startDate) return false;
          if (endDate && date > endDate) return false;
          return true;
        });

        const agentCollections = clientTransactions.filter((transaction) => {
          const isPayment = String(transaction.type || '').toLowerCase() === 'payment';
          const matchById = transaction.sales_agent_id === agent.id;
          const matchByName = normalizeText(transaction.sales_agent_name || '') === normalizeText(agent.name || '');
          if (!isPayment || (!matchById && !matchByName)) return false;
          const date = String(transaction.created || transaction.date || '').slice(0, 10);
          if (startDate && date < startDate) return false;
          if (endDate && date > endDate) return false;
          return true;
        });

        const totalSales = filteredByDate.reduce((sum, invoice) => sum + safeNum(invoice.total_amount), 0);
        const totalQty = filteredByDate.reduce((sum, invoice) => {
          const items = Array.isArray(invoice.items) ? invoice.items : [];
          return sum + items.reduce((itemSum, item) => itemSum + safeNum(item.qty), 0);
        }, 0);
        const collectionTotal = agentCollections.reduce((sum, transaction) => sum + safeNum(transaction.amount), 0);

        return {
          ...agent,
          invoiceCount: filteredByDate.length,
          totalSales,
          totalQty,
          collectionTotal,
          collectionCount: agentCollections.length,
          invoices: filteredByDate,
          collections: agentCollections,
        };
      })
      .filter((agent) => {
        const query = normalizeText(searchTerm).toLowerCase();
        if (!query) return true;
        const haystack = normalizeText(`${agent.name || ''} ${agent.region || ''} ${agent.phone || ''}`).toLowerCase();
        return haystack.includes(query);
      });
  }, [agents, invoices, clientTransactions, searchTerm, startDate, endDate]);

  const totalCollections = agentsReport.reduce((sum, agent) => sum + safeNum(agent.collectionTotal), 0);

  const createAgentMutation = useMutation({
    mutationFn: async (payload) => pb.collection('sales_agents').create(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sales_agents'] });
      setForm({ name: '', phone: '', region: '', notes: '', active: true });
      showToast('✅ تم إضافة المندوب بنجاح');
    },
    onError: (error) => {
      showToast('❌ فشل إضافة المندوب: ' + (error?.message || 'خطأ غير معروف'), 'error');
    },
  });

  const totalRevenue = agentsReport.reduce((sum, agent) => sum + safeNum(agent.totalSales), 0);
  const totalQty = agentsReport.reduce((sum, agent) => sum + safeNum(agent.totalQty), 0);
  const activeAgents = agents.filter((agent) => agent.active !== false).length;

  const handleCreateAgent = (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      showToast('⚠️ اسم المندوب مطلوب', 'error');
      return;
    }

    createAgentMutation.mutate({
      name: form.name.trim(),
      phone: form.phone.trim(),
      region: form.region.trim(),
      notes: form.notes.trim(),
      active: Boolean(form.active),
    });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 md:p-8" dir="rtl">
      {toast.show && (
        <div
          className={`fixed left-5 top-5 z-50 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-2xl ${
            toast.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-[11px] font-bold text-emerald-700">إجمالي مبيعات المناديب</p>
          <p className="mt-2 text-2xl font-black text-emerald-900">{money(totalRevenue)} ج.م</p>
        </div>
        <div className="rounded-3xl border border-cyan-200 bg-cyan-50 p-4 shadow-sm">
          <p className="text-[11px] font-bold text-cyan-700">إجمالي التحصيلات</p>
          <p className="mt-2 text-2xl font-black text-cyan-900">{money(totalCollections)} ج.م</p>
        </div>
        <div className="rounded-3xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
          <p className="text-[11px] font-bold text-blue-700">إجمالي الكميات</p>
          <p className="mt-2 text-2xl font-black text-blue-900">{money(totalQty)}</p>
        </div>
        <div className="rounded-3xl border border-violet-200 bg-violet-50 p-4 shadow-sm">
          <p className="text-[11px] font-bold text-violet-700">عدد المناديب</p>
          <p className="mt-2 text-2xl font-black text-violet-900">{agents.length}</p>
        </div>
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="text-[11px] font-bold text-amber-700">مناديب فعالين</p>
          <p className="mt-2 text-2xl font-black text-amber-900">{activeAgents}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
          <h3 className="mb-4 text-lg font-black text-slate-800">👤 إضافة مندوب</h3>
          <form onSubmit={handleCreateAgent} className="space-y-3">
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold outline-none focus:border-emerald-500"
              placeholder="اسم المندوب"
            />
            <input
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold outline-none focus:border-emerald-500"
              placeholder="رقم الهاتف"
            />
            <input
              value={form.region}
              onChange={(event) => setForm({ ...form, region: event.target.value })}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold outline-none focus:border-emerald-500"
              placeholder="المنطقة / المدينة"
            />
            <textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold outline-none focus:border-emerald-500"
              rows="2"
              placeholder="ملاحظات"
            />
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              مندوب فعال
            </label>
            <button
              type="submit"
              disabled={createAgentMutation.isPending}
              className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-black text-white shadow-md transition hover:bg-emerald-700"
            >
              {createAgentMutation.isPending ? 'جاري الحفظ...' : 'إضافة مندوب'}
            </button>
          </form>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h3 className="text-lg font-black text-slate-800">📊 تقرير مبيعات المناديب</h3>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="بحث بالاسم أو المنطقة..."
                className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold outline-none focus:border-emerald-500"
              />
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold outline-none focus:border-emerald-500"
              />
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-right text-xs">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-3">المندوب</th>
                  <th className="p-3">المنطقة</th>
                  <th className="p-3">عدد الفواتير</th>
                  <th className="p-3">إجمالي الكميات</th>
                  <th className="p-3">إجمالي القيمة</th>
                  <th className="p-3">التحصيلات</th>
                  <th className="p-3">عدد التحصيلات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agentsReport.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="p-6 text-center text-slate-500">
                      لا توجد بيانات للمناديب في هذه الفترة.
                    </td>
                  </tr>
                ) : (
                  agentsReport.map((agent) => (
                    <tr key={agent.id} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-slate-800">
                        <div>{agent.name}</div>
                        <div className="mt-1 text-[10px] text-slate-500">{agent.phone || '—'}</div>
                      </td>
                      <td className="p-3 text-slate-600">{agent.region || '—'}</td>
                      <td className="p-3 text-slate-700">{agent.invoiceCount}</td>
                      <td className="p-3 font-bold text-blue-700">{money(agent.totalQty)}</td>
                      <td className="p-3 font-black text-emerald-700">{money(agent.totalSales)} ج.م</td>
                      <td className="p-3 font-black text-cyan-700">{money(agent.collectionTotal)} ج.م</td>
                      <td className="p-3 text-slate-700">{agent.collectionCount}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
