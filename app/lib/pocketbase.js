import PocketBase from 'pocketbase';

const getPocketBaseUrl = () => {
  if (typeof window !== 'undefined') {
    // بياخد الـ IP بتاع جهازك تلقائياً سواء فتحت من اللابتوب أو من الموبايل
    const hostname = window.location.hostname;
    return `http://${hostname}:8091`;
  }
  return 'http://127.0.0.1:8090';
};

export const pb = new PocketBase(getPocketBaseUrl());