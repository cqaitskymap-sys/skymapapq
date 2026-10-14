'use client';

import { useParams } from 'next/navigation';
import { FileDown, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PqrSectionPage } from '@/components/pqr/pqr-section-page';
import { PqrPdfDocument } from '@/components/pqr/pqr-pdf-document';
import { printPage } from '@/lib/export-utils';

export default function PqrPdfPage() {
  const pqrId = useParams().id as string;

  return (
    <PqrSectionPage pqrId={pqrId} title="PDF Generation" description="Format SOP/QA/055/F01-03 — printout matches the controlled PQR" showRefresh={false}>
      {({ document, approvals, snapshot }) => (
        <div className="space-y-4">
          <div className="flex gap-2 no-print">
            <Button onClick={() => printPage()} className="bg-blue-600 gap-2"><Printer className="h-4 w-4" />Print / Save as PDF</Button>
            <Button variant="outline" className="gap-2" onClick={() => printPage()}><FileDown className="h-4 w-4" />Export PDF</Button>
          </div>
          <div className="border rounded-lg overflow-hidden shadow-sm bg-white">
            {document && <PqrPdfDocument document={document} approvals={approvals} snapshot={snapshot} />}
          </div>
        </div>
      )}
    </PqrSectionPage>
  );
}
