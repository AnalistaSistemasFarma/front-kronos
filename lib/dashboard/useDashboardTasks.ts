'use client';

import { useDashboardData } from './DashboardDataContext';

/** Datos de tareas/solicitudes compartidos en todo el dashboard (sin re-fetch al cambiar de pestaña). */
export function useDashboardTasks() {
  const ctx = useDashboardData();
  return {
    session: ctx.session,
    status: ctx.status,
    tasks: ctx.tasks,
    loading: ctx.tasksLoading,
    refreshing: ctx.tasksRefreshing,
    error: ctx.tasksError,
    dateFilter: ctx.dateFilter,
    setDateFilter: ctx.setDateFilter,
    selectedMonthDate: ctx.selectedMonthDate,
    setSelectedMonthDate: ctx.setSelectedMonthDate,
    fetchTasks: () => ctx.fetchTasks(),
    isAdmin: ctx.isAdmin,
    loadingAdmin: ctx.loadingAdmin,
    appliedRange: ctx.appliedRange,
    activeDateRange: ctx.activeDateRange,
    exportDashboardToExcel: ctx.exportDashboardToExcel,
    exportingExcel: ctx.exportingExcel,
  };
}
