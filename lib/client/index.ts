'use client';
// Browser-side API calls and hooks for the kiosk, kitchen, board, phone bill and owner app.
// Import from '@/lib/client'; the files beside this one are how it is organised inside.
export { ApiError } from './http';
export { api, newKey, type GatewayView } from './api';
export { admin, type Report, type SystemReport } from './admin';
export { usePoll, useLiveOrders, useTodayOrders, useCollected, useOrder, useOrderState, useFreshIds } from './poll';
export { useAutoReload, chime, useServerUp, useAwake, useNightlyReload, useHoldToReload } from './screen';
export { reportError, useWatch } from './watch';
