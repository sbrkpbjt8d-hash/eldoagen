import PocketBase from 'pocketbase';

const LOCAL_POCKETBASE_URL = 'http://127.0.0.1:8090';
const PRODUCTION_POCKETBASE_URL = 'http://187.124.18.27:8090';

const getPocketBaseUrl = () => {
  if (typeof window !== 'undefined') {
    const { hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return LOCAL_POCKETBASE_URL;
    }
  }

  if (process.env.NODE_ENV === 'development') return LOCAL_POCKETBASE_URL;
  return process.env.NEXT_PUBLIC_POCKETBASE_URL || PRODUCTION_POCKETBASE_URL;
};

export const pb = new PocketBase(getPocketBaseUrl());