'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Search, ArrowRight, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { usePermissions } from '@/hooks/usePermissions';
import type { AppModule } from '@/lib/permissions';

const SEARCHABLE_ROUTES: ReadonlyArray<readonly [string, string, string, AppModule]> = [
  ['Admin Dashboard', '/admin', 'Administration system health and controls', 'admin'],
  ['User Management', '/admin/users', 'Users, access, status and login accounts', 'admin'],
  ['Role & Permission', '/admin/roles', 'Role-based access and permission matrix', 'admin'],
  ['Product Master', '/admin/products', 'Product codes, strengths and formulations', 'admin'],
  ['Equipment Master', '/admin/equipment', 'Equipment register and qualification status', 'admin'],
  ['Batch Master', '/admin/batches', 'Manufacturing batch master records', 'admin'],
  ['Parameter Master', '/admin/parameters', 'CPP, CQA and monitoring parameters', 'admin'],
  ['Department Master', '/admin/departments', 'Organizational department master', 'admin'],
  ['Designation Master', '/admin/designations', 'Job title and designation master', 'admin'],
  ['Company / Site Master', '/admin/company-site', 'Company and manufacturing sites', 'admin'],
  ['Master Data Import / Export', '/admin/master-data-import-export', 'Import and export master records', 'admin'],
  ['System Settings', '/admin/system-settings', 'Security, session, theme and maintenance', 'admin'],
  ['Audit Trail', '/admin/audit-trail', 'Administrative audit records', 'admin'],
  ['Notifications', '/notifications', 'Workflow alerts and reminders', 'qms'],
  ['Document Management', '/qms/documents/master', 'Controlled documents and SOPs', 'dms'],
  ['CAPA', '/qms/capa', 'Corrective and preventive actions', 'capa'],
  ['Deviation', '/qms/deviation', 'Deviation investigation and closure', 'deviation'],
  ['Change Control', '/qms/change-control', 'Change assessment and implementation', 'change_control'],
  ['Risk Management', '/qms/risk-management', 'Quality risk assessments', 'qms'],
  ['Audit Management', '/qms/audit', 'Audit planning and findings', 'audit'],
  ['Equipment', '/qms/equipment', 'Equipment, calibration and maintenance', 'equipment'],
  ['Validation', '/qms/validation', 'Validation lifecycle', 'validation'],
  ['Vendors', '/qms/vendors', 'Vendor qualification', 'vendors'],
  ['Complaints', '/qms/complaints', 'Complaint investigation', 'complaints'],
  ['Reports', '/dashboard/reports', 'QMS reports and exports', 'qms'],
] as const;

const RECENT_SEARCH_KEY = 'skymap-recent-searches';

export default function GlobalSearchPage() {
  const searchParams = useSearchParams();
  const { canAccessModule } = usePermissions();
  const query = (searchParams.get('q') || '').trim();
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || '[]') as string[];
      const next = query
        ? [query, ...stored.filter((item) => item.toLowerCase() !== query.toLowerCase())].slice(0, 8)
        : stored.slice(0, 8);
      setRecent(next);
      if (query) localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next));
    } catch {
      setRecent(query ? [query] : []);
    }
  }, [query]);

  const results = useMemo(() => {
    if (!query) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return SEARCHABLE_ROUTES.filter(([label, href, description, module]) => {
      if (!canAccessModule(module)) return false;
      const text = `${label} ${href} ${description}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [canAccessModule, query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Search className="h-6 w-6 text-blue-600" />
          Global Search
        </h1>
        <p className="text-muted-foreground">
          Search authorized SkyMap modules and workflows.
        </p>
      </div>

      {query && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Results for</span>
          <Badge variant="secondary">{query}</Badge>
          <span className="text-sm text-muted-foreground">({results.length})</span>
        </div>
      )}

      {!query ? (
        <EmptyState title="Enter a search" message="Use the search field in the header to find a module or workflow." />
      ) : results.length === 0 ? (
        <EmptyState title="No matching modules" message="Try a broader term such as document, user, or audit." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {results.map(([label, href, description]) => (
            <Link key={href} href={href} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              <Card className="h-full rounded-xl transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{label}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-blue-600" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="recent-searches-title" className="space-y-3">
          <h2 id="recent-searches-title" className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="h-4 w-4" />
            Recent searches
          </h2>
          <div className="flex flex-wrap gap-2">
            {recent.map((item) => (
              <Link
                key={item}
                href={`/dashboard/search?q=${encodeURIComponent(item)}`}
                className="rounded-full border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted"
              >
                {item}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
