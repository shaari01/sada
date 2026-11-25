let n = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}_${(n++).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
