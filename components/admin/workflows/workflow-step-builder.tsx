'use client';

import { useState } from 'react';
import { GripVertical, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WORKFLOW_STEP_TYPES, ADMIN_ROLES, DEPARTMENT_TYPES } from '@/lib/admin/constants';
import type { WorkflowFormData } from '@/lib/admin/schemas';

type Step = WorkflowFormData['steps'][number];

interface WorkflowStepBuilderProps {
  steps: Step[];
  onChange: (steps: Step[]) => void;
  readOnly?: boolean;
  roles?: { id: string; name: string }[];
  departments?: string[];
}

const defaultStep = (): Step => ({
  stepNumber: 1,
  stepName: 'New Step',
  stepType: 'Review',
  department: 'QA',
  assignedRole: 'qa_executive',
  assignedUser: '',
  isMandatory: true,
  canApprove: false,
  canReject: false,
  canSendBack: true,
  requireESignature: false,
  requireComment: false,
  dueDays: 3,
  escalationRole: 'head_qa',
  conditionExpression: '',
  nextStepOnApprove: '',
  nextStepOnReject: '',
  isParallel: false,
  status: 'Active',
});

export function WorkflowStepBuilder({
  steps, onChange, readOnly, roles, departments,
}: WorkflowStepBuilderProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const roleOptions: { id: string; name: string }[] = roles || ADMIN_ROLES.map((r) => ({ id: r.id, name: r.name }));
  const deptOptions = departments || DEPARTMENT_TYPES.slice(0, 12);

  const updateStep = (index: number, patch: Partial<Step>) => {
    const next = steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange(next);
  };

  const addStep = () => onChange([...steps, { ...defaultStep(), stepNumber: steps.length + 1 }]);

  const removeStep = (index: number) => {
    onChange(steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, stepNumber: i + 1 })));
  };

  const moveStep = (from: number, to: number) => {
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next.map((s, i) => ({ ...s, stepNumber: i + 1 })));
  };

  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    moveStep(dragIdx, targetIdx);
    setDragIdx(null);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Workflow Steps</CardTitle>
        {!readOnly && (
          <Button type="button" variant="outline" size="sm" onClick={addStep}>
            <Plus className="h-4 w-4 mr-1" />Add Step
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add at least one workflow step.</p>
        ) : (
          steps.map((step, index) => (
            <div
              key={step.id || `step-${index}`}
              className="border rounded-lg p-4 bg-white space-y-3"
              draggable={!readOnly}
              onDragStart={() => setDragIdx(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(index)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {!readOnly && <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />}
                  <span className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded">Step {index + 1}</span>
                </div>
                {!readOnly && (
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon" onClick={() => moveStep(index, index - 1)} disabled={index === 0}>
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" onClick={() => moveStep(index, index + 1)} disabled={index === steps.length - 1}>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeStep(index)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Step Name</Label>
                  <Input value={step.stepName} disabled={readOnly} onChange={(e) => updateStep(index, { stepName: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Step Type</Label>
                  <Select
                    value={step.stepType}
                    onValueChange={(v) => updateStep(index, {
                      stepType: v as Step['stepType'],
                      canApprove: v.includes('Approve'),
                      requireESignature: v.includes('Approve'),
                    })}
                    disabled={readOnly}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WORKFLOW_STEP_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Assigned Role *</Label>
                  <Select value={step.assignedRole} onValueChange={(v) => updateStep(index, { assignedRole: v })} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Department</Label>
                  <Select value={step.department || 'QA'} onValueChange={(v) => updateStep(index, { department: v })} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {deptOptions.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Due Days</Label>
                  <Input type="number" min={0} value={step.dueDays} disabled={readOnly} onChange={(e) => updateStep(index, { dueDays: Number(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Escalation Role</Label>
                  <Select value={step.escalationRole || 'head_qa'} onValueChange={(v) => updateStep(index, { escalationRole: v })} disabled={readOnly}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {(step.stepType === 'Decision' || step.stepType === 'Condition' || step.conditionExpression) && (
                  <div className="space-y-1 sm:col-span-2 md:col-span-3">
                    <Label className="text-xs">Condition Expression</Label>
                    <Input
                      value={step.conditionExpression || ''}
                      disabled={readOnly}
                      placeholder="e.g. riskLevel == High"
                      onChange={(e) => updateStep(index, { conditionExpression: e.target.value })}
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">Next on Approve</Label>
                  <Input
                    value={step.nextStepOnApprove || ''}
                    disabled={readOnly}
                    placeholder="Step name"
                    onChange={(e) => updateStep(index, { nextStepOnApprove: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Next on Reject</Label>
                  <Input
                    value={step.nextStepOnReject || ''}
                    disabled={readOnly}
                    placeholder="Step name"
                    onChange={(e) => updateStep(index, { nextStepOnReject: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 pt-2">
                {[
                  { key: 'isMandatory', label: 'Mandatory' },
                  { key: 'canApprove', label: 'Can Approve' },
                  { key: 'canReject', label: 'Can Reject' },
                  { key: 'canSendBack', label: 'Can Send Back / Rework' },
                  { key: 'requireESignature', label: 'E-Sign' },
                  { key: 'requireComment', label: 'Require Comment' },
                  { key: 'isParallel', label: 'Parallel' },
                ].map((item) => (
                  <div key={item.key} className="flex items-center gap-2">
                    <Checkbox
                      checked={step[item.key as keyof Step] as boolean}
                      onCheckedChange={(v) => updateStep(index, { [item.key]: Boolean(v) })}
                      disabled={readOnly}
                    />
                    <Label className="text-xs">{item.label}</Label>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
