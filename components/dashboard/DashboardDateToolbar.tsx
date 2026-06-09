'use client';



import {

  ActionIcon,

  Button,

  Group,

  Select,

  Stack,

  Text,

} from '@mantine/core';

import { useMediaQuery } from '@mantine/hooks';

import {

  IconChevronLeft,

  IconChevronRight,

  IconDownload,

  IconRefresh,

} from '@tabler/icons-react';

import {

  getFilterLabel,

  getPeriodRangeLabel,

  getQuarterLabel,

  getSemesterLabel,

  isReferenceAtCurrentPeriod,

  shiftReferenceMonth,

  type DashboardDateFilter,

} from '../../lib/dashboard/dateRange';



interface DashboardDateToolbarProps {

  dateFilter: DashboardDateFilter;

  onDateFilterChange: (value: DashboardDateFilter) => void;

  selectedMonthDate: Date;

  onSelectedMonthDateChange: (date: Date) => void;

  onRefresh: () => void;

  loading?: boolean;

  onExport?: () => void;

  exportingExcel?: boolean;

  showExport?: boolean;

}



function PeriodNavigator({

  dateFilter,

  selectedMonthDate,

  onSelectedMonthDateChange,

}: {

  dateFilter: DashboardDateFilter;

  selectedMonthDate: Date;

  onSelectedMonthDateChange: (date: Date) => void;

}) {

  return (

    <Group gap={4} justify='center' wrap='nowrap' w={{ base: '100%', xs: 'auto' }}>

      <ActionIcon

        variant='light'

        onClick={() =>

          onSelectedMonthDateChange(shiftReferenceMonth(selectedMonthDate, dateFilter, -1))

        }

      >

        <IconChevronLeft size={16} />

      </ActionIcon>

      <Text

        fw={500}

        ta='center'

        size='sm'

        style={{ flex: 1, minWidth: 0, maxWidth: 200 }}

        lineClamp={2}

      >

        {dateFilter === 'month' &&

          selectedMonthDate.toLocaleDateString('es-CO', {

            month: 'long',

            year: 'numeric',

          })}

        {dateFilter === 'quarter' && getQuarterLabel(selectedMonthDate)}

        {dateFilter === 'semester' &&

          `${getSemesterLabel(selectedMonthDate)} ${selectedMonthDate.getFullYear()}`}

        {dateFilter === 'year' && String(selectedMonthDate.getFullYear())}

      </Text>

      <ActionIcon

        variant='light'

        disabled={isReferenceAtCurrentPeriod(selectedMonthDate, dateFilter)}

        onClick={() =>

          onSelectedMonthDateChange(shiftReferenceMonth(selectedMonthDate, dateFilter, 1))

        }

      >

        <IconChevronRight size={16} />

      </ActionIcon>

    </Group>

  );

}



export default function DashboardDateToolbar({

  dateFilter,

  onDateFilterChange,

  selectedMonthDate,

  onSelectedMonthDateChange,

  onRefresh,

  loading = false,

  onExport,

  exportingExcel = false,

  showExport = true,

}: DashboardDateToolbarProps) {

  const isMobile = useMediaQuery('(max-width: 36em)');

  const showPeriodNav =

    dateFilter === 'month' ||

    dateFilter === 'quarter' ||

    dateFilter === 'semester' ||

    dateFilter === 'year';



  const periodSelect = (

    <Select

      label='Periodo'

      data={[

        { value: 'month', label: 'Mensual' },

        { value: 'quarter', label: 'Trimestral' },

        { value: 'semester', label: 'Semestral' },

        { value: 'year', label: 'Anual' },

      ]}

      value={dateFilter}

      onChange={(value) => onDateFilterChange((value as DashboardDateFilter) ?? 'month')}

      allowDeselect={false}

      w={{ base: '100%', xs: 150 }}

    />

  );



  const actionButtons = (

    <Group gap='xs' grow={Boolean(isMobile)} w={{ base: '100%', xs: 'auto' }}>

      <Button

        variant='light'

        onClick={onRefresh}

        loading={loading}

        leftSection={<IconRefresh size={16} />}

        fullWidth={Boolean(isMobile)}

      >

        Actualizar

      </Button>

      {showExport && onExport && (

        <Button

          variant='outline'

          color='green'

          onClick={onExport}

          loading={exportingExcel}

          leftSection={<IconDownload size={16} />}

          fullWidth={Boolean(isMobile)}

        >

          {isMobile ? 'Excel' : 'Descargar Excel'}

        </Button>

      )}

    </Group>

  );



  if (isMobile) {

    return (

      <Stack gap='sm' w='100%'>

        {periodSelect}

        {showPeriodNav && (

          <PeriodNavigator

            dateFilter={dateFilter}

            selectedMonthDate={selectedMonthDate}

            onSelectedMonthDateChange={onSelectedMonthDateChange}

          />

        )}

        {actionButtons}

      </Stack>

    );

  }



  return (

    <Group align='flex-end' wrap='wrap' gap='sm' justify='flex-end'>

      {periodSelect}

      {showPeriodNav && (

        <PeriodNavigator

          dateFilter={dateFilter}

          selectedMonthDate={selectedMonthDate}

          onSelectedMonthDateChange={onSelectedMonthDateChange}

        />

      )}

      {actionButtons}

    </Group>

  );

}



export function DashboardPeriodHint({

  dateFilter,

  selectedMonthDate,

  appliedRange,

}: {

  dateFilter: DashboardDateFilter;

  selectedMonthDate: Date;

  appliedRange: string | null;

}) {

  return (

    <Text size='xs' c='dimmed' mt={4} component='span' display='block'>

      {getFilterLabel(dateFilter)} · {appliedRange ?? getPeriodRangeLabel(dateFilter, selectedMonthDate)}

      {dateFilter === 'quarter' && ` (${getQuarterLabel(selectedMonthDate)})`}

      {dateFilter === 'semester' &&

        ` (${getSemesterLabel(selectedMonthDate)} ${selectedMonthDate.getFullYear()})`}

      {dateFilter === 'year' && ` (${selectedMonthDate.getFullYear()})`}

    </Text>

  );

}

