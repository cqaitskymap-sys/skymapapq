/**

 * CPV Statistical Process Control — privileged Cloud Functions.

 * Server-side SPC engine, dual audit, e-sign approve, CF-only writes.

 * Hardens the existing SPC module (collection: control_charts).

 */

import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { type Firestore, type DocumentData, type WriteBatch } from 'firebase-admin/firestore';
import { getAdminFirestore } from './admin-app';
import { withAiRecommendationOverride } from './ai-recommendation-override';

function requiredString(value: unknown, field: string, maxLength = 500): string {

  if (typeof value !== 'string' || !value.trim()) {

    throw new HttpsError('invalid-argument', `${field} is required`);

  }

  const normalized = value.trim();

  if (normalized.length > maxLength) {

    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);

  }

  return normalized;

}



function optionalString(value: unknown, field: string, maxLength = 500): string {

  if (value == null) return '';

  if (typeof value !== 'string') {

    throw new HttpsError('invalid-argument', `${field} must be a string`);

  }

  const normalized = value.trim();

  if (normalized.length > maxLength) {

    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);

  }

  return normalized;

}



function requiredReason(value: unknown): string {

  const reason = requiredString(value, 'Change reason', 2000);

  if (reason.length < 5) {

    throw new HttpsError('invalid-argument', 'Change reason must be at least 5 characters');

  }

  return reason;

}



function optionalFiniteNumber(value: unknown): number | undefined {

  if (value === null || value === undefined || value === '') return undefined;

  const n = Number(value);

  return Number.isFinite(n) ? n : undefined;

}



function optionalInt(value: unknown, field: string, min: number, max: number, fallback: number): number {

  const n = Number(value ?? fallback);

  if (!Number.isFinite(n) || n < min || n > max) {

    throw new HttpsError('invalid-argument', `${field} must be between ${min} and ${max}`);

  }

  return Math.floor(n);

}



function round(n: number, d = 3): number {

  if (!Number.isFinite(n)) return 0;

  return Math.round(n * 10 ** d) / 10 ** d;

}



const COLLECTION = 'control_charts';

const VIOLATIONS_COLLECTION = 'spc_rule_violations';

const MODULE = 'Statistical Process Control';



const ENTER_ROLES = [

  'super_admin', 'admin', 'qc', 'qc_manager',

  'production', 'production_manager', 'engineering', 'engineering_manager',

];

const REVIEW_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'];

const VIEWER_ROLES = [

  ...ENTER_ROLES, ...REVIEW_ROLES, 'viewer', 'auditor',

];



const CHART_TYPES = [

  'Individuals Chart', 'Moving Range Chart', 'X-Bar Chart', 'R Chart', 'S Chart',

  'X-Bar R Chart', 'EWMA Chart', 'CUSUM Chart', 'Run Chart',

  'P Chart', 'NP Chart', 'C Chart', 'U Chart',

] as const;



const DATA_SOURCES = [

  'CPP Results', 'CQA Results', 'Yield Monitoring', 'Stability Monitoring',

  'Utility Monitoring', 'Environmental Monitoring', 'Hold Time Monitoring',

] as const;



const PARAMETER_TYPES = [

  'CPP', 'CQA', 'Yield', 'Stability', 'Utility', 'Environmental', 'Hold Time',

] as const;



const SPC_A2: Record<number, number> = {

  2: 1.880, 3: 1.023, 4: 0.729, 5: 0.577, 6: 0.483, 7: 0.419, 8: 0.373, 9: 0.337, 10: 0.308,

};

const SPC_D3: Record<number, number> = {

  2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0.076, 8: 0.136, 9: 0.184, 10: 0.223,

};

const SPC_D4: Record<number, number> = {

  2: 3.267, 3: 2.574, 4: 2.282, 5: 2.114, 6: 2.004, 7: 1.924, 8: 1.864, 9: 1.816, 10: 1.777,

};



function assertViewer(actor: DocumentData | undefined, role: string) {

  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {

    throw new HttpsError('permission-denied', 'SPC view access required');

  }

}

function assertEnter(actor: DocumentData | undefined, role: string) {

  if (!actor || actor.is_active !== true || !ENTER_ROLES.includes(role)) {

    throw new HttpsError('permission-denied', 'SPC entry access required');

  }

}

function assertReviewer(actor: DocumentData | undefined, role: string) {

  if (!actor || actor.is_active !== true || !REVIEW_ROLES.includes(role)) {

    throw new HttpsError('permission-denied', 'QA review/approve access required');

  }

}



async function resolveActor(request: { auth?: { uid: string } | null }) {

  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');

  
  const firestore = getAdminFirestore();

  const snap = await firestore.collection('profiles').doc(request.auth.uid).get();

  const actor = snap.data();

  return {

    firestore,

    actor,

    actorRole: String(actor?.role || ''),

    actorName: String(actor?.full_name || actor?.email || request.auth.uid),

    actorUid: request.auth.uid,

  };

}



function buildSpcRecordId(productCode: string, parameterCode: string): string {

  return `SPC-${productCode}-${parameterCode}-${new Date().getFullYear()}`

    .replace(/\s+/g, '-').toUpperCase().slice(0, 80);

}



function buildViolationId(index: number): string {

  return `SPCV-${Date.now()}-${index}`.slice(0, 40);

}



interface SourcePoint {

  batchNumber: string;

  value: number;

  date: string;

  lsl?: number;

  usl?: number;

  target?: number;

}



interface RawViolation {

  rule: number;

  ruleName: string;

  description: string;

  pointIndex: number;

  batch: string;

  chart: string;

}



interface SpcChartPoint {

  index: number;

  label: string;

  batchNumber: string;

  date: string;

  value: number;

  movingRange: number;

  centerLine: number;

  ucl: number;

  lcl: number;

  outOfControl: boolean;

  violated: boolean;

}



interface SpcRuleViolationRecord {

  violationId: string;

  spcRecordId: string;

  product: string;

  batchNumber: string;

  parameter: string;

  violationType: string;

  dataPointValue: number;

  dataPointDate: string;

  ruleDescription: string;

  severity: 'Low' | 'Medium' | 'High' | 'Critical';

  actionRequired: boolean;

}



function isCriticalParameter(name: string): boolean {

  const critical = ['Sterility', 'Assay', 'Bacterial Endotoxin', 'Fill Volume', 'pH', 'Endotoxin'];

  return critical.some((p) => name.toLowerCase().includes(p.toLowerCase()));

}



function detectWesternElectricAndNelsonRules(

  values: number[],

  batches: string[],

  limits: { centerLine: number; ucl: number; lcl: number },

  sigma: number,

  chart: string,

): RawViolation[] {

  const violations: RawViolation[] = [];

  const { centerLine: cl, ucl, lcl } = limits;

  const zone1Upper = cl + sigma;

  const zone1Lower = cl - sigma;

  const zone2Upper = cl + 2 * sigma;

  const zone2Lower = cl - 2 * sigma;



  values.forEach((value, index) => {

    const batch = batches[index] || `Point ${index + 1}`;

    if (value > ucl || value < lcl) {

      violations.push({

        rule: 1, ruleName: 'Rule 1 — Beyond 3σ',

        description: 'Point beyond control limits (UCL/LCL)',

        pointIndex: index + 1, batch, chart,

      });

    }

  });



  for (let i = 2; i < values.length; i++) {

    const window = values.slice(i - 2, i + 1);

    const above2 = window.filter((v) => v > zone2Upper).length;

    const below2 = window.filter((v) => v < zone2Lower).length;

    if (above2 >= 2 || below2 >= 2) {

      violations.push({

        rule: 2, ruleName: 'Rule 2 — 2 of 3 beyond 2σ',

        description: 'Two of three consecutive points beyond 2σ on same side',

        pointIndex: i + 1, batch: batches[i] || `Point ${i + 1}`, chart,

      });

    }

  }



  for (let i = 4; i < values.length; i++) {

    const window = values.slice(i - 4, i + 1);

    const above1 = window.filter((v) => v > zone1Upper).length;

    const below1 = window.filter((v) => v < zone1Lower).length;

    if (above1 >= 4 || below1 >= 4) {

      violations.push({

        rule: 3, ruleName: 'Rule 3 — 4 of 5 beyond 1σ',

        description: 'Four of five consecutive points beyond 1σ on same side',

        pointIndex: i + 1, batch: batches[i] || `Point ${i + 1}`, chart,

      });

    }

  }



  for (let i = 7; i < values.length; i++) {

    const window = values.slice(i - 7, i + 1);

    const allAbove = window.every((v) => v > cl);

    const allBelow = window.every((v) => v < cl);

    if (allAbove || allBelow) {

      violations.push({

        rule: 4, ruleName: 'Rule 4 — 8 consecutive same side',

        description: 'Eight consecutive points on same side of center line',

        pointIndex: i + 1, batch: batches[i] || `Point ${i + 1}`, chart,

      });

    }

  }



  for (let i = 5; i < values.length; i++) {

    const window = values.slice(i - 5, i + 1);

    let inc = true;

    let dec = true;

    for (let j = 1; j < window.length; j++) {

      if (window[j] <= window[j - 1]) inc = false;

      if (window[j] >= window[j - 1]) dec = false;

    }

    if (inc || dec) {

      violations.push({

        rule: 5, ruleName: 'Nelson 5 — Trend of 6',

        description: 'Six consecutive points steadily increasing or decreasing',

        pointIndex: i + 1, batch: batches[i] || `Point ${i + 1}`, chart,

      });

    }

  }



  for (let i = 13; i < values.length; i++) {

    const window = values.slice(i - 13, i + 1);

    let alt = true;

    for (let j = 2; j < window.length; j++) {

      const prevUp = window[j - 1] > window[j - 2];

      const curUp = window[j] > window[j - 1];

      if (prevUp === curUp) { alt = false; break; }

    }

    if (alt) {

      violations.push({

        rule: 6, ruleName: 'Nelson 6 — Alternating 14',

        description: 'Fourteen consecutive points alternating up and down',

        pointIndex: i + 1, batch: batches[i] || `Point ${i + 1}`, chart,

      });

    }

  }



  for (let i = 14; i < values.length; i++) {

    const window = values.slice(i - 14, i + 1);

    if (window.every((v) => v > zone1Lower && v < zone1Upper)) {

      violations.push({

        rule: 7, ruleName: 'Nelson 7 — Stratification',

        description: 'Fifteen consecutive points within 1σ of center line',

        pointIndex: i + 1, batch: batches[i] || `Point ${i + 1}`, chart,

      });

    }

  }



  for (let i = 7; i < values.length; i++) {

    const window = values.slice(i - 7, i + 1);

    if (window.every((v) => v > zone1Upper || v < zone1Lower)) {

      violations.push({

        rule: 8, ruleName: 'Nelson 8 — Mixture',

        description: 'Eight consecutive points beyond 1σ from center (either side)',

        pointIndex: i + 1, batch: batches[i] || `Point ${i + 1}`, chart,

      });

    }

  }



  return violations;

}



function violationSeverity(

  violation: RawViolation,

  ooc: boolean,

  critical: boolean,

): SpcRuleViolationRecord['severity'] {

  if (ooc && critical) return 'Critical';

  if (ooc || violation.rule === 1) return 'High';

  if (violation.rule <= 3) return 'Medium';

  return 'Low';

}



function mapViolations(

  allViolations: RawViolation[],

  points: SpcChartPoint[],

  dates: string[],

  product: string,

  parameter: string,

  spcRecordId: string,

): SpcRuleViolationRecord[] {

  const seen = new Set<string>();

  const records: SpcRuleViolationRecord[] = [];

  const critical = isCriticalParameter(parameter);

  allViolations.forEach((v, i) => {

    const key = `${v.chart}-${v.pointIndex}-${v.rule}`;

    if (seen.has(key)) return;

    seen.add(key);

    const point = points.find((p) => p.index === v.pointIndex);

    const ooc = point?.outOfControl ?? false;

    records.push({

      violationId: buildViolationId(i),

      spcRecordId,

      product,

      batchNumber: v.batch,

      parameter,

      violationType: v.ruleName,

      dataPointValue: point?.value ?? 0,

      dataPointDate: dates[v.pointIndex - 1] || '',

      ruleDescription: v.description,

      severity: violationSeverity(v, ooc, critical),

      actionRequired: ooc || v.rule <= 2,

    });

  });

  return records;

}



function buildSubgroups(values: number[], batches: string[], dates: string[], subgroupSize: number) {

  const groups: { values: number[]; batches: string[]; dates: string[] }[] = [];

  for (let i = 0; i < values.length; i += subgroupSize) {

    const gVals = values.slice(i, i + subgroupSize);

    if (gVals.length === subgroupSize) {

      groups.push({

        values: gVals,

        batches: batches.slice(i, i + subgroupSize),

        dates: dates.slice(i, i + subgroupSize),

      });

    }

  }

  return groups;

}



function calculateSpc(

  points: SourcePoint[],

  parameterName: string,

  productName: string,

  subgroupSize: number,

  spcRecordId: string,

) {

  const sorted = points

    .filter((p) => Number.isFinite(p.value))

    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());



  const values = sorted.map((p) => p.value);

  const batches = sorted.map((p) => p.batchNumber);

  const dates = sorted.map((p) => p.date);

  const batchCount = new Set(batches.filter(Boolean)).size;

  const n = values.length;



  if (n < 5) {

    throw new HttpsError('failed-precondition', 'At least 5 numeric data points required for SPC');

  }



  const lslCandidates = sorted.map((p) => p.lsl).filter((v): v is number => Number.isFinite(v as number));

  const uslCandidates = sorted.map((p) => p.usl).filter((v): v is number => Number.isFinite(v as number));

  const lsl = lslCandidates.length ? Math.min(...lslCandidates) : NaN;

  const usl = uslCandidates.length ? Math.max(...uslCandidates) : NaN;



  const mean = values.reduce((s, v) => s + v, 0) / n;

  const sortedVals = [...values].sort((a, b) => a - b);

  const mid = Math.floor(n / 2);

  const median = n % 2 ? sortedVals[mid] : (sortedVals[mid - 1] + sortedVals[mid]) / 2;

  const freq = new Map<number, number>();

  sortedVals.forEach((v) => freq.set(v, (freq.get(v) || 0) + 1));

  let mode: number | null = null;

  let maxF = 1;

  freq.forEach((f, v) => { if (f > maxF) { maxF = f; mode = v; } });

  const min = sortedVals[0];

  const max = sortedVals[n - 1];

  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;

  const sd = Math.sqrt(variance);



  const mrValues = values.slice(1).map((v, i) => Math.abs(v - values[i]));

  const mrBar = mrValues.length ? mrValues.reduce((s, v) => s + v, 0) / mrValues.length : 0;

  const withinSd = mrBar > 0 ? mrBar / 1.128 : sd;

  const sigma = withinSd;



  const centerLine = round(mean);

  const ucl = mrBar > 0 ? round(mean + 2.66 * mrBar) : round(mean);

  const lcl = mrBar > 0 ? round(mean - 2.66 * mrBar) : round(mean);

  const limits = { centerLine, ucl, lcl };



  const ruleViolations = detectWesternElectricAndNelsonRules(values, batches, limits, sigma || sd || 1, 'individuals');



  const chartData: SpcChartPoint[] = values.map((value, i) => {

    const ooc = value > ucl || value < lcl;

    const violated = ooc || ruleViolations.some((v) => v.pointIndex === i + 1);

    return {

      index: i + 1,

      label: batches[i] || dates[i]?.slice(0, 10) || `P${i + 1}`,

      batchNumber: batches[i] || '',

      date: dates[i] || '',

      value: round(value),

      movingRange: i === 0 ? 0 : round(Math.abs(value - values[i - 1])),

      centerLine,

      ucl,

      lcl,

      outOfControl: ooc,

      violated,

    };

  });



  const mrUcl = round(mrBar * 3.267);

  const movingRangeData: SpcChartPoint[] = mrValues.map((mr, i) => ({

    index: i + 2,

    label: batches[i + 1] || '',

    batchNumber: batches[i + 1] || '',

    date: dates[i + 1] || '',

    value: round(mr),

    movingRange: round(mr),

    centerLine: round(mrBar),

    ucl: mrUcl,

    lcl: 0,

    outOfControl: mr > mrUcl,

    violated: mr > mrUcl,

  }));



  const sgSize = Math.min(Math.max(2, subgroupSize), 10);

  const groups = buildSubgroups(values, batches, dates, sgSize);

  const xbars = groups.map((g) => g.values.reduce((s, v) => s + v, 0) / g.values.length);

  const ranges = groups.map((g) => Math.max(...g.values) - Math.min(...g.values));

  const rBar = ranges.length ? ranges.reduce((s, v) => s + v, 0) / ranges.length : 0;

  const xDoubleBar = xbars.length ? xbars.reduce((s, v) => s + v, 0) / xbars.length : mean;

  const a2 = SPC_A2[sgSize] || SPC_A2[5];

  const xbarUcl = round(xDoubleBar + a2 * rBar);

  const xbarLcl = round(xDoubleBar - a2 * rBar);

  const xbarChartData: SpcChartPoint[] = xbars.map((v, i) => ({

    index: i + 1,

    label: `SG${i + 1}`,

    batchNumber: groups[i]?.batches[0] || '',

    date: groups[i]?.dates[0] || '',

    value: round(v),

    movingRange: 0,

    centerLine: round(xDoubleBar),

    ucl: xbarUcl,

    lcl: xbarLcl,

    outOfControl: v > xbarUcl || v < xbarLcl,

    violated: v > xbarUcl || v < xbarLcl,

  }));



  const d3 = SPC_D3[sgSize] ?? 0;

  const d4 = SPC_D4[sgSize] ?? 2.114;

  const rUcl = round(d4 * rBar);

  const rLcl = round(d3 * rBar);

  const rChartData: SpcChartPoint[] = ranges.map((v, i) => ({

    index: i + 1,

    label: `SG${i + 1}`,

    batchNumber: groups[i]?.batches[0] || '',

    date: groups[i]?.dates[0] || '',

    value: round(v),

    movingRange: 0,

    centerLine: round(rBar),

    ucl: rUcl,

    lcl: rLcl,

    outOfControl: v > rUcl || v < rLcl,

    violated: v > rUcl || v < rLcl,

  }));



  const lambda = 0.2;

  const ewmaVals: number[] = [values[0]];

  for (let i = 1; i < n; i++) ewmaVals.push(lambda * values[i] + (1 - lambda) * ewmaVals[i - 1]);

  const ewmaSigma = sd * Math.sqrt(lambda / (2 - lambda));

  const ewmaData: SpcChartPoint[] = ewmaVals.map((v, i) => ({

    index: i + 1,

    label: batches[i] || '',

    batchNumber: batches[i] || '',

    date: dates[i] || '',

    value: round(v),

    movingRange: 0,

    centerLine: centerLine,

    ucl: round(mean + 3 * ewmaSigma),

    lcl: round(mean - 3 * ewmaSigma),

    outOfControl: v > mean + 3 * ewmaSigma || v < mean - 3 * ewmaSigma,

    violated: v > mean + 3 * ewmaSigma || v < mean - 3 * ewmaSigma,

  }));



  const k = (sd || 1) * 0.5;

  let sh = 0;

  let sl = 0;

  const cusumHighData: SpcChartPoint[] = [];

  const cusumLowData: SpcChartPoint[] = [];

  const h = 5 * (sd || 1);

  values.forEach((v, i) => {

    sh = Math.max(0, sh + (v - mean) - k);

    sl = Math.max(0, sl + (mean - v) - k);

    cusumHighData.push({

      index: i + 1, label: batches[i], batchNumber: batches[i], date: dates[i],

      value: round(sh), movingRange: 0, centerLine: 0, ucl: round(h), lcl: 0,

      outOfControl: sh > h, violated: sh > h,

    });

    cusumLowData.push({

      index: i + 1, label: batches[i], batchNumber: batches[i], date: dates[i],

      value: round(sl), movingRange: 0, centerLine: 0, ucl: round(h), lcl: 0,

      outOfControl: sl > h, violated: sl > h,

    });

  });



  const sChartData: SpcChartPoint[] = [];

  for (let i = 0; i + sgSize <= n; i += sgSize) {

    const group = values.slice(i, i + sgSize);

    const gMean = group.reduce((s, v) => s + v, 0) / group.length;

    const gVar = group.reduce((s, v) => s + (v - gMean) ** 2, 0) / (group.length - 1);

    const sVal = Math.sqrt(gVar);

    const idx = Math.floor(i / sgSize) + 1;

    sChartData.push({

      index: idx,

      label: `SG${idx}`,

      batchNumber: batches[i] || '',

      date: dates[i] || '',

      value: round(sVal),

      movingRange: 0,

      centerLine: round(sd),

      ucl: round(sd * 2),

      lcl: 0,

      outOfControl: sVal > sd * 2,

      violated: sVal > sd * 2,

    });

  }



  const mrViolations = movingRangeData.filter((p) => p.outOfControl).map((p) => ({

    rule: 1, ruleName: 'MR beyond UCL',

    description: 'Moving range exceeds upper control limit',

    pointIndex: p.index, batch: p.batchNumber, chart: 'movingRange',

  }));

  const allRawViolations = [...ruleViolations, ...mrViolations];

  const violations = mapViolations(allRawViolations, chartData, dates, productName, parameterName, spcRecordId);



  const westernElectricCount = violations.filter((v) =>

    /Rule [1-4]|Beyond 3|2 of 3|4 of 5|8 consecutive/.test(v.violationType),

  ).length;

  const nelsonRuleCount = violations.filter((v) =>

    /Nelson|Trend|Alternating|Stratification|Mixture/i.test(v.violationType),

  ).length;



  const outOfControlPoints = chartData.filter((p) => p.outOfControl).length;



  let outlierCount = 0;

  if (n >= 4) {

    const q1 = sortedVals[Math.floor(n * 0.25)];

    const q3 = sortedVals[Math.floor(n * 0.75)];

    const iqr = q3 - q1;

    outlierCount = sortedVals.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr).length;

  }



  let m3 = 0;

  let m4 = 0;

  if (sd > 0) {

    values.forEach((v) => {

      const d = (v - mean) / sd;

      m3 += d ** 3;

      m4 += d ** 4;

    });

  }

  const skewness = round(m3 / n);

  const kurtosis = round(m4 / n - 3);

  const se = sd / Math.sqrt(n);

  const confidenceIntervalLow = round(mean - 1.96 * se);

  const confidenceIntervalHigh = round(mean + 1.96 * se);



  let cp = 0; let cpu = 0; let cpl = 0; let cpk = 0; let pp = 0; let ppk = 0;

  if (Number.isFinite(lsl) && Number.isFinite(usl) && usl > lsl && withinSd > 0) {

    cp = (usl - lsl) / (6 * withinSd);

    cpu = (usl - mean) / (3 * withinSd);

    cpl = (mean - lsl) / (3 * withinSd);

    cpk = Math.min(cpu, cpl);

    pp = sd > 0 ? (usl - lsl) / (6 * sd) : 0;

    ppk = sd > 0 ? Math.min((usl - mean) / (3 * sd), (mean - lsl) / (3 * sd)) : 0;

  }



  let sumX = 0; let sumY = 0; let sumXY = 0; let sumXX = 0;

  for (let i = 0; i < n; i++) {

    sumX += i; sumY += values[i]; sumXY += i * values[i]; sumXX += i * i;

  }

  const denom = n * sumXX - sumX * sumX;

  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;

  const intercept = (sumY - slope * sumX) / n;

  const processDriftDetected = Math.abs(slope) > (sd || 1) * 0.05;

  const specialCauseVariation = outOfControlPoints > 0 || violations.length > 0;

  const commonCauseOnly = !specialCauseVariation;



  const goldenSlice = sorted.slice(0, Math.max(1, Math.floor(n * 0.3)));

  const goldenIdx = goldenSlice.reduce((best, p, i) => (

    Math.abs(p.value - mean) < Math.abs(goldenSlice[best].value - mean) ? i : best

  ), 0);

  const golden = goldenSlice[goldenIdx];



  let spcStatus: 'In Control' | 'Out Of Control' | 'Warning' | 'Insufficient Data' = 'In Control';

  if (outOfControlPoints > 0) spcStatus = 'Out Of Control';

  else if (violations.length > 0 || processDriftDetected) spcStatus = 'Warning';



  const critical = isCriticalParameter(parameterName);

  let riskLevel: 'Low' | 'Medium' | 'High' | 'Critical' = 'Low';

  if (spcStatus === 'Out Of Control') riskLevel = critical ? 'Critical' : 'High';

  else if (spcStatus === 'Warning') riskLevel = 'Medium';



  const capaSuggested = outOfControlPoints > 0

    || violations.filter((v) => v.severity === 'Critical' || v.severity === 'High').length > 0;

  const deviationRequired = outOfControlPoints > 0 || spcStatus === 'Out Of Control';



  let healthScore = 100;

  if (outOfControlPoints) healthScore -= Math.min(40, outOfControlPoints * 12);

  if (violations.length) healthScore -= Math.min(25, violations.length * 3);

  if (processDriftDetected) healthScore -= 10;

  if (cpk > 0 && cpk < 1.33) healthScore -= 10;

  healthScore = Math.max(0, Math.min(100, healthScore));

  const confidenceScore = Math.max(20, Math.min(99, round(45 + Math.min(35, n) + (commonCauseOnly ? 10 : 0) - outlierCount * 2, 1)));



  const tips: string[] = [];

  if (outOfControlPoints > 0) tips.push(`${outOfControlPoints} OOC point(s) — investigate special causes and consider deviation.`);

  if (westernElectricCount > 0) tips.push(`${westernElectricCount} Western Electric signal(s) detected.`);

  if (nelsonRuleCount > 0) tips.push(`${nelsonRuleCount} Nelson rule signal(s) detected.`);

  if (processDriftDetected) tips.push(`Process drift detected (slope ${round(slope, 4)}) — compare to golden batch.`);

  if (cpk > 0 && cpk < 1.33) tips.push(`Cpk ${round(cpk)} below target (≥1.33).`);

  if (!tips.length) tips.push(`Process In Control — health ${round(healthScore, 1)}. Continue routine SPC monitoring.`);



  const sigmaLevel = cpk > 0 ? round(cpk * 3) : (sd > 0 ? round(Math.abs(mean) / sd) : 0);

  const forecastNext = round(intercept + slope * n);



  return {

    batchCount,

    dataPointsCount: n,

    mean: round(mean),

    median: round(median),

    mode: mode == null ? null : round(mode),

    range: round(max - min),

    variance: round(variance),

    centerLine,

    upperControlLimit: ucl,

    lowerControlLimit: lcl,

    upperSpecificationLimit: Number.isFinite(usl) ? round(usl) : 0,

    lowerSpecificationLimit: Number.isFinite(lsl) ? round(lsl) : 0,

    movingRangeAverage: round(mrBar),

    averageRange: round(rBar),

    standardDeviation: round(sd),

    cp: round(cp),

    cpk: round(cpk),

    cpu: round(cpu),

    cpl: round(cpl),

    pp: round(pp),

    ppk: round(ppk),

    sigmaLevel,

    zScoreMean: sd > 0 ? round((values[n - 1] - mean) / sd) : 0,

    confidenceIntervalLow,

    confidenceIntervalHigh,

    skewness,

    kurtosis,

    outlierCount,

    ewmaLast: round(ewmaVals[ewmaVals.length - 1] || mean),

    cusumHighLast: cusumHighData[cusumHighData.length - 1]?.value || 0,

    cusumLowLast: cusumLowData[cusumLowData.length - 1]?.value || 0,

    ewmaData: ewmaData.slice(0, 100),

    cusumHighData: cusumHighData.slice(0, 100),

    cusumLowData: cusumLowData.slice(0, 100),

    sChartData: sChartData.slice(0, 50),

    processDriftDetected,

    specialCauseVariation,

    commonCauseOnly,

    healthScore: round(healthScore, 1),

    confidenceScore,

    aiRecommendation: tips.join(' '),

    goldenBatchNumber: golden?.batchNumber || '',

    goldenBatchDelta: golden ? round(Math.abs(values[n - 1] - golden.value)) : 0,

    forecastNext,

    westernElectricCount,

    nelsonRuleCount,

    spcStatus,

    ruleViolationsCount: violations.length,

    outOfControlPoints,

    riskLevel,

    capaSuggested,

    deviationRequired,

    chartData: chartData.slice(0, 100),

    movingRangeData: movingRangeData.slice(0, 100),

    xbarChartData: xbarChartData.slice(0, 100),

    rChartData: rChartData.slice(0, 100),

    violations,

    sourcePreview: sorted.slice(0, 50),

  };

}



function writeAudit(

  batch: WriteBatch,

  firestore: Firestore,

  input: {

    actorUid: string; actorName: string; recordId: string; documentNumber?: string;

    actionType: string; description: string; oldValue?: unknown; newValue?: unknown;

    reason?: string; now: string; esign?: boolean;

  },

) {

  batch.set(firestore.collection('audit_trail').doc(), {

    auditId: `AUD-SPC-${Date.now().toString(36).toUpperCase()}`,

    dateTime: input.now, timestamp: input.now, moduleName: 'CPV', subModule: MODULE,

    collectionName: COLLECTION, recordId: input.recordId, documentId: input.recordId,

    documentNumber: input.documentNumber || '', actionType: input.actionType, action: input.actionType,

    actionDescription: input.description, oldValue: input.oldValue ?? null, newValue: input.newValue ?? null,

    reason: input.reason || '', performedBy: input.actorName, userId: input.actorUid, userName: input.actorName,

    electronicSignature: input.esign === true, createdAt: input.now, source: 'cpv-spc-admin',

    immutable: true, appendOnly: true,

  });

  batch.set(firestore.collection('audit_logs').doc(), {

    module: MODULE, action: input.actionType, recordId: input.recordId, description: input.description,

    performedBy: input.actorName, userId: input.actorUid, reason: input.reason || '',

    timestamp: input.now, createdAt: input.now, status: 'Success',

    electronicSignature: input.esign === true, source: 'cpv-spc-admin',

  });

  batch.set(firestore.collection('cpv_audit_trail').doc(), {

    moduleName: MODULE, actionType: input.actionType, actionDescription: input.description,

    recordId: input.recordId, documentNumber: input.documentNumber || '',

    userId: input.actorUid, userName: input.actorName, reason: input.reason || '',

    timestamp: input.now, createdAt: input.now, status: 'Success',

    electronicSignature: input.esign === true, source: 'cpv-spc-admin',

  });

}



function notify(

  firestore: Firestore, batch: WriteBatch,

  input: { targetUid: string; recordId: string; eventName: string; title: string; message: string; now: string },

) {

  batch.set(firestore.collection('notifications').doc(), {

    userId: input.targetUid, title: input.title, message: input.message, type: 'cpv_spc',

    eventName: input.eventName, recordId: input.recordId, module: MODULE,

    href: `/cpv/statistical-process-control/${input.recordId}`, read: false, createdAt: input.now,

  });

}



function writeViolations(

  batch: WriteBatch,

  firestore: Firestore,

  recordId: string,

  violations: SpcRuleViolationRecord[],

  actorUid: string,

  now: string,

) {

  for (const v of violations) {

    batch.set(firestore.collection(VIOLATIONS_COLLECTION).doc(), {

      ...v,

      spcRecordId: recordId,

      createdAt: now,

      updatedAt: now,

      createdBy: actorUid,

      updatedBy: actorUid,

      isDeleted: false,

    });

  }

}



async function assertOperationalProduct(firestore: Firestore, productId: string) {

  const snap = await firestore.collection('cpv_products').doc(productId).get();

  if (!snap.exists || snap.data()?.isDeleted === true) {

    throw new HttpsError('failed-precondition', 'CPV product not found');

  }

  const status = String(snap.data()?.cpvStatus || '');

  if (!['Active', 'Under Review', 'Approved'].includes(status)) {

    throw new HttpsError('failed-precondition', 'Selected CPV product is not operational');

  }

}



function sanitizeMeta(data: Record<string, unknown>, existing?: DocumentData) {

  const parameterType = requiredString(data.parameterType ?? existing?.parameterType, 'Parameter type', 40);

  if (!PARAMETER_TYPES.includes(parameterType as typeof PARAMETER_TYPES[number])) {

    throw new HttpsError('invalid-argument', `Invalid parameter type: ${parameterType}`);

  }

  const dataSource = requiredString(data.dataSource ?? existing?.dataSource, 'Data source', 80);

  if (!DATA_SOURCES.includes(dataSource as typeof DATA_SOURCES[number])) {

    throw new HttpsError('invalid-argument', `Invalid data source: ${dataSource}`);

  }

  const chartType = requiredString(data.chartType ?? existing?.chartType, 'Chart type', 80);

  if (!CHART_TYPES.includes(chartType as typeof CHART_TYPES[number])) {

    throw new HttpsError('invalid-argument', `Invalid chart type: ${chartType}`);

  }

  const productCode = requiredString(data.productCode ?? existing?.productCode, 'Product code', 80);

  const parameterCode = requiredString(data.parameterCode ?? existing?.parameterCode, 'Parameter code', 80);

  const from = requiredString(data.reviewPeriodFrom ?? existing?.reviewPeriodFrom, 'Review period from', 40);

  const to = requiredString(data.reviewPeriodTo ?? existing?.reviewPeriodTo, 'Review period to', 40);

  if (new Date(to) <= new Date(from)) {

    throw new HttpsError('invalid-argument', 'Review period end must be after start');

  }

  const subgroupSize = optionalInt(data.subgroupSize ?? existing?.subgroupSize, 'Subgroup size', 2, 10, 4);



  return {

    recordType: 'control_chart',

    spcRecordId: optionalString(data.spcRecordId ?? existing?.spcRecordId, 'SPC record id', 80)

      || buildSpcRecordId(productCode, parameterCode),

    spcCode: optionalString(data.spcCode ?? existing?.spcCode, 'SPC code', 80),

    studyNumber: optionalString(data.studyNumber ?? existing?.studyNumber, 'Study number', 80),

    cpvProductId: requiredString(data.cpvProductId ?? existing?.cpvProductId, 'CPV product', 120),

    productName: requiredString(data.productName ?? existing?.productName, 'Product name', 200),

    productCode,

    productVersion: optionalString(data.productVersion ?? existing?.productVersion, 'Product version', 40),

    batchNumber: optionalString(data.batchNumber ?? existing?.batchNumber, 'Batch number', 80),

    manufacturingOrder: optionalString(data.manufacturingOrder ?? existing?.manufacturingOrder, 'Manufacturing order', 80),

    process: optionalString(data.process ?? existing?.process, 'Process', 120),

    processStep: optionalString(data.processStep ?? existing?.processStep, 'Process step', 120),

    equipmentId: optionalString(data.equipmentId ?? existing?.equipmentId, 'Equipment id', 120),

    equipmentName: optionalString(data.equipmentName ?? existing?.equipmentName, 'Equipment name', 200),

    machine: optionalString(data.machine ?? existing?.machine, 'Machine', 120),

    department: optionalString(data.department ?? existing?.department, 'Department', 120) || 'Quality Control',

    productionLine: optionalString(data.productionLine ?? existing?.productionLine, 'Production line', 120),

    operator: optionalString(data.operator ?? existing?.operator, 'Operator', 120),

    shift: optionalString(data.shift ?? existing?.shift, 'Shift', 40),

    site: optionalString(data.site ?? existing?.site, 'Site', 120),

    chartType: chartType as typeof CHART_TYPES[number],

    dataSource: dataSource as typeof DATA_SOURCES[number],

    parameterType: parameterType as typeof PARAMETER_TYPES[number],

    parameterCode,

    parameterName: requiredString(data.parameterName ?? existing?.parameterName, 'Parameter name', 200),

    reviewPeriodFrom: from,

    reviewPeriodTo: to,

    subgroupSize,

    sampleSize: optionalInt(data.sampleSize ?? existing?.sampleSize, 'Sample size', 1, 100, 1),

    samplingFrequency: optionalString(data.samplingFrequency ?? existing?.samplingFrequency, 'Sampling frequency', 80),

    targetValue: optionalFiniteNumber(data.targetValue ?? existing?.targetValue) ?? null,

    effectiveDate: optionalString(data.effectiveDate ?? existing?.effectiveDate, 'Effective date', 40),

    description: optionalString(data.description ?? existing?.description, 'Description', 2000),

    conclusion: optionalString(data.conclusion ?? existing?.conclusion, 'Conclusion', 2000),

    recommendation: optionalString(data.recommendation ?? existing?.recommendation, 'Recommendation', 2000),

    remarks: optionalString(data.remarks ?? existing?.remarks, 'Remarks', 2000),

  };

}



function parsePoints(data: Record<string, unknown>, existing?: DocumentData): SourcePoint[] {

  const raw = Array.isArray(data.points)

    ? data.points

    : (Array.isArray(existing?.sourcePreview) ? existing!.sourcePreview : []);

  if (!Array.isArray(raw)) {

    throw new HttpsError('invalid-argument', 'points array is required');

  }

  if (raw.length > 5000) {

    throw new HttpsError('invalid-argument', 'Maximum 5000 points per SPC record');

  }

  const points: SourcePoint[] = [];

  for (const item of raw) {

    const row = (item || {}) as Record<string, unknown>;

    const value = Number(row.value);

    if (!Number.isFinite(value)) continue;

    points.push({

      batchNumber: String(row.batchNumber || ''),

      value,

      date: String(row.date || new Date().toISOString()),

      lsl: optionalFiniteNumber(row.lsl),

      usl: optionalFiniteNumber(row.usl),

      target: optionalFiniteNumber(row.target),

    });

  }

  if (points.length < 5) {

    throw new HttpsError('failed-precondition', 'At least 5 numeric data points required for SPC');

  }

  return points;

}



function emitAlerts(

  firestore: Firestore,

  batch: WriteBatch,

  actorUid: string,

  recordId: string,

  meta: ReturnType<typeof sanitizeMeta>,

  calc: ReturnType<typeof calculateSpc>,

  now: string,

  prevCpk?: number,

) {

  if (calc.outOfControlPoints > 0) {

    notify(firestore, batch, {

      targetUid: actorUid, recordId, eventName: 'OOC',

      title: 'Out Of Control', message: `${meta.parameterName}: ${calc.outOfControlPoints} OOC point(s)`, now,

    });

  }

  if (calc.westernElectricCount > 0) {

    notify(firestore, batch, {

      targetUid: actorUid, recordId, eventName: 'Western Electric',

      title: 'Western Electric Signal', message: `${meta.parameterName}: ${calc.westernElectricCount} signal(s)`, now,

    });

  }

  if (calc.nelsonRuleCount > 0) {

    notify(firestore, batch, {

      targetUid: actorUid, recordId, eventName: 'Nelson',

      title: 'Nelson Rule Signal', message: `${meta.parameterName}: ${calc.nelsonRuleCount} signal(s)`, now,

    });

  }

  if (calc.cpk > 0 && calc.cpk < 1.33) {

    notify(firestore, batch, {

      targetUid: actorUid, recordId, eventName: 'Capability Drop',

      title: 'Capability Drop', message: `${meta.parameterName}: Cpk ${calc.cpk} < 1.33`, now,

    });

  } else if (prevCpk != null && prevCpk >= 1.33 && calc.cpk > 0 && calc.cpk < prevCpk) {

    notify(firestore, batch, {

      targetUid: actorUid, recordId, eventName: 'Capability Drop',

      title: 'Capability Drop', message: `${meta.parameterName}: Cpk ${prevCpk} → ${calc.cpk}`, now,

    });

  }

  if (calc.sigmaLevel > 0 && calc.sigmaLevel < 3) {

    notify(firestore, batch, {

      targetUid: actorUid, recordId, eventName: 'Sigma Drop',

      title: 'Sigma Level Drop', message: `${meta.parameterName}: sigma ${calc.sigmaLevel}`, now,

    });

  }

  if (calc.processDriftDetected && calc.forecastNext) {

    notify(firestore, batch, {

      targetUid: actorUid, recordId, eventName: 'Prediction Alert',

      title: 'SPC Forecast Alert', message: `${meta.parameterName} forecast ≈ ${calc.forecastNext}`, now,

    });

  }

  if (calc.deviationRequired) {

    notify(firestore, batch, {

      targetUid: actorUid, recordId, eventName: 'Deviation',

      title: 'Deviation Required', message: `${meta.parameterName}: ${calc.spcStatus}`, now,

    });

  }

  if (calc.capaSuggested) {

    notify(firestore, batch, {

      targetUid: actorUid, recordId, eventName: 'CAPA',

      title: 'CAPA Suggested', message: `${meta.parameterName}: ${calc.ruleViolationsCount} violation(s)`, now,

    });

  }

}



export const createAdminSpcRecord = onCall({ timeoutSeconds: 60 }, async (request) => {

  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);

  assertEnter(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;

  const reason = requiredReason(data.changeReason);

  await assertOperationalProduct(firestore, requiredString(data.cpvProductId, 'CPV product', 120));

  const meta = sanitizeMeta(data);

  const points = parsePoints(data);

  const calc = withAiRecommendationOverride(
    calculateSpc(points, meta.parameterName, meta.productName, meta.subgroupSize, meta.spcRecordId),
    data,
  );

  const now = new Date().toISOString();

  const ref = firestore.collection(COLLECTION).doc();

  const record = {

    ...meta,

    ...calc,

    id: ref.id,

    linkedRiskId: '',

    linkedDeviationNumber: '',

    linkedCapaNumber: '',

    status: 'Generated' as const,

    isLocked: false,

    generatedBy: actorName,

    generatedDate: now.slice(0, 10),

    reviewedBy: '',

    reviewDate: '',

    approvedBy: '',

    approvalDate: '',

    createdAt: now,

    updatedAt: now,

    createdBy: actorUid,

    updatedBy: actorUid,

    createdByName: actorName,

    updatedByName: actorName,

    isDeleted: false,

    changeReason: reason,

  };



  const batch = firestore.batch();

  batch.set(ref, record);

  writeViolations(batch, firestore, ref.id, calc.violations, actorUid, now);

  writeAudit(batch, firestore, {

    actorUid, actorName, recordId: ref.id, documentNumber: meta.spcRecordId,

    actionType: 'SPC Created', description: `Created ${meta.spcRecordId} ${calc.spcStatus}`,

    newValue: { spcStatus: calc.spcStatus, outOfControlPoints: calc.outOfControlPoints }, reason, now,

  });

  writeAudit(batch, firestore, {

    actorUid, actorName, recordId: ref.id, documentNumber: meta.spcRecordId,

    actionType: 'Analysis Executed', description: `n=${calc.dataPointsCount} CL=${calc.centerLine} UCL=${calc.upperControlLimit}`,

    newValue: calc, reason, now,

  });

  if (calc.violations.length) {

    writeAudit(batch, firestore, {

      actorUid, actorName, recordId: ref.id, documentNumber: meta.spcRecordId,

      actionType: 'Rule Violation Detected', description: `${calc.ruleViolationsCount} violation(s)`,

      newValue: { count: calc.ruleViolationsCount }, reason, now,

    });

  }

  writeAudit(batch, firestore, {

    actorUid, actorName, recordId: ref.id, documentNumber: meta.spcRecordId,

    actionType: 'AI Analysis Generated', description: calc.aiRecommendation.slice(0, 500),

    newValue: { healthScore: calc.healthScore, confidenceScore: calc.confidenceScore }, reason, now,

  });

  emitAlerts(firestore, batch, actorUid, ref.id, meta, calc, now);

  await batch.commit();

  return record;

});



export const regenerateAdminSpcRecord = onCall({ timeoutSeconds: 60 }, async (request) => {

  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);

  const data = (request.data || {}) as Record<string, unknown>;

  const id = requiredString(data.id, 'Record id', 120);

  const reason = requiredReason(data.changeReason);

  const qaOverride = data.qaOverride === true;

  const snap = await firestore.collection(COLLECTION).doc(id).get();

  if (!snap.exists || snap.data()?.isDeleted === true) {

    throw new HttpsError('not-found', 'SPC record not found');

  }

  const existing = snap.data() || {};

  if (existing.isLocked === true && existing.status === 'Approved') {

    if (!qaOverride) throw new HttpsError('failed-precondition', 'Approved record is locked. QA override required.');

    assertReviewer(actor, actorRole);

    if (data.esignConfirmed !== true) {

      throw new HttpsError('failed-precondition', 'Electronic signature required for QA override');

    }

  } else {

    assertEnter(actor, actorRole);

  }



  const meta = sanitizeMeta({ ...existing, ...data }, existing);

  const points = parsePoints(data, existing);

  const calc = withAiRecommendationOverride(
    calculateSpc(points, meta.parameterName, meta.productName, meta.subgroupSize, meta.spcRecordId),
    data,
  );

  const now = new Date().toISOString();

  const prevCpk = Number(existing.cpk) || undefined;

  const updates = {

    ...meta,

    ...calc,

    status: 'Generated',

    isLocked: qaOverride ? false : existing.isLocked === true,

    generatedBy: actorName,

    generatedDate: now.slice(0, 10),

    updatedAt: now,

    updatedBy: actorUid,

    updatedByName: actorName,

    changeReason: reason,

  };

  const batch = firestore.batch();

  batch.update(snap.ref, updates);

  writeViolations(batch, firestore, id, calc.violations, actorUid, now);

  writeAudit(batch, firestore, {

    actorUid, actorName, recordId: id, documentNumber: meta.spcRecordId,

    actionType: qaOverride ? 'SPC QA Override' : 'SPC Updated',

    description: `Regenerated ${existing.spcStatus} → ${calc.spcStatus}`,

    oldValue: { spcStatus: existing.spcStatus },

    newValue: { spcStatus: calc.spcStatus },

    reason, now, esign: qaOverride,

  });

  writeAudit(batch, firestore, {

    actorUid, actorName, recordId: id, documentNumber: meta.spcRecordId,

    actionType: 'Analysis Executed', description: `Recalc n=${calc.dataPointsCount}`,

    newValue: calc, reason, now,

  });

  emitAlerts(firestore, batch, actorUid, id, meta, calc, now, prevCpk);

  await batch.commit();

  return { id, ...existing, ...updates };

});



export const reviewAdminSpcRecord = onCall(async (request) => {

  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);

  assertReviewer(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;

  const id = requiredString(data.id, 'Record id', 120);

  const reason = requiredReason(data.changeReason || 'Submitted for QA review');

  const snap = await firestore.collection(COLLECTION).doc(id).get();

  if (!snap.exists || snap.data()?.isDeleted === true) throw new HttpsError('not-found', 'SPC record not found');

  const existing = snap.data() || {};

  if (existing.status === 'Approved') throw new HttpsError('failed-precondition', 'Approved records cannot be reopened');

  const now = new Date().toISOString();

  const updates = {

    status: 'Under Review', reviewedBy: actorName, reviewDate: now.slice(0, 10),

    updatedAt: now, updatedBy: actorUid, updatedByName: actorName, changeReason: reason,

  };

  const batch = firestore.batch();

  batch.update(snap.ref, updates);

  writeAudit(batch, firestore, {

    actorUid, actorName, recordId: id, documentNumber: String(existing.spcRecordId || ''),

    actionType: 'SPC Review Submitted', description: 'Submitted for QA review',

    oldValue: existing.status, newValue: 'Under Review', reason, now,

  });

  notify(firestore, batch, {

    targetUid: actorUid, recordId: id, eventName: 'Workflow Pending',

    title: 'SPC Review Pending', message: `${existing.parameterName} awaiting approval`, now,

  });

  await batch.commit();

  return { id, ...existing, ...updates };

});



export const approveAdminSpcRecord = onCall(async (request) => {

  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);

  assertReviewer(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;

  const id = requiredString(data.id, 'Record id', 120);

  const reason = requiredReason(data.changeReason);

  if (data.esignConfirmed !== true) {

    throw new HttpsError('failed-precondition', 'Electronic signature confirmation required to approve');

  }

  const snap = await firestore.collection(COLLECTION).doc(id).get();

  if (!snap.exists || snap.data()?.isDeleted === true) throw new HttpsError('not-found', 'SPC record not found');

  const existing = snap.data() || {};

  if (!['Draft', 'Generated', 'Under Review'].includes(String(existing.status))) {

    throw new HttpsError('failed-precondition', `Cannot approve from status ${existing.status}`);

  }

  const now = new Date().toISOString();

  const updates = {

    status: 'Approved', isLocked: true, approvedBy: actorName, approvalDate: now.slice(0, 10),

    updatedAt: now, updatedBy: actorUid, updatedByName: actorName, changeReason: reason,

  };

  const batch = firestore.batch();

  batch.update(snap.ref, updates);

  writeAudit(batch, firestore, {

    actorUid, actorName, recordId: id, documentNumber: String(existing.spcRecordId || ''),

    actionType: 'SPC Approved', description: `Approved ${existing.spcRecordId}`,

    oldValue: existing.status, newValue: 'Approved', reason, now, esign: true,

  });

  writeAudit(batch, firestore, {

    actorUid, actorName, recordId: id, documentNumber: String(existing.spcRecordId || ''),

    actionType: 'Electronic Signature', description: `E-sign by ${actorName}`, reason, now, esign: true,

  });

  await batch.commit();

  return { id, ...existing, ...updates };

});



export const rejectAdminSpcRecord = onCall(async (request) => {

  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);

  assertReviewer(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;

  const id = requiredString(data.id, 'Record id', 120);

  const reason = requiredReason(data.changeReason || 'Rejected by QA');

  const snap = await firestore.collection(COLLECTION).doc(id).get();

  if (!snap.exists || snap.data()?.isDeleted === true) throw new HttpsError('not-found', 'SPC record not found');

  const existing = snap.data() || {};

  if (existing.status === 'Approved') throw new HttpsError('failed-precondition', 'Cannot reject approved records');

  const now = new Date().toISOString();

  const updates = {

    status: 'Rejected', updatedAt: now, updatedBy: actorUid, updatedByName: actorName, changeReason: reason,

  };

  const batch = firestore.batch();

  batch.update(snap.ref, updates);

  writeAudit(batch, firestore, {

    actorUid, actorName, recordId: id, documentNumber: String(existing.spcRecordId || ''),

    actionType: 'SPC Rejected', description: 'Rejected by QA',

    oldValue: existing.status, newValue: 'Rejected', reason, now,

  });

  await batch.commit();

  return { id, ...existing, ...updates };

});



export const softDeleteAdminSpcRecord = onCall(async (request) => {

  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);

  assertReviewer(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;

  const id = requiredString(data.id, 'Record id', 120);

  const reason = requiredReason(data.changeReason);

  if (data.esignConfirmed !== true) {

    throw new HttpsError('failed-precondition', 'Electronic signature required to archive');

  }

  const snap = await firestore.collection(COLLECTION).doc(id).get();

  if (!snap.exists || snap.data()?.isDeleted === true) throw new HttpsError('not-found', 'SPC record not found');

  if (snap.data()?.status === 'Approved') {

    throw new HttpsError('failed-precondition', 'Cannot delete approved SPC records');

  }

  const now = new Date().toISOString();

  const updates = {

    isDeleted: true, status: 'Archived', deletedAt: now, deletedBy: actorUid,

    updatedAt: now, updatedBy: actorUid, updatedByName: actorName, changeReason: reason,

  };

  const batch = firestore.batch();

  batch.update(snap.ref, updates);

  writeAudit(batch, firestore, {

    actorUid, actorName, recordId: id, documentNumber: String(snap.data()?.spcRecordId || ''),

    actionType: 'SPC Archived', description: 'Soft-deleted SPC record',

    reason, now, esign: true,

  });

  await batch.commit();

  return { success: true, id };

});



export const logAdminSpcExport = onCall(async (request) => {

  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);

  assertViewer(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;

  const now = new Date().toISOString();

  const batch = firestore.batch();

  writeAudit(batch, firestore, {

    actorUid, actorName, recordId: 'export', actionType: 'SPC Export',

    description: `Exported ${Number(data.count || 0)} records`,

    newValue: { count: Number(data.count || 0), format: optionalString(data.format, 'Format', 40) || 'CSV' },

    reason: optionalString(data.changeReason, 'Change reason', 500) || 'Export', now,

  });

  await batch.commit();

  return { success: true };

});


