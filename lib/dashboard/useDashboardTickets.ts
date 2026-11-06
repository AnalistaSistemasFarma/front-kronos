'use client';

import { useEffect } from 'react';
import { useDashboardData } from './DashboardDataContext';

export function useDashboardTickets() {
  const ctx = useDashboardData();
  const { needTickets } = ctx;
  // Montar una vista de tickets es lo que dispara la primera carga.
  useEffect(() => needTickets(), [needTickets]);
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
    appliedRange: ctx.ticketsAppliedRange ?? ctx.appliedRange,
  };
}
