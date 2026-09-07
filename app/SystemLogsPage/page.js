'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';

export default function SystemLogsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('all'); // فلترة بنوع الحركة
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedLog, setSelectedLog] = useState(null); // نافذة التفاصيل

  const isAdmin = true; // تحقق الصلاحيات

  // 1. جلب السجلات من الجداول المختلفة
  const { data: banks = [] } = useQuery({
    queryKey: ['logs_banks'],
    queryFn: async () => pb.collection('banks').getFullList({ sort: '-created' }).catch(() => []),
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ['logs_expenses'],
    queryFn: async () => pb.collection('expenses').getFullList({ sort: '-created', expand: 'category_id' }).catch(() => []),
  });

  const { data: clientTransactions = [] } = useQuery({
    queryKey: ['logs_client_transactions'],
    queryFn: async () => pb.collection('client_transactions').getFullList({ sort: '-created', expand: 'client_id' }).catch(() => []),
  });

  // دمج وتصنيف الحركات بدقة
  const allSystemLogs = [
    ...banks.map(b => ({
      id: b.id,
      section: 'البنوك',
      type: 'bank_operation',
      typeName: 'حركة بنكية',
      action: 'إضافة / تعديل بنك',
      actor: b.actor_name || 'مسؤول النظام',
      date: b.created,
      details: {
        'اسم البنك': b.name,
        'الرصيد الافتتاحي': `${Number(b.opening_balance || 0).toLocaleString()} ج.م`,
        'الرصيد الحالي': `${Number(b.balance || 0).toLocaleString()} ج.م`,
        'ملاحظات': b.notes || 'لا توجد ملاحظات'
      }
    })),
    ...expenses.map(e => ({
      id: e.id,
      section: 'المصروفات',
      type: 'expense',
      typeName: 'مصروف',
      action: 'تسجيل مصروف جديد',
      actor: e.actor_name || 'مسؤول النظام',
      date: e.created || e.date,
      details: {
        'بند المصروف': e.expand?.category_id?.name || 'مصروف عام',
        'المبلغ': `${Number(e.amount || 0).toLocaleString()} ج.م`,
        'طريقة الدفع': e.payment_source || 'خزنة',
        'ملاحظات': e.notes || 'لا توجد ملاحظات'
      }
    })),
    ...clientTransactions.map(t => ({
      id: t.id,
      section: 'حركات العملاء',
      type: 'client_transaction',
      typeName: 'حركة عملاء',
      action: 'حركة مالية لعميل',
      actor: t.actor_name || 'مسؤول النظام',
      date: t.created || t.date,
      details: {
        'اسم العميل': t.expand?.client_id?.name || 'عميل',
        'المبلغ': `${Number(t.amount || 0).toLocaleString()} ج.م`,
        'الوجهة': t.destination || '-',
        'ملاحظات': t.notes || 'لا توجد ملاحظات'
      }
    }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  // تصفية السجلات حسب البحث، الفترة، ونوع الحركة
  const filteredLogs = allSystemLogs.filter(log => {
    const logDate = String(log.date || '').slice(0, 10);
    
    if (startDate && logDate < startDate) return false;
    if (endDate && logDate > endDate) return false;

    // فلترة حسب نوع الحركة المحدد في القائمة المنسدلة
    if (selectedType !== 'all' && log.type !== selectedType) {
      return false;
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchActor = log.actor.toLowerCase().includes(term);
      const matchSection = log.section.toLowerCase().includes(term);
      if (!matchActor && !matchSection) return false;
    }

    return true;
  });

  if (!isAdmin) {
    return (
      <div className="p-12 text-center" dir="rtl">
        <h1 className="text-2xl font-black text-red-600">عذراً، هذه الصفحة مخصصة للأدمن فقط! 🚫</h1>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6 relative" dir="rtl" suppressHydrationWarning>

      {/* نافذة تفاصيل الحركة المنسقة بشكل احترافي */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="text-base font-black text-gray-800">🔍 تفاصيل الحركة: {selectedLog.action}</h3>
              <button onClick={() => setSelectedLog(null)} className="text-gray-400 font-bold text-lg hover:text-gray-700">✕</button>
            </div>
            
            <div className="space-y-3 text-xs">
              <div className="bg-blue-50 border border-blue-100 p-3 rounded-xl flex justify-between items-center">
                <span className="font-bold text-gray-500">القسم:</span>
                <span className="font-black text-blue-700">{selectedLog.section}</span>
              </div>
              <div className="bg-gray-50 p-3 rounded-xl flex justify-between items-center">
                <span className="font-bold text-gray-500">بواسطة المسؤول:</span>
                <span className="font-black text-emerald-600">{selectedLog.actor}</span>
              </div>
              <div className="bg-gray-50 p-3 rounded-xl flex justify-between items-center">
                <span className="font-bold text-gray-500">تاريخ ووقت الحركة:</span>
                <span className="font-bold text-gray-700">{new Date(selectedLog.date).toLocaleString()}</span>
              </div>

              {/* تفاصيل الحقول المستخرجة بوضوح */}
              <div className="border border-gray-100 rounded-xl p-3 space-y-2 bg-gray-50/50">
                <p className="font-black text-gray-700 mb-1 border-b pb-1">البيانات المسجلة:</p>
                {Object.entries(selectedLog.details).map(([key, value], idx) => (
                  <div key={idx} className="flex justify-between items-center text-xs">
                    <span className="font-bold text-gray-500">{key}:</span>
                    <span className="font-black text-gray-900">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button onClick={() => setSelectedLog(null)} className="bg-gray-900 text-white px-6 py-2.5 rounded-xl text-xs font-bold w-full">
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* الهيدر */}
      <div className="border-b pb-4">
        <h1 className="text-2xl font-black text-gray-800">🛡️ سجلات النظام (لوحة تحكم الأدمن)</h1>
        <p className="text-xs text-gray-500 mt-1">متابعة كافة الحركات والإجراءات التي تتم داخل النظام وتفاصيلها الكاملة</p>
      </div>

      {/* أدوات البحث والفترة وفلترة نوع الحركة */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1">بحث باسم المستخدم / القسم</label>
          <input
            type="text"
            placeholder="🔍 ابحث هنا..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full border p-2.5 rounded-xl text-xs outline-none focus:border-blue-500 bg-gray-50"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1">نوع الحركة</label>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="w-full border p-2.5 rounded-xl text-xs outline-none focus:border-blue-500 bg-gray-50 font-bold"
          >
            <option value="all">جميع الحركات</option>
            <option value="expense">مصروف</option>
            <option value="bank_operation">حركة بنكية</option>
            <option value="client_transaction">حركة عملاء</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1">من تاريخ</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full border p-2.5 rounded-xl text-xs outline-none focus:border-blue-500 bg-gray-50"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-gray-700 block mb-1">إلى تاريخ</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full border p-2.5 rounded-xl text-xs outline-none focus:border-blue-500 bg-gray-50"
          />
        </div>
      </div>

      {/* جدول السجلات */}
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
        <div className="p-4 bg-gray-50 border-b flex justify-between items-center">
          <h2 className="text-sm font-bold text-gray-800">📋 سجل الحركات العامة ({filteredLogs.length} حركة)</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-gray-50 text-gray-500 border-b">
              <tr>
                <th className="p-3">التاريخ والوقت</th>
                <th className="p-3">القسم</th>
                <th className="p-3">نوع الحركة</th>
                <th className="p-3">اسم المسؤول</th>
                <th className="p-3 text-center">عرض التفاصيل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50/60 transition">
                  <td className="p-3 text-gray-600 font-medium">{new Date(log.date).toLocaleString()}</td>
                  <td className="p-3">
                    <span className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg text-[10px] font-black">
                      {log.section}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg text-[10px] font-bold">
                      {log.typeName}
                    </span>
                  </td>
                  <td className="p-3 font-black text-gray-800">{log.actor}</td>
                  <td className="p-3 text-center">
                    <button
                      onClick={() => setSelectedLog(log)}
                      className="bg-gray-900 hover:bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition shadow-sm"
                    >
                      👁️ عرض
                    </button>
                  </td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan="5" className="p-8 text-center text-gray-400 font-bold">
                    لا توجد سجلات مطابقة للبحث أو الفترة المحددة.
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