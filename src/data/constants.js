/** Shared constants for compliance records (Phase 0/1). */

export const LOCAL_ORG_ID = 'local';

export const SYNC_LOCAL = 'local';
export const SYNC_PENDING = 'pending';
export const SYNC_SYNCED = 'synced';
export const SYNC_ERROR = 'error';

/** Registry of collections — implemented + stubs for later phases. */
export const COLLECTIONS = {
  projects: { key: 'projects', implemented: true },
  workers: { key: 'workers', implemented: true },
  oqRecords: { key: 'oqRecords', implemented: true },
  crewDays: { key: 'crewDays', implemented: true },
  startOfDayChecks: { key: 'startOfDayChecks', implemented: true },
  attachments: { key: 'attachments', implemented: true },
  syncQueue: { key: 'syncQueue', implemented: true },
  meta: { key: 'meta', implemented: true },
  packingLists: { key: 'packingLists', implemented: true },
  materials: { key: 'materials', implemented: true },
  materialCheckins: { key: 'materialCheckins', implemented: true },
  // Future phases — registered only, no UI in this increment
  welds: { key: 'welds', implemented: false, stub: true },
  hydroTests: { key: 'hydroTests', implemented: false, stub: true },
  ncrs: { key: 'ncrs', implemented: false, stub: true },
  crossings: { key: 'crossings', implemented: false, stub: true },
  supervisorNotes: { key: 'supervisorNotes', implemented: false, stub: true },
};

export const RECORD_STORES = [
  'projects',
  'workers',
  'oqRecords',
  'crewDays',
  'startOfDayChecks',
  'packingLists',
  'materials',
  'materialCheckins',
];

export const CREW_ROLES = [
  { id: 'foreman', label: 'Foreman' },
  { id: 'operator', label: 'Operator' },
  { id: 'operator-excavator', label: 'Operator — excavator' },
  { id: 'operator-sideboom', label: 'Operator — sideboom' },
  { id: 'welder', label: 'Welder' },
  { id: 'helper', label: 'Helper / laborer' },
  { id: 'hydro-vac', label: 'Hydro-vac' },
  { id: 'hdd', label: 'HDD' },
  { id: 'coating', label: 'Coating' },
  { id: 'nde', label: 'NDE' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'other', label: 'Other' },
];

export const CERT_TYPES = [
  { id: 'osha', label: 'OSHA' },
  { id: 'nccer', label: 'NCCER' },
  { id: 'ampp-nace', label: 'AMPP / NACE' },
  { id: 'api', label: 'API' },
  { id: 'cpr', label: 'CPR / First aid' },
  { id: 'hazwoper', label: 'HAZWOPER' },
  { id: 'confined', label: 'Confined space' },
  { id: 'excavation-cp', label: 'Excavation competent person' },
  { id: 'welding', label: 'Welding' },
  { id: 'operator', label: 'Operator credentials' },
  { id: 'other', label: 'Other' },
];

export const OQ_STATUSES = [
  { id: 'qualified', label: 'Qualified', color: 'green' },
  { id: 'expiring_soon', label: 'Expiring soon', color: 'yellow' },
  { id: 'expired', label: 'Expired', color: 'red' },
  { id: 'not_qualified', label: 'Not qualified', color: 'red' },
  { id: 'unable_to_verify', label: 'Unable to verify', color: 'gray' },
];

/** Manual documentation labels only — not live integrations. */
export const OQ_SOURCES = [
  { id: 'employer_records', label: 'Employer records (manual)' },
  { id: 'operator_oq', label: 'Operator OQ program (manual)' },
  { id: 'isnetworld', label: 'ISNetworld (manual source label)' },
  { id: 'veriforce', label: 'Veriforce (manual source label)' },
  { id: 'card_on_site', label: 'OQ card on site (manual)' },
  { id: 'other', label: 'Other (manual)' },
];

export const EXPIRATION_WINDOWS = [7, 30, 60, 90];

export const START_OF_DAY_SECTIONS = [
  {
    id: 'crew',
    title: 'Crew Compliance',
    items: [
      { id: 'roster', label: 'Today’s crew roster is built' },
      { id: 'oqs', label: 'OQs verified for assigned tasks (or exception documented)' },
      { id: 'competent', label: 'Competent person named for excavation' },
      { id: 'supervision', label: 'Foreman / supervision on site' },
      { id: 'orientation', label: 'New workers / visitors oriented' },
    ],
  },
  {
    id: 'safety',
    title: 'Safety',
    items: [
      { id: 'tailgate', label: 'Tailgate / JSA completed' },
      { id: 'ppe', label: 'Required PPE on crew' },
      { id: 'locate', label: 'Locate ticket valid / marks confirmed (811)' },
      { id: 'traffic', label: 'Traffic control / public protection (if needed)' },
      { id: 'emergency', label: 'Emergency contacts and nearest ER known' },
      { id: 'weather', label: 'Weather / lightning check completed' },
      { id: 'atmosphere', label: 'Atmosphere monitoring available if confined/excavation risk' },
      { id: 'protective', label: 'Excavation protective system plan reviewed' },
    ],
  },
  {
    id: 'documents',
    title: 'Documents',
    items: [
      { id: 'sow', label: 'Operator SOW / specs — current revision on hand' },
      { id: 'drawings', label: 'Alignment sheets / drawings current' },
      { id: 'permits', label: 'Permits / ROW / one-calls current' },
      { id: 'daily', label: 'Daily report started or ready' },
      { id: 'procedures', label: 'Approved procedures available for today’s work' },
    ],
  },
  {
    id: 'equipment',
    title: 'Equipment',
    items: [
      { id: 'const-eq', label: 'Construction / excavation equipment inspected' },
      { id: 'hydro', label: 'Hydro-vac inspected (if used)' },
      { id: 'gas-detect', label: 'Gas detector bump-tested / calibrated' },
      { id: 'first-aid', label: 'Fire extinguisher / first aid available' },
      { id: 'comms', label: 'Communication (radio/phone) working' },
      { id: 'specialty', label: 'Coating / NDE equipment ready (if used)' },
    ],
  },
];

export const COMPLIANCE_NOTE =
  'Always follow the operator SOW, approved procedures, and applicable regulation.';

export const MAX_ATTACH_BYTES = 8 * 1024 * 1024;
