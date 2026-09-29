'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Edit, Trash2, Search, Building2, Shield, AlertCircle } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { PageLoader } from '@/components/loaders/page-loader';
import { useAuth } from '@/contexts/auth-context';
import {
  createVendorMaster,
  deleteVendorMaster,
  getVendorMasters,
  updateVendorMaster,
} from '@/lib/material-service';
import {
  dashboardVendorFormToMaster,
  vendorMasterToDashboardRow,
  type DashboardVendorRow,
} from '@/lib/dashboard-vendor-master-map';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type Vendor = DashboardVendorRow;

type VendorForm = Omit<Vendor, 'id' | 'created_at'>;

const emptyForm: VendorForm = {
  vendor_code: '',
  vendor_name: '',
  vendor_type: 'supplier',
  material_supplied: '',
  manufacturer_name: '',
  supplier_name: '',
  address: '',
  country: '',
  avl_status: 'not_approved',
  approval_date: '',
  approval_expiry_date: '',
  last_audit_date: '',
  next_audit_due_date: '',
  risk_category: 'medium',
  status: 'active',
  remarks: '',
};

export default function VendorMasterPage() {
  const { user } = useAuth();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [search, setSearch] = useState('');
  const [filterAvlStatus, setFilterAvlStatus] = useState('all');
  const [filterVendorType, setFilterVendorType] = useState('all');
  const [filterRiskCategory, setFilterRiskCategory] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    void fetchVendors();
  }, []);

  const fetchVendors = async () => {
    setLoadError(null);
    setIsLoading(true);
    try {
      const rows = await getVendorMasters();
      setVendors(
        rows
          .filter((row) => row.id)
          .map((row) => vendorMasterToDashboardRow({ ...row, id: row.id! })),
      );
    } catch (error) {
      console.error('Error fetching vendors:', error);
      setLoadError('Could not load vendor master data. Please refresh or contact your administrator.');
      setVendors([]);
    } finally {
      setIsLoading(false);
    }
  };

  const filtered = vendors.filter(v => {
    const code = (v.vendor_code ?? '').toLowerCase();
    const name = (v.vendor_name ?? '').toLowerCase();
    const q = search.toLowerCase();
    const matchesSearch = code.includes(q) || name.includes(q);
    const matchesAvlStatus = filterAvlStatus === 'all' || v.avl_status === filterAvlStatus;
    const matchesVendorType = filterVendorType === 'all' || v.vendor_type === filterVendorType;
    const matchesRiskCategory = filterRiskCategory === 'all' || v.risk_category === filterRiskCategory;
    return matchesSearch && matchesAvlStatus && matchesVendorType && matchesRiskCategory;
  });

  const summaryStats = {
    total: vendors.length,
    approved: vendors.filter(v => v.avl_status === 'approved').length,
    conditional: vendors.filter(v => v.avl_status === 'conditional_approved').length,
    blocked: vendors.filter(v => v.avl_status === 'blocked').length,
    auditDue: vendors.filter(v => v.next_audit_due_date && new Date(v.next_audit_due_date) <= new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000)).length,
  };

  const handleSave = async () => {
    if (!form.vendor_code.trim() || !form.vendor_name.trim()) {
      alert('Vendor Code and Vendor Name are required');
      return;
    }

    const actorId = user?.uid ?? 'dashboard-vendor-master';
    const payload = dashboardVendorFormToMaster(form);

    try {
      if (editingId) {
        await updateVendorMaster(editingId, payload, actorId);
      } else {
        await createVendorMaster(payload, actorId);
      }
      setDialogOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      await fetchVendors();
    } catch (error) {
      console.error('Error saving vendor:', error);
      alert(`Error saving vendor: ${(error as Error).message}`);
    }
  };

  const openEdit = async (vendor: Vendor) => {
    setEditingId(vendor.id);
    setForm({
      vendor_code: vendor.vendor_code,
      vendor_name: vendor.vendor_name,
      vendor_type: vendor.vendor_type,
      material_supplied: vendor.material_supplied,
      manufacturer_name: vendor.manufacturer_name,
      supplier_name: vendor.supplier_name,
      address: vendor.address,
      country: vendor.country,
      avl_status: vendor.avl_status,
      approval_date: vendor.approval_date,
      approval_expiry_date: vendor.approval_expiry_date,
      last_audit_date: vendor.last_audit_date,
      next_audit_due_date: vendor.next_audit_due_date,
      risk_category: vendor.risk_category,
      status: vendor.status,
      remarks: vendor.remarks,
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this vendor?')) {
      try {
        await deleteVendorMaster(id);
        await fetchVendors();
      } catch (error) {
        console.error('Error deleting vendor:', error);
        alert(`Error deleting vendor: ${(error as Error).message}`);
      }
    }
  };

  const getAvlBadgeColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'conditional_approved':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'blocked':
        return 'bg-red-100 text-red-800 border-red-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getRiskBadgeColor = (risk: string) => {
    switch (risk) {
      case 'low':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'high':
        return 'bg-red-100 text-red-800 border-red-300';
      default:
        return 'bg-amber-100 text-amber-800 border-amber-300';
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const getVendorTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      manufacturer: 'Manufacturer',
      supplier: 'Supplier',
      manufacturer_supplier: 'Mfg & Supplier',
    };
    return labels[type] || type;
  };

  return (
    <div className="relative space-y-6">
      {isLoading && (
        <div className="absolute inset-0 z-20 flex min-h-[16rem] items-start justify-center rounded-lg bg-background/80 pt-16 backdrop-blur-[1px]">
          <PageLoader message="Loading vendor master…" />
        </div>
      )}
      {loadError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Unable to load vendors</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{loadError}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void fetchVendors()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Vendor Master</h1>
          <p className="text-muted-foreground">Manage vendor approvals, audits, and compliance status</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button
              className="bg-blue-600 hover:bg-blue-500 gap-2"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm);
              }}
            >
              <Plus className="h-4 w-4" />
              Add Vendor
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Vendor' : 'Add New Vendor'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              {/* Basic Information */}
              <div>
                <h3 className="font-semibold text-sm mb-3">Basic Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-medium">Vendor Code *</Label>
                    <Input
                      className="mt-1"
                      placeholder="e.g., VEN001"
                      value={form.vendor_code}
                      onChange={e => setForm(f => ({ ...f, vendor_code: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Vendor Name *</Label>
                    <Input
                      className="mt-1"
                      placeholder="Company name"
                      value={form.vendor_name}
                      onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Vendor Type</Label>
                    <Select
                      value={form.vendor_type}
                      onValueChange={v => setForm(f => ({ ...f, vendor_type: v as any }))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manufacturer">Manufacturer</SelectItem>
                        <SelectItem value="supplier">Supplier</SelectItem>
                        <SelectItem value="manufacturer_supplier">Manufacturer & Supplier</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Material Supplied</Label>
                    <Input
                      className="mt-1"
                      placeholder="e.g., APIs, Excipients"
                      value={form.material_supplied}
                      onChange={e => setForm(f => ({ ...f, material_supplied: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Manufacturer Name</Label>
                    <Input
                      className="mt-1"
                      placeholder="If applicable"
                      value={form.manufacturer_name}
                      onChange={e => setForm(f => ({ ...f, manufacturer_name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Supplier Name</Label>
                    <Input
                      className="mt-1"
                      placeholder="If applicable"
                      value={form.supplier_name}
                      onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Address & Location */}
              <div>
                <h3 className="font-semibold text-sm mb-3">Address & Location</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <Label className="text-xs font-medium">Address</Label>
                    <Input
                      className="mt-1"
                      placeholder="Full address"
                      value={form.address}
                      onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Country</Label>
                    <Input
                      className="mt-1"
                      placeholder="e.g., India"
                      value={form.country}
                      onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* AVL & Approval */}
              <div>
                <h3 className="font-semibold text-sm mb-3">AVL & Approval Status</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-medium">AVL Status</Label>
                    <Select
                      value={form.avl_status}
                      onValueChange={v => setForm(f => ({ ...f, avl_status: v as any }))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="not_approved">Not Approved</SelectItem>
                        <SelectItem value="conditional_approved">Conditional Approval</SelectItem>
                        <SelectItem value="blocked">Blocked</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Approval Date</Label>
                    <Input
                      className="mt-1"
                      type="date"
                      value={form.approval_date}
                      onChange={e => setForm(f => ({ ...f, approval_date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Approval Expiry Date</Label>
                    <Input
                      className="mt-1"
                      type="date"
                      value={form.approval_expiry_date}
                      onChange={e => setForm(f => ({ ...f, approval_expiry_date: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Audit Information */}
              <div>
                <h3 className="font-semibold text-sm mb-3">Audit Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-medium">Last Audit Date</Label>
                    <Input
                      className="mt-1"
                      type="date"
                      value={form.last_audit_date}
                      onChange={e => setForm(f => ({ ...f, last_audit_date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Next Audit Due Date</Label>
                    <Input
                      className="mt-1"
                      type="date"
                      value={form.next_audit_due_date}
                      onChange={e => setForm(f => ({ ...f, next_audit_due_date: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              {/* Risk & Status */}
              <div>
                <h3 className="font-semibold text-sm mb-3">Risk & Status</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs font-medium">Risk Category</Label>
                    <Select
                      value={form.risk_category}
                      onValueChange={v => setForm(f => ({ ...f, risk_category: v as any }))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Status</Label>
                    <Select
                      value={form.status}
                      onValueChange={v => setForm(f => ({ ...f, status: v as any }))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="blocked">Blocked</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Remarks */}
              <div>
                <Label className="text-xs font-medium">Remarks</Label>
                <Input
                  className="mt-1"
                  placeholder="Additional notes"
                  value={form.remarks}
                  onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
                />
              </div>

              <Button className="w-full bg-blue-600 hover:bg-blue-500" onClick={handleSave}>
                {editingId ? 'Update Vendor' : 'Add Vendor'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="border-l-4 border-l-blue-600">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Total Vendors</p>
            <p className="text-2xl font-bold mt-1">{summaryStats.total}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-600">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">AVL Approved</p>
            <p className="text-2xl font-bold mt-1 text-green-700">{summaryStats.approved}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-600">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Conditional</p>
            <p className="text-2xl font-bold mt-1 text-amber-700">{summaryStats.conditional}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-600">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Blocked</p>
            <p className="text-2xl font-bold mt-1 text-red-700">{summaryStats.blocked}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-600">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Audit Due (30d)</p>
            <p className="text-2xl font-bold mt-1 text-orange-700">{summaryStats.auditDue}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search vendor code or name..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterAvlStatus} onValueChange={setFilterAvlStatus}>
          <SelectTrigger>
            <SelectValue placeholder="Filter by AVL Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All AVL Status</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="not_approved">Not Approved</SelectItem>
            <SelectItem value="conditional_approved">Conditional</SelectItem>
            <SelectItem value="blocked">Blocked</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterVendorType} onValueChange={setFilterVendorType}>
          <SelectTrigger>
            <SelectValue placeholder="Filter by Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="manufacturer">Manufacturer</SelectItem>
            <SelectItem value="supplier">Supplier</SelectItem>
            <SelectItem value="manufacturer_supplier">Mfg & Supplier</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterRiskCategory} onValueChange={setFilterRiskCategory}>
          <SelectTrigger>
            <SelectValue placeholder="Filter by Risk" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Risk Levels</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Vendors Table */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="text-muted-foreground">No vendors found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Vendor Code</th>
                  <th className="px-4 py-3 text-left font-semibold">Vendor Name</th>
                  <th className="px-4 py-3 text-left font-semibold">Type</th>
                  <th className="px-4 py-3 text-left font-semibold">Material</th>
                  <th className="px-4 py-3 text-left font-semibold">AVL Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Risk</th>
                  <th className="px-4 py-3 text-left font-semibold">Next Audit</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => (
                  <tr key={v.id} className="border-b hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono font-semibold text-blue-600">{v.vendor_code}</td>
                    <td className="px-4 py-3 font-medium">{v.vendor_name}</td>
                    <td className="px-4 py-3 text-xs">
                      <Badge variant="outline">{getVendorTypeLabel(v.vendor_type)}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{v.material_supplied || '-'}</td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={`text-xs font-medium ${getAvlBadgeColor(v.avl_status)}`}
                      >
                        {v.avl_status === 'approved' && 'Approved'}
                        {v.avl_status === 'not_approved' && 'Not Approved'}
                        {v.avl_status === 'conditional_approved' && 'Conditional'}
                        {v.avl_status === 'blocked' && 'Blocked'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Shield className="h-3.5 w-3.5" />
                        <Badge
                          variant="outline"
                          className={`text-xs font-medium ${getRiskBadgeColor(v.risk_category)}`}
                        >
                          {v.risk_category.charAt(0).toUpperCase() + v.risk_category.slice(1)}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {v.next_audit_due_date ? (
                        <span
                          className={
                            new Date(v.next_audit_due_date) <= new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000)
                              ? 'text-orange-600 font-medium'
                              : ''
                          }
                        >
                          {formatDate(v.next_audit_due_date)}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={
                          v.status === 'active'
                            ? 'bg-green-100 text-green-800 border-green-300'
                            : v.status === 'inactive'
                              ? 'bg-gray-100 text-gray-800 border-gray-300'
                              : 'bg-red-100 text-red-800 border-red-300'
                        }
                      >
                        {v.status.charAt(0).toUpperCase() + v.status.slice(1)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 h-8"
                          onClick={() => openEdit(v)}
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 h-8 text-red-600 hover:text-red-700"
                          onClick={() => handleDelete(v.id)}
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
        )}
      </div>
    </div>
  );
}
