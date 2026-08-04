'use client';

import { useState, useMemo } from 'react';
import { Search, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

export interface ColumnDef<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

interface AdminDataTableProps<T extends { id?: string }> {
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
}

export function AdminDataTable<T extends { id?: string; status?: string }>({
  columns,
  data,
  loading,
  searchKeys = [],
  onRowClick,
  actions,
  emptyMessage = 'No records found',
  pageSize = 10,
  statusKey = 'status',
  statusOptions = ['Active', 'Inactive'],
}: AdminDataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(() => {
    return data.filter((row) => {
      if (statusFilter !== 'all') {
        const rowStatus = String((row as Record<string, unknown>)[statusKey] ?? row.status ?? '');
        if (rowStatus !== statusFilter) return false;
      }
      if (!search) return true;
      const q = search.toLowerCase();
      return searchKeys.some((key) =>
        String(row[key] ?? '').toLowerCase().includes(q)
      ) || Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }, [data, search, searchKeys, statusFilter, statusKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search records..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
          <Filter className="h-4 w-4 mr-2" />
          Filters
        </Button>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-3 p-3 border rounded-lg bg-slate-50 dark:bg-slate-900">
          <div className="space-y-1 min-w-[140px]">
            <p className="text-xs text-muted-foreground">Status</p>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-white dark:bg-slate-900 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 dark:bg-slate-800/50">
              {columns.map((col) => (
                <TableHead key={col.key} className={col.className}>{col.header}</TableHead>
              ))}
              {actions && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + (actions ? 1 : 0)} className="text-center py-12 text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((row, index) => (
                <TableRow
                  key={row.id || `${currentPage}-${index}`}
                  className={onRowClick ? 'cursor-pointer hover:bg-blue-50/50 dark:hover:bg-slate-800/50' : ''}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
                      {col.render
                        ? col.render(row)
                        : col.key === 'status' || col.key.endsWith('Status')
                          ? <StatusBadge status={String((row as Record<string, unknown>)[col.key] ?? '-')} />
                          : String((row as Record<string, unknown>)[col.key] ?? '-')}
                    </TableCell>
                  ))}
                  {actions && (
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {actions(row)}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>{filtered.length} of {data.length} records</p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span>Page {currentPage + 1} of {totalPages}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status?: string }) {
  const colors: Record<string, string> = {
    Active: 'bg-green-50 text-green-700 border-green-200',
    Inactive: 'bg-slate-100 text-slate-600 border-slate-200',
    Locked: 'bg-red-50 text-red-700 border-red-200',
    'Pending Approval': 'bg-amber-50 text-amber-700 border-amber-200',
    Pending: 'bg-amber-50 text-amber-700 border-amber-200',
    Completed: 'bg-green-50 text-green-700 border-green-200',
    Overdue: 'bg-red-50 text-red-700 border-red-200',
    Success: 'bg-green-50 text-green-700 border-green-200',
    Failed: 'bg-red-50 text-red-700 border-red-200',
    'In Progress': 'bg-blue-50 text-blue-700 border-blue-200',
    Healthy: 'bg-green-50 text-green-700 border-green-200',
    Degraded: 'bg-amber-50 text-amber-700 border-amber-200',
    Down: 'bg-red-50 text-red-700 border-red-200',
  };
  return (
    <Badge variant="outline" className={colors[status || ''] || 'bg-slate-100'}>
      {status || 'Unknown'}
    </Badge>
  );
}
