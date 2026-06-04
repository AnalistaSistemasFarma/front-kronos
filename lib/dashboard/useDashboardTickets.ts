'use client';

import { useDashboardData } from './DashboardDataContext';

export function useDashboardTickets() {
  const ctx = useDashboardData();
  return {
    cases: ctx.cases,
    loading: ctx.ticketsLoading,
    refreshing: ctx.ticketsRefreshing,
    error: ctx.ticketsError,
    dateFilter: ctx.dateFilter,
    setDateFilter: ctx.setDateFilter,
    selectedMonthDate: ctx.selectedMonthDate,
    setSelectedMonthDate: ctx.setSelectedMonthDate,
    fetchTickets: () => ctx.fetchTickets(),
    activeDateRange: ctx.activeDateRange,
    appliedRange: ctx.appliedRange,
  };
}
