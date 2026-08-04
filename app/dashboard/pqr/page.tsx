'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, FileText, Eye, Edit } from 'lucide-react';
import { listPqrDocuments } from '@/lib/pqr-service';
import { PqrSubNav, PqrStatusBadge } from '@/components/pqr/pqr-sub-nav';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import type { PqrDocument } from '@/lib/pqr-types';

export default function PqrDashboardPage() {
  const [documents, setDocuments] = useState<PqrDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  useEffect(() => {
    listPqrDocuments().then(setDocuments).finally(() => setLoading(false));
  }, []);

  const filtered = documents.filter((d) => {
    const q = search.toLowerCase();
    const matchSearch = !q || d.pqr_number?.toLowerCase().includes(q) || d.product_name?.toLowerCase().includes(q);
    const matchStatus = filterStatus === 'all' || d.document_status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <PqrSubNav />
      <div className="flex-1 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">PQR Dashboard</h1>
            <p className="text-muted-foreground text-sm">Product Quality Review — Annual compliance documentation</p>
          </div>
          <Link href="/pqr/create">
            <Button className="bg-blue-600 hover:bg-blue-700 gap-2"><Plus className="h-4 w-4" />Create PQR</Button>
          </Link>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Total', value: documents.length },
            { label: 'Draft', value: documents.filter((d) => d.document_status === 'draft').length },
            { label: 'Under Review', value: documents.filter((d) => d.document_status === 'under_review').length },
            { label: 'Approved', value: documents.filter((d) => d.document_status === 'approved').length },
            { label: 'Archived', value: documents.filter((d) => d.document_status === 'archived').length },
          ].map((s) => (
            <Card key={s.label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{s.label}</p><p className="text-2xl font-bold">{s.value}</p></CardContent></Card>
          ))}
        </div>

        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search PQR..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {['draft', 'under_review', 'approved', 'rejected', 'archived'].map((s) => (
                <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? <LoadingSpinner /> : (
          <div className="space-y-3">
            {filtered.map((doc) => (
              <Card key={doc.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="h-4 w-4 text-blue-600" />
                      <span className="font-mono font-semibold text-sm">{doc.pqr_number}</span>
                      <PqrStatusBadge status={doc.document_status} />
                    </div>
                    <p className="font-medium">{doc.document_title}</p>
                    <p className="text-sm text-muted-foreground">{doc.product_name} | Year {doc.pqr_year}</p>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/dashboard/pqr/${doc.id}`}><Button size="sm" variant="outline" className="gap-1"><Eye className="h-3.5 w-3.5" />Open</Button></Link>
                    {doc.document_status === 'draft' && (
                      <Link href={`/dashboard/pqr/${doc.id}/edit`}><Button size="sm" variant="outline" className="gap-1"><Edit className="h-3.5 w-3.5" />Edit</Button></Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {!filtered.length && (
              <Card><CardContent className="p-12 text-center text-muted-foreground">No PQR documents found. Create your first annual PQR.</CardContent></Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
