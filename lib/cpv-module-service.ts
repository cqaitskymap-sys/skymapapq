import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { getFirebaseFirestore } from '@/lib/firebase';
import { validateRecordMetadata } from '@/lib/database-registry';
import { CPV_COLLECTIONS, classifySpecification } from '@/lib/cpv';
import {
  CPV_MODULE_COLLECTIONS,
  type BatchInput,
  type BatchRecord,
  type RawMaterialInput,
  type RawMaterialRecord,
  type PackingMaterialInput,
  type PackingMaterialRecord,
  type UtilityMonitoringInput,
  type UtilityMonitoringRecord,
  type EnvironmentInput,
  type EnvironmentRecord,
  type YieldMonitoringInput,
  type YieldMonitoringRecord,
  type StabilityInput,
  type StabilityRecord,
  type HoldTimeInput,
  type HoldTimeRecord,
  type CpvAlertRecord,
  calculateYieldMetrics,
  calculateHoldTimeStatus,
  classifyEnvironment,
  rawMaterialStatus,
  stabilityStatus,
} from '@/lib/cpv-modules';

type Actor = { id?: string; name?: string; role?: string };

function serialized<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function writeAudit(action: string, module: string, recordId: string, actor: Actor, payload: unknown) {
  await addDoc(collection(getFirebaseFirestore(), CPV_COLLECTIONS.audit), {
    action,
    module,
    recordId,
    actorId: actor.id || 'system',
    actorName: actor.name || 'System',
    actorRole: actor.role || 'unknown',
    payload: serialized(payload),
    timestamp: new Date().toISOString(),
    serverTimestamp: serverTimestamp(),
  });
}

export async function listModuleRecords<T>(collectionName: string, max = 500): Promise<T[]> {
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), collectionName),
      orderBy('createdAt', 'desc'),
      limit(max),
    ));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as T));
  } catch {
    try {
      const snapshot = await getDocs(query(collection(getFirebaseFirestore(), collectionName), limit(max)));
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as T));
    } catch (error) {
      console.error(`Unable to load ${collectionName}:`, error);
      return [];
    }
  }
}

async function createModuleRecord<T>(
  collectionName: string,
  module: string,
  data: T,
  actor: Actor,
) {
  const now = new Date().toISOString();
  const payload = {
    ...serialized(data),
    createdAt: now,
    updatedAt: now,
    createdBy: actor.id || 'system',
    createdByName: actor.name || 'System',
    version: 1,
  };
  const reference = await addDoc(collection(getFirebaseFirestore(), collectionName), payload);
  await writeAudit('CREATE', module, reference.id, actor, payload);
  return { id: reference.id, ...payload };
}

async function updateModuleRecord<T extends Record<string, unknown>>(
  collectionName: string,
  module: string,
  id: string,
  data: Partial<T>,
  actor: Actor,
) {
  const payload = { ...data, updatedAt: new Date().toISOString() };
  await updateDoc(doc(getFirebaseFirestore(), collectionName, id), payload);
  await writeAudit('UPDATE', module, id, actor, payload);
}

export async function createBatch(input: BatchInput, actor: Actor) {
  const record = await createModuleRecord(
    CPV_MODULE_COLLECTIONS.batches,
    'Batch Registration',
    {
      ...input,
      batch_number: input.batchNumber,
      product_name: input.productName,
    } as BatchRecord,
    actor,
  );
  try {
    await addDoc(collection(getFirebaseFirestore(), 'batches'), {
      batch_number: input.batchNumber,
      product_name: input.productName,
      product_code: input.productCode,
      manufacturing_date: input.manufacturingDate,
      expiry_date: input.expiryDate,
      batch_size: input.batchSize,
      market: input.market,
      shift: input.shift,
      manufacturing_line: input.manufacturingLine,
      status: input.status,
      source: 'cpv',
      cpv_batch_id: record.id,
      created_at: new Date().toISOString(),
    });
  } catch { /* batches collection may not exist */ }
  return record;
}

export async function updateBatchStatus(id: string, status: BatchInput['status'], actor: Actor, reviewedBy?: string) {
  await updateModuleRecord(CPV_MODULE_COLLECTIONS.batches, 'Batch Registration', id, {
    status,
    reviewedBy: reviewedBy || actor.name || '',
    approvedBy: status === 'Approved' ? actor.name || '' : undefined,
  }, actor);
}

export async function createRawMaterial(input: RawMaterialInput, actor: Actor, allRecords: RawMaterialRecord[] = []) {
  // Legacy workspace helper — writes are CF-only via Raw Material Monitoring.
  // Prefer createRawMaterialRecord from @/lib/cpv-raw-material-monitoring-service.
  void allRecords;
  const { createRawMaterialRecord } = await import('@/lib/cpv-raw-material-monitoring-service');
  const status = rawMaterialStatus(input.assay, input.lsl, input.usl);
  const mapped = {
    cpvProductId: String((input as { cpvProductId?: string }).cpvProductId || ''),
    productName: input.productName,
    productCode: String((input as { productCode?: string }).productCode || input.productName),
    batchNumber: input.batchNo,
    materialCode: String((input as { materialCode?: string }).materialCode || input.apiName),
    materialName: input.apiName,
    materialType: 'API' as const,
    materialGrade: '',
    materialCategory: 'API',
    manufacturerName: input.vendor,
    supplierName: input.vendor,
    vendorId: '',
    vendorName: input.vendor,
    vendorStatus: 'Active',
    avlStatus: 'Approved',
    vendorCode: '',
    pharmacopoeiaStandard: '',
    grnNumber: input.grnNo || '',
    purchaseOrderNumber: '',
    arNumber: input.arNo,
    coaNumber: '',
    materialLotNumber: '',
    supplierBatchNumber: '',
    mfgDate: String((input as { mfgDate?: string }).mfgDate || new Date().toISOString().slice(0, 10)),
    expDate: String((input as { expDate?: string }).expDate || new Date().toISOString().slice(0, 10)),
    retestDate: '',
    shelfLifeMonths: '',
    receivedQuantity: 0,
    acceptedQuantity: 0,
    rejectedQuantity: 0,
    quarantineQuantity: 0,
    issuedQuantity: 0,
    usedQuantity: 0,
    unit: 'kg',
    storageCondition: '',
    warehouseLocation: '',
    storageArea: '',
    site: '',
    department: 'Warehouse',
    shift: '',
    qcStatus: (status === 'OOS' ? 'Rejected' : 'Under Test') as 'Approved' | 'Rejected' | 'Under Test' | 'Quarantine' | 'Retest Required',
    qaStatus: '',
    releaseStatus: '',
    samplingStatus: '',
    coaAvailable: 'Yes' as const,
    specificationNumber: '',
    specificationVersion: '',
    stpNumber: '',
    testParameter: 'Assay',
    observedResult: input.assay,
    lowerLimit: input.lsl,
    upperLimit: input.usl,
    testUnit: '',
    testResultSummary: '',
    remarks: 'Created via legacy CPV workspace helper',
    effectiveDate: '',
    version: '1.0',
    changeReason: 'Legacy workspace raw material entry',
  };
  if (!mapped.cpvProductId) {
    throw new Error('cpvProductId is required. Use Raw Material Monitoring (/cpv/raw-material-monitoring).');
  }
  const { result, error } = await createRawMaterialRecord(mapped, {
    id: actor.id || 'system',
    name: actor.name || actor.id || 'system',
    role: actor.role,
  });
  if (error || !result) throw new Error(error || 'Failed to create raw material record');
  return result as unknown as RawMaterialRecord;
}

export async function createPackingMaterial(input: PackingMaterialInput, actor: Actor) {
  // Legacy workspace helper — writes are CF-only via Packing Material Monitoring.
  const { createPackingMaterialRecord } = await import('@/lib/cpv-packing-material-monitoring-service');
  const matTypeRaw = String(input.materialType || '');
  const materialType = (matTypeRaw.includes('Secondary')
    ? 'Secondary Packing Material'
    : matTypeRaw.includes('Tertiary')
      ? 'Tertiary Packing Material'
      : 'Primary Packing Material') as 'Primary Packing Material' | 'Secondary Packing Material' | 'Tertiary Packing Material';
  const today = new Date().toISOString().slice(0, 10);
  const mapped = {
    cpvProductId: String((input as { cpvProductId?: string }).cpvProductId || ''),
    productName: input.productName,
    productCode: String((input as { productCode?: string }).productCode || input.productName),
    batchNumber: input.batchNo,
    materialCode: String((input as { materialCode?: string }).materialCode || input.materialType),
    materialName: String((input as { materialName?: string }).materialName || input.materialType),
    materialType,
    materialCategory: 'Other' as const,
    manufacturerName: input.vendor || 'Unknown',
    supplierName: input.vendor || 'Unknown',
    vendorId: '',
    vendorName: input.vendor || 'Unknown',
    vendorStatus: 'Active',
    avlStatus: 'Approved',
    vendorCode: '',
    grnNumber: input.grnNo || '',
    purchaseOrderNumber: '',
    arNumber: input.arNo || `AR-${Date.now()}`,
    coaNumber: '',
    materialLotNumber: '',
    supplierBatchNumber: '',
    mfgDate: today,
    expDate: today,
    retestDate: '',
    shelfLifeMonths: '',
    receivedQuantity: 0,
    acceptedQuantity: 0,
    rejectedQuantity: 0,
    quarantineQuantity: 0,
    returnedQuantity: 0,
    issuedQuantity: 0,
    usedQuantity: 0,
    unit: 'nos',
    storageCondition: '',
    warehouseLocation: '',
    storageArea: '',
    site: '',
    department: 'Warehouse',
    shift: '',
    qcStatus: (input.status === 'Fail' ? 'Rejected' : 'Under Test') as 'Approved' | 'Rejected' | 'Under Test' | 'Quarantine' | 'Retest Required',
    qaStatus: '',
    releaseStatus: '',
    samplingStatus: '',
    coaAvailable: 'Yes' as const,
    specificationNumber: '',
    specificationVersion: '',
    artworkVersion: '',
    barcode: '',
    qrCode: '',
    rfid: '',
    artworkVerified: '',
    barcodeVerified: '',
    labelVerified: '',
    packagingIntegrity: '',
    damageInspection: '',
    printingVerified: '',
    dimensionCheck: '',
    sealIntegrity: '',
    stsNumber: '',
    stpNumber: '',
    testParameter: '',
    testUnit: '',
    testResultSummary: String(input.testResult || ''),
    remarks: 'Created via legacy CPV workspace helper',
    effectiveDate: '',
    reviewDate: '',
    version: '1.0',
    description: '',
    changeReason: 'Legacy workspace packing material entry',
  };
  if (!mapped.cpvProductId) {
    throw new Error('cpvProductId is required. Use Packing Material Monitoring (/cpv/packing-material-monitoring).');
  }
  const { result, error } = await createPackingMaterialRecord(mapped, {
    id: actor.id || 'system',
    name: actor.name || actor.id || 'system',
    role: actor.role,
  });
  if (error || !result) throw new Error(error || 'Failed to create packing material record');
  return result as unknown as PackingMaterialRecord;
}

export async function createUtilityRecord(input: UtilityMonitoringInput, actor: Actor) {
  // Legacy workspace helper — writes are CF-only via Utility Monitoring.
  const { createUtilityRecord: createUtil } = await import('@/lib/cpv-utility-monitoring-service');
  const today = new Date().toISOString().slice(0, 10);
  const mapped = {
    cpvProductId: String((input as { cpvProductId?: string }).cpvProductId || ''),
    productName: String(input.productName || input.utilityType),
    productCode: String((input as { productCode?: string }).productCode || input.utilityType),
    batchNumber: String(input.batchNo || 'N/A'),
    utilityType: (['Purified Water', 'Water for Injection', 'Clean Steam', 'Compressed Air', 'Nitrogen', 'HVAC', 'Chilled Water', 'Cooling Water', 'Vacuum', 'Electricity', 'Gas', 'Temperature', 'Humidity', 'Differential Pressure', 'Boiler Steam', 'Other'].includes(String(input.utilityType))
      ? String(input.utilityType)
      : 'Other') as 'Purified Water' | 'Water for Injection' | 'Clean Steam' | 'Compressed Air' | 'Nitrogen' | 'HVAC' | 'Chilled Water' | 'Cooling Water' | 'Vacuum' | 'Electricity' | 'Gas' | 'Temperature' | 'Humidity' | 'Differential Pressure' | 'Boiler Steam' | 'Other',
    utilitySystemName: String(input.utilityType),
    utilitySystemCode: '',
    samplingPoint: 'Main',
    areaRoomNo: '',
    building: '',
    site: '',
    department: 'Utilities',
    shift: '',
    productionLine: '',
    equipmentId: '',
    equipmentName: '',
    dataSource: 'Manual' as const,
    sensorId: '',
    alarmStatus: '',
    communicationStatus: 'OK',
    parameterId: '',
    parameterCode: String(input.parameterName || 'PARAM').replace(/\s+/g, '_').toUpperCase(),
    parameterName: input.parameterName,
    observedValue: input.observedValue,
    targetValue: (input.lsl + input.usl) / 2,
    lowerLimit: input.lsl,
    upperLimit: input.usl,
    unit: input.unit,
    resultType: 'Numeric' as const,
    monitoringDate: input.recordedDate || today,
    monitoringTime: '00:00',
    recordedBy: input.recordedBy || actor.name || 'system',
    reviewedBy: '',
    reviewDate: '',
    remarks: 'Created via legacy CPV workspace helper',
    utilityCriticality: 'Major',
    autoDeviationRequired: true,
    specificationNumber: '',
    version: '1.0',
    effectiveDate: '',
    description: '',
    changeReason: 'Legacy workspace utility entry',
  };
  if (!mapped.cpvProductId) {
    throw new Error('cpvProductId is required. Use Utility Monitoring (/cpv/utility-monitoring).');
  }
  const { result, error } = await createUtil(mapped, {
    id: actor.id || 'system',
    name: actor.name || actor.id || 'system',
    role: actor.role,
  });
  if (error || !result) throw new Error(error || 'Failed to create utility record');
  return result as unknown as UtilityMonitoringRecord;
}

export async function createEnvironment(input: EnvironmentInput, actor: Actor) {
  const status = classifyEnvironment(input);
  const record = await createModuleRecord<EnvironmentRecord>(
    CPV_MODULE_COLLECTIONS.environment,
    'Environmental Monitoring',
    { ...input, status },
    actor,
  );
  if (status !== 'Complies') {
    await createAlert({
      alertType: status === 'OOS' ? 'Limit Exceeded' : 'OOT',
      severity: status === 'OOS' ? 'High' : 'Medium',
      module: 'Environmental Monitoring',
      productName: input.area,
      batchNo: input.recordedDate,
      parameterName: 'Temperature/Humidity',
      message: `Environmental excursion in ${input.area} Grade ${input.grade}`,
      recordId: record.id,
    }, actor);
  }
  return record;
}

export async function createYieldRecord(input: YieldMonitoringInput, actor: Actor) {
  const { yieldPercent, variancePercent, status } = calculateYieldMetrics(input.expectedYield, input.actualYield);
  const record = await createModuleRecord<YieldMonitoringRecord>(
    CPV_MODULE_COLLECTIONS.yieldMonitoring,
    'Yield Monitoring',
    { ...input, yieldPercent, variancePercent, status },
    actor,
  );
  if (status !== 'Complies') {
    await createAlert({
      alertType: 'Trend Deteriorating',
      severity: status === 'OOS' ? 'High' : 'Medium',
      module: 'Yield Monitoring',
      productName: input.productName,
      batchNo: input.batchNo,
      parameterName: input.stage,
      message: `${input.stage} yield ${yieldPercent}% (${status})`,
      observedValue: yieldPercent,
      recordId: record.id,
    }, actor);
  }
  return record;
}

export async function createStability(input: StabilityInput, actor: Actor) {
  const status = stabilityStatus(input.observedValue, input.lsl, input.usl);
  return createModuleRecord<StabilityRecord>(
    CPV_MODULE_COLLECTIONS.stability,
    'Stability Monitoring',
    { ...input, status },
    actor,
  );
}

export async function createHoldTime(input: HoldTimeInput, actor: Actor) {
  const status = calculateHoldTimeStatus(input.allowedTime, input.actualTime);
  const variancePercent = input.allowedTime === 0
    ? 0
    : Number((((input.actualTime - input.allowedTime) / input.allowedTime) * 100).toFixed(2));
  const record = await createModuleRecord<HoldTimeRecord>(
    CPV_MODULE_COLLECTIONS.holdTime,
    'Hold Time Monitoring',
    { ...input, status, variancePercent },
    actor,
  );
  if (status === 'Fail') {
    await createAlert({
      alertType: 'Limit Exceeded',
      severity: 'High',
      module: 'Hold Time Monitoring',
      productName: input.productName,
      batchNo: input.batchNo,
      parameterName: input.stage,
      message: `Hold time exceeded at ${input.stage}: ${input.actualTime}${input.unit} vs ${input.allowedTime}${input.unit} allowed`,
      observedValue: input.actualTime,
      recordId: record.id,
    }, actor);
  }
  return record;
}

export async function createAlert(
  input: Omit<CpvAlertRecord, 'id' | 'createdAt' | 'status'>,
  actor: Actor,
) {
  const payload = {
    ...input,
    status: 'Open' as const,
    createdAt: new Date().toISOString(),
    createdBy: actor.name || 'System',
  };
  const ref = await addDoc(collection(getFirebaseFirestore(), CPV_MODULE_COLLECTIONS.alerts), payload);
  return { id: ref.id, ...payload };
}

export async function acknowledgeAlert(id: string, actor: Actor) {
  await updateModuleRecord(CPV_MODULE_COLLECTIONS.alerts, 'Alert Engine', id, { status: 'Acknowledged' }, actor);
}

export async function closeAlert(id: string, actor: Actor) {
  await updateModuleRecord(CPV_MODULE_COLLECTIONS.alerts, 'Alert Engine', id, { status: 'Closed' }, actor);
}

export async function listAlerts(max = 200): Promise<CpvAlertRecord[]> {
  return listModuleRecords<CpvAlertRecord>(CPV_MODULE_COLLECTIONS.alerts, max);
}

export async function listBatches(max = 500): Promise<BatchRecord[]> {
  return listModuleRecords<BatchRecord>(CPV_MODULE_COLLECTIONS.batches, max);
}

export async function loadAllCpvModules() {
  const [
    batches, rawMaterials, packingMaterials, utilityMonitoring,
    environment, yieldMonitoring, stability, holdTime, alerts,
  ] = await Promise.all([
    listBatches(),
    listModuleRecords<RawMaterialRecord>(CPV_MODULE_COLLECTIONS.rawMaterials),
    listModuleRecords<PackingMaterialRecord>(CPV_MODULE_COLLECTIONS.packingMaterials),
    listModuleRecords<UtilityMonitoringRecord>(CPV_MODULE_COLLECTIONS.utilityMonitoring),
    listModuleRecords<EnvironmentRecord>(CPV_MODULE_COLLECTIONS.environment),
    listModuleRecords<YieldMonitoringRecord>(CPV_MODULE_COLLECTIONS.yieldMonitoring),
    listModuleRecords<StabilityRecord>(CPV_MODULE_COLLECTIONS.stability),
    listModuleRecords<HoldTimeRecord>(CPV_MODULE_COLLECTIONS.holdTime),
    listAlerts(),
  ]);
  return {
    batches, rawMaterials, packingMaterials, utilityMonitoring,
    environment, yieldMonitoring, stability, holdTime, alerts,
  };
}

export async function deleteBatch(id: string, actor: Actor) {
  await deleteDoc(doc(getFirebaseFirestore(), CPV_MODULE_COLLECTIONS.batches, id));
  await writeAudit('DELETE', 'Batch Registration', id, actor, {});
}
