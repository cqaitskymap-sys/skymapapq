'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { AdminDataTable, type ColumnDef } from '@/components/admin/admin-data-table';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogLoader } from '@/components/loading/loaders';
import { StatusBadge } from '@/components/cpv/cpv-ui';

interface ResponsiveDataTableProps<T extends { id?: string }> {
  columns: ColumnDef<T>[];
  data: T[];
  loading?: boolean;
  searchKeys?: (keyof T)[];
  onRowClick?: (row: T) => void;
  actions?: (row: T) => React.ReactNode;
  emptyMessage?: string;
  pageSize?: number;
  statusKey?: string;
  statusOptions?: string[];
  mobileTitleKey?: string;
  mobileSubtitleKey?: string;
}

export function ResponsiveDataTable<T extends { id?: string }>({
  columns,
  data,
  loading,
  searchKeys,
  onRowClick,
  actions,
  emptyMessage,
  pageSize,
  statusKey,
  statusOptions,
  mobileTitleKey,
  mobileSubtitleKey,
}: ResponsiveDataTableProps<T>) {
  const [mobileSearch, setMobileSearch] = useState('');
  const [mobilePage, setMobilePage] = useState(0);
  const mobilePageSize = pageSize || 10;
  const filteredMobileData = useMemo(() => {
    const query = mobileSearch.trim().toLowerCase();
    if (!query) return data;
    return data.filter((row) => {
      const record = row as Record<string, unknown>;
      const values = searchKeys?.length
        ? searchKeys.map((key) => record[String(key)])
        : Object.values(record);
      return values.some((value) => String(value ?? '').toLowerCase().includes(query));
    });
  }, [data, mobileSearch, searchKeys]);
  const mobileTotalPages = Math.max(1, Math.ceil(filteredMobileData.length / mobilePageSize));
  const currentMobilePage = Math.min(mobilePage, mobileTotalPages - 1);
  const mobileRows = filteredMobileData.slice(
    currentMobilePage * mobilePageSize,
    (currentMobilePage + 1) * mobilePageSize,
  );
  const titleKey = mobileTitleKey || columns[0]?.key;
  const subtitleKey = mobileSubtitleKey || columns[1]?.key;

  return (
    <div className="space-y-4">
      <div className="hidden md:block">
        <AdminDataTable
          columns={columns}
          data={data}
          loading={loading}
          searchKeys={searchKeys}
          onRowClick={onRowClick}
          actions={actions}
          emptyMessage={emptyMessage}
          pageSize={pageSize}
          statusKey={statusKey}
          statusOptions={statusOptions}
        />
      </div>
      <div className="space-y-3 md:hidden">
        {!loading && data.length > 0 && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search records"
              value={mobileSearch}
              onChange={(event) => {
                setMobileSearch(event.target.value);
                setMobilePage(0);
              }}
              placeholder="Search records..."
              className="pl-9"
            />
          </div>
        )}
        {loading ? (
          <DialogLoader message="Loading records..." />
        ) : filteredMobileData.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">{emptyMessage || 'No records found'}</p>
        ) : (
          mobileRows.map((row, index) => {
            const title = String((row as Record<string, unknown>)[titleKey] ?? '—');
            const subtitle = String((row as Record<string, unknown>)[subtitleKey] ?? '');
            const statusVal = String((row as Record<string, unknown>)[statusKey || 'cpvStatus'] ?? '');
            return (
              <Card
                key={row.id ?? `${currentMobilePage}-${index}`}
                className="cursor-pointer shadow-sm"
                onClick={() => onRowClick?.(row)}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{title}</p>
                      {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
                    </div>
                    {statusVal && <StatusBadge status={statusVal} />}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    {columns.slice(0, 4).map((col) => (
                      <div key={col.key}>
                        <span className="font-medium text-slate-600">{col.header}: </span>
                        {col.render
                          ? col.render(row)
                          : String((row as Record<string, unknown>)[col.key] ?? '—')}
                      </div>
                    ))}
                  </div>
                  {actions && (
                    <div className="pt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
                      {actions(row)}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
        {!loading && filteredMobileData.length > 0 && (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{filteredMobileData.length} of {data.length} records</span>
            <div className="flex items-center gap-2">
              <Button
                aria-label="Previous page"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={currentMobilePage === 0}
                onClick={() => setMobilePage((page) => Math.max(0, page - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span>Page {currentMobilePage + 1} of {mobileTotalPages}</span>
              <Button
                aria-label="Next page"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={currentMobilePage >= mobileTotalPages - 1}
                onClick={() => setMobilePage((page) => Math.min(mobileTotalPages - 1, page + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
