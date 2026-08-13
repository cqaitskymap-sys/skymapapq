'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Printer, Upload, Download, ExternalLink, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EquipmentStatusBadge } from './equipment-sub-nav';
import { EquipmentForm } from './equipment-form';
import { EquipmentDetailPdf } from './equipment-pdf-document';
import {
  listCalibrations, listPmRecords, listBreakdowns, getEquipmentAttachments,
  uploadEquipmentAttachment, getStatusHistory, getAuditLogsForEquipment,
  updateEquipment, blockEquipment,
} from '@/lib/equipment-mgmt-service';
import type { EquipmentRecord, CalibrationRecord, PmRecord, BreakdownRecord, EquipmentAttachment, EquipmentStatusHistory } from '@/lib/equipment-mgmt-types';
import { canManageEquipment, isEquipmentReadOnly, isEquipmentUsable } from '@/lib/equipment-mgmt-types';
import type { EquipmentCreateInput } from '@/lib/equipment-mgmt-schemas';
import { useEquipmentActor } from '@/hooks/use-equipment-mgmt';
import { printPage } from '@/lib/export-utils';

export function EquipmentDetailView({ equipment, onRefresh }: { equipment: EquipmentRecord; onRefresh: () => void }) {
  const actor = useEquipmentActor();
  const readOnly = isEquipmentReadOnly(actor.role);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [calibrations, setCalibrations] = useState<CalibrationRecord[]>([]);
  const [pmRecords, setPmRecords] = useState<PmRecord[]>([]);
  const [breakdowns, setBreakdowns] = useState<BreakdownRecord[]>([]);
  const [attachments, setAttachments] = useState<EquipmentAttachment[]>([]);
  const [statusHistory, setStatusHistory] = useState<EquipmentStatusHistory[]>([]);
  const [auditLogs, setAuditLogs] = useState<Record<string, unknown>[]>([]);
  const [attachCategory, setAttachCategory] = useState('Manual');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cal, pm, bd, att, hist, logs] = await Promise.all([
        listCalibrations(equipment.id), listPmRecords(equipment.id), listBreakdowns(equipment.id),
        getEquipmentAttachments(equipment.id), getStatusHistory(equipment.id), getAuditLogsForEquipment(equipment.id),
      ]);
      setCalibrations(cal);
      setPmRecords(pm);
      setBreakdowns(bd);
      setAttachments(att);
      setStatusHistory(hist);
      setAuditLogs(logs);
    } catch (err) {
      console.error('Equipment detail load failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to load equipment details');
    } finally {
      setLoading(false);
    }
  }, [equipment.id]);

  useEffect(() => { void load(); }, [load]);

  const handleUpdate = async (d: EquipmentCreateInput) => {
    try {
      await updateEquipment(equipment.id, d, actor);
      toast.success('Equipment updated');
      setEditing(false);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleBlock = async () => {
    const reason = prompt('Reason for blocking equipment:');
    if (!reason) return;
    try {
      await blockEquipment(equipment.id, actor, reason);
      toast.success('Equipment blocked');
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Block failed');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadEquipmentAttachment(equipment.id, file, attachCategory, actor);
      toast.success('Uploaded');
      await load();
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed'); }
    e.target.value = '';
  };

  const info = [
    ['Equipment ID', equipment.equipment_id],
    ['Qualification Status', equipment.qualification_status || '—'],
    ['Manufacturing Line', equipment.manufacturing_line || '—'],
    ['Status', equipment.equipment_status],
    ['Cal Due', equipment.calibration_due_date || '—'],
    ['PM Due', equipment.pm_due_date || '—'],
    ['Usable', isEquipmentUsable(equipment) ? 'Yes' : 'No'],
  ];

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground font-mono">{equipment.equipment_id}</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{equipment.equipment_name}</h1>
          <div className="flex flex-wrap gap-2 mt-2">
            <EquipmentStatusBadge status={equipment.qualification_status || '—'} />
            <EquipmentStatusBadge status={equipment.equipment_status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={printPage}><Printer className="h-4 w-4 mr-1" />Print</Button>
          {canManageEquipment(actor.role) && !readOnly && equipment.equipment_status !== 'Blocked' && (
            <Button variant="destructive" onClick={handleBlock}><Ban className="h-4 w-4 mr-1" />Block</Button>
          )}
          {canManageEquipment(actor.role) && !readOnly && (
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setEditing(!editing)}>{editing ? 'Cancel Edit' : 'Edit'}</Button>
          )}
        </div>
      </div>

      {editing ? (
        <Card><CardHeader><CardTitle>Edit Equipment</CardTitle></CardHeader>
          <CardContent><EquipmentForm defaultValues={{
            equipment_name: equipment.equipment_name,
            equipment_id: equipment.equipment_id,
            qualification_status: (['Qualified', 'Not Qualified'].includes(equipment.qualification_status)
              ? equipment.qualification_status
              : 'Not Qualified') as EquipmentCreateInput['qualification_status'],
            manufacturing_line: ['A1', 'A2', 'LV', 'DPI', '3 Piece'].includes(equipment.manufacturing_line)
              ? equipment.manufacturing_line
              : 'A1',
          }} onSubmit={handleUpdate} onCancel={() => setEditing(false)} submitLabel="Update" /></CardContent></Card>
      ) : (
        <Tabs defaultValue="overview">
          <TabsList className="flex flex-wrap h-auto gap-1">
            {['overview', 'calibration', 'pm', 'breakdown', 'qualification', 'attachments', 'audit'].map((t) => (
              <TabsTrigger key={t} value={t} className="capitalize">{t === 'pm' ? 'PM History' : t === 'audit' ? 'Audit Trail' : t.replace('-', ' ')}</TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <Card><CardContent className="pt-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {info.map(([k, v]) => (
                  <div key={k}><p className="text-xs text-muted-foreground">{k}</p><p className="font-medium">{v}</p></div>
                ))}
              </div>
              {equipment.remarks && <p className="mt-4 text-sm text-muted-foreground border-t pt-4">{equipment.remarks}</p>}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="calibration" className="mt-4">
            <Card><CardHeader><CardTitle>Calibration History</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table><TableHeader><TableRow>
                  <TableHead>Record No</TableHead><TableHead>Date</TableHead><TableHead>Due</TableHead>
                  <TableHead>Agency</TableHead><TableHead>Status</TableHead><TableHead>Certificate</TableHead>
                </TableRow></TableHeader><TableBody>
                  {calibrations.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No calibration records</TableCell></TableRow>
                    : calibrations.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-sm">{c.calibration_record_no}</TableCell>
                        <TableCell>{c.calibration_date}</TableCell><TableCell>{c.calibration_due_date}</TableCell>
                        <TableCell>{c.calibration_agency || '—'}</TableCell>
                        <TableCell><EquipmentStatusBadge status={c.calibration_status} /></TableCell>
                        <TableCell>{c.certificate_url ? <a href={c.certificate_url} target="_blank" rel="noreferrer" className="text-blue-600 text-sm">View</a> : '—'}</TableCell>
                      </TableRow>
                    ))}
                </TableBody></Table>
              </CardContent></Card>
          </TabsContent>

          <TabsContent value="pm" className="mt-4">
            <Card><CardHeader><CardTitle>PM History</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table><TableHeader><TableRow>
                  <TableHead>PM No</TableHead><TableHead>Type</TableHead><TableHead>Date</TableHead>
                  <TableHead>Next Due</TableHead><TableHead>Done By</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader><TableBody>
                  {pmRecords.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No PM records</TableCell></TableRow>
                    : pmRecords.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-sm">{p.pm_record_no}</TableCell><TableCell>{p.pm_type}</TableCell>
                        <TableCell>{p.pm_date}</TableCell><TableCell>{p.next_pm_due_date}</TableCell>
                        <TableCell>{p.done_by_name || '—'}</TableCell>
                        <TableCell><EquipmentStatusBadge status={p.pm_status} /></TableCell>
                      </TableRow>
                    ))}
                </TableBody></Table>
              </CardContent></Card>
          </TabsContent>

          <TabsContent value="breakdown" className="mt-4">
            <Card><CardHeader><CardTitle>Breakdown History</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table><TableHeader><TableRow>
                  <TableHead>No</TableHead><TableHead>Date</TableHead><TableHead>Problem</TableHead>
                  <TableHead>Downtime</TableHead><TableHead>Status</TableHead><TableHead>Deviation</TableHead>
                </TableRow></TableHeader><TableBody>
                  {breakdowns.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">No breakdowns</TableCell></TableRow>
                    : breakdowns.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono text-sm">{b.breakdown_no}</TableCell><TableCell>{b.breakdown_date}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{b.problem_description}</TableCell>
                        <TableCell>{b.downtime_hours}h</TableCell><TableCell>{b.status}</TableCell>
                        <TableCell>{b.linked_deviation_number ? <Link href={b.linked_deviation_id ? `/qms/deviation/${b.linked_deviation_id}` : '/qms/deviation'} className="text-blue-600 text-sm">{b.linked_deviation_number}</Link> : '—'}</TableCell>
                      </TableRow>
                    ))}
                </TableBody></Table>
              </CardContent></Card>
          </TabsContent>

          <TabsContent value="qualification" className="mt-4">
            <Card><CardContent className="pt-6 space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Qualification Status</p>
                <p className="font-medium">{equipment.qualification_status || '—'}</p>
              </div>
              {!equipment.qualification_required || equipment.qualification_status === 'Not Required' ? (
                <p className="text-muted-foreground">Qualification not required for this equipment.</p>
              ) : equipment.validation_id ? (
                <Link href={`/qms/validation/${equipment.validation_id}`} className="inline-flex items-center gap-2 text-blue-600">
                  <ExternalLink className="h-4 w-4" />View Validation Record
                </Link>
              ) : equipment.qualification_status === 'Qualified' ? (
                <p className="text-muted-foreground">Marked as Qualified. Link a validation record when available.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-muted-foreground">Qualification required but not linked.</p>
                  <Link href="/qms/validation"><Button variant="outline">Go to Validation Module</Button></Link>
                </div>
              )}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="attachments" className="mt-4">
            <Card><CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Attachments</CardTitle>
              {canManageEquipment(actor.role) && !readOnly && (
                <div className="flex gap-2 items-center">
                  <Input placeholder="Category" className="w-32 h-8" value={attachCategory} onChange={(e) => setAttachCategory(e.target.value)} />
                  <label><Input type="file" className="hidden" onChange={handleUpload} /><Button variant="outline" size="sm" asChild><span><Upload className="h-4 w-4 mr-1" />Upload</span></Button></label>
                </div>
              )}
            </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table><TableHeader><TableRow>
                  <TableHead>File</TableHead><TableHead>Category</TableHead><TableHead>Uploaded By</TableHead><TableHead>Date</TableHead><TableHead></TableHead>
                </TableRow></TableHeader><TableBody>
                  {attachments.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No attachments</TableCell></TableRow>
                    : attachments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>{a.file_name}</TableCell><TableCell>{a.category}</TableCell>
                        <TableCell>{a.uploaded_by_name}</TableCell><TableCell>{a.uploaded_at?.slice(0, 10)}</TableCell>
                        <TableCell><a href={a.download_url} target="_blank" rel="noreferrer"><Download className="h-4 w-4" /></a></TableCell>
                      </TableRow>
                    ))}
                </TableBody></Table>
              </CardContent></Card>
          </TabsContent>

          <TabsContent value="audit" className="mt-4 space-y-4">
            <Card><CardHeader><CardTitle>Status History</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table><TableHeader><TableRow>
                  <TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Reason</TableHead><TableHead>By</TableHead><TableHead>Date</TableHead>
                </TableRow></TableHeader><TableBody>
                  {statusHistory.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No status changes</TableCell></TableRow>
                    : statusHistory.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell>{h.old_status}</TableCell><TableCell>{h.new_status}</TableCell>
                        <TableCell>{h.reason}</TableCell><TableCell>{h.changed_by_name}</TableCell><TableCell>{h.changed_at?.slice(0, 10)}</TableCell>
                      </TableRow>
                    ))}
                </TableBody></Table>
              </CardContent></Card>
            <Card><CardHeader><CardTitle>Audit Trail</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table><TableHeader><TableRow>
                  <TableHead>Action</TableHead><TableHead>User</TableHead><TableHead>Timestamp</TableHead>
                </TableRow></TableHeader><TableBody>
                  {auditLogs.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">No audit entries</TableCell></TableRow>
                    : auditLogs.map((l, i) => (
                      <TableRow key={String(l.id || i)}>
                        <TableCell>{String(l.action || l.actionType || l.event_type || '—')}</TableCell>
                        <TableCell>{String(l.user_name || l.userName || l.actor_name || '—')}</TableCell>
                        <TableCell>{String(l.timestamp || l.dateTime || l.created_at || '—').slice(0, 19)}</TableCell>
                      </TableRow>
                    ))}
                </TableBody></Table>
              </CardContent></Card>
          </TabsContent>
        </Tabs>
      )}

      <div className="hidden print:block">
        <EquipmentDetailPdf equipment={equipment} calibrations={calibrations} pmRecords={pmRecords} breakdowns={breakdowns} />
      </div>
    </div>
  );
}
