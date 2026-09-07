'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { pb } from '../lib/pocketbase';

export default function LoginPage() {
  const router = useRouter();
  const [identity, setIdentity] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [mode, setMode] = useState('login');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'register') {
        if (password !== passwordConfirm) throw new Error('password_mismatch');
        await pb.collection('users').create({
          name: name.trim(),
          email: identity.trim(),
          password,
          passwordConfirm,
          emailVisibility: true,
        });
        await pb.collection('users').authWithPassword(identity.trim(), password);
      } else {
        try {
          await pb.collection('users').authWithPassword(identity.trim(), password);
        } catch {
          await pb.collection('_superusers').authWithPassword(identity.trim(), password);
        }
      }

      // التحقق من المستخدم الموجه لصفحة الخزنة فقط أو توجيه باقي المستخدمين للتقارير
      const loggedUser = pb.authStore.model;
      
      if (loggedUser?.email === 'ahmed@gmail.com') {
        router.replace('/moashe/Treasury');
      } else {
        router.replace('/reports');
      }

    } catch (requestError) {
      console.error("PocketBase Error Details:", requestError); // طباعة الخطأ الكامل في الـ Console
      
      let message = 'حدث خطأ غير معروف.';
      if (requestError.message === 'password_mismatch') {
        message = 'كلمتا المرور غير متطابقتين.';
      } else if (requestError.data && requestError.data.message) {
        // رسالة الخطأ القادمة مباشرة من PocketBase (مثل الإيميل مستخدم مسبقاً أو الباسورد قصير)
        message = Object.values(requestError.data.data)
          .map(err => err.message)
          .join(' - ') || requestError.data.message;
      } else {
        message = requestError.message || 'تعذر إنشاء الحساب.';
      }
      setError(message);
    
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 p-4" dir="rtl">
      <form onSubmit={handleSubmit} className="bg-white w-full max-w-md rounded-3xl shadow-xl border p-8 space-y-5">
        <div className="text-center">
          <h1 className="text-2xl font-black text-gray-900">{mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب جديد'}</h1>
          <p className="text-sm text-gray-500 mt-2">الدخول إلى نظام إدارة المصنع</p>
        </div>
        {error && <p className="bg-red-50 text-red-600 p-3 rounded-xl text-xs font-bold">{error}</p>}
        {mode === 'register' && (
          <div>
            <label className="text-xs font-bold text-gray-700">الاسم</label>
            <input required value={name} onChange={e => setName(e.target.value)} className="w-full border p-3 rounded-xl mt-1 text-sm text-black" autoComplete="name" />
          </div>
        )}
        <div>
          <label className="text-xs font-bold text-gray-700">البريد الإلكتروني أو اسم المستخدم</label>
          <input required value={identity} onChange={e => setIdentity(e.target.value)} className="w-full border p-3 rounded-xl mt-1 text-sm text-black" autoComplete="username" />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-700">كلمة المرور</label>
          <input required type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full border p-3 rounded-xl mt-1 text-sm text-black" autoComplete="current-password" />
        </div>
        {mode === 'register' && (
          <div>
            <label className="text-xs font-bold text-gray-700">تأكيد كلمة المرور</label>
            <input required type="password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} className="w-full border p-3 rounded-xl mt-1 text-sm text-black" autoComplete="new-password" />
          </div>
        )}
        <button disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-xl font-bold text-sm">
          {loading ? 'جاري التنفيذ...' : mode === 'login' ? 'دخول' : 'إنشاء الحساب'}
        </button>
        <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }} className="w-full text-blue-600 text-xs font-bold">
          {mode === 'login' ? 'إنشاء حساب جديد' : 'لديك حساب؟ تسجيل الدخول'}
        </button>
      </form>
    </main>
  );
}