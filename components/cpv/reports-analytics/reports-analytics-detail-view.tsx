'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Archive, Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import { reportStatusLabel } from '@/lib/cpv-reports-records';
import {
  archiveCpvReport, fetchCpvReportAuditTrail, fetchCpvReportById, logCpvReportDownload,
} from '@/lib/cpv-reports-service';
import { downloadCsv, printPage } from '@/lib/export-utils';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { AnalyticsChart } from './analytics-chart';
import { HealthScoreBadge } from './health-score-badge';
import { ReportPreview } from './report-preview';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

export function ReportsAnalyticsDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const canExport = cpvPermissions.canExportReports(profile?.role);
  const canArchive = cpvPermissions.canArchiveReports(profile?.role);

  const [record, setRecord] = useState<Awaited<ReturnType<typeof fetchCpvReportById>>>(null);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [esignOpen, setEsignOpen] = useState(false);
  const [signatureText, setSignatureText] = useState('');
  const [esignReason, setEsignReason] = useState('');

  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: profile?.role || '' };

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchCpvReportById(id);
    setRecord(r);
    if (r) setAudit(await fetchCpvReportAuditTrail(id));
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={1} /></div>;
  if (!record) return <div className="p-4 sm:p-6"><ErrorCard message="Report not found." onRetry={load} /></div>;

  const charts = record.charts || {};

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title={record.reportNumber}
        description={`${record.reportType} · ${record.productName}`}
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Reports & Analytics', href: '/cpv/reports-analytics' },
          { label: record.reportNumber },
        ]}
        actions={(
          <>
            <Button variant="outline" size="sm" onClick={() => router.push('/cpv/reports-analytics')}>
              <ArrowLeft className="h-4 w-4 mr-1" />Back
            </Button>
            {canExport && (
              <>
                <Button size="sm" variant="outline" onClick={() => {
                  downloadCsv(`${record.reportNumber}.csv`, ['Module', 'Product', 'Batch', 'Status', 'Date'],
                    record.previewRows.map((r) => [
                      String(r._module || ''), String(r.productName || ''), String(r.batchNo || ''),
                      String(r.status || ''), String(r._date || '').slice(0, 10),
                    ]));
                  void logCpvReportDownload(actor, record);
                  toast.success('CSV downloaded');
                }}><Download className="h-4 w-4 mr-1" />CSV</Button>
                <Button size="sm" variant="outline" onClick={() => { printPage(); void logCpvReportDownload(actor, record); }}>
                  <Printer className="h-4 w-4 mr-1" />Print
                </Button>
              </>
            )}
            {canArchive && record.reportStatus !== 'Archived' && (
              <Button size="sm" variant="outline" onClick={() => {
                setSignatureText(actor.name);
                setEsignReason('Archived CPV report');
                setEsignOpen(true);
              }}><Archive className="h-4 w-4 mr-1" />Archive</Button>
            )}
          </>
        )}
      />

      <div className="no-print flex flex-wrap gap-1.5">
        {[
          { href: '/cpv/cpp', label: 'CPP' },
          { href: '/cpv/cqa', label: 'CQA' },
          { href: '/cpv/process-capability', label: 'Capability' },
          { href: '/cpv/trend-analysis', label: 'Trend' },
          { href: '/cpv/statistical-process-control', label: 'SPC' },
          { href: '/cpv/risk-assessment', label: 'Risk' },
          { href: '/cpv/annual-review', label: 'Annual Review' },
          { href: '/admin/audit-trail', label: 'Audit Trail' },
        ].map((link) => (
          <Link key={link.label} href={link.href} className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900">
            {link.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <KpiCard label="Status" value={reportStatusLabel(String(record.reportStatus))} tone="blue" />
        <KpiCard label="Records" value={record.totalRecords} />
        <KpiCard label="Compliance" value={`${record.metrics?.cpvCompliancePct || 0}%`} tone="green" />
        <KpiCard label="Health" value={record.metrics?.healthScore || 0} tone={record.metrics?.healthScore >= 75 ? 'green' : 'amber'} />
        <KpiCard label="Product Health" value={`${record.metrics?.productHealthScore || 0}%`} />
        <KpiCard label="Confidence" value={`${record.metrics?.confidenceScore || record.aiInsights?.aiConfidenceScore || 0}%`} />
      </div>

      {record.aiInsights && (
        <Card>
          <CardHeader><CardTitle className="text-sm">AI Insights</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{record.aiInsights.aiExecutiveSummary}</p>
            <p className="text-muted-foreground">{record.aiInsights.aiRiskPrediction}</p>
            <p>{record.aiInsights.aiPreventiveRecommendations}</p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="preview">
        <TabsList>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="charts">Charts</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="preview">
          <ReportPreview metrics={record.metrics} rows={record.previewRows} />
          <div className="mt-2"><HealthScoreBadge score={record.metrics?.healthScore || 0} label={record.metrics?.healthLabel} /></div>
        </TabsContent>
        <TabsContent value="charts">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardContent className="pt-6"><AnalyticsChart title="CPP vs CQA" data={(charts.cppVsCqa as Array<{ name: string; value: number }>) || []} /></CardContent></Card>
            <Card><CardContent className="pt-6"><AnalyticsChart title="Risk Distribution" data={(charts.riskDistribution as Array<{ name: string; value: number }>) || []} type="pie" /></CardContent></Card>
          </div>
        </TabsContent>
        <TabsContent value="audit">
          <Card><CardContent className="pt-6">
            {audit.length ? (
              <Table>
                <TableHeader><TableRow><TableHead>Action</TableHead><TableHead>User</TableHead><TableHead>Reason</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
                <TableBody>
                  {audit.map((row) => (
                    <TableRow key={String(row.id)}>
                      <TableCell>{String(row.action || row.actionType || '')}</TableCell>
                      <TableCell>{String(row.userName || row.userId || '')}</TableCell>
                      <TableCell>{String(row.reason || '')}</TableCell>
                      <TableCell>{String(row.createdAt || row.timestamp || '')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : <p className="text-sm text-muted-foreground">No audit entries.</p>}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={esignOpen} onOpenChange={setEsignOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>E-Signature — Archive Report</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Full Name *</Label><Input className="mt-1" value={signatureText} onChange={(e) => setSignatureText(e.target.value)} /></div>
            <div><Label>Reason *</Label><Textarea className="mt-1" rows={2} value={esignReason} onChange={(e) => setEsignReason(e.target.value)} /></div>
            <Button className="w-full" onClick={async () => {
              if (!signatureText.trim() || esignReason.trim().length < 5) {
                return toast.error('Signature and reason (min 5 chars) required');
              }
              const { error } = await archiveCpvReport(record.id, actor, record, {
                changeReason: esignReason.trim(),
                esignConfirmed: true,
              });
              if (error) return toast.error(error);
              toast.success('Archived');
              setEsignOpen(false);
              await load();
            }}>
              Confirm Electronic Signature
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
