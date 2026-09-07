'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pb } from '../../lib/pocketbase';

const today = (() => {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 10);
})();
const number = (value) => Number(value || 0);

function timeValues(checkIn, checkOut) {
  if (!checkIn || !checkOut) return { late: 0, earlyLeave: 0, overtime: 0, overtimePay: 0 };
  const [inHour, inMinute] = checkIn.split(':').map(Number);
  const [outHour, outMinute] = checkOut.split(':').map(Number);
  const start = inHour * 60 + inMinute;
  const end = outHour * 60 + outMinute;
  
  // التأخير: الحضور بعد الساعة 9 صباحاً (540 دقيقة)
  const late = Math.max(0, (start - 540) / 60);

  // الانصراف المبكر قبل الساعة 4 عصراً يخصم بسعر الساعة
  const earlyLeave = Math.max(0, (960 - end) / 60);
  
  // الوقت الإضافي يبدأ بعد الساعة 4 عصراً (16:00 = 960 دقيقة)
  const overtimeStart = 960;
  const overtimeMinutes = Math.max(0, end - overtimeStart);
  
  // تقريب الدقائق إلى أقرب ربع ساعة (حذف ما قل عن 15 دقيقة)
  const quarters = Math.floor(overtimeMinutes / 15);
  const adjustedOvertimeMinutes = quarters * 15;
  const overtimeHours = adjustedOvertimeMinutes / 60;
  
  // حساب الفلوس بدون قروش (استخدام Math.floor أو Math.round للأعداد الصحيحة)
  const overtimePay = Math.floor(overtimeHours * 25);

  return { 
    late, 
    earlyLeave,
    overtime: overtimeHours, 
    overtimePay 
  };
}

function recordValues(record) {
  return {
    status: record?.status || 'حضور',
    check_in: record?.check_in || '',
    check_out: record?.check_out || '',
    late_hours: record?.late_hours ?? '',
    overtime_hours: record?.overtime_hours ?? '',
  };
}

function latestAttendanceRecord(records, employeeId, date) {
  const filtered = (records || []).filter((record) => (
    record.employee_id === employeeId && (!date || String(record.date).slice(0, 10) === date)
  ));
  if (!filtered.length) return null;

  return filtered.sort((a, b) => {
    const aTime = new Date(a.updated || a.created || 0).getTime();
    const bTime = new Date(b.updated || b.created || 0).getTime();
    return bTime - aTime || String(b.id).localeCompare(String(a.id));
  })[0];
}

export default function SalariesPage() {
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(today);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [notice, setNotice] = useState(null);
  const [employeeForm, setEmployeeForm] = useState({ name: '', base_salary: '', hour_rate: '' });
  const [advanceForm, setAdvanceForm] = useState({ employee_id: '', amount: '', notes: '' });
  const [modal, setModal] = useState('');
  const [dialog, setDialog] = useState(null);
  
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchTimes, setBatchTimes] = useState({ check_in: '', check_out: '' });

  const notify = (text, type = 'success') => {
    setNotice({ text, type });
    setTimeout(() => setNotice(null), 4000);
  };

  const requestDialog = ({ title, message, type = 'confirm' }) => new Promise((resolve) => {
    setDialog({ title, message, type, resolve });
  });

  const closeDialog = (value) => {
    dialog?.resolve(value);
    setDialog(null);
  };

  const { data: employees = [] } = useQuery({
    queryKey: ['employees'],
    queryFn: () => pb.collection('employees').getFullList({ sort: '-created' }).catch(() => []),
  });
  const { data: dailyRecords = [], isLoading, refetch: refetchDailyRecords } = useQuery({
    queryKey: ['attendance', selectedDate],
    queryFn: () => pb.collection('attendance').getFullList({ filter: `date = "${selectedDate}"` }).catch(() => []),
  });
  const { data: allRecords = [], refetch: refetchAllRecords, isError: attendanceHistoryError } = useQuery({
    queryKey: ['attendance_all'],
    queryFn: () => pb.collection('attendance').getFullList({ sort: '-date' }),
  });
  const { data: advances = [] } = useQuery({
    queryKey: ['advances'],
    queryFn: () => pb.collection('advances').getFullList({ sort: '-created' }).catch(() => []),
  });
  const { data: treasuryTransactions = [] } = useQuery({
    queryKey: ['treasury_transactions'],
    queryFn: () => pb.collection('treasury_transactions').getFullList({ sort: '-date' }).catch(() => []),
  });

  const getDraft = (employeeId, existing) => drafts[employeeId] || recordValues(existing);
  const updateDraft = (employeeId, changes) => setDrafts((current) => {
    const existing = latestAttendanceRecord(
      [...dailyRecords, ...allRecords],
      employeeId,
      selectedDate,
    );
    const next = { ...getDraft(employeeId, existing), ...changes };
    if ('check_in' in changes || 'check_out' in changes || 'status' in changes) {
      next.late_hours = '';
      next.overtime_hours = '';
    }
    return { ...current, [employeeId]: next };
  });

  const saveAttendance = useMutation({
    mutationFn: async () => {
      if (!selectedIds.length) throw new Error('اختر موظفًا واحدًا على الأقل.');
      const records = [];
      for (const employeeId of selectedIds) {
        const existing = latestAttendanceRecord([...dailyRecords, ...allRecords], employeeId, selectedDate);
        const value = getDraft(employeeId, existing);
        const calculated = timeValues(value.check_in, value.check_out);
        const payload = {
          employee_id: employeeId,
          date: selectedDate,
          status: value.status || 'حضور',
          check_in: value.status === 'غياب' ? '' : value.check_in,
          check_out: value.status === 'غياب' ? '' : value.check_out,
          late_hours: value.status === 'غياب' ? 0 : calculated.late,
          overtime_hours: value.status === 'غياب' ? 0 : calculated.overtime,
        };

        if (existing) {
          try {
            records.push(await pb.collection('attendance').update(existing.id, payload));
          } catch (error) {
            if (error.status !== 404) throw error;
            records.push(await pb.collection('attendance').create(payload));
          }
        } else {
          records.push(await pb.collection('attendance').create(payload));
        }
      }
      return records;
    },
    onSuccess: async (savedRecords) => {
      const mergeRecords = (current = []) => [
        ...current.filter((record) => !savedRecords.some((saved) => saved.id === record.id)),
        ...savedRecords,
      ];
      queryClient.setQueryData(['attendance', selectedDate], (current = []) => mergeRecords(current));
      queryClient.setQueryData(['attendance_all'], (current = []) => mergeRecords(current));
      await Promise.all([
        refetchDailyRecords(),
        refetchAllRecords(),
      ]);
      setSelectedIds([]);
      setDrafts({});
      notify('تم حفظ الحضور والانصراف للموظفين المحددين.');
    },
    onError: (error) => notify(`فشل الحفظ: ${error.message}`, 'error'),
  });

  const applyBatchTimes = () => {
    if (!selectedIds.length) {
      notify('الرجاء اختيار موظفين أولاً', 'error');
      return;
    }
    if (!batchTimes.check_in || !batchTimes.check_out) {
      notify('اكتب وقت الحضور والانصراف أولاً.', 'error');
      return;
    }

    setDrafts((current) => {
      const updatedDrafts = { ...current };
      selectedIds.forEach((id) => {
        const existing = dailyRecords.find((rec) => rec.employee_id === id);
        const currentDraft = current[id] || recordValues(existing);
        
        updatedDrafts[id] = {
          ...currentDraft,
          status: 'حضور',
          check_in: batchTimes.check_in,
          check_out: batchTimes.check_out,
          late_hours: '',
          overtime_hours: '',
        };
      });
      return updatedDrafts;
    });
    setBatchModalOpen(false);
    setBatchTimes({ check_in: '', check_out: '' });
    notify(`تم تطبيق المواعيد على ${selectedIds.length} موظفاً (اضغط حفظ لتأكيدها في القاعدة).`);
  };

  const deleteAttendance = useMutation({
    mutationFn: (recordId) => pb.collection('attendance').delete(recordId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance', selectedDate] });
      queryClient.invalidateQueries({ queryKey: ['attendance_all'] });
      notify('تم حذف سجل الحضور وإلغاء أثره من حساب المرتب.');
    },
    onError: (error) => notify(`فشل حذف السجل: ${error.message}`, 'error'),
  });

  const addEmployee = useMutation({
    mutationFn: () => pb.collection('employees').create({ name: employeeForm.name.trim(), base_salary: Math.floor(number(employeeForm.base_salary)), hour_rate: Math.floor(number(employeeForm.hour_rate)) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['employees'] }); setEmployeeForm({ name: '', base_salary: '', hour_rate: '' }); setModal(''); notify('تم إضافة الموظف.'); },
    onError: (error) => notify(`فشل إضافة الموظف: ${error.message}`, 'error'),
  });

  const deleteEmployee = useMutation({
    mutationFn: async (employeeId) => {
      const password = await requestDialog({
        title: 'تأكيد حذف الموظف',
        message: 'هذه العملية مخصصة للآدمن فقط. أدخل كلمة المرور للتأكيد.',
        type: 'password',
      });
      if (password !== '0123') {
        throw new Error('كلمة مرور الآدمن غير صحيحة. تم إلغاء الحذف.');
      }
      return pb.collection('employees').delete(employeeId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      notify('تم حذف الموظف بنجاح بواسطة الآدمن.');
    },
    onError: (error) => notify(error.message, 'error'),
  });

  const paySalary = useMutation({
    mutationFn: async (employee) => {
      const sheet = calculate(employee);
      if (sheet.net <= 0) throw new Error('لا يوجد صافي مرتب مستحق للصرف.');
      
      const confirmPay = await requestDialog({
        title: 'تأكيد صرف المرتب',
        message: `سيتم صرف ${sheet.net.toLocaleString()} ج.م للموظف ${employee.name}.`,
      });
      if (!confirmPay) return;

      const month = selectedDate.slice(0, 7);
      const alreadyPaid = treasuryTransactions.some((transaction) => (
        String(transaction.type || '').toLowerCase() === 'salary'
        && String(transaction.date || transaction.created || '').slice(0, 7) === month
        && String(transaction.title || '').includes(employee.name)
      ));
      if (alreadyPaid) throw new Error('تم صرف مرتب هذا الموظف لهذا الشهر من قبل.');

      await pb.collection('treasury_transactions').create({
        type: 'salary',
        amount: sheet.net,
        title: `صرف مرتب للموظف: ${employee.name}`,
        notes: `صافي المرتب بعد الخصومات والسلف لشهر ${month}`,
        date: selectedDate,
        actor_name: pb.authStore.model?.name || pb.authStore.model?.email || 'مشرف النظام',
      });

      const employeeAdvances = advances.filter((item) => item.employee_id === employee.id && !item.is_deducted);
      for (const adv of employeeAdvances) {
        await pb.collection('advances').update(adv.id, { is_deducted: true });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['advances'] });
      queryClient.invalidateQueries({ queryKey: ['treasury_transactions'] });
      queryClient.invalidateQueries({ queryKey: ['attendance_all'] });
      notify('تم صرف المرتب وتسجيله في الخزنة بنجاح.');
    },
    onError: (error) => {
      notify(`فشل صرف المرتب: ${error.message || error.data?.message}`, 'error');
    },
  });

  const payAllSalaries = useMutation({
    mutationFn: async () => {
      const month = selectedDate.slice(0, 7);
      const alreadyPaidThisMonth = (employee) => treasuryTransactions.some((transaction) => (
        String(transaction.type || '').toLowerCase() === 'salary'
        && String(transaction.date || transaction.created || '').slice(0, 7) === month
        && String(transaction.title || '').includes(employee.name)
      ));
      const employeesToPay = employees.filter((employee) => !alreadyPaidThisMonth(employee));
      const totalAmount = employeesToPay.reduce((sum, employee) => sum + calculate(employee).net, 0);

      if (totalAmount <= 0) {
        throw new Error('لا توجد مرتبات جديدة مستحقة للصرف هذا الشهر.');
      }

      const confirmed = await requestDialog({
        title: 'تأكيد صرف إجمالي المرتبات',
        message: `سيتم صرف إجمالي ${totalAmount.toLocaleString()} ج.م لعدد ${employeesToPay.length} موظف.`,
      });
      if (!confirmed) return false;

      await pb.collection('treasury_transactions').create({
        type: 'salary',
        amount: totalAmount,
        title: `صرف إجمالي صافي المرتبات لشهر ${month}`,
        notes: `صرف جماعي لمرتبات ${employeesToPay.length} موظف عن شهر ${month}`,
        date: selectedDate,
        actor_name: pb.authStore.model?.name || pb.authStore.model?.email || 'مشرف النظام',
      });

      for (const employee of employeesToPay) {
        const employeeAdvances = advances.filter((item) => item.employee_id === employee.id && !item.is_deducted);
        for (const advance of employeeAdvances) {
          await pb.collection('advances').update(advance.id, { is_deducted: true });
        }
      }

      return true;
    },
    onSuccess: (saved) => {
      if (!saved) return;
      queryClient.invalidateQueries({ queryKey: ['advances'] });
      queryClient.invalidateQueries({ queryKey: ['treasury_transactions'] });
      queryClient.invalidateQueries({ queryKey: ['treasury_transactions_treasury'] });
      notify('تم صرف إجمالي صافي المرتبات وتسجيله في الخزنة.');
    },
    onError: (error) => notify(`فشل صرف إجمالي المرتبات: ${error.message}`, 'error'),
  });

  const addAdvance = useMutation({
    mutationFn: () => {
      if (!advanceForm.employee_id || number(advanceForm.amount) <= 0) throw new Error('اختر الموظف واكتب مبلغًا صحيحًا.');
      return pb.collection('advances').create({ employee_id: advanceForm.employee_id, amount: Math.floor(number(advanceForm.amount)), date: selectedDate, notes: advanceForm.notes.trim() || 'سلفة موظف', is_deducted: false });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['advances'] }); setAdvanceForm({ employee_id: '', amount: '', notes: '' }); setModal(''); notify('تم تسجيل السلفة.'); },
    onError: (error) => notify(`فشل تسجيل السلفة: ${error.message}`, 'error'),
  });

  const calculate = (employee) => {
    const recordsForSelectedDate = [
      ...dailyRecords,
      ...allRecords.filter((record) => String(record.date).slice(0, 10) === selectedDate),
    ];
    const currentRecord = latestAttendanceRecord(recordsForSelectedDate, employee.id, selectedDate);
    const current = getDraft(employee.id, currentRecord);
    const month = selectedDate.slice(0, 7);
    const monthlyRecords = allRecords.filter((record) => (
      record.employee_id === employee.id && String(record.date).startsWith(month)
    ));
    const monthlyLatestByDate = new Map();
    monthlyRecords.forEach((record) => {
      const date = String(record.date).slice(0, 10);
      const currentRecordForDate = monthlyLatestByDate.get(date);
      if (!currentRecordForDate || latestAttendanceRecord([currentRecordForDate, record], employee.id, date)?.id === record.id) {
        monthlyLatestByDate.set(date, record);
      }
    });
    if (currentRecord) monthlyLatestByDate.set(selectedDate, { ...currentRecord, ...current });

    const monthlyAttendance = [...monthlyLatestByDate.values()];
    const absent = monthlyAttendance.filter((record) => record.status === 'غياب').length;
    const rate = number(employee.hour_rate) || number(employee.base_salary) / 240;
    const calculated = timeValues(current.check_in, current.check_out);
    const savedLateHours = number(currentRecord?.late_hours ?? current.late_hours ?? 0);
    const savedOvertimeHours = number(currentRecord?.overtime_hours ?? current.overtime_hours ?? 0);
    const late = current.status === 'غياب' ? 0 : (savedLateHours > 0 ? savedLateHours : calculated.late);
    const earlyLeave = current.status === 'غياب' ? 0 : calculated.earlyLeave;
    const overtime = current.status === 'غياب' ? 0 : (savedOvertimeHours > 0 ? savedOvertimeHours : calculated.overtime);
    const monthlyLate = monthlyAttendance.reduce((sum, record) => {
      const values = recordValues(record);
      return sum + number(values.late_hours || timeValues(values.check_in, values.check_out).late);
    }, 0);
    const monthlyOvertime = monthlyAttendance.reduce((sum, record) => {
      const values = recordValues(record);
      return sum + number(values.overtime_hours || timeValues(values.check_in, values.check_out).overtime);
    }, 0);
    const monthlyEarlyLeave = monthlyAttendance.reduce((sum, record) => {
      if (record.status === 'غياب') return sum;
      const values = recordValues(record);
      return sum + timeValues(values.check_in, values.check_out).earlyLeave;
    }, 0);

    // منع القروش في الخصومات والإضافات باستخدام Math.floor
    const absenceDeduction = Math.floor(Math.max(0, absent - 2) * number(employee.base_salary) / 30);
    const lateDeduction = Math.floor(monthlyLate * rate);
    const earlyLeaveDeduction = Math.floor(monthlyEarlyLeave * rate);
    const overtimeAddition = Math.floor(monthlyOvertime * 25);
    const advancesTotal = advances.filter((item) => item.employee_id === employee.id && !item.is_deducted).reduce((sum, item) => sum + number(item.amount), 0);

    const net = Math.max(0, Math.floor(number(employee.base_salary) - absenceDeduction - lateDeduction - earlyLeaveDeduction + overtimeAddition - advancesTotal));

    return {
      current,
      absent,
      absenceDeduction,
      late,
      earlyLeave,
      overtime,
      lateDeduction,
      earlyLeaveDeduction,
      overtimeAddition,
      advancesTotal,
      net
    };
  };

  const filteredRecords = allRecords.filter((record) => { const date = String(record.date || '').slice(0, 10); return (!rangeStart || date >= rangeStart) && (!rangeEnd || date <= rangeEnd); });
  const totalNet = employees.reduce((sum, employee) => sum + calculate(employee).net, 0);

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8" dir="rtl">
      {notice && <div className={`fixed left-5 top-5 z-50 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-xl ${notice.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`}>{notice.text}</div>}
      
      <header className="mx-auto mb-6 flex max-w-7xl flex-col justify-between gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-center">
        <div>
          <p className="mb-1 text-xs font-bold text-emerald-600">الموارد البشرية</p>
          <h1 className="text-2xl font-black text-slate-900">الحضور والمرتبات</h1>
          <p className="mt-1 text-sm text-slate-500">إدارة يومية الموظفين والحسابات في شاشة واحدة.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => payAllSalaries.mutate()}
            disabled={payAllSalaries.isPending}
            className="rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:opacity-50"
          >
            {payAllSalaries.isPending ? 'جاري الصرف...' : 'صرف إجمالي صافي المرتبات'}
          </button>
          <button onClick={() => setModal('advance')} className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white">+ سلفة</button>
          <button onClick={() => setModal('employee')} className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white">+ موظف</button>
        </div>
      </header>

      <section className="mx-auto mb-5 flex max-w-7xl flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
        <label className="flex items-center gap-3 text-xs font-bold text-slate-700">
          يوم الحضور
          <input type="date" value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value); setDrafts({}); }} className="rounded-lg border border-slate-300 bg-slate-50 p-2" />
        </label>
        
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500">المحدد ({selectedIds.length})</span>
          <button 
            onClick={() => setBatchModalOpen(true)} 
            disabled={!selectedIds.length}
            className="rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50 hover:bg-sky-700 transition"
          >
            تحديد وقت جماعي
          </button>
          <button onClick={() => saveAttendance.mutate()} disabled={saveAttendance.isPending || !selectedIds.length} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white disabled:opacity-50 hover:bg-emerald-700 transition">
            {saveAttendance.isPending ? 'جاري الحفظ...' : `حفظ المحدد (${selectedIds.length})`}
          </button>
        </div>
      </section>

      <section className="mx-auto mb-6 max-w-7xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-300 text-right text-xs">
            <thead className="bg-slate-900 text-white">
              <tr>
                <th className="p-3 text-center">
                  <input 
                    type="checkbox" 
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(employees.map(emp => emp.id));
                      } else {
                        setSelectedIds([]);
                      }
                    }}
                    checked={employees.length > 0 && selectedIds.length === employees.length}
                    className="h-4 w-4 accent-emerald-600 cursor-pointer"
                  />
                </th>
                <th className="p-3">الموظف</th>
                <th className="p-3">الأساسي</th>
                <th className="p-3">الحالة</th>
                <th className="p-3">الحضور</th>
                <th className="p-3">الانصراف</th>
                <th className="p-3">الغياب</th>
                <th className="p-3">التأخير</th>
                <th className="p-3">انصراف مبكر</th>
                <th className="p-3">الإضافي </th>
                <th className="p-3">السلف</th>
                <th className="p-3">الصافي</th>
                <th className="p-3 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {employees.map((employee) => { 
                const sheet = calculate(employee); 
                const checked = selectedIds.includes(employee.id); 
                return (
                  <tr key={employee.id} className="hover:bg-slate-50">
                    <td className="p-3 text-center">
                      <input type="checkbox" checked={checked} onChange={() => setSelectedIds((current) => checked ? current.filter((id) => id !== employee.id) : [...current, employee.id])} className="h-4 w-4 accent-emerald-600" />
                    </td>
                    <td className="p-3 font-bold text-slate-900">{employee.name}</td>
                    <td className="p-3 font-bold">{Math.floor(number(employee.base_salary)).toLocaleString()} ج.م</td>
                    <td className="p-3">
                      <select value={sheet.current.status} onChange={(event) => updateDraft(employee.id, { status: event.target.value })} className="rounded-lg border border-slate-300 p-1.5 font-bold">
                        <option value="حضور">حضور</option>
                        <option value="غياب">غياب</option>
                      </select>
                    </td>
                    <td className="p-3">
                      <input type="time" value={sheet.current.check_in} disabled={sheet.current.status === 'غياب'} onChange={(event) => updateDraft(employee.id, { check_in: event.target.value })} className="rounded-lg border border-slate-300 p-1.5" />
                    </td>
                    <td className="p-3">
                      <input type="time" value={sheet.current.check_out} disabled={sheet.current.status === 'غياب'} onChange={(event) => updateDraft(employee.id, { check_out: event.target.value })} className="rounded-lg border border-slate-300 p-1.5" />
                    </td>
                    <td className="p-3 font-bold text-red-600">{sheet.absent} يوم<br /><span className="text-[10px]">خصم {sheet.absenceDeduction} ج</span></td>
                    <td className="p-3">
                      <span className="font-bold text-amber-700">{sheet.late.toFixed(2)}</span>
                      <span className="mr-1 text-[10px] text-amber-700">-{sheet.lateDeduction} ج</span>
                    </td>
                    <td className="p-3">
                      <span className="font-bold text-red-700">{sheet.earlyLeave.toFixed(2)} س</span>
                      <span className="mr-1 text-[10px] text-red-700">-{sheet.earlyLeaveDeduction} ج</span>
                    </td>
                    <td className="p-3">
                      <span className="font-bold text-blue-700">{sheet.overtime.toFixed(2)} س</span>
                      <span className="mr-1 text-[10px] text-blue-700">+{sheet.overtimeAddition} ج</span>
                    </td>
                    <td className="p-3 font-bold text-violet-700">{sheet.advancesTotal ? `${sheet.advancesTotal.toLocaleString()} ج.م` : '-'}</td>
                    <td className="p-3 text-sm font-black text-emerald-700">{sheet.net.toLocaleString()} ج.م</td>
                    <td className="p-3 flex items-center justify-center gap-1">
                      <button 
                        onClick={() => paySalary.mutate(employee)} 
                        className="rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 transition"
                        title="صرف المرتب للموظف وتسجيله في الخزنة"
                      >
                        صرف المرتب
                      </button>
                      <button 
                        onClick={() => deleteEmployee.mutate(employee.id)} 
                        className="rounded-lg bg-red-50 px-2 py-1 text-[11px] font-bold text-red-600 hover:bg-red-100 transition"
                        title="حذف الموظف (للآدمن فقط)"
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                ); 
              })}
            </tbody>
          </table>
        </div>
        {isLoading && <p className="p-6 text-center text-sm font-bold text-slate-500">جاري تحميل حضور اليوم...</p>}
        {!isLoading && !employees.length && <p className="p-8 text-center text-sm text-slate-400">لا يوجد موظفون حتى الآن.</p>}
      </section>

      <section className="mx-auto max-w-7xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-center">
          <h2 className="font-black text-slate-900">سجل الحضور</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} className="rounded-lg border border-slate-300 p-2 text-xs" />
            <span className="text-xs text-slate-500">إلى</span>
            <input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} className="rounded-lg border border-slate-300 p-2 text-xs" />
            <button onClick={() => { setRangeStart(''); setRangeEnd(''); }} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold">كل المدة</button>
          </div>
        </div>
        {attendanceHistoryError && <p className="mb-4 rounded-lg bg-red-50 p-3 text-xs font-bold text-red-700">تعذر تحميل سجل الحضور من PocketBase.</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-right text-xs">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="p-3">التاريخ</th>
                <th className="p-3">الموظف</th>
                <th className="p-3">الحالة</th>
                <th className="p-3">الحضور</th>
                <th className="p-3">الانصراف</th>
                <th className="p-3">التأخير</th>
                <th className="p-3">الإضافي</th>
                <th className="p-3">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRecords.map((record) => { 
                const employee = employees.find((item) => item.id === record.employee_id); 
                const value = recordValues(record); 
                return (
                  <tr key={record.id}>
                    <td className="p-3">{record.date}</td>
                    <td className="p-3 font-bold">{employee?.name || 'موظف غير معروف'}</td>
                    <td className={`p-3 font-bold ${value.status === 'غياب' ? 'text-red-600' : 'text-emerald-600'}`}>{value.status}</td>
                    <td className="p-3">{value.check_in || '-'}</td>
                    <td className="p-3">{value.check_out || '-'}</td>
                  <td className="p-3">{Number(value.late_hours || 0).toFixed(2)} ساعة</td>
                    <td className="p-3">{number(value.overtime_hours)} ساعة</td>
                    <td className="p-3">
                      <button
                        type="button"
                        disabled={deleteAttendance.isPending}
                        onClick={async () => {
                          const confirmed = await requestDialog({
                            title: 'حذف سجل الحضور',
                            message: 'سيتم حذف سجل الحضور والانصراف لهذا اليوم.',
                          });
                          if (confirmed) deleteAttendance.mutate(record.id);
                        }}
                        className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[10px] font-bold text-red-600 hover:bg-red-100 disabled:opacity-50"
                      >
                        حذف
                      </button>
                    </td>
                  </tr>
                ); 
              })}
            </tbody>
          </table>
        </div>
        {!filteredRecords.length && <p className="p-6 text-center text-sm text-slate-400">لا توجد سجلات في الفترة المحددة.</p>}
      </section>

      <section className="mx-auto mt-6 flex max-w-7xl items-center justify-between rounded-2xl bg-slate-900 p-5 text-white">
        <div>
          <p className="text-xs text-slate-300">إجمالي صافي المرتبات الحالية</p>
          <p className="mt-1 text-2xl font-black">{totalNet.toLocaleString()} ج.م</p>
        </div>
        <span className="text-xs text-slate-300">الانصراف قبل 4 عصراً يخصم بسعر الساعة، والإضافي بعد 4 عصراً (الساعة بـ 25 ج)</span>
      </section>

      {batchModalOpen && (
        <Modal title={`تحديد مواعيد لـ (${selectedIds.length}) موظف`} onClose={() => setBatchModalOpen(false)}>
          <div className="space-y-4">
            <label className="block text-xs font-bold text-slate-700">
              وقت الحضور الجماعي
              <input 
                type="time" 
                value={batchTimes.check_in} 
                onChange={(e) => setBatchTimes({ ...batchTimes, check_in: e.target.value })} 
                className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs outline-none" 
              />
            </label>
            <label className="block text-xs font-bold text-slate-700">
              وقت الانصراف الجماعي
              <input 
                type="time" 
                value={batchTimes.check_out} 
                onChange={(e) => setBatchTimes({ ...batchTimes, check_out: e.target.value })} 
                className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs outline-none" 
              />
            </label>
            <button 
              onClick={applyBatchTimes} 
              className="w-full rounded-xl bg-sky-600 p-3 text-xs font-bold text-white hover:bg-sky-700 transition"
            >
              تطبيق على المحددين
            </button>
          </div>
        </Modal>
      )}

      {modal === 'employee' && (
        <Modal title="إضافة موظف" onClose={() => setModal('')}>
          <Input label="اسم الموظف" value={employeeForm.name} onChange={(value) => setEmployeeForm({ ...employeeForm, name: value })} />
          <Input label="المرتب الأساسي" type="number" value={employeeForm.base_salary} onChange={(value) => setEmployeeForm({ ...employeeForm, base_salary: value })} />
          <Input label="سعر الساعة اختياري" type="number" value={employeeForm.hour_rate} onChange={(value) => setEmployeeForm({ ...employeeForm, hour_rate: value })} />
          <button onClick={() => employeeForm.name.trim() ? addEmployee.mutate() : notify('اكتب اسم الموظف.', 'error')} className="w-full rounded-xl bg-emerald-600 p-3 text-xs font-bold text-white">حفظ الموظف</button>
        </Modal>
      )}

      {modal === 'advance' && (
        <Modal title="تسجيل سلفة" onClose={() => setModal('')}>
          <label className="block text-xs font-bold text-slate-700">
            الموظف
            <select value={advanceForm.employee_id} onChange={(event) => setAdvanceForm({ ...advanceForm, employee_id: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-xs">
              <option value="">اختر الموظف</option>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </select>
          </label>
          <Input label="المبلغ" type="number" value={advanceForm.amount} onChange={(value) => setAdvanceForm({ ...advanceForm, amount: value })} />
          <Input label="ملاحظات" value={advanceForm.notes} onChange={(value) => setAdvanceForm({ ...advanceForm, notes: value })} />
          <button onClick={() => addAdvance.mutate()} className="w-full rounded-xl bg-violet-600 p-3 text-xs font-bold text-white">حفظ السلفة</button>
        </Modal>
      )}

      {dialog && (
        <Dialog
          title={dialog.title}
          message={dialog.message}
          type={dialog.type}
          onClose={closeDialog}
        />
      )}
    </main>
  );
}

function Dialog({ title, message, type, onClose }) {
  const [value, setValue] = useState('');
  const isPassword = type === 'password';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" dir="rtl">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-bold text-emerald-600">تأكيد العملية</p>
            <h2 className="text-lg font-black text-slate-900">{title}</h2>
          </div>
          <button type="button" onClick={() => onClose(isPassword ? '' : false)} className="text-2xl leading-none text-slate-400 hover:text-slate-700" aria-label="إغلاق">×</button>
        </div>
        <p className="mb-5 text-sm leading-6 text-slate-600">{message}</p>
        {isPassword && (
          <input
            autoFocus
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="أدخل كلمة المرور"
            className="mb-5 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={() => onClose(isPassword ? value : true)} className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700">تأكيد</button>
          <button type="button" onClick={() => onClose(isPassword ? '' : false)} className="flex-1 rounded-xl bg-slate-100 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-200">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }) { 
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-5 flex items-center justify-between border-b pb-3">
          <h2 className="font-black text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-2xl text-slate-400">×</button>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  ); 
}

function Input({ label, value, onChange, type = 'text' }) { 
  return (
    <label className="block text-xs font-bold text-slate-700">
      {label}
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs outline-none" />
    </label>
  ); 
}