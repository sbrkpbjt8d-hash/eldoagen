'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase'; // تأكد من مطابقة مسار ملف الـ pocketbase عندك

// البيانات الافتراضية كاملة (الأسماء، التعبئة، الأسعار، التصنيف)
const initialFeedData = [
  { id: 'p1', name: 'سوبر بادي ۲۳ %', weight: '25 / 50 كجم', price: 24000, category: 'poultry' },
  { id: 'p2', name: 'سوبر نامي ۲۱,٥ %', weight: '25 / 50 كجم', price: 23900, category: 'poultry' },
  { id: 'p3', name: 'سوبر ناهي ۱۹ %', weight: '25 / 50 كجم', price: 23750, category: 'poultry' },
  { id: 'p4', name: 'سوبر بادي ۲۳ %', weight: '10 كجم', price: 24200, category: 'poultry' },
  { id: 'p5', name: 'بادي نامي ۲۱,٥ %', weight: '25 كجم', price: 22500, category: 'poultry' },
  { id: 'p6', name: 'بادي نامي ۲۱,٥ %', weight: '10 كجم', price: 22700, category: 'poultry' },
  { id: 'p7', name: 'النور ( تربية منزلية ) ۲۱ %', weight: '25 كجم', price: 21000, category: 'poultry' },
  { id: 'p8', name: 'النور ( تربية منزلية ) ۲۱ %', weight: '10 كجم', price: 21200, category: 'poultry' },
  { id: 'p9', name: 'حمام ۱۷ %', weight: '10 كجم', price: 19500, category: 'poultry' },
  { id: 'p10', name: 'بياض ۱4 %', weight: '10 كجم', price: 18200, category: 'poultry' },
  { id: 'p11', name: 'بياض ۱4 %', weight: '25 كجم', price: 18000, category: 'poultry' },

  { id: 'l1', name: 'الزعيم تسمين ۱٦ %', weight: '( 50ك / 5ك )', price: 16950, category: 'livestock' },
  { id: 'l2', name: 'الزعيم تسمين ۱۴ %', weight: '( 50ك / 5ك )', price: 16650, category: 'livestock' },
  { id: 'l3', name: 'بط فاخر ۱۱ %', weight: '( ك 20 )', price: 10050, category: 'livestock' },
  { id: 'l4', name: 'النور سوبر مصبع ۱۱ %', weight: '( 40ك / 5ك )', price: 9350, category: 'livestock' },
  { id: 'l5', name: 'الزعيم سوبر ۱۱ %', weight: '( 50ك / 5ك )', price: 8850, category: 'livestock' },
  { id: 'l6', name: 'النور محسن ۹ %', weight: '( 50ك / 5ك )', price: 8050, category: 'livestock' },
  { id: 'l7', name: 'النور عادي ۷ %', weight: '( 50ك / 5ك )', price: 7950, category: 'livestock' },
  { id: 'l8', name: 'الوطنية ٥ %', weight: '( 30ك / 5ك )', price: 6950, category: 'livestock' },
];

export default function EditableFeedPrices() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkMode, setBulkMode] = useState('add');
  const [bulkValue, setBulkValue] = useState('');
  const [feedback, setFeedback] = useState({ text: '', type: '' });

  const showFeedback = (text, type = 'success') => {
    setFeedback({ text, type });
    setTimeout(() => setFeedback({ text: '', type: '' }), 4000);
  };

  // جلب البيانات من جدول feed_prices في PocketBase
  const { data: feedItems = [], isLoading } = useQuery({
    queryKey: ['feed_prices'],
    queryFn: async () => {
      try {
        const records = await pb.collection('feed_prices').getFullList({ sort: 'created' });
        // لو القاعدة لسه فاضية، نرجع البيانات الافتراضية مؤقتاً لحد ما تسجلهم في القاعدة
        return records.length > 0 ? records : initialFeedData;
      } catch (err) {
        console.warn('PocketBase fetch failed, using fallback data:', err);
        return initialFeedData;
      }
    },
  });

  // تقسيم الأصناف لدواجن ومواشي بناءً على حقل category
  const poultryData = feedItems.filter((item) => item.category === 'poultry');
  const livestockData = feedItems.filter((item) => item.category === 'livestock');

  // تحديث سعر صنف فردي وحفظه في القاعدة
  const updatePriceMutation = useMutation({
    mutationFn: async ({ id, price }) => {
      // لو الـ id افتراضي (يبدأ بـ p أو l)، مش هينفع نعدل في السيرفر إلا لو متسجل بقاعدة البيانات الحقيقية
      if (id.startsWith('p') || id.startsWith('l')) {
        return { id, price: Number(price) || 0 };
      }
      return await pb.collection('feed_prices').update(id, { price: Number(price) || 0 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed_prices'] });
      showFeedback('تم حفظ السعر بنجاح.');
    },
    onError: (error) => showFeedback(`فشل الحفظ: ${error.message}`, 'error'),
  });

  // تنفيذ وحفظ التعديل المجمع
  const bulkUpdateMutation = useMutation({
    mutationFn: async () => {
      const val = parseFloat(bulkValue);
      if (isNaN(val) || selectedIds.length === 0) return;

      const promises = selectedIds.map((id) => {
        const item = feedItems.find((i) => i.id === id);
        if (!item || id.startsWith('p') || id.startsWith('l')) return null;

        let newPrice = item.price;
        if (bulkMode === 'add') newPrice = item.price + val;
        else if (bulkMode === 'sub') newPrice = Math.max(0, item.price - val);
        else if (bulkMode === 'percent') newPrice = Math.round(item.price * (1 + val / 100));
        else if (bulkMode === 'set') newPrice = val;

        return pb.collection('feed_prices').update(id, { price: newPrice });
      });

      await Promise.all(promises.filter(Boolean));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed_prices'] });
      setSelectedIds([]);
      setBulkValue('');
      showFeedback('تم تطبيق وحفظ التعديلات المجمعة بنجاح.');
    },
    onError: (error) => showFeedback(`فشل التعديل المجمع: ${error.message}`, 'error'),
  });

  const toggleSelectItem = (id) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const toggleSelectAll = () => {
    const allIds = feedItems.map((i) => i.id);
    if (selectedIds.length === allIds.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(allIds);
    }
  };

  const formatPrice = (price) => (price ? price.toLocaleString('en-US') : '0');

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#2b261f] flex items-center justify-center text-amber-300 font-bold" dir="rtl">
        جاري تحميل الأسعار...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#2b261f] p-2 sm:p-4 text-white font-sans" dir="rtl">
      <div className="max-w-3xl mx-auto border-2 border-[#5c4e3a] bg-[#26221c] p-2 shadow-2xl relative">
        
        {feedback.text && (
          <div className={`p-2 mb-2 rounded text-xs font-bold text-center ${feedback.type === 'error' ? 'bg-red-900/50 text-red-200' : 'bg-green-900/50 text-green-200'}`}>
            {feedback.text}
          </div>
        )}

        <div className="flex justify-between items-center mb-2">
          {isEditing && (
            <button
              onClick={toggleSelectAll}
              className="px-2 py-1 bg-stone-700 hover:bg-stone-600 rounded text-xs text-amber-200 font-bold"
            >
              {selectedIds.length === feedItems.length ? 'إلغاء تحديد الكل' : 'تحديد الكل'} ({selectedIds.length})
            </button>
          )}
          <div className="text-left ml-auto">
            <button
              onClick={() => {
                setIsEditing(!isEditing);
                if (isEditing) setSelectedIds([]);
              }}
              className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                isEditing
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-amber-600 hover:bg-amber-700 text-white'
              }`}
            >
              {isEditing ? '✓ إنهاء وحفظ' : '⚙️ تعديل الأسعار'}
            </button>
          </div>
        </div>

        {isEditing && selectedIds.length > 0 && (
          <div className="bg-[#332b21] border border-amber-500/40 p-2.5 mb-3 rounded shadow-md">
            <div className="text-xs text-amber-300 font-bold mb-2">
              تعديل مجمع لـ ({selectedIds.length}) عناصر محددة:
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <select
                value={bulkMode}
                onChange={(e) => setBulkMode(e.target.value)}
                className="bg-[#1c1914] text-white text-xs border border-amber-500/50 rounded p-1.5 focus:outline-none"
              >
                <option value="add">إضافة مبلغ ثابت (+)</option>
                <option value="sub">خصم مبلغ ثابت (-)</option>
                <option value="percent">تعديل بنسبة مئوية (%)</option>
                <option value="set">تعيين سعر موحد</option>
              </select>

              <input
                type="number"
                placeholder={bulkMode === 'percent' ? 'النسبة مثلاً 5 أو -5' : 'القيمة'}
                value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value)}
                className="bg-[#1c1914] text-amber-300 text-xs border border-amber-500/50 rounded p-1.5 w-28 text-center focus:outline-none"
              />

              <button
                onClick={() => bulkUpdateMutation.mutate()}
                disabled={bulkUpdateMutation.isPending}
                className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded text-xs font-bold transition-colors"
              >
                {bulkUpdateMutation.isPending ? 'جاري الحفظ...' : 'تطبيق على المحدّد'}
              </button>
            </div>
          </div>
        )}

        {/* البانر العلوي */}
        <div className="bg-gradient-to-b from-[#3b3328] to-[#1c1914] border border-[#736148] p-3 mb-2 rounded-sm flex items-center justify-between">
          <div className="text-center flex-1">
            <span className="text-[#ffcc00] font-black text-lg block tracking-wider drop-shadow">
              الزعـيـم
            </span>
            <span className="text-[#f3e5ab] font-bold text-xs sm:text-sm">
              قائمة أصناف أعلاف الزعيم علماً بأن الأسعار الآتية بالقائمة أرض المصنع وليس وصال
            </span>
          </div>
        </div>

        {/* أعلاف الدواجن */}
        <div className="bg-[#3b3328] border border-[#6b583f] text-[#f3e5ab] font-bold text-base sm:text-xl py-2 px-3 mb-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🐔</span>
            <span>اعلاف الدواجن</span>
          </div>
          <span className="text-xs text-[#ffcc00] font-black tracking-wide">أعلاف الزعيم</span>
        </div>
        
        <table className="w-full text-center border-collapse border border-[#5c4e3a] bg-[#1f1c18] mb-4">
          <thead>
            <tr className="bg-[#332b21] text-[#e6d39c] font-bold text-xs sm:text-sm">
              {isEditing && <th className="border border-[#5c4e3a] py-2 px-1 w-[8%]">تحديد</th>}
              <th className={`border border-[#5c4e3a] py-2 px-2 ${isEditing ? 'w-[25%]' : 'w-[30%]'}`}>سعر الطن</th>
              <th className="border border-[#5c4e3a] py-2 px-2 w-[35%]">التعبئة</th>
              <th className="border border-[#5c4e3a] py-2 px-2 w-[35%]">اسم الصنف</th>
            </tr>
          </thead>
          <tbody>
            {poultryData.map((item) => (
              <tr key={item.id} className={selectedIds.includes(item.id) ? 'bg-[#3a3020]' : ''}>
                {isEditing && (
                  <td className="border border-[#5c4e3a] py-1.5 px-1 bg-[#29241e] text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelectItem(item.id)}
                      className="accent-amber-600 cursor-pointer w-4 h-4"
                    />
                  </td>
                )}
                <td className="border border-[#5c4e3a] py-1.5 px-2 font-bold text-sm sm:text-base text-white bg-[#29241e]">
                  {isEditing ? (
                    <input
                      type="number"
                      defaultValue={item.price}
                      onBlur={(e) => updatePriceMutation.mutate({ id: item.id, price: e.target.value })}
                      className="w-full bg-[#1c1914] text-amber-300 text-center border border-amber-500/50 rounded py-0.5 px-1 focus:outline-none"
                    />
                  ) : (
                    formatPrice(item.price)
                  )}
                </td>
                <td className="border border-[#5c4e3a] py-1.5 px-2 text-[#e0d0b0] text-xs sm:text-sm">
                  {item.weight}
                </td>
                <td className="border border-[#5c4e3a] py-1.5 px-2 font-bold text-white text-xs sm:text-sm">
                  {item.name}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* أعلاف المواشي */}
        <div className="bg-[#3b3328] border border-[#6b583f] text-[#f3e5ab] font-bold text-base sm:text-xl py-2 px-3 mb-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🐂</span>
            <span>اعلاف المواشي</span>
          </div>
          <span className="text-xs text-[#ffcc00] font-black tracking-wide">أعلاف الزعيم</span>
        </div>
        
        <table className="w-full text-center border-collapse border border-[#5c4e3a] bg-[#1f1c18] mb-3">
          <thead>
            <tr className="bg-[#332b21] text-[#e6d39c] font-bold text-xs sm:text-sm">
              {isEditing && <th className="border border-[#5c4e3a] py-2 px-1 w-[8%]">تحديد</th>}
              <th className={`border border-[#5c4e3a] py-2 px-2 ${isEditing ? 'w-[25%]' : 'w-[30%]'}`}>سعر الطن</th>
              <th className="border border-[#5c4e3a] py-2 px-2 w-[35%]">التعبئة</th>
              <th className="border border-[#5c4e3a] py-2 px-2 w-[35%]">اسم الصنف</th>
            </tr>
          </thead>
          <tbody>
            {livestockData.map((item) => (
              <tr key={item.id} className={selectedIds.includes(item.id) ? 'bg-[#3a3020]' : ''}>
                {isEditing && (
                  <td className="border border-[#5c4e3a] py-1.5 px-1 bg-[#29241e] text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => toggleSelectItem(item.id)}
                      className="accent-amber-600 cursor-pointer w-4 h-4"
                    />
                  </td>
                )}
                <td className="border border-[#5c4e3a] py-1.5 px-2 font-bold text-sm sm:text-base text-[#ff6b6b] bg-[#29241e]">
                  {isEditing ? (
                    <input
                      type="number"
                      defaultValue={item.price}
                      onBlur={(e) => updatePriceMutation.mutate({ id: item.id, price: e.target.value })}
                      className="w-full bg-[#1c1914] text-amber-300 text-center border border-amber-500/50 rounded py-0.5 px-1 focus:outline-none"
                    />
                  ) : (
                    formatPrice(item.price)
                  )}
                </td>
                <td className="border border-[#5c4e3a] py-1.5 px-2 text-[#e0d0b0] text-xs sm:text-sm">
                  {item.weight}
                </td>
                <td className="border border-[#5c4e3a] py-1.5 px-2 font-bold text-white text-xs sm:text-sm">
                  {item.name}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* التذييل */}
        <div className="bg-gradient-to-b from-[#3b3328] to-[#1c1914] border border-[#736148] text-[#f3e5ab] text-center font-bold text-xs sm:text-sm p-2 rounded-sm">
          الاسعار مقيدة بوقت التنفيذ وليس الطلب ... ادارة المبيعات ت/ ٠١٠٢٤٧٣٣٣٦٨
        </div>

      </div>
    </div>
  );
}