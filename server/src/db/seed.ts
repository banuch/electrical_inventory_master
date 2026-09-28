import { randomUUID } from 'node:crypto';
import { DbService } from './db.service.js';
import { hashPassword } from '../auth/auth.service.js';
import { DEFAULT_ROLES, PERMISSIONS, type Permission } from '../auth/permissions.js';
import { AuditService } from '../audit/audit.service.js';
import { StockPostingService, type PostableType } from '../stock/stock-posting.service.js';
import { normalizeName } from '../items/items.service.js';
import type { AuthUser } from '../auth/auth-user.js';

const UNITS: [string, string, number][] = [
  ['NOS', 'Numbers', 0], ['SET', 'Sets', 0], ['PAIR', 'Pairs', 0], ['M', 'Metres', 2], ['KM', 'Kilometres', 3],
  ['KG', 'Kilograms', 3], ['L', 'Litres', 2], ['ROLL', 'Rolls', 0], ['BOX', 'Boxes', 0],
];

const CATEGORIES: [string, string, string | null][] = [
  ['SWG', 'Switchgear', null], ['SWG-CB', 'Circuit Breakers', 'SWG'], ['SWG-ISO', 'Isolators', 'SWG'],
  ['TRF', 'Transformers & Spares', null], ['TRF-BUSH', 'Bushings', 'TRF'], ['TRF-OIL', 'Transformer Oil', 'TRF'],
  ['CBL', 'Cables & Conductors', null], ['CBL-PWR', 'Power Cables', 'CBL'], ['CBL-CTRL', 'Control Cables', 'CBL'], ['CBL-OH', 'Overhead Conductors', 'CBL'],
  ['PROT', 'Protection & Metering', null], ['PROT-RLY', 'Relays', 'PROT'], ['PROT-CT', 'Instrument Transformers', 'PROT'],
  ['INS', 'Insulators & Hardware', null], ['LA', 'Lightning Arresters', null],
  ['BAT', 'Batteries & DC Systems', null], ['TOOL', 'Tools & Testing Equipment', null], ['SAFE', 'Safety Equipment', null],
  ['CONS', 'Consumables', null],
];

const REASONS: [string, string, string, boolean][] = [
  ['RCV_PURCHASE', 'RECEIPT', 'Purchase / supplier delivery', true],
  ['RCV_STORE', 'RECEIPT', 'Received from central store', true],
  ['RCV_OTHER', 'RECEIPT', 'Other receipt', true],
  ['ISS_MAINT', 'ISSUE', 'Maintenance work', true],
  ['ISS_BREAKDOWN', 'ISSUE', 'Breakdown / emergency repair', false],
  ['ISS_PROJECT', 'ISSUE', 'Project / new installation', true],
  ['ISS_CONSUMPTION', 'ISSUE', 'Routine consumption', false],
  ['RTN_UNUSED', 'RETURN', 'Unused material returned from work', true],
  ['RTN_RECOVERED', 'RETURN', 'Recovered usable material', false],
  ['ADJ_COUNT', 'ADJUSTMENT', 'Physical verification variance', true],
  ['ADJ_ERROR', 'ADJUSTMENT', 'Correction of recording error', true],
  ['SCR_DAMAGED', 'SCRAP', 'Damaged beyond repair', true],
  ['SCR_OBSOLETE', 'SCRAP', 'Obsolete / condemned', true],
];

export async function seedBase(db: DbService, opts: { adminUsername: string; adminPassword: string }) {
  await db.tx(async (c) => {
    await c.query('INSERT INTO permissions (code, description) SELECT * FROM unnest($1::text[], $2::text[]) ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description',
      [Object.keys(PERMISSIONS), Object.values(PERMISSIONS)]);
    for (const r of DEFAULT_ROLES) {
      const { rows: [role] } = await c.query(
        `INSERT INTO roles (code, name, description, is_system) VALUES ($1, $2, $3, true)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id, (xmax = 0) AS inserted`,
        [r.code, r.name, r.description]);
      // Only initialise permissions for new roles (so admins' later edits are kept) — except SUPER_ADMIN, which always has all.
      if (role.inserted || r.code === 'SUPER_ADMIN') {
        await c.query('INSERT INTO role_permissions (role_id, permission_code) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING', [role.id, r.permissions]);
      }
    }
    for (const [code, name, dp] of UNITS) {
      await c.query('INSERT INTO units (code, name, decimal_places) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [code, name, dp]);
    }
    for (const [code, name, parent] of CATEGORIES) {
      await c.query(
        `INSERT INTO item_categories (code, name, parent_id)
         VALUES ($1, $2, (SELECT id FROM item_categories WHERE code = $3)) ON CONFLICT DO NOTHING`, [code, name, parent]);
    }
    for (const [code, docType, name, requiresRef] of REASONS) {
      await c.query('INSERT INTO transaction_reasons (code, doc_type, name, requires_reference) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [code, docType, name, requiresRef]);
    }
    const exists = (await c.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [opts.adminUsername])).rowCount;
    if (!exists) {
      const { rows: [u] } = await c.query(
        `INSERT INTO users (username, full_name, password_hash, org_wide, must_change_password)
         VALUES ($1, 'Super Administrator', $2, true, true) RETURNING id`, [opts.adminUsername, await hashPassword(opts.adminPassword)]);
      await c.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'SUPER_ADMIN'`, [u.id]);
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Demo data (development only)
// ---------------------------------------------------------------------------------------------

const SUBSTATIONS: [string, string, string, string][] = [
  ['SLP', 'SLP', '', ''],
  ['FLP', 'FLP', '', ''],
  ['CC', 'Control Center', '', ''],
  ['TLM', 'Telemetry', '', ''],
  ['MRS', 'SHAR MRS', '', ''],
  ['STEX', 'Stex', '', ''],
  ['SHARCOL', 'SHAR Colonies', '', ''],
  ['SPTHC', 'SPT Housing Colonies', '', ''],
];

// code, name, category, unit, spec, rating, manufacturer, critical, aliases
const ITEMS: [string, string, string, string, string, string, string, boolean, string[]][] = [
  ['CB-VCB-33-1250', 'Vacuum Circuit Breaker 33kV', 'SWG-CB', 'NOS', 'Outdoor, spring operated', '33kV 1250A 25kA', 'Siemens', true, ['VCB 33']],
  ['CB-SF6-132-3150', 'SF6 Circuit Breaker 132kV', 'SWG-CB', 'NOS', 'Live tank, 3 pole', '132kV 3150A 40kA', 'ABB', true, []],
  ['ISO-33-1250', 'Isolator 33kV Double Break', 'SWG-ISO', 'SET', 'With earth switch', '33kV 1250A', 'Hitachi Energy', false, []],
  ['BUSH-33-630', 'Transformer Bushing 33kV', 'TRF-BUSH', 'NOS', 'Porcelain, oil impregnated paper', '33kV 630A', 'CGL', false, []],
  ['BUSH-11-1000', 'Transformer Bushing 11kV', 'TRF-BUSH', 'NOS', 'Porcelain', '11kV 1000A', 'CGL', false, []],
  ['OIL-TRF-IEC60296', 'Transformer Oil Mineral', 'TRF-OIL', 'L', 'IEC 60296 uninhibited', '', 'Savita', false, ['insulating oil', 'TO oil']],
  ['CBL-XLPE-11-3C300', 'XLPE Power Cable 3C x 300 sq mm', 'CBL-PWR', 'M', 'Aluminium, armoured', '11kV', 'Polycab', false, ['300 sqmm cable']],
  ['CBL-XLPE-33-1C630', 'XLPE Power Cable 1C x 630 sq mm', 'CBL-PWR', 'M', 'Copper, unarmoured', '33kV', 'KEI', false, []],
  ['CBL-CTRL-12C-2.5', 'Control Cable 12C x 2.5 sq mm', 'CBL-CTRL', 'M', 'Copper, PVC, armoured', '1.1kV', 'Havells', false, []],
  ['CBL-CTRL-4C-4', 'Control Cable 4C x 4 sq mm', 'CBL-CTRL', 'M', 'Copper, PVC, armoured', '1.1kV', 'Havells', false, []],
  ['ACSR-PANTHER', 'ACSR Conductor Panther', 'CBL-OH', 'KM', '30/7/3.00 mm', '', 'Apar', false, ['panther conductor']],
  ['ACSR-ZEBRA', 'ACSR Conductor Zebra', 'CBL-OH', 'KM', '54/7/3.18 mm', '', 'Apar', false, ['zebra conductor']],
  ['RLY-DIST-P443', 'Numerical Distance Protection Relay', 'PROT-RLY', 'NOS', 'MiCOM P443', '110V DC aux', 'GE Vernova', true, ['distance relay']],
  ['RLY-OC-P127', 'Numerical Overcurrent & Earth Fault Relay', 'PROT-RLY', 'NOS', 'MiCOM P127', '1A/5A', 'GE Vernova', true, ['O/C E/F relay']],
  ['RLY-DIFF-7UT', 'Transformer Differential Relay', 'PROT-RLY', 'NOS', 'SIPROTEC 7UT85', '', 'Siemens', true, []],
  ['CT-33-400-1', 'Current Transformer 33kV 400/1A', 'PROT-CT', 'NOS', 'Outdoor oil cooled, 3 core', '33kV 400/1A 5P20', 'Kappa', false, ['CT 400/1']],
  ['PT-33-110', 'Potential Transformer 33kV/110V', 'PROT-CT', 'NOS', 'Outdoor', '33kV/√3 / 110V/√3', 'Kappa', false, ['PT', 'VT 33kV']],
  ['INS-DISC-120', 'Disc Insulator 120kN', 'INS', 'NOS', 'Porcelain, ball & socket', '120kN', 'Modern Insulators', false, []],
  ['INS-POST-33', 'Post Insulator 33kV', 'INS', 'NOS', 'Solid core porcelain', '33kV', 'WS Industries', false, []],
  ['LA-33-10KA', 'Lightning Arrester 33kV', 'LA', 'NOS', 'Metal oxide, polymer housed', '30kV 10kA', 'Oblum', true, ['surge arrester']],
  ['LA-11-5KA', 'Lightning Arrester 11kV', 'LA', 'NOS', 'Metal oxide, polymer housed', '9kV 5kA', 'Oblum', false, []],
  ['BAT-VRLA-2V-300', 'VRLA Battery Cell 2V 300Ah', 'BAT', 'NOS', 'Sealed maintenance free', '2V 300Ah', 'Exide', true, ['battery cell']],
  ['BAT-CHGR-110V', 'Battery Charger 110V DC', 'BAT', 'SET', 'Float cum boost', '110V 40A', 'Amara Raja', false, []],
  ['TOOL-IR-5KV', 'Insulation Resistance Tester 5kV', 'TOOL', 'NOS', 'Digital, with case', '5kV', 'Megger', false, ['megger']],
  ['TOOL-CRM', 'Contact Resistance Meter 200A', 'TOOL', 'NOS', 'Micro-ohm meter', '200A', 'Scope T&M', false, []],
  ['SAFE-GLV-CL2', 'Insulating Gloves Class 2', 'SAFE', 'PAIR', 'Rubber, IEC 60903', '17kV', 'Salisbury', false, ['HV gloves']],
  ['SAFE-EARTH-33', 'Portable Earthing Set 33kV', 'SAFE', 'SET', 'With telescopic rod', '33kV', 'Hastings', false, ['discharge rod']],
  ['CONS-LUG-300', 'Aluminium Cable Lug 300 sq mm', 'CONS', 'NOS', 'Crimping type', '300 sq mm', 'Dowells', false, []],
  ['CONS-TAPE-PVC', 'PVC Insulation Tape', 'CONS', 'ROLL', '19mm x 8m', '', 'Anchor', false, []],
  ['CONS-SILICA-GEL', 'Silica Gel Breather Crystals', 'CONS', 'KG', 'Blue indicating', '', 'Generic', false, ['silica gel']],
];

export async function seedDemo(db: DbService, demoPassword: string, log: (m: string) => void = console.log) {
  const already = await db.one(`SELECT 1 FROM substations WHERE code = 'SLP'`);
  if (already) { log('Demo data already present; skipping.'); return; }

  const pwHash = await hashPassword(demoPassword);
  const ids = await db.tx(async (c) => {
    const sub: Record<string, number> = {};
    for (const [code, name, contact, phone] of SUBSTATIONS) {
      const { rows: [r] } = await c.query(
        `INSERT INTO substations (code, name, address, contact_name, contact_phone) VALUES ($1, $2, '', $3, $4) RETURNING id`,
        [code, name, contact, phone]);
      sub[code] = r.id;
    }
    const item: Record<string, number> = {};
    for (const [code, name, cat, unit, spec, rating, mfr, critical, aliases] of ITEMS) {
      const { rows: [r] } = await c.query(
        `INSERT INTO items (code, name, normalized_name, category_id, unit_id, specification, rating, manufacturer, is_critical)
         VALUES ($1, $2, $3, (SELECT id FROM item_categories WHERE code = $4), (SELECT id FROM units WHERE code = $5), $6, $7, $8, $9)
         RETURNING id`, [code, name, normalizeName(name), cat, unit, spec, rating, mfr, critical]);
      item[code] = r.id;
      for (const a of aliases) await c.query('INSERT INTO item_aliases (item_id, alias) VALUES ($1, $2)', [r.id, a]);
    }
    const users: [string, string, string, boolean, string[]][] = [
      ['inv.admin', 'Inventory Administrator (Demo)', 'INVENTORY_ADMIN', true, []],
      ['incharge.slp', 'SLP In-Charge (Demo)', 'SUBSTATION_INCHARGE', false, ['SLP']],
      ['store.slp', 'SLP Storekeeper (Demo)', 'STOREKEEPER', false, ['SLP']],
      ['store.flp', 'FLP Storekeeper (Demo)', 'STOREKEEPER', false, ['FLP']],
      ['auditor', 'Auditor (Demo)', 'VIEWER', true, []],
    ];
    for (const [username, fullName, role, orgWide, subs] of users) {
      const { rows: [u] } = await c.query(
        `INSERT INTO users (username, full_name, password_hash, org_wide, must_change_password) VALUES ($1, $2, $3, $4, false) RETURNING id`,
        [username, fullName, pwHash, orgWide]);
      await c.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2', [u.id, role]);
      for (const s of subs) await c.query('INSERT INTO user_substation_assignments VALUES ($1, $2)', [u.id, sub[s]]);
    }
    return { sub, item };
  });

  // Opening stock and a few movements go through the real posting engine (ledger + balances + audit).
  const admin = await db.one(`SELECT id, username, full_name FROM users WHERE username = 'inv.admin'`);
  const actor: AuthUser = {
    id: admin.id, username: admin.username, fullName: admin.full_name, orgWide: true, mustChangePassword: false,
    permissions: new Set(Object.keys(PERMISSIONS) as Permission[]), substationIds: [], sessionId: 'seed', csrfToken: 'seed',
  };
  const posting = new StockPostingService(db, new AuditService(db));
  const today = new Date().toISOString().slice(0, 10);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const post = (docType: PostableType, sub: string, lines: [string, string][], extra: Partial<{ reasonCode: string; referenceNo: string; counterparty: string; remarks: string }> = {}) =>
    posting.post(actor, {
      docType, substationId: ids.sub[sub], docDate: today, referenceNo: '', counterparty: '', remarks: '',
      idempotencyKey: randomUUID(), lines: lines.map(([code, quantity]) => ({ itemId: ids.item[code], quantity })), ...extra,
    });

  for (const [s] of SUBSTATIONS) {
    const lines: [string, string][] = [];
    for (const [code, , , unit] of ITEMS) {
      if (rand() < 0.35) continue;
      const base = unit === 'M' ? Math.round(rand() * 800) : unit === 'KM' ? Math.round(rand() * 12) : unit === 'L' ? Math.round(rand() * 2000) : Math.round(rand() * 24);
      if (base > 0) lines.push([code, String(base)]);
    }
    if (lines.length) await post('OPENING', s, lines, { referenceNo: 'MIGRATION-2026', remarks: 'Opening balance from legacy register' });
  }
  const levels: [string, string, string][] = [
    ['SLP', 'LA-33-10KA', '6'], ['SLP', 'RLY-OC-P127', '2'], ['SLP', 'BAT-VRLA-2V-300', '10'], ['SLP', 'CT-33-400-1', '3'],
    ['FLP', 'LA-33-10KA', '4'], ['FLP', 'CB-VCB-33-1250', '1'], ['CC', 'RLY-DIST-P443', '1'], ['MRS', 'SAFE-GLV-CL2', '6'],
  ];
  for (const [s, code, min] of levels) {
    await db.query(`INSERT INTO item_substation_settings (substation_id, item_id, min_level, reorder_level, updated_by)
      VALUES ($1, $2, $3, $3, $4) ON CONFLICT DO NOTHING`, [ids.sub[s], ids.item[code], min, admin.id]);
  }
  await post('RECEIPT', 'SLP', [['CBL-CTRL-12C-2.5', '500'], ['CONS-TAPE-PVC', '40']],
    { reasonCode: 'RCV_PURCHASE', referenceNo: 'PO/2026/0412', counterparty: 'Havells India Ltd' });
  log('Demo data created: 8 substations, 30 items, 5 demo users (password from DEMO_USER_PASSWORD).');
}
