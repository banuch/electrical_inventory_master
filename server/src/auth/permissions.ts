// Permission catalogue. Roles are bundles of these; code checks permissions, never role names.
export const PERMISSIONS = {
  'admin.users': 'Create and manage user accounts, role and substation assignments',
  'admin.roles': 'Manage roles and their permissions',
  'admin.reconcile': 'Run ledger vs balance reconciliation',
  'master.substations': 'Create and edit substations',
  'master.items': 'Create and edit Item Master, categories and units',
  'inventory.view': 'View inventory, documents and history of substations in scope',
  'inventory.global_view': 'See stock quantities at every substation in search and availability',
  'stock.opening': 'Post opening stock (controlled migration activity)',
  'stock.receive': 'Post material receipts',
  'stock.issue': 'Post material issues / consumption',
  'stock.return': 'Post material returns',
  'stock.adjust': 'Post stock adjustments / corrections',
  'stock.scrap': 'Post damage / scrap write-offs',
  'stock.reverse': 'Reverse posted documents',
  'stock.min_levels': 'Maintain substation minimum and reorder levels',
  'audit.view': 'View audit log and login history in scope',
  'reports.export': 'Export data to CSV',
} as const;

export type Permission = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const DEFAULT_ROLES: { code: string; name: string; description: string; permissions: Permission[] }[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Administrator',
    description: 'Organization-wide technical and security administration',
    permissions: ALL,
  },
  {
    code: 'INVENTORY_ADMIN',
    name: 'Inventory Administrator',
    description: 'Organization-wide inventory administration, Item Master and corrections',
    permissions: ALL.filter((p) => p !== 'admin.roles' && p !== 'admin.users'),
  },
  {
    code: 'SUBSTATION_INCHARGE',
    name: 'Substation In-Charge',
    description: 'Responsible for assigned substations; corrections, scrap and reversals',
    permissions: [
      'inventory.view', 'inventory.global_view', 'stock.adjust', 'stock.scrap', 'stock.reverse',
      'stock.min_levels', 'audit.view', 'reports.export',
    ],
  },
  {
    code: 'STOREKEEPER',
    name: 'Storekeeper / Operator',
    description: 'Day-to-day receipts, issues and returns at assigned substations',
    permissions: ['inventory.view', 'inventory.global_view', 'stock.receive', 'stock.issue', 'stock.return', 'reports.export'],
  },
  {
    code: 'VIEWER',
    name: 'Viewer / Auditor',
    description: 'Read-only access to inventory, reports and audit data in scope',
    permissions: ['inventory.view', 'inventory.global_view', 'audit.view', 'reports.export'],
  },
];
