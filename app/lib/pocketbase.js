import PocketBase from 'pocketbase';

const LOCAL_POCKETBASE_URL = 'http://127.0.0.1:8090';

const getPocketBaseUrl = () => {
  if (process.env.NODE_ENV === 'development') return LOCAL_POCKETBASE_URL;
  return process.env.NEXT_PUBLIC_POCKETBASE_URL || LOCAL_POCKETBASE_URL;
};

export const pb = new PocketBase(getPocketBaseUrl());