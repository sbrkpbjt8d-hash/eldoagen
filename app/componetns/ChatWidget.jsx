'use client';

import { useEffect, useState } from 'react';
import Chat from './Chat';
import { pb } from '../lib/pocketbase';

export default function ChatWidget() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const syncAuthentication = () => {
      const authenticated = pb.authStore.isValid;
      setIsAuthenticated(authenticated);
      if (!authenticated) setIsOpen(false);
    };

    syncAuthentication();
    return pb.authStore.onChange(syncAuthentication);
  }, []);

  if (!isAuthenticated) return null;

  return (
    <div data-chat-widget className="fixed bottom-5 left-5 z-[100] flex flex-col items-end gap-3">
      <div className={`${isOpen ? 'block' : 'hidden'} h-[min(760px,calc(100dvh-6rem))] w-[min(26rem,calc(100vw-2.5rem))] overflow-hidden rounded-3xl shadow-2xl`}>
        <Chat />
      </div>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'إغلاق مساعد المصنع' : 'فتح مساعد المصنع'}
        className="flex min-h-14 items-center gap-3 rounded-full bg-teal-700 px-5 text-sm font-bold text-white shadow-lg transition hover:bg-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2"
      >
        {isOpen ? (
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5">
            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5">
            <path d="M7 10h10M7 14h6m-1 7-4-4H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5l-4 4Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        <span>{isOpen ? 'إغلاق الشات' : 'اسأل مساعد المصنع'}</span>
      </button>
    </div>
  );
}
