import { MASTER_DATA_PATH_PREFIXES } from '@/lib/launcher/module-scope';

export type GuideGroup =
  | 'start'
  | 'admin'
  | 'qms'
  | 'cpv'
  | 'pqr'
  | 'ops'
  | 'other';

export type GuideStep = {
  title: string;
  detail: string;
  href?: string;
  /** Path fragments used to highlight the current step */
  match?: string[];
};

export type UserGuideTopic = {
  id: string;
  title: string;
  summary: string;
  who: string;
  whatNext: string;
  href: string;
  group: GuideGroup;
  pathPrefixes: string[];
  steps: GuideStep[];
};

export const GUIDE_GROUPS: { id: GuideGroup; label: string }[] = [
  { id: 'start', label: 'Getting started' },
  { id: 'admin', label: 'Administration' },
  { id: 'qms', label: 'QMS' },
  { id: 'cpv', label: 'Continued Process Verification' },
  { id: 'pqr', label: 'Product Quality Review' },
  { id: 'ops', label: 'Operations & master data' },
  { id: 'other', label: 'Reports & notifications' },
];

export const USER_GUIDE_TOPICS: UserGuideTopic[] = [
  {
    id: 'getting-started',
    title: 'A to Z — how to use SKYMAP',
    summary:
      'Follow this sequence the first time you use the system. Later you can jump to any module from the launcher.',
    who: 'Every user, especially first-time login',
    whatNext: 'After setup, daily work happens in QMS, CPV, and PQR from the module launcher.',
    href: '/launcher',
    group: 'start',
    pathPrefixes: ['/launcher', '/dashboard/help', '/dashboard/support', '/auth'],
    steps: [
      {
        title: 'Sign in',
        detail: 'Open the login page, enter your approved credentials, and complete e-sign / MFA if prompted. Do not share passwords or signature credentials.',
        href: '/auth/login',
      },
      {
        title: 'Open the Module Launcher',
        detail: 'After login you land on the launcher. This is the home screen. Each tile is a module (QMS, CPV, PQR, Admin, and so on).',
        href: '/launcher',
        match: ['/launcher'],
      },
      {
        title: 'Admin prepares the system (once)',
        detail: 'An administrator creates users, roles, numbering, workflows, and e-signature settings before operational records are raised.',
        href: '/admin',
      },
      {
        title: 'Load master data',
        detail: 'Confirm products, equipment, batches, parameters, sites, departments, materials, and vendors exist. CPV and PQR cannot run without this foundation.',
        href: '/admin/products',
      },
      {
        title: 'Register batches',
        detail: 'Production / CPV registers commercial batches. Quality events and CPV monitoring attach to these batches.',
        href: '/cpv/batch-registration',
      },
      {
        title: 'Use QMS for quality events',
        detail: 'Raise deviations, OOS, complaints, change controls, CAPA, audits, and recalls. Each record follows Create → Investigate → Impact → CAPA (if needed) → Approve → Close.',
        href: '/qms/dashboard',
      },
      {
        title: 'Use CPV to keep the process in control',
        detail: 'Monitor CPP, CQA, materials, utilities, environment, yield, and stability. Then review capability, SPC, trends, risk, and the annual CPV review.',
        href: '/cpv/dashboard',
      },
      {
        title: 'Complete the annual PQR',
        detail: 'Create a PQR for the product and year, pull batch / material / packaging / equipment / utility / stability data, write the conclusion, then approve.',
        href: '/pqr/dashboard',
      },
      {
        title: 'Review reports, alerts, and the audit trail',
        detail: 'Dashboards and reports summarise performance. Alerts escalate out-of-limit results. The audit trail records who did what, when, and why.',
        href: '/dashboard/reports',
      },
    ],
  },
  {
    id: 'admin',
    title: 'Administration',
    summary: 'Configure people, access, workflows, and controlled system behaviour before any GMP records are created.',
    who: 'Super Admin / IT / QA system owner',
    whatNext: 'Users can log in with their role and open only the modules assigned to them.',
    href: '/admin',
    group: 'admin',
    pathPrefixes: ['/admin', '/dashboard/admin'],
    steps: [
      { title: 'Open Admin Dashboard', detail: 'Start at Administration to see system health and configuration shortcuts.', href: '/admin', match: ['/admin'] },
      { title: 'Users', detail: 'Create users, assign site / department / role, and activate access after identity verification.', href: '/admin/users' },
      { title: 'Roles & permissions', detail: 'Grant view / create / approve rights per module. Users only see what their role allows.', href: '/admin/roles' },
      { title: 'Workflows & approval matrix', detail: 'Set who reviews and who approves each record type, including e-signature steps.', href: '/admin/workflows' },
      { title: 'Document numbering & e-sign settings', detail: 'Configure controlled numbering and 21 CFR Part 11 electronic signature rules.', href: '/admin/document-numbering' },
      { title: 'Notifications, backup, system settings', detail: 'Turn on alerts, email/SMS templates, backups, and compliance settings.', href: '/admin/notifications' },
    ],
  },
  {
    id: 'deviation',
    title: 'Deviation Management',
    summary: 'Record an unplanned event, investigate root cause, assess impact, link CAPA, approve, then close.',
    who: 'Production, QC, QA',
    whatNext: 'If CAPA is required, a CAPA record is created and tracked until effectiveness is proven. Trends feed PQR and CPV.',
    href: '/qms/deviation',
    group: 'qms',
    pathPrefixes: ['/qms/deviation'],
    steps: [
      { title: 'Open Deviation Dashboard', detail: 'See open, overdue, and recently closed deviations for your site.', href: '/qms/deviation', match: ['/qms/deviation'] },
      { title: 'Create Deviation', detail: 'Capture date, batch/product, area, description, immediate action, and attachments. Submit for QA.', href: '/qms/deviation/create', match: ['/create', '/new'] },
      { title: 'Investigation', detail: 'Perform root-cause analysis (for example 5-Why). Record facts only — do not guess missing batch numbers.', href: '/qms/deviation/investigation', match: ['/investigation'] },
      { title: 'Impact Assessment', detail: 'Assess product, patient, validation, and regulatory impact. Decide whether a hold or recall path is needed.', href: '/qms/deviation/impact-assessment', match: ['/impact'] },
      { title: 'CAPA Link', detail: 'If the cause can recur, raise or link a CAPA. This is the “what happens next” for most major deviations.', href: '/qms/deviation/capa-link', match: ['/capa'] },
      { title: 'Approval', detail: 'QA (and other matrix roles) e-sign the investigation and disposition.', href: '/qms/deviation/approval', match: ['/approval'] },
      { title: 'Closure', detail: 'Confirm actions are done, attach evidence, and close. The record becomes read-only in the audit trail.', href: '/qms/deviation/closure', match: ['/closure'] },
      { title: 'Trends & reports', detail: 'Use trend analysis and reports to spot repeat causes for management review.', href: '/qms/deviation/trend-analysis', match: ['/trend', '/report'] },
    ],
  },
  {
    id: 'oos',
    title: 'OOS Management',
    summary: 'Handle out-of-specification laboratory results through Phase I, Phase II, impact, CAPA, approval, and closure.',
    who: 'QC analyst, QC supervisor, QA',
    whatNext: 'Confirmed OOS usually drives CAPA, possible batch disposition, and CPV / PQR trend review.',
    href: '/qms/oos',
    group: 'qms',
    pathPrefixes: ['/qms/oos'],
    steps: [
      { title: 'Create OOS', detail: 'Log the failing result, method, specification, analyst, and sample / batch identity.', href: '/qms/oos/create', match: ['/create', '/new'] },
      { title: 'Phase I investigation', detail: 'Check obvious lab error (calculation, instrument, sample handling) before manufacturing is blamed.', href: '/qms/oos/phase1', match: ['/phase1'] },
      { title: 'Phase II investigation', detail: 'If the lab is cleared, investigate the manufacturing process and related batches.', href: '/qms/oos/phase2', match: ['/phase2'] },
      { title: 'Impact assessment', detail: 'Decide batch disposition, related-batch impact, and whether other lots need testing.', href: '/qms/oos/impact-assessment', match: ['/impact'] },
      { title: 'CAPA', detail: 'Link corrective and preventive actions so the failure mode does not repeat.', href: '/qms/oos/capa-management', match: ['/capa'] },
      { title: 'Approve and close', detail: 'QA e-signs the conclusion. Closed OOS remains in trends and PQR laboratory review.', href: '/qms/oos/approval', match: ['/approval', '/closure'] },
    ],
  },
  {
    id: 'capa',
    title: 'CAPA Management',
    summary: 'Correct the cause of a quality problem and prevent recurrence, then prove the fix worked.',
    who: 'QA, department owners, effectiveness reviewers',
    whatNext: 'Effectiveness check results feed management review, CPV risk, and PQR conclusions.',
    href: '/qms/capa',
    group: 'qms',
    pathPrefixes: ['/qms/capa'],
    steps: [
      { title: 'Create CAPA', detail: 'Source it from a deviation, OOS, audit finding, complaint, or recall. State the problem and objective.', href: '/qms/capa/create', match: ['/create', '/new'] },
      { title: 'Investigation & RCA', detail: 'Confirm root cause before writing actions. Weak RCA produces weak CAPA.', href: '/qms/capa/investigation', match: ['/investigation'] },
      { title: 'Corrective actions', detail: 'Fix the current issue (containment, rework rules, batch actions).', href: '/qms/capa/corrective-action', match: ['/corrective'] },
      { title: 'Preventive actions', detail: 'Change the system so the same failure cannot happen again (SOP, training, design, monitoring).', href: '/qms/capa/preventive-action', match: ['/preventive'] },
      { title: 'Implementation', detail: 'Owners complete tasks with evidence and due dates. Overdue tasks escalate.', href: '/qms/capa/implementation', match: ['/implementation'] },
      { title: 'Effectiveness check', detail: 'After a defined period, verify the problem did not recur. If it failed, reopen actions.', href: '/qms/capa/effectiveness-check', match: ['/effectiveness'] },
      { title: 'Approve and close', detail: 'QA approves effectiveness and closes the CAPA. The record stays in the audit trail.', href: '/qms/capa/approval', match: ['/approval', '/closure'] },
    ],
  },
  {
    id: 'change-control',
    title: 'Change Control',
    summary: 'Plan, assess, approve, implement, and verify any controlled change to process, equipment, document, or system.',
    who: 'Change owner, QA, validation, affected departments',
    whatNext: 'Approved changes may update SOPs, validation, CPV limits, and training. Effectiveness is reviewed after go-live.',
    href: '/qms/change-control',
    group: 'qms',
    pathPrefixes: ['/qms/change-control'],
    steps: [
      { title: 'Create Change', detail: 'Describe the current state, proposed change, reason, and impacted products / systems.', href: '/qms/change-control/create', match: ['/create'] },
      { title: 'Impact assessment', detail: 'Identify departments, documents, regulatory filings, and computer systems affected.', href: '/qms/change-control/impact-assessment', match: ['/impact'] },
      { title: 'Risk assessment', detail: 'Score quality / patient / compliance risk and decide extra controls.', href: '/qms/change-control/risk-assessment', match: ['/risk'] },
      { title: 'Validation assessment', detail: 'Decide if IQ/OQ/PQ, cleaning, or computer validation must be repeated.', href: '/qms/change-control/validation-assessment', match: ['/validation'] },
      { title: 'Implementation plan', detail: 'List tasks, owners, and the go-live sequence. Do not implement before QA approval.', href: '/qms/change-control/implementation', match: ['/implementation'] },
      { title: 'Approval', detail: 'Matrix approvers e-sign. Only then may the change be executed.', href: '/qms/change-control/approval', match: ['/approval'] },
      { title: 'Effectiveness review & closure', detail: 'Confirm the change achieved its intent with no new defects, then close.', href: '/qms/change-control/effectiveness', match: ['/effectiveness', '/closure'] },
    ],
  },
  {
    id: 'complaints',
    title: 'Complaint Management',
    summary: 'Log a market or customer complaint, investigate, assess impact, link CAPA if needed, then close.',
    who: 'QA, complaint coordinator, medical / regulatory as required',
    whatNext: 'Serious complaints can trigger recall assessment. Trends go into PQR and management review.',
    href: '/qms/complaints',
    group: 'qms',
    pathPrefixes: ['/qms/complaints'],
    steps: [
      { title: 'Register complaint', detail: 'Capture reporter, product, batch, country, description, and criticality.', href: '/qms/complaints/create', match: ['/create', '/new'] },
      { title: 'Investigation', detail: 'Review retain samples, batch records, and similar history.', href: '/qms/complaints/investigation', match: ['/investigation'] },
      { title: 'Impact assessment', detail: 'Decide if other batches, markets, or patients are affected.', href: '/qms/complaints/impact-assessment', match: ['/impact'] },
      { title: 'CAPA link', detail: 'Raise CAPA when the cause is confirmed and preventable.', href: '/qms/complaints/capa-link', match: ['/capa'] },
      { title: 'Approve and close', detail: 'QA closes after response to the complainant and actions are complete.', href: '/qms/complaints/approval', match: ['/approval', '/closure'] },
    ],
  },
  {
    id: 'recall',
    title: 'Product Recall',
    summary: 'Initiate a recall, notify distribution and regulators, track recovery, then close with a management review.',
    who: 'QA head, recall coordinator, regulatory, warehouse',
    whatNext: 'Closed recalls feed CAPA, PQR, and regulatory files. Remaining stock is quarantined or destroyed under warehouse control.',
    href: '/qms/recall',
    group: 'qms',
    pathPrefixes: ['/qms/recall'],
    steps: [
      { title: 'Initiate recall', detail: 'Classify the recall, list batches / markets, and the reason (complaint, OOS, deviation).', href: '/qms/recall/create', match: ['/create', '/new'] },
      { title: 'Regulatory notification', detail: 'Prepare and record notifications required for each market.', href: '/qms/recall/regulatory-notification', match: ['/regulatory'] },
      { title: 'Distribution list', detail: 'Identify where the product was shipped so recovery can be targeted.', href: '/qms/recall/distribution', match: ['/distribution'] },
      { title: 'Recovery tracking', detail: 'Record quantities returned vs shipped until reconciliation is acceptable.', href: '/qms/recall/recovery', match: ['/recovery'] },
      { title: 'Closure', detail: 'QA closes after reconciliation, destruction / rework, and CAPA are complete.', href: '/qms/recall/closure', match: ['/closure'] },
    ],
  },
  {
    id: 'stability',
    title: 'Stability Management',
    summary: 'Plan studies, pull samples on schedule, record results, and act on OOT / OOS stability findings.',
    who: 'QC stability, QA',
    whatNext: 'Results feed CPV stability monitoring and the PQR stability review.',
    href: '/qms/stability',
    group: 'qms',
    pathPrefixes: ['/qms/stability'],
    steps: [
      { title: 'Open Stability', detail: 'See ongoing studies, due pulls, and overdue chambers / time points.', href: '/qms/stability' },
      { title: 'Schedule & sample pulling', detail: 'Create or follow the protocol schedule and document each pull.', href: '/qms/stability/schedule' },
      { title: 'Enter results', detail: 'Record assay, impurities, and appearance against specifications.', href: '/qms/stability' },
      { title: 'If OOT / OOS', detail: 'Open an OOS or deviation as required, then continue the study unless QA stops it.', href: '/qms/oos' },
    ],
  },
  {
    id: 'dms',
    title: 'Document Management',
    summary: 'Control SOPs, forms, and work instructions from draft through review, approval, training, effective date, and archive.',
    who: 'Document controller, authors, reviewers, trainees',
    whatNext: 'Effective documents are used on the shop floor. Periodic review and change control keep them current.',
    href: '/qms/documents/master',
    group: 'qms',
    pathPrefixes: [
      '/qms/documents',
      '/qms/dms',
      '/qms/sop',
      '/qms/sop-management',
      '/qms/wi',
      '/qms/wi-management',
      '/qms/work-instructions',
      '/qms/forms',
      '/qms/forms-management',
      '/qms/templates',
      '/qms/template-library',
      '/qms/document-master',
      '/qms/document-management',
      '/qms/document-approval',
      '/qms/document-acknowledgement',
      '/qms/document-effective-dates',
      '/qms/document-read-confirmation',
      '/qms/document-review',
      '/qms/document-versions',
      '/qms/document-distribution',
      '/qms/document-archive',
      '/qms/document-retention',
      '/qms/document-impact',
      '/qms/document-audit',
      '/qms/document-history',
      '/qms/document-printing',
      '/qms/document-watermarks',
      '/qms/document-control',
      '/qms/controlled-distribution',
      '/qms/controlled-printing',
      '/qms/print-control',
      '/qms/watermarks',
      '/qms/watermark-management',
      '/qms/archive',
      '/qms/archive-management',
      '/qms/retention',
      '/qms/records-retention',
      '/qms/disposal',
      '/qms/approval-workflow',
      '/qms/review-workflow',
      '/qms/version-control',
      '/qms/read-confirmation',
      '/qms/periodic-review',
    ],
    steps: [
      { title: 'Create / import in Document Master', detail: 'Assign type, number, owner, and draft content.', href: '/qms/documents/master' },
      { title: 'Review & approval workflow', detail: 'Reviewers comment; approvers e-sign. Training may be required before the effective date.', href: '/qms/document-approval' },
      { title: 'Effective date & distribution', detail: 'On the effective date, previous versions become superseded. Controlled copies are issued.', href: '/qms/document-effective-dates' },
      { title: 'Read confirmation', detail: 'Users acknowledge they have read the new version before working to it.', href: '/qms/document-acknowledgement' },
      { title: 'Periodic review, print control, archive', detail: 'Review before expiry, watermark prints, then archive or dispose per retention.', href: '/qms/documents/periodic-review' },
    ],
  },
  {
    id: 'audit',
    title: 'Audit Management',
    summary: 'Plan internal / external audits, record findings, link CAPA, and track closure.',
    who: 'Lead auditor, auditees, QA',
    whatNext: 'Open findings become CAPA. Audit outcomes appear in PQR and management review.',
    href: '/qms/audit',
    group: 'qms',
    pathPrefixes: ['/qms/audit'],
    steps: [
      { title: 'Schedule the audit', detail: 'Set type, scope, dates, and team.', href: '/qms/audit' },
      { title: 'Execute and log findings', detail: 'Classify observations (critical / major / minor) with evidence.', href: '/qms/audit' },
      { title: 'Link CAPA', detail: 'Each finding that requires action gets a CAPA owner and due date.', href: '/qms/capa' },
      { title: 'Close the audit', detail: 'QA verifies responses and closes the audit package.', href: '/qms/audit' },
    ],
  },
  {
    id: 'qms-other',
    title: 'Other QMS modules',
    summary: 'Vendors, validation, CSV, risk, and eBMR support the core quality event modules.',
    who: 'QA, validation, procurement, production',
    whatNext: 'Approved vendors, validated systems, and completed eBMRs become inputs to CPV and PQR.',
    href: '/qms/dashboard',
    group: 'qms',
    pathPrefixes: ['/qms/vendors', '/qms/validation', '/qms/csv', '/qms/ebmr', '/qms/risk-management', '/qms/dashboard'],
    steps: [
      { title: 'QMS Dashboard', detail: 'Start here for a cross-module view of open quality work.', href: '/qms/dashboard', match: ['/qms/dashboard'] },
      { title: 'Vendor Management', detail: 'Qualify, audit, and monitor suppliers before materials are used.', href: '/qms/vendors', match: ['/qms/vendors'] },
      { title: 'Validation & CSV', detail: 'Plan and execute process / equipment / computer system validation and keep them current.', href: '/qms/validation', match: ['/qms/validation', '/qms/csv'] },
      { title: 'Risk Management', detail: 'Create FMEA-style assessments, mitigate, and review residual risk.', href: '/qms/risk-management/dashboard', match: ['/qms/risk'] },
      { title: 'eBMR', detail: 'Execute and review electronic batch manufacturing records, including CPP / IPC checks.', href: '/qms/ebmr', match: ['/qms/ebmr'] },
    ],
  },
  {
    id: 'cpv',
    title: 'CPV — A to Z',
    summary: 'Stage 3 continued process verification: register the product and batches, monitor the process, analyse, then complete the annual review.',
    who: 'QA CPV owner, production, QC',
    whatNext: 'Annual CPV conclusions support ongoing manufacture and feed the Product Quality Review.',
    href: '/cpv/dashboard',
    group: 'cpv',
    pathPrefixes: ['/cpv'],
    steps: [
      { title: 'CPV Dashboard', detail: 'See health, alerts, and which products need attention.', href: '/cpv/dashboard', match: ['/cpv/dashboard', '/cpv'] },
      { title: 'Product Master', detail: 'Define the commercial product, CPPs, CQAs, and CPV plan before collecting data.', href: '/cpv/product-master', match: ['/product-master'] },
      { title: 'Batch Registration', detail: 'Register each commercial batch that will be included in CPV.', href: '/cpv/batch-registration', match: ['/batch-registration'] },
      { title: 'Equipment review', detail: 'Confirm equipment used for those batches remains qualified.', href: '/cpv/equipment-review', match: ['/equipment-review'] },
      { title: 'Monitor inputs & process', detail: 'Enter raw material, packing material, CPP, CQA, utility, environment, yield, stability, and hold-time data.', href: '/cpv/cpp', match: ['/raw-material', '/cpp', '/cqa', '/packing-material', '/utility-monitoring', '/environmental', '/yield', '/stability-monitoring', '/hold-time'] },
      { title: 'Process capability', detail: 'Calculate Cp / Cpk / Pp / Ppk. Out of capability triggers investigation or tighter control.', href: '/cpv/process-capability', match: ['/process-capability'] },
      { title: 'Trend analysis & SPC', detail: 'Look for shifts, drifts, and rule violations. AI can polish the recommendation text.', href: '/cpv/trend-analysis', match: ['/trend-analysis', '/statistical-process-control'] },
      { title: 'Risk assessment', detail: 'Score residual process risk from the monitoring picture.', href: '/cpv/risk-assessment', match: ['/risk-assessment'] },
      { title: 'Alert Engine', detail: 'Review OOS / OOT / predictive alerts and recommended actions.', href: '/cpv/alert-engine', match: ['/alert-engine'] },
      { title: 'AI Analytics', detail: 'Open AI Analytics for health scores, predictions, and management summary (uses OpenRouter when configured).', href: '/cpv/ai-analytics', match: ['/ai-analytics'] },
      { title: 'Annual CPV Review', detail: 'Generate the yearly review, QA-approve it, and carry recommendations into the next year.', href: '/cpv/annual-review', match: ['/annual-review'] },
      { title: 'Reports', detail: 'Export CPV reports for quality council and inspectors.', href: '/cpv/reports-analytics', match: ['/reports-analytics'] },
    ],
  },
  {
    id: 'pqr',
    title: 'PQR — A to Z',
    summary: 'Annual Product Quality Review: create the PQR, pull data from each section, conclude, and approve.',
    who: 'QA PQR owner, section authors, approvers',
    whatNext: 'Approved PQR may trigger CAPA or change controls. It is retained as a controlled record.',
    href: '/pqr/dashboard',
    group: 'pqr',
    pathPrefixes: ['/pqr', '/dashboard/pqr'],
    steps: [
      { title: 'PQR Dashboard', detail: 'See which products are due, in progress, or approved for the review year.', href: '/pqr/dashboard', match: ['/pqr/dashboard'] },
      { title: 'Create PQR', detail: 'Select product, site, and review period. The system builds the shell record.', href: '/pqr/create', match: ['/create'] },
      { title: 'Batch review', detail: 'Pull commercial batches, yields, and rejects for the period.', href: '/pqr/batches', match: ['/batch'] },
      { title: 'Material & packaging review', detail: 'Review incoming material and packaging performance and supplier issues.', href: '/pqr/materials', match: ['/material', '/packaging'] },
      { title: 'Equipment & utility review', detail: 'Confirm equipment and utilities remained in a qualified / monitored state.', href: '/pqr/equipment-review', match: ['/equipment', '/utility'] },
      { title: 'Stability review', detail: 'Summarise on-going stability and any OOT / OOS.', href: '/pqr/stability', match: ['/stability'] },
      { title: 'Summary & conclusion', detail: 'Write observations, conclusions, and recommendations. AI can polish the narrative.', href: '/pqr/summary', match: ['/summary'] },
      { title: 'Approval', detail: 'Approvers e-sign. After approval the PQR is locked except via controlled change.', href: '/pqr/approval', match: ['/approval'] },
    ],
  },
  {
    id: 'operations',
    title: 'Operations',
    summary: 'Day-to-day equipment, environmental / utility monitoring, vendors, and warehouse traceability.',
    who: 'Engineering, EHS, warehouse, QA',
    whatNext: 'Excursions become deviations or CPV alerts. Warehouse movements support recalls.',
    href: '/qms/equipment',
    group: 'ops',
    pathPrefixes: ['/qms/equipment', '/qms/monitoring', '/qms/warehouse'],
    steps: [
      { title: 'Equipment Management', detail: 'Maintain status, calibration, and maintenance so equipment is fit for use.', href: '/qms/equipment', match: ['/qms/equipment'] },
      { title: 'Environmental & utility monitoring', detail: 'Record cleanroom and utility results. Out-of-limit values escalate.', href: '/qms/monitoring', match: ['/qms/monitoring'] },
      { title: 'Warehouse', detail: 'Track inventory status (released / quarantine / rejected) for traceability and recall.', href: '/qms/warehouse', match: ['/qms/warehouse'] },
    ],
  },
  {
    id: 'manufacturing',
    title: 'Manufacturing',
    summary: 'High-level batch and product view used alongside CPV batch registration and eBMR.',
    who: 'Production planners, QA',
    whatNext: 'Registered batches are monitored in CPV and reviewed in PQR.',
    href: '/manufacturing/dashboard',
    group: 'ops',
    pathPrefixes: ['/manufacturing', '/dashboard/batches', '/dashboard/products'],
    steps: [
      { title: 'Manufacturing dashboard', detail: 'See production status at a glance.', href: '/manufacturing/dashboard' },
      { title: 'Batches', detail: 'Open batch records linked to quality and CPV data.', href: '/dashboard/batches' },
      { title: 'Products', detail: 'Review the product list used across QMS / CPV / PQR.', href: '/dashboard/products' },
    ],
  },
  {
    id: 'master-data',
    title: 'Master Data',
    summary: 'Reference data that every module reads: products, equipment, batches, parameters, departments, sites, materials, and vendors.',
    who: 'Master data owner, QA',
    whatNext: 'Once published, operational modules can select these records instead of typing free text.',
    href: '/admin/products',
    group: 'ops',
    pathPrefixes: [...MASTER_DATA_PATH_PREFIXES],
    steps: [
      { title: 'Products', detail: 'Keep product codes, strengths, and sites accurate.', href: '/admin/products' },
      { title: 'Equipment', detail: 'IDs must match qualification and CPV equipment review.', href: '/admin/equipment' },
      { title: 'Batches & parameters', detail: 'Register manufacturing batches and the CPP / CQA / IPC parameters they use.', href: '/admin/batches' },
      { title: 'Departments, designations & sites', detail: 'Define organization structure and manufacturing sites used across QMS records.', href: '/admin/departments' },
      { title: 'Materials & vendors', detail: 'Link materials to approved vendors before goods receipt.', href: '/dashboard/master/materials' },
      { title: 'Import / export', detail: 'Bulk load or extract master records when migrating or reconciling data.', href: '/admin/master-data-import-export' },
    ],
  },
  {
    id: 'reports',
    title: 'Reports & Analytics',
    summary: 'Cross-module KPIs and printable reports for quality council and inspections.',
    who: 'QA, management',
    whatNext: 'Findings here often become CAPA, change controls, or CPV plan updates.',
    href: '/dashboard/reports',
    group: 'other',
    pathPrefixes: ['/dashboard/reports'],
    steps: [
      { title: 'Open Reports', detail: 'Filter by site, product, and date range.', href: '/dashboard/reports' },
      { title: 'Review KPIs', detail: 'Look at open deviations, overdue CAPA, OOS rate, and CPV health.', href: '/dashboard/reports' },
      { title: 'Export / present', detail: 'Use module-level Reports screens for signed PDF packages.', href: '/dashboard/reports' },
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    summary: 'In-app alerts for due dates, approvals waiting, and CPV / quality escalations.',
    who: 'Every user',
    whatNext: 'Open the linked record, complete your step, then the next role is notified.',
    href: '/notifications',
    group: 'other',
    pathPrefixes: ['/dashboard/notifications', '/notifications'],
    steps: [
      { title: 'Open the bell in the header', detail: 'Unread items are your action queue. Use View all for the full list.', href: '/notifications' },
      { title: 'Open the record', detail: 'Complete investigation, approval, or data entry as assigned.', href: '/notifications' },
      { title: 'Watch CPV alerts', detail: 'High-confidence AI / limit alerts also appear in CPV Alert Engine.', href: '/cpv/alert-engine' },
    ],
  },
  {
    id: 'audit-trail',
    title: 'Audit Trail',
    summary: 'ALCOA+ history of who created, changed, approved, or closed a record — including why.',
    who: 'QA, inspectors, system owner',
    whatNext: 'Use it during investigations and inspections. Never attempt to edit history.',
    href: '/admin/audit-trail',
    group: 'admin',
    pathPrefixes: ['/admin/audit-trail', '/dashboard/audit-trail'],
    steps: [
      { title: 'Open Audit Trail', detail: 'Filter by module, record number, user, and date.', href: '/admin/audit-trail' },
      { title: 'Inspect a change', detail: 'Each event stores old value, new value, user, timestamp, and reason.', href: '/admin/audit-trail' },
    ],
  },
];

export function getGuideTopic(id: string): UserGuideTopic | undefined {
  return USER_GUIDE_TOPICS.find((t) => t.id === id);
}

export function matchGuideTopic(pathname: string): UserGuideTopic {
  const path = pathname || '/';
  if (path === '/dashboard' || path === '/dashboard/') {
    return USER_GUIDE_TOPICS[0];
  }

  let best: UserGuideTopic | undefined;
  let bestLen = -1;
  for (const topic of USER_GUIDE_TOPICS) {
    if (topic.id === 'getting-started') continue;
    for (const prefix of topic.pathPrefixes) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        if (prefix.length > bestLen) {
          best = topic;
          bestLen = prefix.length;
        }
      }
    }
  }
  return best || USER_GUIDE_TOPICS[0];
}

export function matchGuideStepIndex(topic: UserGuideTopic, pathname: string): number {
  if (!topic.steps.length) return 0;
  let found = -1;
  topic.steps.forEach((step, index) => {
    const needles = [
      ...(step.match || []),
      ...(step.href && step.href !== topic.href ? [step.href] : []),
    ];
    if (needles.some((n) => n && pathname.includes(n))) found = index;
  });
  if (found >= 0) return found;
  return 0;
}

export const GUIDE_SEEN_KEY = 'skymap-user-guide-seen';
export const GUIDE_OPEN_EVENT = 'skymap-open-user-guide';
export const BANNER_COLLAPSED_KEY = 'skymap-page-help-collapsed';
export const GUIDE_FAB_POS_KEY = 'skymap-guide-coach-pos';

export function requestOpenUserGuide() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(GUIDE_OPEN_EVENT));
}
