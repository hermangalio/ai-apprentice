// Seed data for the sandbox accounts payable system.
// Two invoice sets: "expert" (the session the expert demonstrates) and
// "learner" (cases the expert never showed, used in the teach phase).

export type ErpSet = "expert" | "learner";

export type InvoiceStatus = "open" | "posted" | "on_hold" | "awaiting_approval";

export type CostCenter = { code: string; name: string };

export const COST_CENTERS: CostCenter[] = [
  { code: "4711", name: "Opex General" },
  { code: "4720", name: "Opex Maintenance" },
  { code: "0400", name: "Capex Equipment" },
];

export type Supplier = {
  name: string;
  country: string; // ISO code, "DE"
  countryName: string;
  isGroupCompany: boolean;
  known: boolean; // false: not in the supplier master yet
};

export type PurchaseOrder = {
  number: string;
  amount: number;
  description: string;
  goodsReceipt: string;
};

export type HistoryEntry = {
  id: string;
  date: string; // ISO date
  amount: number;
  description: string;
  paidDate: string; // ISO date
};

export type EditableFields = {
  costCenter: string;
  assetNumber: string;
  note: string;
};

export type Invoice = {
  id: string;
  supplier: Supplier;
  amount: number; // EUR
  date: string; // ISO date
  description: string;
  category: string; // "equipment" | "consumables" | "services"
  defaultCostCenter: string;
  purchaseOrder: PurchaseOrder | null;
  history: HistoryEntry[];
  status: InvoiceStatus;
  // Last saved values. They change only when an action button is pressed.
  saved: EditableFields;
  // What the form currently shows. Differs from `saved` while there are unsaved changes.
  draft: EditableFields;
};

type SeedInvoice = Omit<Invoice, "status" | "saved" | "draft">;

const kessler: Supplier = {
  name: "Kessler Werkzeugtechnik GmbH",
  country: "DE",
  countryName: "Germany",
  isGroupCompany: false,
  known: true,
};

const brandt: Supplier = {
  name: "Brandt Industriebedarf",
  country: "DE",
  countryName: "Germany",
  isGroupCompany: false,
  known: true,
};

const novak: Supplier = {
  name: "Novák Strojírna s.r.o.",
  country: "CZ",
  countryName: "Czech Republic",
  isGroupCompany: true,
  known: true,
};

const hartmann: Supplier = {
  name: "Hartmann Fördertechnik GmbH",
  country: "DE",
  countryName: "Germany",
  isGroupCompany: false,
  known: true,
};

const reuter: Supplier = {
  name: "Reuter Prüftechnik UG",
  country: "DE",
  countryName: "Germany",
  isGroupCompany: false,
  known: false,
};

const schwarz: Supplier = {
  name: "Schwarz Betriebsbedarf GmbH",
  country: "DE",
  countryName: "Germany",
  isGroupCompany: false,
  known: true,
};

const EXPERT: SeedInvoice[] = [
  {
    id: "4471",
    supplier: kessler,
    amount: 6840,
    date: "2025-12-01",
    description: "CNC tool holder set",
    category: "equipment",
    defaultCostCenter: "4711",
    purchaseOrder: {
      number: "PO-8812",
      amount: 6840,
      description: "CNC tool holder set, 24 pieces",
      goodsReceipt: "Received in full on 27.11.2025",
    },
    history: [
      { id: "4388", date: "2025-10-14", amount: 2115.4, description: "Milling cutters", paidDate: "2025-10-30" },
      { id: "4251", date: "2025-08-05", amount: 980, description: "Collet chucks", paidDate: "2025-08-21" },
    ],
  },
  {
    id: "4472",
    supplier: brandt,
    amount: 1260,
    date: "2025-12-02",
    description: "Hydraulic fittings",
    category: "consumables",
    defaultCostCenter: "4711",
    purchaseOrder: {
      number: "PO-8790",
      amount: 1260,
      description: "Hydraulic fittings, assorted",
      goodsReceipt: "Received in full on 30.10.2025",
    },
    history: [
      { id: "4409", date: "2025-11-04", amount: 1260, description: "Hydraulic fittings", paidDate: "2025-11-18" },
      { id: "4310", date: "2025-09-30", amount: 742.5, description: "Seals and O-rings", paidDate: "2025-10-21" },
      { id: "4102", date: "2024-12-03", amount: 615, description: "Hose couplings", paidDate: "2024-12-19" },
      { id: "4087", date: "2024-11-12", amount: 615, description: "Hose couplings", paidDate: "2024-11-26" },
    ],
  },
  {
    id: "4473",
    supplier: novak,
    amount: 3950,
    date: "2025-12-03",
    description: "Machining services, November",
    category: "services",
    defaultCostCenter: "4711",
    purchaseOrder: {
      number: "PO-8835",
      amount: 3950,
      description: "Contract machining, November",
      goodsReceipt: "Service confirmed on 28.11.2025",
    },
    history: [
      { id: "4395", date: "2025-11-03", amount: 4120, description: "Machining services, October", paidDate: "2025-11-20" },
      { id: "4302", date: "2025-10-02", amount: 3780, description: "Machining services, September", paidDate: "2025-10-17" },
    ],
  },
];

const LEARNER: SeedInvoice[] = [
  {
    id: "4480",
    supplier: hartmann,
    amount: 7200,
    date: "2025-12-08",
    description: "Conveyor drive unit",
    category: "equipment",
    defaultCostCenter: "4711",
    purchaseOrder: {
      number: "PO-8851",
      amount: 7200,
      description: "Conveyor drive unit, line 3",
      goodsReceipt: "Received in full on 04.12.2025",
    },
    history: [
      { id: "4296", date: "2025-09-22", amount: 1340, description: "Conveyor belt rollers", paidDate: "2025-10-08" },
    ],
  },
  {
    id: "4481",
    supplier: brandt,
    amount: 890,
    date: "2025-12-09",
    description: "Pneumatic couplings",
    category: "consumables",
    defaultCostCenter: "4711",
    purchaseOrder: {
      number: "PO-8822",
      amount: 890,
      description: "Pneumatic couplings, assorted",
      goodsReceipt: "Received in full on 14.11.2025",
    },
    history: [
      { id: "4431", date: "2025-11-17", amount: 890, description: "Pneumatic couplings", paidDate: "2025-11-25" },
      { id: "4409", date: "2025-11-04", amount: 1260, description: "Hydraulic fittings", paidDate: "2025-11-18" },
      { id: "4310", date: "2025-09-30", amount: 742.5, description: "Seals and O-rings", paidDate: "2025-10-21" },
    ],
  },
  {
    id: "4482",
    supplier: reuter,
    amount: 2300,
    date: "2025-12-09",
    description: "Calibration service for measuring equipment",
    category: "services",
    defaultCostCenter: "4711",
    purchaseOrder: null,
    history: [],
  },
  {
    id: "4483",
    supplier: schwarz,
    amount: 412.6,
    date: "2025-12-10",
    description: "Cutting oil and cleaning supplies",
    category: "consumables",
    defaultCostCenter: "4711",
    purchaseOrder: {
      number: "PO-8860",
      amount: 412.6,
      description: "Cutting oil 20 l, cleaning supplies",
      goodsReceipt: "Received in full on 05.12.2025",
    },
    history: [
      { id: "4418", date: "2025-11-10", amount: 388.2, description: "Cutting oil and rags", paidDate: "2025-11-24" },
      { id: "4333", date: "2025-10-08", amount: 295, description: "Cleaning supplies", paidDate: "2025-10-22" },
    ],
  },
];

function hydrate(seed: SeedInvoice): Invoice {
  const fields: EditableFields = { costCenter: seed.defaultCostCenter, assetNumber: "", note: "" };
  return { ...seed, status: "open", saved: { ...fields }, draft: { ...fields } };
}

// Returns a fresh, independent copy of the seed data.
export function seedInvoices(): Record<ErpSet, Invoice[]> {
  const copy = (list: SeedInvoice[]) => (JSON.parse(JSON.stringify(list)) as SeedInvoice[]).map(hydrate);
  return { expert: copy(EXPERT), learner: copy(LEARNER) };
}
