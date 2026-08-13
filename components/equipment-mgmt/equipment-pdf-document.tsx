'use client';

import type { EquipmentRecord, CalibrationRecord, PmRecord, BreakdownRecord } from '@/lib/equipment-mgmt-types';

export function EquipmentPdfDocument({
  equipment, calibrations, pmRecords, breakdowns, reportTitle = 'Equipment Report',
}: {
  equipment: EquipmentRecord[];
  calibrations: CalibrationRecord[];
  pmRecords: PmRecord[];
  breakdowns: BreakdownRecord[];
  reportTitle?: string;
}) {
  return (
    <div className="max-w-4xl mx-auto bg-white text-black p-8 space-y-6 print:p-4" id="equipment-report">
      <header className="border-b pb-4">
        <h1 className="text-xl font-bold">{reportTitle}</h1>
        <p className="text-sm text-gray-600">Generated {new Date().toLocaleDateString()} — GMP Equipment Management</p>
      </header>
      <section>
        <h2 className="font-semibold mb-2">Equipment Master Register</h2>
        <table className="w-full text-xs border"><thead><tr className="bg-gray-100">
          <th className="p-1 border">ID</th><th className="p-1 border">Name</th><th className="p-1 border">Type</th>
          <th className="p-1 border">Dept</th><th className="p-1 border">Status</th><th className="p-1 border">Cal</th><th className="p-1 border">PM</th>
        </tr></thead>
          <tbody>{equipment.map((e) => (
            <tr key={e.id}><td className="p-1 border font-mono">{e.equipment_id}</td><td className="p-1 border">{e.equipment_name}</td>
              <td className="p-1 border">{e.equipment_type}</td><td className="p-1 border">{e.department}</td>
              <td className="p-1 border">{e.equipment_status}</td><td className="p-1 border">{e.calibration_status}</td><td className="p-1 border">{e.pm_status}</td></tr>
          ))}</tbody></table>
      </section>
      {calibrations.length > 0 && (
        <section><h2 className="font-semibold mb-2">Calibration Records</h2>
          <table className="w-full text-xs border"><thead><tr className="bg-gray-100">
            <th className="p-1 border">Record No</th><th className="p-1 border">Equipment</th><th className="p-1 border">Date</th>
            <th className="p-1 border">Due</th><th className="p-1 border">Status</th><th className="p-1 border">Agency</th>
          </tr></thead>
            <tbody>{calibrations.map((c) => (
              <tr key={c.id}><td className="p-1 border">{c.calibration_record_no}</td><td className="p-1 border">{c.equipment_name}</td>
                <td className="p-1 border">{c.calibration_date}</td><td className="p-1 border">{c.calibration_due_date}</td>
                <td className="p-1 border">{c.calibration_status}</td><td className="p-1 border">{c.calibration_agency}</td></tr>
            ))}</tbody></table>
        </section>
      )}
      {pmRecords.length > 0 && (
        <section><h2 className="font-semibold mb-2">Preventive Maintenance</h2>
          <table className="w-full text-xs border"><thead><tr className="bg-gray-100">
            <th className="p-1 border">PM No</th><th className="p-1 border">Equipment</th><th className="p-1 border">Date</th>
            <th className="p-1 border">Next Due</th><th className="p-1 border">Status</th>
          </tr></thead>
            <tbody>{pmRecords.map((p) => (
              <tr key={p.id}><td className="p-1 border">{p.pm_record_no}</td><td className="p-1 border">{p.equipment_name}</td>
                <td className="p-1 border">{p.pm_date}</td><td className="p-1 border">{p.next_pm_due_date}</td><td className="p-1 border">{p.pm_status}</td></tr>
            ))}</tbody></table>
        </section>
      )}
      {breakdowns.length > 0 && (
        <section><h2 className="font-semibold mb-2">Breakdown Records</h2>
          <table className="w-full text-xs border"><thead><tr className="bg-gray-100">
            <th className="p-1 border">Breakdown No</th><th className="p-1 border">Equipment</th><th className="p-1 border">Date</th>
            <th className="p-1 border">Status</th><th className="p-1 border">Downtime (h)</th>
          </tr></thead>
            <tbody>{breakdowns.map((b) => (
              <tr key={b.id}><td className="p-1 border">{b.breakdown_no}</td><td className="p-1 border">{b.equipment_name}</td>
                <td className="p-1 border">{b.breakdown_date}</td><td className="p-1 border">{b.status}</td><td className="p-1 border">{b.downtime_hours}</td></tr>
            ))}</tbody></table>
        </section>
      )}
    </div>
  );
}

export function EquipmentDetailPdf({ equipment, calibrations, pmRecords, breakdowns }: {
  equipment: EquipmentRecord; calibrations: CalibrationRecord[]; pmRecords: PmRecord[]; breakdowns: BreakdownRecord[];
}) {
  return (
    <div className="max-w-4xl mx-auto bg-white text-black p-8 space-y-6 print:p-4" id="equipment-detail-report">
      <header className="border-b pb-4">
        <h1 className="text-xl font-bold">Equipment Dossier — {equipment.equipment_id}</h1>
        <p className="text-sm text-gray-600">{equipment.equipment_name} | {equipment.manufacturing_line || '—'}</p>
      </header>
      <section>
        <h2 className="font-semibold mb-2">Master Data</h2>
        <table className="w-full text-sm border-collapse">
          <tbody>{[
            ['Equipment ID', equipment.equipment_id],
            ['Name', equipment.equipment_name],
            ['Qualification Status', equipment.qualification_status || '—'],
            ['Manufacturing Line', equipment.manufacturing_line || '—'],
            ['Status', equipment.equipment_status],
          ].map(([k, v]) => (
            <tr key={k} className="border-b"><td className="py-1 pr-4 font-medium w-40">{k}</td><td>{v}</td></tr>
          ))}</tbody>
        </table>
      </section>
      {calibrations.length > 0 && (
        <section><h2 className="font-semibold mb-2">Calibration History ({calibrations.length})</h2>
          <table className="w-full text-xs border"><thead><tr className="bg-gray-100"><th className="p-1 border">No</th><th className="p-1 border">Date</th><th className="p-1 border">Due</th><th className="p-1 border">Status</th></tr></thead>
            <tbody>{calibrations.map((c) => <tr key={c.id}><td className="p-1 border">{c.calibration_record_no}</td><td className="p-1 border">{c.calibration_date}</td><td className="p-1 border">{c.calibration_due_date}</td><td className="p-1 border">{c.calibration_status}</td></tr>)}</tbody></table>
        </section>
      )}
      {pmRecords.length > 0 && (
        <section><h2 className="font-semibold mb-2">PM History ({pmRecords.length})</h2>
          <table className="w-full text-xs border"><thead><tr className="bg-gray-100"><th className="p-1 border">No</th><th className="p-1 border">Date</th><th className="p-1 border">Next Due</th><th className="p-1 border">Status</th></tr></thead>
            <tbody>{pmRecords.map((p) => <tr key={p.id}><td className="p-1 border">{p.pm_record_no}</td><td className="p-1 border">{p.pm_date}</td><td className="p-1 border">{p.next_pm_due_date}</td><td className="p-1 border">{p.pm_status}</td></tr>)}</tbody></table>
        </section>
      )}
      {breakdowns.length > 0 && (
        <section><h2 className="font-semibold mb-2">Breakdown History ({breakdowns.length})</h2>
          <table className="w-full text-xs border"><thead><tr className="bg-gray-100"><th className="p-1 border">No</th><th className="p-1 border">Date</th><th className="p-1 border">Status</th><th className="p-1 border">Downtime</th></tr></thead>
            <tbody>{breakdowns.map((b) => <tr key={b.id}><td className="p-1 border">{b.breakdown_no}</td><td className="p-1 border">{b.breakdown_date}</td><td className="p-1 border">{b.status}</td><td className="p-1 border">{b.downtime_hours}h</td></tr>)}</tbody></table>
        </section>
      )}
    </div>
  );
}
