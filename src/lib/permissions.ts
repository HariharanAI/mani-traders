export const ROLES = [
  { key: "OWNER", name: "Owner", description: "Full access to everything, including financial overview, employees and settings." },
  { key: "ADMIN", name: "Admin", description: "Manages customers, suppliers, transactions, products and invoices." },
  { key: "EMPLOYEE", name: "Employee", description: "Daily counter work: sales entries, payments, permitted customers." },
] as const;
export type RoleKey = (typeof ROLES)[number]["key"];

export const PERMISSIONS = [
  { key: "dashboard.financials", group: "Dashboard", description: "View financial overview and business metrics" },
  { key: "customers.view", group: "Customers", description: "View customers (assigned customers only, unless 'view all')" },
  { key: "customers.view_all", group: "Customers", description: "View all customers, not just assigned ones" },
  { key: "customers.manage", group: "Customers", description: "Add and edit customers" },
  { key: "customers.archive", group: "Customers", description: "Archive / restore customers" },
  { key: "suppliers.view", group: "Suppliers", description: "View suppliers and payables" },
  { key: "suppliers.manage", group: "Suppliers", description: "Add, edit and archive suppliers" },
  { key: "ledger.view", group: "Khata", description: "View khata / ledger entries" },
  { key: "ledger.create", group: "Khata", description: "Add khata entries (credit, adjustments, opening balance)" },
  { key: "ledger.reverse", group: "Khata", description: "Reverse (correct) khata entries" },
  { key: "payments.receive", group: "Payments", description: "Record payments received" },
  { key: "payments.make", group: "Payments", description: "Record payments made" },
  { key: "payments.reverse", group: "Payments", description: "Reverse payments" },
  { key: "sales.view", group: "Sales", description: "View sales and invoices" },
  { key: "sales.create", group: "Sales", description: "Create sales" },
  { key: "sales.cancel", group: "Sales", description: "Cancel invoices" },
  { key: "sales.return", group: "Sales", description: "Record sales returns" },
  { key: "purchases.view", group: "Purchases", description: "View purchases" },
  { key: "purchases.create", group: "Purchases", description: "Create purchases" },
  { key: "purchases.cancel", group: "Purchases", description: "Cancel purchases" },
  { key: "inventory.view", group: "Inventory", description: "View products and stock" },
  { key: "inventory.manage", group: "Inventory", description: "Add, edit and archive products" },
  { key: "inventory.adjust", group: "Inventory", description: "Stock in / out / adjustments" },
  { key: "inventory.negative", group: "Inventory", description: "Allow selling below zero stock" },
  { key: "expenses.view", group: "Expenses", description: "View expenses" },
  { key: "expenses.manage", group: "Expenses", description: "Add, edit and void expenses" },
  { key: "reports.view", group: "Reports", description: "View and export reports" },
  { key: "messages.send", group: "WhatsApp", description: "Send WhatsApp reminders, statements, invoices" },
  { key: "employees.manage", group: "Administration", description: "Manage employees and their access" },
  { key: "settings.manage", group: "Administration", description: "Change business settings" },
  { key: "audit.view", group: "Administration", description: "View audit log" },
] as const;
export type Permission = (typeof PERMISSIONS)[number]["key"];

const ALL = PERMISSIONS.map((p) => p.key) as Permission[];

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  OWNER: ALL,
  ADMIN: [
    "customers.view", "customers.view_all", "customers.manage", "customers.archive",
    "suppliers.view", "suppliers.manage",
    "ledger.view", "ledger.create", "ledger.reverse",
    "payments.receive", "payments.make", "payments.reverse",
    "sales.view", "sales.create", "sales.cancel", "sales.return",
    "purchases.view", "purchases.create", "purchases.cancel",
    "inventory.view", "inventory.manage", "inventory.adjust",
    "expenses.view", "expenses.manage",
    "messages.send",
  ],
  EMPLOYEE: [
    "customers.view", "customers.manage",
    "ledger.view", "payments.receive",
    "sales.view", "sales.create",
    "inventory.view", "messages.send",
  ],
};
