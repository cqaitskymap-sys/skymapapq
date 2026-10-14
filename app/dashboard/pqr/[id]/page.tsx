'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { RefreshCw, FileDown, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PqrSectionPage, PqrSummaryCard } from '@/components/pqr/pqr-section-page';
import { PqrStatusBadge } from '@/components/pqr/pqr-sub-nav';

export default function PqrDetailPage() {
  const params = useParams();
  const pqrId = params.id as string;

  return (
    <PqrSectionPage pqrId={pqrId} title="Product Information" description="Sections 1 to 5.1 — introduction, objective, scope, responsibility and product details">
      {({ document, snapshot, refreshing, refreshData }) => (
        <>
          <div className="flex flex-wrap gap-2 mb-4">
            <PqrStatusBadge status={document?.document_status} />
            {document?.last_refreshed_at && (
              <span className="text-xs text-muted-foreground self-center">Last refreshed: {new Date(document.last_refreshed_at).toLocaleString()}</span>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <PqrSummaryCard title="Batches Mfg" value={snapshot?.batches.manufactured ?? document?.total_batches_manufactured ?? 0} />
            <PqrSummaryCard title="Released" value={snapshot?.batches.released ?? document?.total_released_batches ?? 0} />
            <PqrSummaryCard title="Deviations" value={snapshot?.deviations.total ?? document?.deviation_count ?? 0} />
            <PqrSummaryCard title="OOS" value={snapshot?.oos.total ?? document?.oos_count ?? 0} />
            <PqrSummaryCard title="CAPA" value={snapshot?.capa.total ?? document?.capa_count ?? 0} />
            <PqrSummaryCard title="CPP Records" value={snapshot?.cpp.total ?? 0} />
            <PqrSummaryCard title="CQA Records" value={snapshot?.cqa.total ?? 0} />
            <PqrSummaryCard title="Materials" value={snapshot?.materials.total ?? 0} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Review Period</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1">
                <p><strong>From:</strong> {document?.review_period_from}</p>
                <p><strong>To:</strong> {document?.review_period_to}</p>
                <p><strong>Year:</strong> {document?.pqr_year}</p>
                <p><strong>Compliance:</strong> {document?.overall_compliance?.replace(/_/g, ' ')}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Quick Actions</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => refreshData()} disabled={refreshing} className="gap-1">
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />Refresh All Data
                </Button>
                <Link href={`/dashboard/pqr/${pqrId}/pdf`}><Button size="sm" className="bg-blue-600 gap-1"><FileDown className="h-3.5 w-3.5" />Generate PDF</Button></Link>
                {document?.document_status === 'draft' && (
                  <Link href={`/dashboard/pqr/${pqrId}/edit`}><Button variant="outline" size="sm" className="gap-1"><Edit className="h-3.5 w-3.5" />Edit</Button></Link>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader><CardTitle className="text-base">PQR Sections</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {[
                  ['pdf', 'PQR Document (Print)'],
                  ['batches', '5.2 Batch Manufacturing'],
                  ['materials', '5.4–5.6 Materials'],
                  ['packaging', '5.7–5.9 Packing Material'],
                  ['equipment', '5.3 Equipment'],
                  ['stability', '10.0 Stability'],
                  ['deviations', '9.0 Deviations'],
                  ['oos', '6.0 OOS'],
                  ['capa', '15.0 CAPA'],
                  ['change-control', '8.0 Change Control'],
                  ['summary', '24.0 Summary'],
                  ['approval', '31.0 Approval'],
                ].map(([href, label]) => (
                  <Link key={href} href={`/dashboard/pqr/${pqrId}/${href}`} className="text-sm px-3 py-2 rounded-md border hover:bg-blue-50 hover:border-blue-200">
                    {label}
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </PqrSectionPage>
  );
}
