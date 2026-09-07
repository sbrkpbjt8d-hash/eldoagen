'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';

const today = new Date().toISOString().slice(0, 10);
const amountValue = value => Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 });

export default function OtherAccountsPage() {
  const queryClient = useQueryClient();
  const [recipientName, setRecipientName] = useState('');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('treasury');
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [returnAmounts, setReturnAmounts] = useState({});
  const [returnSources, setReturnSources] = useState({});
  const [message, setMessage] = useState({ text: '', type: 'success' });

  const currentUser = pb.authStore.model;
  const actorName = currentUser?.name || currentUser?.email || 'مستخدم النظام';

  const { data: treasuryRecords = [] } = useQuery({
    queryKey: ['other_accounts_treasury'],
    queryFn: () => pb.collection('treasury').getFullList().catch(() => []),
  });
  const { data: banks = [] } = useQuery({
    queryKey: ['other_accounts_banks'],
    queryFn: () => pb.collection('banks').getFullList({ sort: 'name' }).catch(() => []),
  });
  const { data: advances = [] } = useQuery({
    queryKey: ['other_accounts_advances'],
    queryFn: () => pb.collection('advances').getFullList({ sort: '-created' }).catch(() => []),
  });

  const otherAdvances = advances.filter(item => item.advance_type === 'other' && Number(item.remaining_amount ?? item.amount ?? 0) > 0);
  const treasury = treasuryRecords[0] || null;

  const updateBalance = async (sourceType, bankId, delta) => {
    if (sourceType === 'treasury') {
      if (treasury) {
        await pb.collection('treasury').update(treasury.id, { balance: Number(treasury.balance || 0) + delta });
      } else {
        await pb.collection('treasury').create({ opening_balance: 0, balance: delta });
      }
      return;
    }

    const bank = banks.find(item => item.id === bankId);
    if (!bank) throw new Error('البنك المختار غير موجود.');
    await pb.collection('banks').update(bank.id, { balance: Number(bank.balance || 0) + delta });
  };

  const createAdvanceMutation = useMutation({
    mutationFn: async () => {
      const numericAmount = Number(amount);
      if (!recipientName.trim()) throw new Error('اكتب اسم مستلم العهدة.');
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error('اكتب مبلغ عهدة صحيح.');
      if (source !== 'treasury' && !banks.some(bank => bank.id === source)) throw new Error('اختر مصدر صرف صحيح.');

      const sourceType = source === 'treasury' ? 'treasury' : 'bank';
      const advance = await pb.collection('advances').create({
        advance_type: 'other',
        recipient_name: recipientName.trim(),
        amount: numericAmount,
        original_amount: numericAmount,
        returned_amount: 0,
        remaining_amount: numericAmount,
        source_type: sourceType,
        bank_id: sourceType === 'bank' ? source : '',
        status: 'open',
        date,
        notes: notes.trim() || 'عهدة',
        actor_name: actorName,
        is_deducted: false,
      });

      await updateBalance(sourceType, source, -numericAmount);
      await pb.collection('treasury_transactions').create({
        type: 'purchase',
        movement_type: 'other_advance',
        source_type: sourceType,
        bank_id: sourceType === 'bank' ? source : '',
        amount: numericAmount,
        title: `صرف عهدة: ${recipientName.trim()}`,
        notes: notes.trim() || 'صرف عهدة',
        date,
        actor_name: actorName,
        advance_id: advance.id,
      });
      return advance;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['other_accounts_advances'] });
      queryClient.invalidateQueries({ queryKey: ['other_accounts_treasury'] });
      queryClient.invalidateQueries({ queryKey: ['other_accounts_banks'] });
      setRecipientName('');
      setAmount('');
      setNotes('');
      setSource('treasury');
      setMessage({ text: 'تم صرف العهدة وخصمها من المصدر وتسجيلها في السجل.', type: 'success' });
    },
    onError: error => setMessage({ text: error.message || 'تعذر تسجيل العهدة.', type: 'error' }),
  });

  const returnAdvanceMutation = useMutation({
    mutationFn: async ({ advance, returnAmount, returnSource }) => {
      const numericReturn = Number(returnAmount);
      const remaining = Number(advance.remaining_amount ?? advance.amount ?? 0);
      if (!Number.isFinite(numericReturn) || numericReturn <= 0) throw new Error('اكتب مبلغ رد صحيح.');
      if (numericReturn > remaining) throw new Error('مبلغ الرد أكبر من المتبقي في العهدة.');
      if (returnSource !== 'treasury' && !banks.some(bank => bank.id === returnSource)) throw new Error('اختر مصدر إيداع صحيح.');

      const nextRemaining = remaining - numericReturn;
      const sourceType = returnSource === 'treasury' ? 'treasury' : 'bank';
      await pb.collection('advances').update(advance.id, {
        returned_amount: Number(advance.returned_amount || 0) + numericReturn,
        remaining_amount: nextRemaining,
        status: nextRemaining === 0 ? 'closed' : 'open',
        is_deducted: nextRemaining === 0,
      });
      await updateBalance(sourceType, returnSource, numericReturn);
      await pb.collection('treasury_transactions').create({
        type: 'purchase',
        movement_type: 'other_advance_return',
        source_type: sourceType,
        bank_id: sourceType === 'bank' ? returnSource : '',
        amount: numericReturn,
        title: `رد عهدة: ${advance.recipient_name || 'غير معروف'}`,
        notes: nextRemaining === 0 ? 'رد كامل للعهدة' : `رد جزئي، المتبقي ${nextRemaining}`,
        date: today,
        actor_name: actorName,
        advance_id: advance.id,
      });
      if (nextRemaining === 0) {
        await pb.collection('advances').delete(advance.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['other_accounts_advances'] });
      queryClient.invalidateQueries({ queryKey: ['other_accounts_treasury'] });
      queryClient.invalidateQueries({ queryKey: ['other_accounts_banks'] });
      setReturnAmounts({});
      setReturnSources({});
      setMessage({ text: 'تم رد المبلغ وتحديث رصيد المصدر وتسجيل الحركة.', type: 'success' });
    },
    onError: error => setMessage({ text: error.message || 'تعذر رد مبلغ العهدة.', type: 'error' }),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8" dir="rtl">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-black text-gray-800">حسابات أخرى</h1>
        <p className="mt-1 text-xs text-gray-500">إدارة العهد المصروفة من الخزنة أو البنوك ومتابعة ردها</p>
      </div>

      {message.text && <div className={`rounded-2xl p-4 text-xs font-bold ${message.type === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{message.text}</div>}

      <section className="rounded-3xl border bg-white p-6 shadow-xl">
        <h2 className="mb-4 border-b pb-3 text-lg font-black">➕ صرف عهدة جديدة</h2>
        <form onSubmit={event => { event.preventDefault(); createAdvanceMutation.mutate(); }} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <input value={recipientName} onChange={event => setRecipientName(event.target.value)} placeholder="اسم مستلم العهدة *" className="rounded-xl border p-3 text-xs outline-none focus:border-blue-500" required />
          <input type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} placeholder="مبلغ العهدة *" className="rounded-xl border p-3 text-xs outline-none focus:border-blue-500" required />
          <select value={source} onChange={event => setSource(event.target.value)} className="rounded-xl border bg-white p-3 text-xs font-bold outline-none focus:border-blue-500">
            <option value="treasury">الخزنة</option>
            {banks.map(bank => <option key={bank.id} value={bank.id}>البنك: {bank.name}</option>)}
          </select>
          <input type="date" value={date} onChange={event => setDate(event.target.value)} className="rounded-xl border p-3 text-xs outline-none focus:border-blue-500" required />
          <input value={notes} onChange={event => setNotes(event.target.value)} placeholder="ملاحظات اختيارية" className="rounded-xl border p-3 text-xs outline-none focus:border-blue-500 md:col-span-2" />
          <button type="submit" disabled={createAdvanceMutation.isPending} className="rounded-xl bg-blue-600 px-6 py-3 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60 md:col-span-2">حفظ وصرف العهدة</button>
        </form>
      </section>

      <section className="overflow-hidden rounded-3xl border bg-white shadow-xl">
        <div className="border-b bg-gray-50 p-5"><h2 className="text-lg font-black">📋 العهد المفتوحة</h2></div>
        <div className="overflow-x-auto p-4">
          <table className="w-full text-right text-xs">
            <thead className="bg-gray-100"><tr><th className="p-3">المستلم</th><th className="p-3">المبلغ</th><th className="p-3">المتبقي</th><th className="p-3">المصدر</th><th className="p-3">التاريخ</th><th className="p-3">رد عهدة</th></tr></thead>
            <tbody className="divide-y">
              {otherAdvances.map(advance => {
                const originalSourceName = advance.source_type === 'bank' ? `بنك: ${banks.find(bank => bank.id === advance.bank_id)?.name || 'غير معروف'}` : 'الخزنة';
                const returnSource = returnSources[advance.id] || 'treasury';
                return <tr key={advance.id}>
                  <td className="p-3 font-bold">{advance.recipient_name || 'غير معروف'}</td>
                  <td className="p-3">{amountValue(advance.original_amount ?? advance.amount)} ج.م</td>
                  <td className="p-3 font-black text-red-700">{amountValue(advance.remaining_amount ?? advance.amount)} ج.م</td>
                  <td className="p-3">صرف من: {originalSourceName}</td>
                  <td className="p-3">{String(advance.date || advance.created || '').slice(0, 10)}</td>
                  <td className="p-3"><div className="flex min-w-64 flex-wrap gap-2"><select value={returnSource} onChange={event => setReturnSources(current => ({ ...current, [advance.id]: event.target.value }))} className="w-full rounded-lg border bg-white p-2 text-xs"><option value="treasury">إيداع في الخزنة</option>{banks.map(bank => <option key={bank.id} value={bank.id}>إيداع في بنك: {bank.name}</option>)}</select><input type="number" min="0.01" step="0.01" value={returnAmounts[advance.id] || ''} onChange={event => setReturnAmounts(current => ({ ...current, [advance.id]: event.target.value }))} placeholder="مبلغ الرد" className="w-full rounded-lg border p-2 text-xs" /><button onClick={() => returnAdvanceMutation.mutate({ advance, returnAmount: returnAmounts[advance.id], returnSource })} disabled={returnAdvanceMutation.isPending} className="rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-60">رد</button></div></td>
                </tr>;
              })}
              {!otherAdvances.length && <tr><td colSpan="6" className="p-8 text-center text-gray-400">لا توجد عهد مفتوحة.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}