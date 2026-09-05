import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, getToken, setToken } from './api';
import type { User, LiveStatusType } from './types';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isSuper: boolean;
  hasPermission: (permission: string | string[]) => boolean;
  canAny: (...permissions: string[]) => boolean;
  canAll: (...permissions: string[]) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  updateLiveStatus: (status: LiveStatusType, message?: string) => Promise<void>;
  setUser: (u: User) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setUserState(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api.get<{ user: User }>('/auth/me');
      setUserState(data.user);
    } catch {
      setToken(null);
      setUserState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
    const onLogout = () => setUserState(null);
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, [refreshUser]);

  // Background Heartbeat for Live Status — keeps user Active while logged in
  useEffect(() => {
    if (!user) return;

    let lastSent = 0;
    const sendHeartbeat = async () => {
      const now = Date.now();
      if (now - lastSent < 10_000) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      lastSent = now;
      try {
        const res = await api.post<{ ok: boolean; live_status: LiveStatusType }>('/live-status/heartbeat', {});
        if (res?.live_status && user.live_status !== res.live_status) {
          setUserState((prev) => prev ? { ...prev, live_status: res.live_status } : null);
        }
      } catch {}
    };

    sendHeartbeat();
    const onFocus = () => { sendHeartbeat(); };
    const onVisible = () => { if (!document.hidden) sendHeartbeat(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    const onActivity = () => { sendHeartbeat(); };
    const activityEvents: (keyof DocumentEventMap)[] = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    activityEvents.forEach((evt) => document.addEventListener(evt, onActivity));

    const interval = setInterval(() => {
      if (!document.hidden) sendHeartbeat();
    }, 15000);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      activityEvents.forEach((evt) => document.removeEventListener(evt, onActivity));
      clearInterval(interval);
    };
  }, [user?.id]);

  const updateLiveStatus = useCallback(async (status: LiveStatusType, message?: string) => {
    setUserState((prev) => prev ? { ...prev, live_status: status, status_message: message ?? prev.status_message } : null);
    try {
      const res = await api.post<{ ok: boolean; user: User }>('/live-status/status', {
        status,
        status_message: message,
      });
      if (res.user) {
        setUserState((prev) => ({ ...prev, ...res.user }));
      }
    } catch (err) {
      refreshUser();
      throw err;
    }
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    setToken(data.token);
    setUserState(data.user);
    try {
      await updateLiveStatus('active');
    } catch {
      await refreshUser();
    }
  }, [updateLiveStatus, refreshUser]);

  const logout = useCallback(() => {
    // Notify server to set status to inactive immediately
    api.post('/auth/logout', {}).catch(() => {});
    setToken(null);
    setUserState(null);
  }, []);

  const hasPermission = useCallback((permission: string | string[]): boolean => {
    if (!user) return false;
    if (user.role === 'super_admin' || user.role_group_slug === 'super_admin') return true;

    const perms = Array.isArray(user.permissions)
      ? user.permissions
      : Array.isArray(user.role_group_permissions)
      ? user.role_group_permissions
      : [];

    if (perms.includes('*')) return true;

    const targetList = Array.isArray(permission) ? permission : [permission];
    return targetList.some((reqPerm) => {
      if (perms.includes(reqPerm)) return true;
      const [module] = reqPerm.split('.');
      if (perms.includes(`${module}.*`)) return true;
      return false;
    });
  }, [user]);

  const canAny = useCallback((...permissions: string[]): boolean => {
    return permissions.some((p) => hasPermission(p));
  }, [hasPermission]);

  const canAll = useCallback((...permissions: string[]): boolean => {
    return permissions.every((p) => hasPermission(p));
  }, [hasPermission]);

  const value = useMemo<AuthCtx>(() => ({
    user,
    loading,
    isAdmin: !!user && (
      user.role === 'admin' ||
      user.role === 'super_admin' ||
      user.role === 'sub_admin' ||
      user.role_group_slug === 'admin' ||
      user.role_group_slug === 'super_admin' ||
      user.role_group_slug === 'sub_admin' ||
      hasPermission([
        'admin.access',
        'settings.manage',
        'settings.view',
        'roles.manage',
        'users.manage',
        'teams.manage',
        'departments.manage',
        'kpi.manage',
        'leaves.approve',
        'priority_tasks.manage',
      ])
    ),
    isSuper: !!user && (user.role === 'super_admin' || user.role_group_slug === 'super_admin'),
    hasPermission,
    canAny,
    canAll,
    login,
    logout,
    refreshUser,
    updateLiveStatus,
    setUser: setUserState,
  }), [user, loading, hasPermission, canAny, canAll, login, logout, refreshUser, updateLiveStatus]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
