'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Sparkles, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PqrSubNav } from '@/components/pqr/pqr-sub-nav';
import { useAuth } from '@/contexts/auth-context';
import { createPqrDocument, generatePqrNumber, listProducts } from '@/lib/pqr-service';
import type { PqrApproval } from '@/lib/pqr-types';

const defaultApprovals: Omit<PqrApproval, 'id' | 'pqr_id'>[] = [
  { approval_type: 'prepared', designation: 'Executive QA', name: '', signature_url: '', signature_text: '', approval_date: null, status: 'pending', remarks: '' },
  { approval_type: 'reviewed', designation: 'Manager QA', name: '', signature_url: '', signature_text: '', approval_date: null, status: 'pending', remarks: '' },
  { approval_type: 'reviewed', designation: 'Manager QC', name: '', signature_url: '', signature_text: '', approval_date: null, status: 'pending', remarks: '' },
  { approval_type: 'reviewed', designation: 'Manager Production', name: '', signature_url: '', signature_text: '', approval_date: null, status: 'pending', remarks: '' },
  { approval_type: 'approved', designation: 'Head QA', name: '', signature_url: '', signature_text: '', approval_date: null, status: 'pending', remarks: '' },
];

export default function CreatePqrPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [products, setProducts] = useState<Awaited<ReturnType<typeof listProducts>>>([]);
  const [productId, setProductId] = useState('');
  const [reviewYear, setReviewYear] = useState(new Date().getFullYear());
  const [periodFrom, setPeriodFrom] = useState(`${reviewYear}-01-01`);
  const [periodTo, setPeriodTo] = useState(`${reviewYear}-12-31`);
  const [saving, setSaving] = useState(false);
  const [pqrPreview, setPqrPreview] = useState('');

  useEffect(() => {
    listProducts().then(setProducts);
  }, []);

  useEffect(() => {
    setPeriodFrom(`${reviewYear}-01-01`);
    setPeriodTo(`${reviewYear}-12-31`);
  }, [reviewYear]);

  const selected = products.find((p) => p.id === productId);

  useEffect(() => {
    if (selected) {
      generatePqrNumber(selected.product_code, reviewYear).then(setPqrPreview);
    }
  }, [selected, reviewYear]);

  const handleCreate = async (status: 'draft' | 'under_review') => {
    if (!selected || !user) {
      toast.error('Select a product and ensure you are logged in');
      return;
    }
    setSaving(true);
    try {
      const pqrNumber = pqrPreview || await generatePqrNumber(selected.product_code, reviewYear);
      const { id } = await createPqrDocument({
        company_name: String(process.env.NEXT_PUBLIC_COMPANY_NAME || profile?.full_name || 'Organization'),
        site_name: String(selected.product_code ? `${selected.product_code} Site` : 'Manufacturing Site'),
        address: '',
        document_title: `Product Quality Review for ${selected.product_name}`,
        product_name: selected.product_name,
        product_id: selected.id,
        product_code: selected.product_code,
        generic_name: selected.generic_name,
        strength: selected.strength,
        dosage_form: selected.dosage_form,
        pqr_number: pqrNumber,
        page_number: '1',
        revision_number: '00',
        format_number: '',
        review_period_from: periodFrom,
        review_period_to: periodTo,
        pqr_year: reviewYear,
        total_batches_manufactured: 0,
        total_released_batches: 0,
        total_rejected_batches: 0,
        total_reworked_batches: 0,
        total_reprocessed_batches: 0,
        document_status: status,
        review_frequency: 'yearly',
        current_revision: '00',
        previous_revision: '',
        next_review_due_date: `${reviewYear + 1}-12-31`,
        document_owner_department: 'Quality Assurance',
        effective_date: null,
        prepared_date: new Date().toISOString().split('T')[0],
        company_logo_url: '',
        observations: '',
        conclusions: '',
        recommendations: '',
        overall_compliance: 'satisfactory',
      }, defaultApprovals.map((a) => ({ ...a, name: a.approval_type === 'prepared' ? (profile?.full_name || '') : a.name })), {
        id: user.uid,
        name: profile?.full_name,
        role: profile?.role,
      });

      toast.success('PQR created');
      // Prefer modern create wizard for new work; legacy detail still works for pqr_documents
      router.push(`/dashboard/pqr/${id}`);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to create PQR');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <PqrSubNav />
      <div className="flex-1 space-y-6 max-w-2xl">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/pqr"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold">Create Annual PQR</h1>
            <p className="text-sm text-muted-foreground">Select product and review year — data auto-pulled from Batch, CPP, CQA, Deviation, OOS, CAPA modules</p>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Sparkles className="h-5 w-5 text-blue-600" />PQR Setup</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Product *</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="Select product..." /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.product_name} ({p.product_code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Review Year *</Label>
                <Select value={String(reviewYear)} onValueChange={(v) => setReviewYear(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[2024, 2025, 2026, 2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>PQR Number (Auto)</Label>
                <Input value={pqrPreview} readOnly className="font-mono bg-slate-50" placeholder="Select product..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Review Period From</Label><Input type="date" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} /></div>
              <div className="space-y-2"><Label>Review Period To</Label><Input type="date" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} /></div>
            </div>
            {selected && (
              <div className="rounded-lg bg-blue-50 border border-blue-100 p-4 text-sm space-y-1">
                <p><strong>Generic:</strong> {selected.generic_name}</p>
                <p><strong>Strength:</strong> {selected.strength}</p>
                <p><strong>Dosage Form:</strong> {selected.dosage_form}</p>
                <p className="text-muted-foreground mt-2">On create, system will auto-pull: Batches, CPP, CQA, Deviations, OOS, CAPA, Change Control, Stability, Materials, Packaging</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => handleCreate('draft')} disabled={saving || !productId} className="gap-2">
            <Save className="h-4 w-4" />Save as Draft
          </Button>
          <Button onClick={() => handleCreate('under_review')} disabled={saving || !productId} className="bg-blue-600 hover:bg-blue-700 gap-2">
            <Send className="h-4 w-4" />Generate PQR & Submit
          </Button>
        </div>
      </div>
    </div>
  );
}
