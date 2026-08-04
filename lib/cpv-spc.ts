import type { CppRecord, CqaRecord } from './cpv';
import { isQualitativeCqaParameter } from './cpv';

export type SpcDataSource = 'cpp' | 'cqa';

export interface SpcObservation {
  id: string;
  source: SpcDataSource;
  product: string;
  batch: string;
  date: string;
  parameter: string;
  value: number;
  lsl?: number;
  usl?: number;
  unit: string;
}

export interface SpcRuleViolation {
  rule: number;
  ruleName: string;
  description: string;
  pointIndex: number;
  batch: string;
  chart: 'individuals' | 'movingRange' | 'xbar' | 'r';
}

export interface SpcChartPoint {
  index: number;
  batch: string;
  value: number;
  movingRange: number;
  subgroup?: number;
  xbar?: number;
  range?: number;
  outOfControl: boolean;
  specialCause: boolean;
  ruleViolations: SpcRuleViolation[];
}

export interface SpcChartLimits {
  centerLine: number;
  ucl: number;
  lcl: number;
}

export interface SpcChartResult {
  chartType: 'individuals' | 'movingRange' | 'xbar' | 'r';
  title: string;
  limits: SpcChartLimits;
  points: SpcChartPoint[];
  violations: SpcRuleViolation[];
  outOfControlCount: number;
  specialCauseCount: number;
  inControl: boolean;
}

export interface SpcAnalysis {
  observations: SpcObservation[];
  subgroupSize: number;
  individuals: SpcChartResult;
  movingRange: SpcChartResult;
  xbar: SpcChartResult;
  rChart: SpcChartResult;
  totalViolations: number;
  specialCausePoints: number;
  processStatus: 'In Control' | 'Special Cause Present' | 'Insufficient Data';
}

export interface SpcReport {
  generatedAt: string;
  source: SpcDataSource | 'all';
  product: string;
  parameter: string;
  subgroupSize: number;
  observationCount: number;
  processStatus: SpcAnalysis['processStatus'];
  charts: {
    individuals: SpcChartResult;
    movingRange: SpcChartResult;
    xbar: SpcChartResult;
    rChart: SpcChartResult;
  };
  violations: SpcRuleViolation[];
  summary: string;
}

const round = (value: number, digits = 3) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;

const SPC_A2: Record<number, number> = {
  2: 1.880, 3: 1.023, 4: 0.729, 5: 0.577, 6: 0.483, 7: 0.419, 8: 0.373, 9: 0.337, 10: 0.308,
};
const SPC_D3: Record<number, number> = {
  2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0.076, 8: 0.136, 9: 0.184, 10: 0.223,
};
const SPC_D4: Record<number, number> = {
  2: 3.267, 3: 2.574, 4: 2.282, 5: 2.114, 6: 2.004, 7: 1.924, 8: 1.864, 9: 1.816, 10: 1.777,
};

export function cppToSpcObservations(records: CppRecord[]): SpcObservation[] {
  return records.map((record) => ({
    id: record.id || `${record.batchNo}-${record.parameterName}`,
    source: 'cpp',
    product: record.productName,
    batch: record.batchNo,
    date: record.manufacturingDate || record.createdAt || '',
    parameter: record.parameterName,
    value: record.observedValue,
    lsl: record.lsl,
    usl: record.usl,
    unit: record.unit,
  }));
}

export function cqaToSpcObservations(records: CqaRecord[]): SpcObservation[] {
  return records
    .filter((record) => !isQualitativeCqaParameter(record.testParameter))
    .filter((record) => record.lsl < record.usl)
    .map((record) => ({
      id: record.id || `${record.batchNo}-${record.testParameter}`,
      source: 'cqa',
      product: record.productName,
      batch: record.batchNo,
      date: record.testDate || record.createdAt || '',
      parameter: record.testParameter,
      value: record.observedValue,
      lsl: record.lsl,
      usl: record.usl,
      unit: record.unit,
    }));
}

export function mergeSpcObservations(cpp: CppRecord[], cqa: CqaRecord[]): SpcObservation[] {
  return [...cppToSpcObservations(cpp), ...cqaToSpcObservations(cqa)];
}

export function filterSpcObservations(
  observations: SpcObservation[],
  filters: { source?: SpcDataSource | 'all'; product?: string; parameter?: string },
): SpcObservation[] {
  return observations
    .filter((item) => {
      if (filters.source && filters.source !== 'all' && item.source !== filters.source) return false;
      if (filters.product && filters.product !== 'all' && item.product !== filters.product) return false;
      if (filters.parameter && filters.parameter !== 'all' && item.parameter !== filters.parameter) return false;
      return true;
    })
    .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
}

function detectWesternElectricRules(
  values: number[],
  batches: string[],
  limits: SpcChartLimits,
  sigma: number,
  chart: SpcRuleViolation['chart'],
): SpcRuleViolation[] {
  const violations: SpcRuleViolation[] = [];
  const { centerLine: cl, ucl, lcl } = limits;
  const zone1Upper = cl + sigma;
  const zone1Lower = cl - sigma;
  const zone2Upper = cl + 2 * sigma;
  const zone2Lower = cl - 2 * sigma;

  values.forEach((value, index) => {
    const batch = batches[index] || `Point ${index + 1}`;
    if (value > ucl || value < lcl) {
      violations.push({
        rule: 1,
        ruleName: 'Rule 1 — Beyond 3σ',
        description: `Point beyond control limits (UCL/LCL)`,
        pointIndex: index + 1,
        batch,
        chart,
      });
    }
  });

  for (let i = 2; i < values.length; i++) {
    const window = values.slice(i - 2, i + 1);
    const above2 = window.filter((v) => v > zone2Upper).length;
    const below2 = window.filter((v) => v < zone2Lower).length;
    if (above2 >= 2 || below2 >= 2) {
      violations.push({
        rule: 2,
        ruleName: 'Rule 2 — 2 of 3 beyond 2σ',
        description: 'Two of three consecutive points beyond 2σ on same side',
        pointIndex: i + 1,
        batch: batches[i] || `Point ${i + 1}`,
        chart,
      });
    }
  }

  for (let i = 4; i < values.length; i++) {
    const window = values.slice(i - 4, i + 1);
    const above1 = window.filter((v) => v > zone1Upper).length;
    const below1 = window.filter((v) => v < zone1Lower).length;
    if (above1 >= 4 || below1 >= 4) {
      violations.push({
        rule: 3,
        ruleName: 'Rule 3 — 4 of 5 beyond 1σ',
        description: 'Four of five consecutive points beyond 1σ on same side',
        pointIndex: i + 1,
        batch: batches[i] || `Point ${i + 1}`,
        chart,
      });
    }
  }

  for (let i = 7; i < values.length; i++) {
    const window = values.slice(i - 7, i + 1);
    const allAbove = window.every((v) => v > cl);
    const allBelow = window.every((v) => v < cl);
    if (allAbove || allBelow) {
      violations.push({
        rule: 4,
        ruleName: 'Rule 4 — 8 consecutive same side',
        description: 'Eight consecutive points on same side of center line',
        pointIndex: i + 1,
        batch: batches[i] || `Point ${i + 1}`,
        chart,
      });
    }
  }

  // Nelson Rule 5 — 6 consecutive increasing or decreasing
  for (let i = 5; i < values.length; i++) {
    const window = values.slice(i - 5, i + 1);
    let inc = true;
    let dec = true;
    for (let j = 1; j < window.length; j++) {
      if (!(window[j] > window[j - 1])) inc = false;
      if (!(window[j] < window[j - 1])) dec = false;
    }
    if (inc || dec) {
      violations.push({
        rule: 5,
        ruleName: 'Nelson 5 — Trend of 6',
        description: 'Six consecutive points steadily increasing or decreasing',
        pointIndex: i + 1,
        batch: batches[i] || `Point ${i + 1}`,
        chart,
      });
    }
  }

  // Nelson Rule 6 — 14 consecutive alternating up/down
  for (let i = 13; i < values.length; i++) {
    const window = values.slice(i - 13, i + 1);
    let alt = true;
    for (let j = 2; j < window.length; j++) {
      const prevUp = window[j - 1] > window[j - 2];
      const curUp = window[j] > window[j - 1];
      if (prevUp === curUp) {
        alt = false;
        break;
      }
    }
    if (alt) {
      violations.push({
        rule: 6,
        ruleName: 'Nelson 6 — Alternating 14',
        description: 'Fourteen consecutive points alternating up and down',
        pointIndex: i + 1,
        batch: batches[i] || `Point ${i + 1}`,
        chart,
      });
    }
  }

  // Nelson Rule 7 — 15 consecutive within 1σ of center
  for (let i = 14; i < values.length; i++) {
    const window = values.slice(i - 14, i + 1);
    if (window.every((v) => v > zone1Lower && v < zone1Upper)) {
      violations.push({
        rule: 7,
        ruleName: 'Nelson 7 — Stratification',
        description: 'Fifteen consecutive points within 1σ of center line',
        pointIndex: i + 1,
        batch: batches[i] || `Point ${i + 1}`,
        chart,
      });
    }
  }

  // Nelson Rule 8 — 8 consecutive beyond 1σ (either side)
  for (let i = 7; i < values.length; i++) {
    const window = values.slice(i - 7, i + 1);
    if (window.every((v) => v > zone1Upper || v < zone1Lower)) {
      violations.push({
        rule: 8,
        ruleName: 'Nelson 8 — Mixture',
        description: 'Eight consecutive points beyond 1σ from center (either side)',
        pointIndex: i + 1,
        batch: batches[i] || `Point ${i + 1}`,
        chart,
      });
    }
  }

  return violations;
}

function buildIndividualsChart(observations: SpcObservation[]): SpcChartResult {
  const values = observations.map((o) => o.value);
  const batches = observations.map((o) => o.batch);

  if (values.length < 2) {
    return emptyChart('individuals', 'Individuals Chart (I-Chart)');
  }

  const movingRanges = values.slice(1).map((v, i) => Math.abs(v - values[i]));
  const mrBar = movingRanges.reduce((s, v) => s + v, 0) / movingRanges.length;
  const sigma = mrBar / 1.128;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const limits: SpcChartLimits = {
    centerLine: round(mean),
    ucl: round(mean + 3 * sigma),
    lcl: round(mean - 3 * sigma),
  };

  const ruleViolations = detectWesternElectricRules(values, batches, limits, sigma, 'individuals');
  const violationIndices = new Set(ruleViolations.map((v) => v.pointIndex));

  const points: SpcChartPoint[] = values.map((value, index) => {
    const ooc = value > limits.ucl || value < limits.lcl;
    const pointRules = ruleViolations.filter((v) => v.pointIndex === index + 1);
    return {
      index: index + 1,
      batch: batches[index],
      value: round(value),
      movingRange: index === 0 ? 0 : round(Math.abs(value - values[index - 1])),
      outOfControl: ooc,
      specialCause: ooc || pointRules.length > 0,
      ruleViolations: pointRules,
    };
  });

  return {
    chartType: 'individuals',
    title: 'Individuals Chart (I-Chart)',
    limits,
    points,
    violations: ruleViolations,
    outOfControlCount: points.filter((p) => p.outOfControl).length,
    specialCauseCount: points.filter((p) => p.specialCause).length,
    inControl: points.every((p) => !p.specialCause),
  };
}

function buildMovingRangeChart(observations: SpcObservation[], individuals: SpcChartResult): SpcChartResult {
  const mrValues = individuals.points.slice(1).map((p) => p.movingRange);
  const batches = individuals.points.slice(1).map((p) => p.batch);

  if (mrValues.length < 1) {
    return emptyChart('movingRange', 'Moving Range Chart (MR-Chart)');
  }

  const mrBar = mrValues.reduce((s, v) => s + v, 0) / mrValues.length;
  const limits: SpcChartLimits = {
    centerLine: round(mrBar),
    ucl: round(mrBar * 3.267),
    lcl: 0,
  };

  const points: SpcChartPoint[] = mrValues.map((value, index) => {
    const ooc = value > limits.ucl;
    return {
      index: index + 2,
      batch: batches[index],
      value: round(value),
      movingRange: round(value),
      outOfControl: ooc,
      specialCause: ooc,
      ruleViolations: ooc ? [{
        rule: 1,
        ruleName: 'MR beyond UCL',
        description: 'Moving range exceeds upper control limit — special cause variation',
        pointIndex: index + 2,
        batch: batches[index],
        chart: 'movingRange' as const,
      }] : [],
    };
  });

  const violations = points.flatMap((p) => p.ruleViolations);

  return {
    chartType: 'movingRange',
    title: 'Moving Range Chart (MR-Chart)',
    limits,
    points,
    violations,
    outOfControlCount: points.filter((p) => p.outOfControl).length,
    specialCauseCount: points.filter((p) => p.specialCause).length,
    inControl: points.every((p) => !p.specialCause),
  };
}

function buildSubgroups(observations: SpcObservation[], subgroupSize: number) {
  const groups: SpcObservation[][] = [];
  for (let i = 0; i < observations.length; i += subgroupSize) {
    const group = observations.slice(i, i + subgroupSize);
    if (group.length === subgroupSize) groups.push(group);
  }
  return groups;
}

function buildXbarChart(observations: SpcObservation[], subgroupSize: number): SpcChartResult {
  const n = Math.min(Math.max(subgroupSize, 2), 10);
  const groups = buildSubgroups(observations, n);

  if (groups.length < 2) {
    return emptyChart('xbar', `X-Bar Chart (subgroup n=${n})`);
  }

  const xbars = groups.map((g) => g.reduce((s, o) => s + o.value, 0) / g.length);
  const ranges = groups.map((g) => Math.max(...g.map((o) => o.value)) - Math.min(...g.map((o) => o.value)));
  const batches = groups.map((g) => g.map((o) => o.batch).join(', '));
  const rBar = ranges.reduce((s, v) => s + v, 0) / ranges.length;
  const xDoubleBar = xbars.reduce((s, v) => s + v, 0) / xbars.length;
  const a2 = SPC_A2[n] || SPC_A2[5];

  const limits: SpcChartLimits = {
    centerLine: round(xDoubleBar),
    ucl: round(xDoubleBar + a2 * rBar),
    lcl: round(xDoubleBar - a2 * rBar),
  };

  const sigma = rBar / (SPC_D4[n] ? (SPC_D4[n] / 3) : 1);
  const ruleViolations = detectWesternElectricRules(xbars, batches, limits, sigma || rBar / 6, 'xbar');

  const points: SpcChartPoint[] = xbars.map((value, index) => {
    const ooc = value > limits.ucl || value < limits.lcl;
    const pointRules = ruleViolations.filter((v) => v.pointIndex === index + 1);
    return {
      index: index + 1,
      batch: batches[index],
      value: round(value),
      movingRange: 0,
      subgroup: index + 1,
      xbar: round(value),
      range: round(ranges[index]),
      outOfControl: ooc,
      specialCause: ooc || pointRules.length > 0,
      ruleViolations: pointRules,
    };
  });

  return {
    chartType: 'xbar',
    title: `X-Bar Chart (subgroup n=${n})`,
    limits,
    points,
    violations: ruleViolations,
    outOfControlCount: points.filter((p) => p.outOfControl).length,
    specialCauseCount: points.filter((p) => p.specialCause).length,
    inControl: points.every((p) => !p.specialCause),
  };
}

function buildRChart(observations: SpcObservation[], subgroupSize: number): SpcChartResult {
  const n = Math.min(Math.max(subgroupSize, 2), 10);
  const groups = buildSubgroups(observations, n);

  if (groups.length < 2) {
    return emptyChart('r', `R Chart (subgroup n=${n})`);
  }

  const ranges = groups.map((g) => Math.max(...g.map((o) => o.value)) - Math.min(...g.map((o) => o.value)));
  const batches = groups.map((g) => g.map((o) => o.batch).join(', '));
  const rBar = ranges.reduce((s, v) => s + v, 0) / ranges.length;
  const d3 = SPC_D3[n] ?? 0;
  const d4 = SPC_D4[n] ?? 2.114;

  const limits: SpcChartLimits = {
    centerLine: round(rBar),
    ucl: round(d4 * rBar),
    lcl: round(d3 * rBar),
  };

  const points: SpcChartPoint[] = ranges.map((value, index) => {
    const ooc = value > limits.ucl || value < limits.lcl;
    return {
      index: index + 1,
      batch: batches[index],
      value: round(value),
      movingRange: 0,
      subgroup: index + 1,
      range: round(value),
      outOfControl: ooc,
      specialCause: ooc,
      ruleViolations: ooc ? [{
        rule: 1,
        ruleName: 'R beyond control limits',
        description: 'Subgroup range exceeds control limits',
        pointIndex: index + 1,
        batch: batches[index],
        chart: 'r' as const,
      }] : [],
    };
  });

  return {
    chartType: 'r',
    title: `R Chart (subgroup n=${n})`,
    limits,
    points,
    violations: points.flatMap((p) => p.ruleViolations),
    outOfControlCount: points.filter((p) => p.outOfControl).length,
    specialCauseCount: points.filter((p) => p.specialCause).length,
    inControl: points.every((p) => !p.specialCause),
  };
}

function emptyChart(chartType: SpcChartResult['chartType'], title: string): SpcChartResult {
  return {
    chartType,
    title,
    limits: { centerLine: 0, ucl: 0, lcl: 0 },
    points: [],
    violations: [],
    outOfControlCount: 0,
    specialCauseCount: 0,
    inControl: true,
  };
}

export function runSpcAnalysis(
  observations: SpcObservation[],
  subgroupSize = 4,
): SpcAnalysis {
  if (observations.length < 2) {
    const empty = emptyChart('individuals', 'Individuals Chart (I-Chart)');
    return {
      observations,
      subgroupSize,
      individuals: empty,
      movingRange: emptyChart('movingRange', 'Moving Range Chart'),
      xbar: emptyChart('xbar', 'X-Bar Chart'),
      rChart: emptyChart('r', 'R Chart'),
      totalViolations: 0,
      specialCausePoints: 0,
      processStatus: 'Insufficient Data',
    };
  }

  const individuals = buildIndividualsChart(observations);
  const movingRange = buildMovingRangeChart(observations, individuals);
  const xbar = buildXbarChart(observations, subgroupSize);
  const rChart = buildRChart(observations, subgroupSize);

  const allViolations = [
    ...individuals.violations,
    ...movingRange.violations,
    ...xbar.violations,
    ...rChart.violations,
  ];
  const specialCausePoints = new Set(allViolations.map((v) => `${v.chart}-${v.pointIndex}`)).size;

  const hasSpecialCause = individuals.specialCauseCount > 0
    || movingRange.specialCauseCount > 0
    || xbar.specialCauseCount > 0
    || rChart.specialCauseCount > 0;

  return {
    observations,
    subgroupSize,
    individuals,
    movingRange,
    xbar,
    rChart,
    totalViolations: allViolations.length,
    specialCausePoints,
    processStatus: hasSpecialCause ? 'Special Cause Present' : 'In Control',
  };
}

export function buildSpcReport(
  analysis: SpcAnalysis,
  meta: { source: SpcDataSource | 'all'; product: string; parameter: string },
): SpcReport {
  const allViolations = [
    ...analysis.individuals.violations,
    ...analysis.movingRange.violations,
    ...analysis.xbar.violations,
    ...analysis.rChart.violations,
  ];

  const summary = analysis.processStatus === 'Insufficient Data'
    ? 'Insufficient observations for SPC analysis. Minimum 2 data points required.'
    : analysis.processStatus === 'In Control'
      ? `Process is in statistical control. ${analysis.observations.length} observations analysed from ${meta.source === 'all' ? 'CPP and CQA' : meta.source.toUpperCase()} data with no special cause variation detected.`
      : `Special cause variation detected. ${allViolations.length} rule violation(s) across control charts. Investigation recommended per CPV protocol.`;

  return {
    generatedAt: new Date().toISOString(),
    source: meta.source,
    product: meta.product,
    parameter: meta.parameter,
    subgroupSize: analysis.subgroupSize,
    observationCount: analysis.observations.length,
    processStatus: analysis.processStatus,
    charts: {
      individuals: analysis.individuals,
      movingRange: analysis.movingRange,
      xbar: analysis.xbar,
      rChart: analysis.rChart,
    },
    violations: allViolations,
    summary,
  };
}

export function spcFilterOptions(observations: SpcObservation[], source: SpcDataSource | 'all', product: string) {
  const scoped = observations.filter((o) => {
    if (source !== 'all' && o.source !== source) return false;
    if (product !== 'all' && o.product !== product) return false;
    return true;
  });
  const products = Array.from(new Set(observations.map((o) => o.product))).sort();
  const parameters = Array.from(new Set(scoped.map((o) => o.parameter))).sort();
  return { products, parameters };
}
