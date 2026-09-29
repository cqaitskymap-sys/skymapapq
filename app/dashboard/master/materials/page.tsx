'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Edit, Trash2, Search, Beaker, Download } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { collection, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getFirebaseFirestore } from '@/lib/firebase';
import { PageLoader } from '@/components/loaders/page-loader';
import { getMaterialMasters } from '@/lib/material-service';
import { materialMasterToDashboardRow, type DashboardMaterialRow } from '@/lib/dashboard-material-master-map';

type Material = DashboardMaterialRow;

const materialTypeOptions = [
  { value: 'api', label: 'API' },
  { value: 'raw_material', label: 'Raw Material' },
  { value: 'excipient', label: 'Excipient' },
  { value: 'solvent', label: 'Solvent' },
  { value: 'preservative', label: 'Preservative' },
  { value: 'buffer', label: 'Buffer' },
  { value: 'ph_adjuster', label: 'pH Adjuster' },
  { value: 'other', label: 'Other' },
];

const statusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'blocked', label: 'Blocked' },
];

function getTypeColor(type: Material['material_type']) {
  const colors: Record<Material['material_type'], string> = {
    api: 'bg-blue-100 text-blue-800',
    raw_material: 'bg-orange-100 text-orange-800',
    excipient: 'bg-green-100 text-green-800',
    solvent: 'bg-cyan-100 text-cyan-800',
    preservative: 'bg-amber-100 text-amber-800',
    buffer: 'bg-purple-100 text-purple-800',
    ph_adjuster: 'bg-pink-100 text-pink-800',
    other: 'bg-gray-100 text-gray-800',
  };
  return colors[type] || 'bg-gray-100 text-gray-800';
}

function getTypeLabel(type: Material['material_type']) {
  const option = materialTypeOptions.find(o => o.value === type);
  return option?.label || type;
}

function getStatusColor(status: Material['status']) {
  const colors: Record<Material['status'], string> = {
    active: 'bg-green-100 text-green-800',
    inactive: 'bg-gray-100 text-gray-800',
    blocked: 'bg-red-100 text-red-800',
  };
  return colors[status] ?? 'bg-gray-100 text-gray-800';
}

export default function MaterialMasterPage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Material, 'id'>>({
    material_code: '',
    material_name: '',
    material_type: 'api',
    grade: '',
    specification_no: '',
    stp_no: '',
    approved_vendor_required: false,
    storage_condition: '',
    retest_period: '',
    shelf_life: '',
    status: 'active',
    remarks: '',
  });

  useEffect(() => {
    void fetchMaterials();
  }, []);

  const fetchMaterials = async () => {
    setIsLoading(true);
    try {
      const rows = await getMaterialMasters();
      setMaterials(
        rows
          .filter((row) => row.id)
          .map((row) => materialMasterToDashboardRow({ ...row, id: row.id! })),
      );
    } catch (error) {
      console.error('Error fetching materials:', error);
      setMaterials([]);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = materials.filter(m => {
    const code = (m.material_code ?? (m as { materialCode?: string }).materialCode ?? '').toLowerCase();
    const name = (m.material_name ?? (m as { materialName?: string }).materialName ?? '').toLowerCase();
    const q = search.toLowerCase();
    const matchesSearch = code.includes(q) || name.includes(q);
    const matchesType = filterType === 'all' || m.material_type === filterType;
    const matchesStatus = filterStatus === 'all' || m.status === filterStatus;
    return matchesSearch && matchesType && matchesStatus;
  });

  const summary = {
    total: materials.length,
    api: materials.filter(m => m.material_type === 'api').length,
    rawMaterial: materials.filter(m => m.material_type === 'raw_material').length,
    active: materials.filter(m => m.status === 'active').length,
    blocked: materials.filter(m => m.status === 'blocked').length,
  };

  const handleSave = async () => {
    if (!form.material_code.trim() || !form.material_name.trim()) {
      alert('Material Code and Material Name are required');
      return;
    }

    try {
      if (editingId) {
        await updateDoc(doc(getFirebaseFirestore(), 'material_master', editingId), form);
      } else {
        const materialRef = doc(collection(getFirebaseFirestore(), 'material_master'));
        await setDoc(materialRef, form);
      }

      setDialogOpen(false);
      setEditingId(null);
      setForm({
        material_code: '',
        material_name: '',
        material_type: 'api',
        grade: '',
        specification_no: '',
        stp_no: '',
        approved_vendor_required: false,
        storage_condition: '',
        retest_period: '',
        shelf_life: '',
        status: 'active',
        remarks: '',
      });
      fetchMaterials();
    } catch (error) {
      console.error('Error saving material:', error);
      alert('Error saving material');
    }
  };

  const openEdit = (m: Material) => {
    setEditingId(m.id);
    setForm({
      material_code: m.material_code,
      material_name: m.material_name,
      material_type: m.material_type,
      grade: m.grade,
      specification_no: m.specification_no,
      stp_no: m.stp_no,
      approved_vendor_required: m.approved_vendor_required,
      storage_condition: m.storage_condition,
      retest_period: m.retest_period,
      shelf_life: m.shelf_life,
      status: m.status,
      remarks: m.remarks,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this material?')) {
      try {
        await deleteDoc(doc(getFirebaseFirestore(), 'material_master', id));
        fetchMaterials();
      } catch (error) {
        console.error('Error deleting material:', error);
        alert('Error deleting material');
      }
    }
  };

  const handleExport = () => {
    const headers = ['Material Code', 'Material Name', 'Type', 'Grade', 'Spec No.', 'STP No.', 'Status', 'Storage Condition', 'Retest Period', 'Shelf Life'];
    const rows = filtered.map(m => [
      m.material_code,
      m.material_name,
      getTypeLabel(m.material_type),
      m.grade,
      m.specification_no,
      m.stp_no,
      m.status,
      m.storage_condition,
      m.retest_period,
      m.shelf_life,
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `materials-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="relative space-y-6">
      {isLoading && (
        <div className="absolute inset-0 z-20 flex min-h-[16rem] items-start justify-center rounded-lg bg-background/80 pt-16 backdrop-blur-[1px]">
          <PageLoader message="Loading material master…" />
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Material Master</h1>
          <p className="text-muted-foreground">Manage raw materials, APIs, excipients, and other pharmaceutical materials</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={handleExport}>
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-500 gap-2" onClick={() => {
                setEditingId(null);
                setForm({
                  material_code: '',
                  material_name: '',
                  material_type: 'api',
                  grade: '',
                  specification_no: '',
                  stp_no: '',
                  approved_vendor_required: false,
                  storage_condition: '',
                  retest_period: '',
                  shelf_life: '',
                  status: 'active',
                  remarks: '',
                });
              }}>
                <Plus className="h-4 w-4" />Add Material
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingId ? 'Edit Material' : 'Add New Material'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Material Code *</Label>
                    <Input
                      className="mt-1 font-mono"
                      placeholder="e.g., MAT-001"
                      value={form.material_code}
                      onChange={e => setForm(f => ({ ...f, material_code: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Material Name *</Label>
                    <Input
                      className="mt-1"
                      placeholder="e.g., Paracetamol"
                      value={form.material_name}
                      onChange={e => setForm(f => ({ ...f, material_name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Material Type *</Label>
                    <Select value={form.material_type} onValueChange={v => setForm(f => ({ ...f, material_type: v as Material['material_type'] }))}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {materialTypeOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Grade</Label>
                    <Input
                      className="mt-1"
                      placeholder="e.g., BP, USP, IP"
                      value={form.grade}
                      onChange={e => setForm(f => ({ ...f, grade: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Specification No.</Label>
                    <Input
                      className="mt-1 font-mono"
                      placeholder="e.g., SPEC-001"
                      value={form.specification_no}
                      onChange={e => setForm(f => ({ ...f, specification_no: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>STP No.</Label>
                    <Input
                      className="mt-1 font-mono"
                      placeholder="e.g., STP-001"
                      value={form.stp_no}
                      onChange={e => setForm(f => ({ ...f, stp_no: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Storage Condition</Label>
                    <Input
                      className="mt-1"
                      placeholder="e.g., 2-8°C, Room Temperature"
                      value={form.storage_condition}
                      onChange={e => setForm(f => ({ ...f, storage_condition: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Retest Period</Label>
                    <Input
                      className="mt-1"
                      placeholder="e.g., 12 months"
                      value={form.retest_period}
                      onChange={e => setForm(f => ({ ...f, retest_period: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Shelf Life</Label>
                    <Input
                      className="mt-1"
                      placeholder="e.g., 24 months"
                      value={form.shelf_life}
                      onChange={e => setForm(f => ({ ...f, shelf_life: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Status *</Label>
                    <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as Material['status'] }))}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.approved_vendor_required}
                        onChange={e => setForm(f => ({ ...f, approved_vendor_required: e.target.checked }))}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm">Approved Vendor Required</span>
                    </label>
                  </div>
                </div>

                <div>
                  <Label>Remarks</Label>
                  <Input
                    className="mt-1"
                    placeholder="Additional notes or remarks"
                    value={form.remarks}
                    onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
                  />
                </div>

                <Separator />

                <Button className="w-full bg-blue-600 hover:bg-blue-500" onClick={handleSave}>
                  {editingId ? 'Update Material' : 'Add Material'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground mb-1">Total Materials</p>
            <p className="text-3xl font-bold">{summary.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground mb-1">API</p>
            <p className="text-3xl font-bold text-blue-600">{summary.api}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground mb-1">Raw Materials</p>
            <p className="text-3xl font-bold text-orange-600">{summary.rawMaterial}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground mb-1">Active</p>
            <p className="text-3xl font-bold text-green-600">{summary.active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground mb-1">Blocked</p>
            <p className="text-3xl font-bold text-red-600">{summary.blocked}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-4 flex-wrap">
        <div className="flex-1 min-w-xs relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by code or name..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {materialTypeOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {statusOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold">Material Code</th>
                  <th className="px-6 py-3 text-left font-semibold">Material Name</th>
                  <th className="px-6 py-3 text-left font-semibold">Type</th>
                  <th className="px-6 py-3 text-left font-semibold">Grade</th>
                  <th className="px-6 py-3 text-left font-semibold">Spec No.</th>
                  <th className="px-6 py-3 text-left font-semibold">STP No.</th>
                  <th className="px-6 py-3 text-left font-semibold">Status</th>
                  <th className="px-6 py-3 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => (
                  <tr key={m.id} className="border-b hover:bg-muted/50">
                    <td className="px-6 py-3 font-mono font-semibold text-blue-600">{m.material_code}</td>
                    <td className="px-6 py-3">{m.material_name}</td>
                    <td className="px-6 py-3">
                      <Badge className={`text-xs ${getTypeColor(m.material_type)}`}>
                        {getTypeLabel(m.material_type)}
                      </Badge>
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">{m.grade || '-'}</td>
                    <td className="px-6 py-3 font-mono text-xs">{m.specification_no || '-'}</td>
                    <td className="px-6 py-3 font-mono text-xs">{m.stp_no || '-'}</td>
                    <td className="px-6 py-3">
                      <Badge className={`text-xs ${getStatusColor(m.status)}`}>
                        {m.status.charAt(0).toUpperCase() + m.status.slice(1)}
                      </Badge>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEdit(m)}
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-600"
                          onClick={() => handleDelete(m.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="p-12 text-center">
              <Beaker className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">
                {search || filterType !== 'all' || filterStatus !== 'all'
                  ? 'No materials match your filters'
                  : 'No materials found. Add your first material to get started.'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
