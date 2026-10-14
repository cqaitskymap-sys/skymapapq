'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import type { PqrDocument, PqrApproval, PqrDataSnapshot } from '@/lib/pqr-types';

const FORMAT_NO = 'SOP/QA/055/F01-03';

const TOC: { no: string; title: string; sheet: string }[] = [
  { no: '1.', title: 'Introduction', sheet: 'intro' },
  { no: '2.', title: 'Objective', sheet: 'intro' },
  { no: '3.', title: 'Scope', sheet: 'intro' },
  { no: '4.', title: 'Responsibility', sheet: 'intro' },
  { no: '5.', title: 'Product Information', sheet: 'product' },
  { no: '5.1', title: 'Product details', sheet: 'product' },
  { no: '5.2', title: 'Batch Manufacturing Details during the review period', sheet: 'batches' },
  { no: '5.3', title: 'Equipment Details with qualification status', sheet: 'batches' },
  { no: '5.4', title: 'Active Pharmaceutical Ingredient data', sheet: 'api' },
  { no: '5.5', title: 'Raw material (API) Manufacturer/ Supplier performance review', sheet: 'api' },
  { no: '5.6', title: 'Excipients Data review', sheet: 'excipients' },
  { no: '5.7', title: 'Primary Packing material data', sheet: 'primary' },
  { no: '5.8', title: 'Primary Packing material Manufacturer/ Supplier performance review', sheet: 'primary' },
  { no: '5.9', title: 'Packing material data', sheet: 'packing' },
  { no: '5.10', title: 'Critical process parameter', sheet: 'cpp' },
  { no: '5.10.1', title: 'Dispensing of Raw Material', sheet: 'cpp' },
  { no: '5.10.2', title: 'Manufacturing parameter', sheet: 'cpp' },
  { no: '5.11', title: 'Specification Results', sheet: 'specs' },
  { no: '5.11.1', title: 'In process', sheet: 'specs' },
  { no: '5.11.2', title: 'Finished Products', sheet: 'specs' },
  { no: '5.12', title: 'Stage wise Yield', sheet: 'yield' },
  { no: '5.13', title: 'Batch (s) Failure/Rejected (If Any)', sheet: 'yield' },
  { no: '5.14', title: 'Reworking and reprocess', sheet: 'yield' },
  { no: '5.15', title: 'Manufactured and testing procedure followed', sheet: 'yield' },
  { no: '6.', title: 'Out of specification and Internal Quality complaints', sheet: 'events' },
  { no: '7.', title: 'Non-conformance report', sheet: 'events' },
  { no: '8.', title: 'A review of all changes carried out to the processes or analytical methods', sheet: 'events' },
  { no: '9.', title: 'Incident and deviation reporting', sheet: 'events' },
  { no: '10.', title: 'Stability review', sheet: 'events' },
  { no: '11.', title: 'Validation and Qualification', sheet: 'reviews' },
  { no: '12.', title: 'Review of retained sample', sheet: 'reviews' },
  { no: '13.', title: 'Market complaints', sheet: 'reviews' },
  { no: '14.', title: 'Product recall and returned goods', sheet: 'reviews' },
  { no: '15.', title: 'CAPA effectiveness review (If any)', sheet: 'reviews' },
  { no: '16.', title: 'Review of Marketing Variations submitted, granted or refused, including those for third country Dossiers', sheet: 'reviews' },
  { no: '17.', title: 'Review For New Marketing Authorizations and Variations to Marketing Authorizations, a review of post-marketing commitments', sheet: 'reviews' },
  { no: '18.', title: 'Review of Adequacy of product process and equipment corrective actions', sheet: 'reviews' },
  { no: '19.', title: 'Review of control Limits', sheet: 'closeout' },
  { no: '20.', title: 'Review of Technical Agreements', sheet: 'closeout' },
  { no: '21.', title: 'Supply chain Traceability', sheet: 'closeout' },
  { no: '22.', title: 'Evaluation of CQA and Excipients testing', sheet: 'closeout' },
  { no: '23.', title: 'Distribution of Finished vials', sheet: 'closeout' },
  { no: '24.', title: 'Summary', sheet: 'summary' },
  { no: '25.', title: 'Conclusion', sheet: 'conclusion' },
  { no: '26.', title: 'Recommendation review and Update PQR Documentation', sheet: 'conclusion' },
  { no: '27.', title: 'PQR Submitted to (if any)', sheet: 'conclusion' },
  { no: '28.', title: 'Tracking System', sheet: 'conclusion' },
  { no: '29.', title: 'Revision History', sheet: 'revision' },
  { no: '30.', title: 'Abbreviation', sheet: 'revision' },
  { no: '31.', title: 'PQR Approval', sheet: 'approval' },
];

const ABBREVIATIONS: [string, string][] = [
  ['STP', 'Standard Test Procedure'],
  ['STS', 'Standard test Specification'],
  ['FP', 'Finish product'],
  ['SF', 'Semi finish'],
  ['BMR', 'Batch Manufacturing Record'],
  ['BPR', 'Batch Packing Record'],
  ['M.F.R.No.', 'Master Formula Record Number'],
  ['PQR', 'Product Quality Review'],
  ['Min.', 'Minimum value from all values'],
  ['Max.', 'Maximum value from all values'],
  ['API', 'Active Pharmaceutical Ingredients'],
  ['A.R.', 'Analytical Report'],
  ['HVAC', 'Heating Ventilation Air Conditioner'],
  ['CAPA', 'Corrective action and preventive action'],
  ['OOS', 'Out of Specification'],
  ['LT', 'Less Than'],
  ['NMT', 'Not more than'],
  ['ND', 'Not Detected'],
  ['AVL', 'Approved Vendor List'],
  ['BDL', 'Below Detected Limit'],
];

const IP_TESTS = ['Description', 'pH', 'Weight per ml', 'Colour Index', 'Benzyl Alcohol', 'Assay'];
const FP_TESTS = [
  'Description', 'Identification', 'pH', 'Extracted Volume',
  'Particulate Matter — Visible', 'Particulate Matter — ≥10 µm', 'Particulate Matter — ≥25 µm',
  'Bacterial Endotoxin', 'Sterility', 'Related Substance', 'Benzyl Alcohol', 'Assay',
];

type Row = Record<string, unknown>;

function text(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

function pick(row: Row, keys: string[], fallback = '—'): string {
  for (const key of keys) {
    const value = text(row[key]);
    if (value) return value;
  }
  return fallback;
}

function dmy(value: string): string {
  if (!value || value === '—') return value || '—';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value) || /^\d{2}\/\d{4}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}

function monthYear(value: string): string {
  if (!value) return '—';
  if (/^\d{2}\/\d{4}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function periodLabel(from: string, to: string): string {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${from} to ${to}`;
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }).replace(' ', '-');
  return `${fmt(start)} to ${fmt(end)}`;
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function includesAny(value: string, words: string[]): boolean {
  const n = norm(value);
  return words.some((word) => n.includes(norm(word)));
}

function SkymapMark() {
  return (
    <svg viewBox="0 0 72 52" className="h-11 w-14" aria-label="Skymap">
      <path d="M6 34c10-18 16-24 30-24s20 6 30 24" fill="none" stroke="#1d4ed8" strokeWidth="3.2" />
      <path d="M14 36c7-12 12-16 22-16s15 4 22 16" fill="none" stroke="#16a34a" strokeWidth="2.2" />
      <text x="36" y="48" textAnchor="middle" fontSize="9" fontWeight="700" fill="#1e3a8a">SKYMAP</text>
    </svg>
  );
}

function Sheet({
  doc, page, total, children,
}: {
  doc: PqrDocument;
  page: number;
  total: number;
  children: ReactNode;
}) {
  const product = (doc.product_name || 'PRODUCT').toUpperCase();
  const formatNo = doc.format_number || FORMAT_NO;
  const revision = doc.revision_number || doc.current_revision || '00';
  return (
    <section className="sop-sheet bg-white text-black border border-black mx-auto w-[210mm] min-h-[297mm] px-3 pt-2 pb-8 mb-4 relative print:mb-0 print:shadow-none">
      <table className="w-full border-collapse text-[8px] mb-2">
        <tbody>
          <tr>
            <td className="border border-black w-[68px] text-center align-middle p-1" rowSpan={3}>
              {doc.company_logo_url ? (
                <Image src={doc.company_logo_url} alt="Skymap" width={56} height={40} className="object-contain mx-auto" unoptimized />
              ) : <SkymapMark />}
            </td>
            <td className="border border-black text-center font-bold leading-tight px-1 w-[28%]" rowSpan={3}>
              SKYMAP<br />PHARMACEUTICALS<br />PVT. LTD., ROORKEE
            </td>
            <td className="border border-black text-center font-bold leading-tight px-1" rowSpan={3}>
              PRODUCT QUALITY<br />REVIEW FOR<br />{product}
            </td>
            <td className="border border-black px-1 py-0.5 whitespace-nowrap">PQR No.: {doc.pqr_number}</td>
          </tr>
          <tr>
            <td className="border border-black px-1 py-0.5">PAGE No.: {page} of {total}</td>
          </tr>
          <tr>
            <td className="border border-black px-1 py-0.5">REVISION No.: {revision}</td>
          </tr>
        </tbody>
      </table>
      <div className="text-[9px] leading-snug">{children}</div>
      <p className="absolute bottom-1.5 left-3 text-[8px]">FORMAT No.: {formatNo}</p>
    </section>
  );
}

function H({ children }: { children: ReactNode }) {
  return <h2 className="font-bold text-[10px] mt-2 mb-1">{children}</h2>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-justify">{children}</p>;
}

function Grid({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <table className="w-full border-collapse text-[7.5px] mb-2">
      <thead>
        <tr className="bg-neutral-200">
          {headers.map((header) => (
            <th key={header} className="border border-black px-1 py-0.5 text-center font-semibold align-bottom">{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(rows.length ? rows : [headers.map(() => '')]).map((row, index) => (
          <tr key={index}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex} className="border border-black px-1 py-0.5 align-top">{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Kv({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full border-collapse text-[9px] mb-2">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td className="border border-black px-2 py-1 font-semibold w-[38%]">{label}</td>
            <td className="border border-black px-2 py-1 whitespace-pre-line">{value || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function dedupe(rows: Row[], keys: string[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const row of rows) {
    const key = keys.map((k) => text(row[k])).filter(Boolean).join('|') || JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function batchRows(records: Row[]) {
  return dedupe(records, ['finishedProductBatchNumber', 'batchNumber', 'batch_number', 'id']).map((row) => ({
    sf: pick(row, ['semiFinishedBatchNumber', 'semi_finish_batch_no', 'sfBatchNo', 'batchNumber', 'batch_number'], ''),
    finish: pick(row, ['finishedProductBatchNumber', 'finishBatchNo', 'packingBatchNumber', 'batchNumber', 'batch_number'], ''),
    mfg: monthYear(pick(row, ['manufacturingDate', 'manufacturing_date', 'mfg_date', 'mfgDate'], '')),
    exp: monthYear(pick(row, ['expiryDate', 'expiry_date', 'exp_date', 'expDate'], '')),
    size: [pick(row, ['batchSize', 'batch_size'], ''), pick(row, ['batchSizeUnit', 'batch_size_unit'], '')].filter((v) => v && v !== '—').join(' '),
    product: pick(row, ['productName', 'product_name', 'product', 'brandName'], ''),
    madeFor: pick(row, ['manufacturedFor', 'customerName', 'market', 'customer'], ''),
    remark: pick(row, ['releaseStatus', 'batchStatus', 'batch_status', 'status'], ''),
  }));
}

function materialKind(row: Row): 'api' | 'primary' | 'excipient' | 'other' {
  const blob = `${pick(row, ['materialType', 'material_type', 'packagingMaterialType', 'packagingMaterialCategory'], '')} ${pick(row, ['materialName', 'material_name'], '')}`.toLowerCase();
  if (blob.includes('api') || blob.includes('active pharmaceutical')) return 'api';
  if (blob.includes('primary') || blob.includes('ampoule') || blob.includes('vial') || blob.includes('glass')) return 'primary';
  if (blob.includes('excipient') || blob.includes('raw')) return 'excipient';
  return 'other';
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item) || '—';
    const list = map.get(k) || [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

function numbers(values: string[]): number[] {
  return values.map((v) => Number(String(v).replace(/[^\d.-]/g, ''))).filter((n) => Number.isFinite(n));
}

function statRows(columns: number[][]): string[][] {
  const stats = (fn: (nums: number[]) => string) => columns.map((col) => (col.length ? fn(col) : ''));
  return [
    ['Minimum', ...stats((n) => Math.min(...n).toFixed(2))],
    ['Maximum', ...stats((n) => Math.max(...n).toFixed(2))],
    ['Mean (μ)', ...stats((n) => (n.reduce((a, b) => a + b, 0) / n.length).toFixed(2))],
  ];
}

function eventLines(records: Row[], titleKeys: string[]): string[][] {
  return records.slice(0, 20).map((row, index) => [
    String(index + 1),
    pick(row, titleKeys),
    pick(row, ['batchNumber', 'batch_number', 'batchNo', 'batch_no']),
    pick(row, ['status']),
    pick(row, ['description', 'summary', 'remarks', 'title', 'deviation_title', 'oos_description']),
  ]);
}

function SignTable({
  rows,
}: {
  rows: { designation: string; name: string; signature: string; date: string }[];
}) {
  return (
    <table className="w-full border-collapse text-[9px] mb-4">
      <thead>
        <tr className="bg-neutral-200">
          {['DESIGNATION', 'NAME', 'SIGNATURE', 'DATE'].map((h) => (
            <th key={h} className="border border-black px-2 py-1">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.designation}>
            <td className="border border-black px-2 py-2 font-semibold">{row.designation}</td>
            <td className="border border-black px-2 py-2">{row.name}</td>
            <td className="border border-black px-2 py-2 italic">{row.signature}</td>
            <td className="border border-black px-2 py-2">{row.date}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function findApproval(approvals: PqrApproval[], hints: string[], type?: PqrApproval['approval_type']) {
  return approvals.find((approval) => {
    const blob = `${approval.designation} ${approval.approval_type} ${approval.esign_meaning || ''}`.toLowerCase();
    const typeOk = !type || approval.approval_type === type;
    return typeOk && hints.some((hint) => blob.includes(hint));
  });
}

function signCell(approval?: PqrApproval) {
  if (!approval) return { name: '', signature: '', date: '' };
  return {
    name: approval.name || '',
    signature: approval.signature_text || (approval.status === 'approved' ? 'Signed electronically' : ''),
    date: approval.approval_date ? dmy(approval.approval_date) : '',
  };
}

export function PqrPdfDocument({
  document: doc,
  approvals,
  snapshot,
}: {
  document: PqrDocument;
  approvals: PqrApproval[];
  snapshot: PqrDataSnapshot | null;
}) {
  const product = doc.product_name || 'the product';
  const period = periodLabel(doc.review_period_from, doc.review_period_to);
  const year = doc.pqr_year || new Date(doc.review_period_from).getFullYear();
  const batches = batchRows(snapshot?.batches.records || []);
  const materials = snapshot?.materials.records || [];
  const packaging = snapshot?.packaging.records || [];
  const apiRows = materials.filter((row) => materialKind(row) === 'api');
  const excipientRows = materials.filter((row) => materialKind(row) !== 'api');
  const primaryRows = [...packaging, ...materials].filter((row) => materialKind(row) === 'primary');
  const secondaryRows = packaging.filter((row) => materialKind(row) !== 'primary');
  const equipment = dedupe(snapshot?.equipment.records || [], ['equipmentCode', 'equipmentId', 'equipmentName']);
  const cpp = snapshot?.cpp.records || [];
  const cqa = snapshot?.cqa.records || [];
  const deviations = snapshot?.deviations.records || [];
  const oos = snapshot?.oos.records || [];
  const capa = snapshot?.capa.records || [];
  const changes = snapshot?.changeControl.records || [];
  const stability = snapshot?.stability.records || [];
  const rejected = batches.filter((row) => /reject/i.test(row.remark));
  const rework = (snapshot?.batches.records || []).filter((row) => row.reworkRequired === true || row.reprocessRequired === true || /rework|reprocess/i.test(text(row.batchStatus || row.status)));

  const batchGroups = Array.from(groupBy(batches, (row) => row.sf || row.finish).entries());
  const excipientGroups = Array.from(groupBy(excipientRows, (row) => pick(row, ['materialName', 'material_name'], 'Excipient')).entries());

  const dispensing = cpp.filter((row) => {
    const stage = pick(row, ['process_stage', 'processStage', 'stage'], '');
    const parameter = pick(row, ['parameter_name', 'parameterName', 'parameter'], '');
    if (includesAny(stage, ['steril', 'mixing', 'holding', 'filtrat', 'washing', 'depyro', 'filling', 'sealing'])) return false;
    if (includesAny(stage, ['dispens'])) return true;
    return includesAny(parameter, ['balance', 'relative humidity', 'rh%', 'dispensing temperature', 'room temperature']);
  });
  const manufacturing = cpp.filter((row) => !dispensing.includes(row));
  const mfgStages = Array.from(groupBy(manufacturing, (row) => pick(row, ['process_stage', 'processStage', 'stage'], 'Manufacturing')).entries());

  const inProcess = cqa.filter((row) => !includesAny(pick(row, ['stage', 'process_stage', 'sample_type', 'sampleType', 'test_type'], ''), ['finish', 'fp', 'release']));
  const finished = cqa.filter((row) => !inProcess.includes(row) || includesAny(pick(row, ['stage', 'process_stage', 'sample_type', 'sampleType'], ''), ['finish', 'fp']));
  const ipSource = inProcess.length ? inProcess : cqa;
  const fpSource = finished.length ? finished : [];

  function pivot(records: Row[], tests: string[]) {
    const batchesFound = Array.from(groupBy(records, (row) => pick(row, ['batchNumber', 'batch_number', 'batchNo', 'sfBatchNo'], '')).entries());
    const extraTests = Array.from(new Set(records.map((row) => pick(row, ['parameterName', 'parameter_name', 'testName', 'test_name', 'check_name'], '')).filter((name) => name !== '—' && !tests.some((test) => norm(test) === norm(name) || norm(name).includes(norm(test)) || norm(test).includes(norm(name))))));
    const columns = [...tests, ...extraTests];
    const body = batchesFound.map(([batch, rows], index) => {
      const cells = columns.map((test) => {
        const hit = rows.find((row) => {
          const name = pick(row, ['parameterName', 'parameter_name', 'testName', 'test_name', 'check_name'], '');
          return norm(name) === norm(test) || norm(name).includes(norm(test)) || norm(test).includes(norm(name));
        });
        return hit ? pick(hit, ['observed_value', 'observedValue', 'observedResult', 'result', 'value', 'status']) : '';
      });
      return [String(index + 1), batch, ...cells];
    });
    return { columns, body };
  }

  const ip = pivot(ipSource, IP_TESTS);
  const fp = pivot(fpSource, FP_TESTS);

  const yieldRows = (snapshot?.batches.records || []).map((row) => ({
    batch: pick(row, ['finishedProductBatchNumber', 'batchNumber', 'batch_number']),
    bulk: pick(row, ['bulkYield', 'yieldAtBulk', 'theoreticalYield'], ''),
    filling: pick(row, ['fillingYield', 'yieldAtFilling'], ''),
    packing: pick(row, ['packingYield', 'yieldAtPacking', 'yieldPct', 'yield_percentage', 'actualYield'], ''),
  })).filter((row) => row.batch !== '—');
  const yieldStats = statRows([
    numbers(yieldRows.map((r) => r.bulk)),
    numbers(yieldRows.map((r) => r.filling)),
    numbers(yieldRows.map((r) => r.packing)),
  ]);

  const none = (count: number, sentence: string, detail: string) => (count === 0 ? sentence : detail);
  const cpk = snapshot?.processCapability.averageCpk;

  const summaryRows: [string, string, string, string][] = [
    ['01', 'Review of API & Excipients', apiRows.length + excipientRows.length ? `${product} starting materials reviewed from approved-vendor records. API lots: ${apiRows.length}. Excipient lots: ${excipientRows.length}.` : `${product} starting material review is included for the review period.`, 'Critical quality attributes reviewed against specification.'],
    ['02', 'Review of PM', primaryRows.length + secondaryRows.length ? `Packing material lots reviewed: primary ${primaryRows.length}, other packing ${secondaryRows.length}.` : 'Packing material review included for the review period.', 'Analytical parameters reviewed against specification.'],
    ['03', 'Review of critical in-process and Finished parameter', `In-process results: ${ipSource.length}. Finished product results: ${fpSource.length}.`, oos.length ? `${oos.length} OOS recorded.` : 'Results reviewed against specification.'],
    ['04', 'Review of changes in processes and analytical methods', changes.length ? `${changes.length} change(s) recorded.` : 'No change was observed during the review period.', changes.length ? 'Reviewed' : 'NA'],
    ['05', 'Review of Qualification status of relevant Equipment/utilities', equipment.length ? `${equipment.length} equipment record(s) reviewed.` : 'Equipment qualification status reviewed.', 'Complies'],
    ['06', 'Batch failure/Rejection', rejected.length ? `${rejected.length} batch(es) rejected.` : 'No rejection found during the review period.', rejected.length ? 'See section 5.13' : 'NA'],
    ['07', 'Reprocess/Rework', rework.length ? `${rework.length} batch(es) reworked or reprocessed.` : 'No batch reprocess and rework.', rework.length ? 'See section 5.14' : 'NA'],
    ['08', 'OOS and Internal Quality complaints', oos.length ? `${oos.length} OOS recorded.` : 'No OOS and quality complaints observed in the recorded data.', oos.length ? 'See section 6.0' : 'NA'],
    ['09', 'Non-conformance report', 'No non-conformance is recorded in this PQR.', 'NA'],
    ['10', 'Incident and Deviation', deviations.length ? `${deviations.length} deviation(s) recorded.` : 'No incident and no deviation observed in the recorded data.', deviations.length ? 'See section 9.0' : 'NA'],
    ['11', 'Stability Review', stability.length ? `${stability.length} stability record(s) reviewed.` : 'Stability data reviewed as per the stability schedule.', 'Comply with current specification'],
    ['12', 'Validation and Qualification', 'Process validation and equipment qualification status were reviewed for the manufacturing year.', 'Complies'],
    ['13', 'Market complaints', 'No market complaint is recorded in this PQR for the review period.', 'Complies'],
    ['14', 'Product recall and Returned goods', 'No product recall is recorded in this PQR for the review period.', 'NA'],
    ['15', 'CAPA Effectiveness', capa.length ? `${capa.length} CAPA record(s) reviewed.` : 'No CAPA observed in the recorded data.', capa.length ? 'See section 15.0' : 'NA'],
  ];

  const sheets: { id: string; node: (page: number, total: number) => ReactNode }[] = [
    {
      id: 'cover',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <div className="min-h-[210mm] flex flex-col justify-center">
            <h1 className="text-center font-bold text-[18px] tracking-wide leading-tight mb-10">
              PRODUCT QUALITY REVIEW<br />FOR {product.toUpperCase()}
            </h1>
            <table className="w-[88%] mx-auto border-collapse text-[11px]">
              <tbody>
                <tr><td className="border border-black px-3 py-2 font-semibold w-[40%]">PRODUCT NAME</td><td className="border border-black px-3 py-2">{doc.product_name}</td></tr>
                <tr><td className="border border-black px-3 py-2 font-semibold">STRENGTH</td><td className="border border-black px-3 py-2">{doc.strength || '—'}</td></tr>
                <tr><td className="border border-black px-3 py-2 font-semibold">Review Period</td><td className="border border-black px-3 py-2">{dmy(doc.review_period_from)} - {dmy(doc.review_period_to)}</td></tr>
              </tbody>
            </table>
          </div>
        </Sheet>
      ),
    },
    {
      id: 'contents',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>CONTENTS OF PQR</H>
          <table className="w-full border-collapse text-[8px]">
            <thead>
              <tr className="bg-neutral-200">
                <th className="border border-black px-1 py-1 w-14">S. No.</th>
                <th className="border border-black px-1 py-1 text-left">TITLE</th>
                <th className="border border-black px-1 py-1 w-16">PAGE No.</th>
              </tr>
            </thead>
            <tbody>
              {TOC.map((item) => (
                <tr key={item.no + item.title}>
                  <td className="border border-black px-1 py-0.5">{item.no}</td>
                  <td className="border border-black px-1 py-0.5">{item.title}</td>
                  <td className="border border-black px-1 py-0.5 text-center">{pageOf(item.sheet)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Sheet>
      ),
    },
    {
      id: 'intro',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>1.0 Introduction:</H>
          <P>“Product Quality Review” is the product wise comprehensive summary that includes data, in tabular form and the Graphical Representation, of the review of starting material, Critical Process Parameter, Critical quality attributes and qualification status of equipment and utility and used QMS tools etc. It provides the reader a quick glimpse of the reproducibility of the process.</P>
          <H>2.0 Objective:</H>
          <P>The objective of product quality review is to review the critical in process and quality parameters, and to ensure that the product formula and manufacturing process is capable of producing the finished goods in compliance to its pre-determined quality attributes and specifications.</P>
          <H>3.0 Scope:</H>
          <P>The Scope of this Product Quality Review is applicable to {product}{doc.product_code ? `, product Code - ${doc.product_code}` : ''}, manufactured in year {year} at {doc.site_name || 'Skymap Pharmaceuticals Pvt. Ltd., Roorkee'}{doc.market ? ` for ${doc.market} market` : ''}.</P>
          <H>4.0 Responsibility:</H>
          <P><strong>Officer/Executive-QA:</strong> To prepare PQR.</P>
          <P><strong>Manager QA:</strong> Responsible for Review of PQR.</P>
          <P><strong>Head Warehouse:</strong> To provide starting material data and review PQR for starting material related data.</P>
          <P><strong>Head Production:</strong> To organize production related data for compilation and review PQR for production related data.</P>
          <P><strong>Head Engineering:</strong> To review PQR and address finding related to machine breakdown and equipment.</P>
          <P><strong>Head QC:</strong> To provide QC related data and review PQR for QC related data.</P>
          <P><strong>Head QA:</strong> To ensure PQR performed in timely manner and is accurate. To review, conclude CAPA and approve PQR.</P>
        </Sheet>
      ),
    },
    {
      id: 'product',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>5.0 Product Information</H>
          <H>5.1 Product Details:</H>
          <Kv rows={[
            ['Generic Name', doc.generic_name || '—'],
            ['Product name / Brand Name', [doc.brand_name, doc.product_name].filter(Boolean).join('\n') || '—'],
            ['Strength (Label Claim)', [doc.strength, doc.label_claim].filter(Boolean).join('\n') || '—'],
            ['Shelf Life', doc.shelf_life || '—'],
            ['Standard batch size', doc.standard_batch_size || '—'],
            ['Manufacturing license no.', doc.manufacturing_license_no || '—'],
            ['Number of Batches Manufactured', String(batches.length || doc.total_batches_manufactured || 0)],
            ['Final Packing Details', doc.final_packing_details || '—'],
          ]} />
        </Sheet>
      ),
    },
    {
      id: 'batches',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>5.2 Batch Manufacturing details during the Review period:</H>
          <P>Below batches are manufactured during the PQR review period {period}.</P>
          <table className="w-full border-collapse text-[7.5px] mb-3">
            <thead>
              <tr className="bg-neutral-200">
                {['S. No.', 'Semi Finish Batch No.', 'Finish Batch No.', 'Mfg. Date', 'Exp. Date', 'Batch Size in Litre', 'Product Name', 'Manufactured For', 'Remark (Release/Rejected)'].map((h) => (
                  <th key={h} className="border border-black px-1 py-0.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {batchGroups.length === 0 && (
                <tr>{Array.from({ length: 9 }).map((_, i) => <td key={i} className="border border-black px-1 py-2" />)}</tr>
              )}
              {batchGroups.map(([sf, rows], index) => rows.map((row, rowIndex) => (
                <tr key={`${sf}-${row.finish}-${rowIndex}`}>
                  {rowIndex === 0 && <td className="border border-black px-1 py-0.5 text-center" rowSpan={rows.length}>{index + 1}</td>}
                  {rowIndex === 0 && <td className="border border-black px-1 py-0.5" rowSpan={rows.length}>{sf}</td>}
                  <td className="border border-black px-1 py-0.5">{row.finish}</td>
                  <td className="border border-black px-1 py-0.5">{row.mfg}</td>
                  <td className="border border-black px-1 py-0.5">{row.exp}</td>
                  {rowIndex === 0 && <td className="border border-black px-1 py-0.5" rowSpan={rows.length}>{row.size}</td>}
                  <td className="border border-black px-1 py-0.5">{row.product}</td>
                  <td className="border border-black px-1 py-0.5">{row.madeFor}</td>
                  <td className="border border-black px-1 py-0.5">{row.remark}</td>
                </tr>
              )))}
            </tbody>
          </table>
          <H>5.3 EQUIPMENT DETAILS WITH THE QUALIFICATION STATUS:</H>
          <P>All equipment performance Qualification Status is reviewed for {year}. Preventive maintenance of equipment is reviewed as per the scheduled planner and critical Equipment/Instrument used in processing of {product}. Qualification / Calibration status details are mentioned below:</P>
          <Grid
            headers={['Name of Equipment', 'Equipment ID NO.', 'Qualification status']}
            rows={equipment.map((row) => [
              pick(row, ['equipmentName', 'equipment_name', 'name']),
              pick(row, ['equipmentCode', 'equipmentId', 'equipment_id']),
              pick(row, ['qualificationStatus', 'qualification_status', 'complianceStatus']),
            ])}
          />
        </Sheet>
      ),
    },
    {
      id: 'api',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>5.4 Active Pharmaceutical Ingredient Data:</H>
          <P>Details of API Data are found below:</P>
          <Grid
            headers={['S. No.', 'SF Batch No.', 'Material Name', 'Material code', 'Vendor Name', 'A.R No.', 'Mfg. Date', 'Exp. Date', 'Dispensed Qty.']}
            rows={apiRows.map((row, index) => [
              String(index + 1),
              pick(row, ['batchNumber', 'batchNo', 'batch_number']),
              pick(row, ['materialName', 'material_name']),
              pick(row, ['materialCode', 'material_code']),
              pick(row, ['manufacturerName', 'supplierName', 'vendor_name']),
              pick(row, ['arNumber', 'ar_number']),
              monthYear(pick(row, ['mfgDate', 'material_mfg_date'], '')),
              monthYear(pick(row, ['expDate', 'material_exp_date'], '')),
              [pick(row, ['usedQuantity', 'issuedQuantity', 'dispensed_quantity'], ''), pick(row, ['unit'], '')].filter((v) => v && v !== '—').join(' '),
            ])}
          />
          <H>5.5 Raw material (API) Manufacturer / Supplier Performance Review:</H>
          <P>Details of Raw material Manufacturer are as:</P>
          <Grid
            headers={['Name of API', 'Manufacturer Name', 'Supplier Name', 'Consignment / Batches Received', 'Listed in AVL', 'Consignments Approved', 'Consignments Rejected (if any)', 'Cause of Rejection']}
            rows={Array.from(groupBy(apiRows, (row) => `${pick(row, ['materialName'])}|${pick(row, ['manufacturerName'])}|${pick(row, ['supplierName'])}`).entries()).map(([, rows]) => {
              const row = rows[0];
              const rejectedLots = rows.filter((item) => /reject/i.test(pick(item, ['qcStatus', 'complianceStatus'], ''))).length;
              return [
                pick(row, ['materialName', 'material_name']),
                pick(row, ['manufacturerName', 'manufacturer']),
                pick(row, ['supplierName', 'supplier']),
                `${rows.length} batches`,
                pick(row, ['vendorAvlStatus', 'avlStatus'], ''),
                rejectedLots === rows.length ? '' : 'Approved',
                rejectedLots ? String(rejectedLots) : 'NA',
                rejectedLots ? pick(row, ['remarks'], 'NA') : 'NA',
              ];
            })}
          />
        </Sheet>
      ),
    },
    {
      id: 'excipients',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>5.6 Excipients Data review:</H>
          <P>All the Excipients data review of {product} during review period of PQR is included.</P>
          {excipientGroups.length === 0 && <Grid headers={['Sr. No.', 'Batch No.', 'Material Name', 'Material code', 'A.R No.', 'Dispensed Qty.', 'Manufacturer Name', 'Supplier Name', 'Listed in AVL', 'Consignments Approved', 'Consignments Rejected (if any)']} rows={[]} />}
          {excipientGroups.map(([name, rows], groupIndex) => (
            <div key={name}>
              <p className="font-semibold mt-2">{['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii'][groupIndex] || String(groupIndex + 1)}. {name}</p>
              <Grid
                headers={['Sr. No.', 'Batch No.', 'Material Name', 'Material code', 'A.R No.', 'Dispensed Qty.', 'Manufacturer Name', 'Supplier Name', 'Listed in AVL', 'Consignments Approved', 'Consignments Rejected (if any)']}
                rows={rows.map((row, index) => [
                  String(index + 1),
                  pick(row, ['batchNumber', 'batchNo', 'batch_number']),
                  pick(row, ['materialName', 'material_name']),
                  pick(row, ['materialCode', 'material_code']),
                  pick(row, ['arNumber', 'ar_number']),
                  [pick(row, ['usedQuantity', 'issuedQuantity'], ''), pick(row, ['unit'], '')].filter((v) => v && v !== '—').join(' '),
                  pick(row, ['manufacturerName']),
                  pick(row, ['supplierName']),
                  pick(row, ['vendorAvlStatus']),
                  /reject/i.test(pick(row, ['qcStatus', 'complianceStatus'], '')) ? '' : pick(row, ['qcStatus', 'complianceStatus'], 'Approved'),
                  /reject/i.test(pick(row, ['qcStatus'], '')) ? pick(row, ['rejectedQuantity', 'remarks'], 'Rejected') : 'NA',
                ])}
              />
            </div>
          ))}
        </Sheet>
      ),
    },
    {
      id: 'primary',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>5.7 Primary Packaging Material Data:</H>
          <P>Details of Primary Packing Material data found below:</P>
          <Grid
            headers={['S. No.', 'Batch No.', 'Name of Primary Packaging Material', 'Material code', 'Manufacturer Name', 'A.R No.', 'Dispensed Qty.', 'Description', 'Physical parameter']}
            rows={primaryRows.map((row, index) => [
              String(index + 1),
              pick(row, ['batchNumber', 'batchNo', 'batch_number']),
              pick(row, ['materialName', 'packagingMaterialName']),
              pick(row, ['materialCode', 'material_code']),
              pick(row, ['manufacturerName']),
              pick(row, ['arNumber', 'ar_number']),
              [pick(row, ['usedQuantity', 'issuedQuantity'], ''), pick(row, ['unit'], '')].filter((v) => v && v !== '—').join(' '),
              pick(row, ['qcStatus', 'complianceStatus']),
              pick(row, ['remarks'], ''),
            ])}
          />
          <H>5.8 Primary Packaging Material Manufacturer / Supplier Performance Review:</H>
          <P>Details of primary packing manufacturer review are as:</P>
          <Grid
            headers={['Name of Primary Packaging Material', 'Manufacturer (Name & Address)', 'Supplier (Name & Address)', 'Listed in AVL', 'Consignment / Batches Received', 'Consignments Approved', 'Consignments Rejected (if any)', 'Cause of Rejection']}
            rows={Array.from(groupBy(primaryRows, (row) => `${pick(row, ['materialName'])}|${pick(row, ['manufacturerName'])}`).entries()).map(([, rows]) => {
              const row = rows[0];
              const rejectedLots = rows.filter((item) => /reject/i.test(pick(item, ['qcStatus', 'complianceStatus'], ''))).length;
              return [
                pick(row, ['materialName']),
                pick(row, ['manufacturerName']),
                pick(row, ['supplierName']),
                pick(row, ['vendorAvlStatus'], ''),
                `${rows.length} batch`,
                rejectedLots === rows.length ? '' : 'Approved',
                rejectedLots ? String(rejectedLots) : 'NA',
                rejectedLots ? pick(row, ['remarks'], '') : 'NA',
              ];
            })}
          />
        </Sheet>
      ),
    },
    {
      id: 'packing',
      node: (page, total) => {
        const names = Array.from(groupBy(secondaryRows, (row) => pick(row, ['materialName', 'packagingMaterialCategory', 'packagingMaterialType'], 'Packing material')).keys());
        const byBatch = Array.from(groupBy(secondaryRows, (row) => pick(row, ['batchNumber', 'batchNo', 'batch_number'])).entries());
        return (
          <Sheet doc={doc} page={page} total={total}>
            <H>5.9 Packaging Material Data:</H>
            <P>All the packaging material data review of {product} during review period of PQR is included.</P>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[7px] mb-2">
                <thead>
                  <tr className="bg-neutral-200">
                    <th className="border border-black px-1" rowSpan={2}>Sr. No.</th>
                    <th className="border border-black px-1" rowSpan={2}>Batch No.</th>
                    {(names.length ? names : ['Label', 'Carton', 'Leaflet', 'C. Box', 'BOPP Tape']).map((name) => (
                      <th key={name} className="border border-black px-1" colSpan={2}>{name}</th>
                    ))}
                  </tr>
                  <tr className="bg-neutral-100">
                    {(names.length ? names : ['Label', 'Carton', 'Leaflet', 'C. Box', 'BOPP Tape']).flatMap((name) => [
                      <th key={`${name}-ar`} className="border border-black px-1">A.R No.</th>,
                      <th key={`${name}-qty`} className="border border-black px-1">Dispensed Qty.</th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {(byBatch.length ? byBatch : [['', []] as [string, Row[]]]).map(([batch, rows], index) => (
                    <tr key={batch || index}>
                      <td className="border border-black px-1">{batch ? index + 1 : ''}</td>
                      <td className="border border-black px-1">{batch}</td>
                      {(names.length ? names : ['Label', 'Carton', 'Leaflet', 'C. Box', 'BOPP Tape']).flatMap((name) => {
                        const hit = rows.find((row) => norm(pick(row, ['materialName', 'packagingMaterialCategory', 'packagingMaterialType'], '')).includes(norm(name)) || norm(name).includes(norm(pick(row, ['materialName'], ''))));
                        return [
                          <td key={`${batch}-${name}-ar`} className="border border-black px-1">{hit ? pick(hit, ['arNumber', 'ar_number'], '') : ''}</td>,
                          <td key={`${batch}-${name}-qty`} className="border border-black px-1">{hit ? [pick(hit, ['usedQuantity', 'issuedQuantity'], ''), pick(hit, ['unit'], '')].filter((v) => v && v !== '—').join(' ') : ''}</td>,
                        ];
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Sheet>
        );
      },
    },
    {
      id: 'cpp',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>5.10 CRITICAL PROCESS PARAMETER:</H>
          <P>All the Critical Process Parameter of {product} reviewed in the PQR period {period}. The Critical Process Parameter and results are presented in tabular form.</P>
          <H>5.10.1 Dispensing of Raw Material:</H>
          <P>All the Critical process parameter of the dispensing stage of {product} manufactured in the review period are included.</P>
          <Grid
            headers={['S. No.', 'Batch No.', 'Temperature (NMT 25°C)', 'RH% (NMT 55%)', 'Balance Verification']}
            rows={Array.from(groupBy(dispensing, (row) => pick(row, ['batchNumber', 'batch_number', 'batchNo'])).entries()).map(([batch, rows], index) => {
              const valueOf = (words: string[]) => {
                const hit = rows.find((row) => includesAny(pick(row, ['parameter_name', 'parameterName', 'parameter'], ''), words));
                return hit ? pick(hit, ['observed_value', 'observedValue', 'result', 'value'], '') : '';
              };
              return [String(index + 1), batch, valueOf(['temp']), valueOf(['rh', 'humidity']), valueOf(['balance'])];
            })}
          />
          <H>5.10.2 Manufacturing parameter:</H>
          <P>All the Critical process parameter of the manufacturing stage of {product} manufactured in the review period are included.</P>
          {(mfgStages.length ? mfgStages : [['Manufacturing', []] as [string, Row[]]]).map(([stage, rows]) => {
            const parameters = Array.from(new Set(rows.map((row) => pick(row, ['parameter_name', 'parameterName', 'parameter'], '')).filter((name) => name !== '—')));
            const headers = ['S. No.', 'Batch No.', ...(parameters.length ? parameters : ['Observed value'])];
            const body = Array.from(groupBy(rows, (row) => pick(row, ['batchNumber', 'batch_number', 'batchNo'])).entries()).map(([batch, batchRowsForStage], index) => [
              String(index + 1),
              batch,
              ...(parameters.length ? parameters : ['Observed value']).map((parameter) => {
                const hit = batchRowsForStage.find((row) => pick(row, ['parameter_name', 'parameterName', 'parameter']) === parameter);
                return hit ? pick(hit, ['observed_value', 'observedValue', 'result', 'value'], '') : '';
              }),
            ]);
            return (
              <div key={stage}>
                <p className="font-semibold mt-1">Stage: {stage}</p>
                <Grid headers={headers} rows={body} />
              </div>
            );
          })}
        </Sheet>
      ),
    },
    {
      id: 'specs',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>5.11 SPECIFICATION &amp; RESULTS:</H>
          <H>5.11.1 In-Process:</H>
          <P>5.11.1.1 All the Critical Quality attributes of the In-Process Parameters of {product} manufactured in the review period are included. The In-process parameters and results are presented in tabular form.</P>
          <P>5.11.1.2 Average of all the critical Process Parameters including In-Process results.</P>
          <div className="overflow-x-auto">
            <Grid headers={['S. No.', 'SF B. No.', ...ip.columns]} rows={ip.body} />
          </div>
          <H>5.11.2 Finished product:</H>
          <P>5.11.2.1 All the Critical Quality attributes of the Finish Parameters of {product} manufactured in the review period are included.</P>
          <P>5.11.2.2 Average of all the Critical Quality attributes including Finished Product results.</P>
          <div className="overflow-x-auto">
            <Grid headers={['S. No.', 'Finish Batch No.', ...fp.columns]} rows={fp.body} />
          </div>
        </Sheet>
      ),
    },
    {
      id: 'yield',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>5.12 Stage wise Yield:</H>
          <P>Details of stage wise yield are found below:</P>
          <Grid
            headers={['S. No.', 'Batch No.', 'Yield at bulk Stage (Limit 96.0 to 100.0%)', 'Yield at Filling Stage (Limit 90.0 to 100.0%)', 'Yield at Packing Stage (NLT 80.0%)']}
            rows={[
              ...yieldRows.map((row, index) => [String(index + 1), row.batch, row.bulk, row.filling, row.packing]),
              ...yieldStats,
            ]}
          />
          <H>5.13 Batch (s) Failure/ Rejected (If any):</H>
          <P>{rejected.length ? `${rejected.length} batch(es) rejected during the review period: ${rejected.map((row) => row.finish || row.sf).join(', ')}.` : `No any Batch rejection was found in ${product} manufactured during the PQR review period.`}</P>
          <H>5.14 Reworking and Reprocess (if any):</H>
          <P>{rework.length ? `${rework.length} batch(es) were reworked or reprocessed.` : 'NA'}</P>
          <H>5.15 Manufactured and Testing Procedures Followed:</H>
          <P>Details of Manufacturing and testing procedure are as following:</P>
          <Grid
            headers={['S. No.', 'Document', 'Reference', 'Revision No.']}
            rows={[
              ['1', 'Manufacturing Formula Record', '', ''],
              ['2', 'API Standard Test Specifications', '', ''],
              ['3', 'API Standard Test Procedure', '', ''],
              ['4', 'In-Process Standard Test Specifications', '', ''],
              ['5', 'In-Process Standard Test Procedure', '', ''],
              ['6', 'Primary Packing Materials Standard Test Specification', '', ''],
              ['7', 'Primary Packing Materials Standard Test Procedure', '', ''],
              ['8', 'Finished product Standard Test Specifications', '', ''],
              ['9', 'Finished Product Standard Test Procedure', '', ''],
            ]}
          />
        </Sheet>
      ),
    },
    {
      id: 'events',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>6.0 Out of Specification (OOS) and Internal Quality Complaints:</H>
          <P>{none(oos.length, `No any OOS was found during manufacturing of ${product} during the PQR review period.`, `${oos.length} OOS record(s) were found during the review period.`)}</P>
          {oos.length > 0 && <Grid headers={['S. No.', 'Reference', 'Batch No.', 'Status', 'Description']} rows={eventLines(oos, ['oos_number', 'oosNumber', 'reference', 'id'])} />}
          <H>7.0 Non-Conformance Report:</H>
          <P>There was no non-conformance recorded in {product} during the PQR review period.</P>
          <H>8.0 A review of all changes carried out to the processes or analytical methods:</H>
          <P>{none(changes.length, `No Change was observed during manufacturing of ${product} during the PQR review period.`, `${changes.length} change control record(s) were reviewed.`)}</P>
          {changes.length > 0 && <Grid headers={['S. No.', 'Reference', 'Batch No.', 'Status', 'Description']} rows={eventLines(changes, ['change_number', 'changeNumber', 'cc_number', 'id'])} />}
          <H>9.0 Incidents and Deviations Reporting:</H>
          <P>{none(deviations.length, `There was no any Incident and no Deviation observed in ${product} during the PQR review period.`, `${deviations.length} deviation record(s) were observed during the review period.`)}</P>
          {deviations.length > 0 && <Grid headers={['S. No.', 'Reference', 'Batch No.', 'Status', 'Description']} rows={eventLines(deviations, ['deviation_number', 'deviationNumber', 'id'])} />}
          <H>10.0 Stability Review:</H>
          <P>Below mentioned batches were subjected to stability study as per stability study schedule and reviewed for compliance with the shelf life specification.</P>
          <Grid
            headers={['Batch no.', 'Mfg. Date', 'Exp. Date', 'Initiated on', 'Condition', 'Status', 'Remarks']}
            rows={stability.map((row) => [
              pick(row, ['batchNumber', 'batch_number', 'batchNo']),
              monthYear(pick(row, ['mfgDate', 'manufacturingDate', 'manufacturing_date'], '')),
              monthYear(pick(row, ['expDate', 'expiryDate', 'expiry_date'], '')),
              dmy(pick(row, ['studyStartDate', 'initiatedOn', 'startDate'], '')),
              pick(row, ['storageCondition', 'condition', 'studyType']),
              pick(row, ['resultStatus', 'status', 'complianceStatus']),
              pick(row, ['remarks', 'conclusion'], ''),
            ])}
          />
        </Sheet>
      ),
    },
    {
      id: 'reviews',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>11.0 Validation &amp; Qualification Status:</H>
          <P>Qualification and validation status of {product} was reviewed for manufacturing in year {year}.</P>
          <H>11.1 Qualification Status of Relevant equipment and utility:</H>
          <P>All qualification status of relevant equipment and utilities were reviewed and found satisfactory.</P>
          <H>12.0 Review of Retained Samples:</H>
          <P>No any deterioration, colour variation and leakage observed during the period review.</P>
          <H>13.0 Market Complaints:</H>
          <P>There was no market complaint recorded for {product} during the PQR review period.</P>
          <H>14.0 Product Recall and Returned Goods:</H>
          <P>There was no Product Recall of {product} recorded during the PQR review period.</P>
          <H>15.0 CAPA Effectiveness Review (If any):</H>
          <P>{none(capa.length, `There was no CAPA logged for ${product} manufactured during the PQR review period.`, `${capa.length} CAPA record(s) were logged during the review period.`)}</P>
          {capa.length > 0 && <Grid headers={['S. No.', 'Reference', 'Batch No.', 'Status', 'Description']} rows={eventLines(capa, ['capa_number', 'capaNumber', 'id'])} />}
          <H>16.0 Review of Marketing Variations submitted, granted or refused, including those for third country Dossiers:</H>
          <P>NA</P>
          <H>17.0 Review For New Marketing Authorizations and Variations to Marketing Authorizations, a Review of post-marketing commitments:</H>
          <P>NA</P>
          <H>18.0 Review of Adequacy of previous product process and equipment corrective actions:</H>
          <P>During review it was observed that the process is established and the equipment is found adequate for the manufacturing of product {product}.</P>
        </Sheet>
      ),
    },
    {
      id: 'closeout',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>19.0 Review of control Limits:</H>
          <P>{cpk ? `The calculated Cpk is ${cpk.toFixed(2)}. The process capability was reviewed against the specification limits.` : 'The calculated Cpk was reviewed against the required specification limits, confirming whether the process is capable and under control.'}</P>
          <H>20.0 Review of Technical Agreements:</H>
          <P>Technical Agreements with manufacturers / suppliers of Active Pharmaceutical Ingredients (API) and primary packaging materials are reviewed. Technical Agreements established between the company and the third party customer for the manufacture and supply of {product} are in place and maintained under document control. These agreements define the responsibilities of both parties regarding manufacturing, testing, batch release, deviation handling, change control, and regulatory compliance.</P>
          <H>21.0 Supply chain Traceability:</H>
          <P>The traceability system for the raw materials and packaging materials used in {product} is reviewed, with API batches traceable from receipt through manufacturing to finished product.</P>
          <H>22.0 Evaluation of CQA and Excipients testing:</H>
          <P>All Critical Quality Attributes (CQAs) of the excipients used in the manufacturing of {product} were reviewed.</P>
          <H>23.0 Distribution of finished product:</H>
          <P>{doc.market || 'In export Market.'}</P>
        </Sheet>
      ),
    },
    {
      id: 'summary',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>24.0 Summary:</H>
          <table className="w-full border-collapse text-[8px]">
            <thead>
              <tr className="bg-neutral-200">
                {['S.No.', 'Parameter', 'Observation', 'Inference'].map((h) => (
                  <th key={h} className="border border-black px-1 py-1">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, index) => <td key={index} className="border border-black px-1 py-1 align-top">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </Sheet>
      ),
    },
    {
      id: 'conclusion',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>25.0 Conclusion:</H>
          <P>{doc.conclusions || `All the Finished product results of ${product} reviewed for the PQR review period ${period}. All the batches are manufactured under the validated status of facility, utility, equipment & process. Reviewed critical process parameters and Critical quality attributes, release specifications and process control are recorded in the sections above.`}</P>
          <H>26.0 Recommendations review and Update PQR Documentation:</H>
          <P>{doc.recommendations || 'NA'}</P>
          <H>27.0 PQR Submitted to (if any):</H>
          <P>NA</P>
          <H>28.0 Tracking System:</H>
          <P>A tracking system is in place to monitor deviations, OOS results, CAPAs, complaints, and change controls. All quality events are recorded and reviewed periodically as part of the PQR to ensure timely closure and effectiveness.</P>
        </Sheet>
      ),
    },
    {
      id: 'revision',
      node: (page, total) => (
        <Sheet doc={doc} page={page} total={total}>
          <H>29.0 Revision History:</H>
          <Grid
            headers={['Revision No.', 'Change Control No.', 'Details of Changes', 'Reason of Changes', 'Effective Date', 'Updated By']}
            rows={[[
              doc.revision_number || '00',
              'Not Applicable',
              doc.previous_revision ? `Revised from ${doc.previous_revision}` : 'Not Applicable',
              doc.previous_revision ? 'Revision' : 'New PQR',
              doc.effective_date ? dmy(doc.effective_date) : '',
              doc.created_by || '',
            ]]}
          />
          <H>30.0 Abbreviations:</H>
          <table className="w-full text-[9px]">
            <tbody>
              {ABBREVIATIONS.map(([short, full]) => (
                <tr key={short}>
                  <td className="py-0.5 w-28">{short}</td>
                  <td className="py-0.5">: {full}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Sheet>
      ),
    },
    {
      id: 'approval',
      node: (page, total) => {
        const prepared = signCell(findApproval(approvals, ['officer', 'executive-qa', 'executive qa', 'prepared'], 'prepared') || approvals.find((a) => a.approval_type === 'prepared'));
        const reviewedQa = signCell(findApproval(approvals, ['manager qa', 'executive /manager', 'qa manager'], 'reviewed'));
        const qc = signCell(findApproval(approvals, ['qc']));
        const production = signCell(findApproval(approvals, ['production']));
        const warehouse = signCell(findApproval(approvals, ['warehouse']));
        const engineering = signCell(findApproval(approvals, ['engineering']));
        const head = signCell(findApproval(approvals, ['head'], 'approved') || approvals.find((a) => a.approval_type === 'approved'));
        return (
          <Sheet doc={doc} page={page} total={total}>
            <H>31.0 PQR Approval</H>
            <p className="font-bold mt-3 mb-1">PREPARED BY:</p>
            <SignTable rows={[{ designation: 'OFFICER / EXECUTIVE-QA', ...prepared }]} />
            <p className="font-bold mt-4 mb-1">REVIEWED BY:</p>
            <SignTable rows={[
              { designation: 'EXECUTIVE /MANAGER QA', ...reviewedQa },
              { designation: 'MANAGER QC', ...qc },
              { designation: 'MANAGER PRODUCTION', ...production },
              { designation: 'MANAGER WAREHOUSE', ...warehouse },
              { designation: 'MANAGER ENGINEERING', ...engineering },
            ]} />
            <p className="font-bold mt-4 mb-1">APPROVED BY:</p>
            <SignTable rows={[{ designation: 'HEAD QA', ...head }]} />
          </Sheet>
        );
      },
    },
  ];

  function pageOf(id: string) {
    const index = sheets.findIndex((sheet) => sheet.id === id);
    return index >= 0 ? index + 1 : '';
  }

  return (
    <article id="pqr-pdf-document" className="bg-neutral-300 print:bg-white py-4 print:py-0">
      {sheets.map((sheet, index) => (
        <div key={sheet.id}>{sheet.node(index + 1, sheets.length)}</div>
      ))}
    </article>
  );
}
