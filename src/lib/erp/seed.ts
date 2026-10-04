// Seed data for the sandbox hiring desk of Gipfel AI (a fictional ETH Zurich spin-off).
// Two application sets: "expert" (the session the expert demonstrates) and
// "learner" (cases the expert never showed, used in the teach phase).

export type ErpSet = "expert" | "learner";

export type CandidateStatus = "open" | "advanced" | "on_hold" | "escalated" | "rejected";

export type Track = "standard" | "fast" | "research";

// `label` is the full option text in the form, `short` is used in event summaries.
export const TRACKS: { value: Track; label: string; short: string }[] = [
  { value: "standard", label: "Standard loop", short: "Standard loop" },
  { value: "fast", label: "Fast track (founder interview)", short: "Fast track" },
  { value: "research", label: "Research track", short: "Research track" },
];

export type WorkEntry = {
  period: string; // "2021 to today"
  title: string;
  employer: string;
  detail: string;
};

export type EducationEntry = {
  degree: string; // "MSc"
  field: string; // "Computer Science"
  university: string; // exactly "ETH Zurich", "UZH", "EPFL"
  years: string; // "2019 to 2021"
  detail: string;
};

export type EditableFields = {
  track: Track;
  interviewer: string;
  note: string;
};

export type Candidate = {
  id: string; // "C-101"
  name: string;
  role: string; // role applied for
  degree: string; // highest degree, "MSc"
  university: string; // where the highest degree is from
  yearsExperience: number;
  hasProductionMl: boolean;
  productionMlYears: number;
  // Where the production ML was shipped, "a logistics company". Empty when there is none.
  productionMlAt: string;
  salaryExpectation: number; // CHF per year
  currentEmployer: string;
  // Relation of the current employer to Gipfel AI, shown as a badge.
  employerRelation: "investor" | "customer" | null;
  referrer: string | null; // employee who referred the candidate
  referralNote: string;
  workHistory: WorkEntry[];
  education: EducationEntry[];
  coverLetter: string; // one line from the cover letter
  hobbies: string;
  defaultTrack: Track;
  status: CandidateStatus;
  // Last saved values. They change only when an action is confirmed.
  saved: EditableFields;
  // What the form currently shows. Differs from `saved` while there are unsaved changes.
  draft: EditableFields;
};

type SeedCandidate = Omit<Candidate, "status" | "saved" | "draft">;

const ROLE = "ML Engineer";

const EXPERT: SeedCandidate[] = [
  {
    id: "C-101",
    name: "Nina Baumann",
    role: ROLE,
    degree: "MSc",
    university: "ETH Zurich",
    yearsExperience: 4,
    hasProductionMl: true,
    productionMlYears: 4,
    productionMlAt: "a logistics company",
    salaryExpectation: 125000,
    currentEmployer: "Cargoline AG",
    employerRelation: null,
    referrer: null,
    referralNote: "",
    workHistory: [
      {
        period: "2022 to today",
        title: "Senior ML Engineer",
        employer: "Cargoline AG (logistics)",
        detail: "Owns the recommender system for load matching. In production, 2 million requests per day.",
      },
      {
        period: "2021 to 2022",
        title: "ML Engineer",
        employer: "Cargoline AG (logistics)",
        detail: "Built and shipped the first version of the recommender system, including monitoring and retraining.",
      },
    ],
    education: [
      { degree: "MSc", field: "Computer Science", university: "ETH Zurich", years: "2019 to 2021", detail: "Thesis on ranking models. Grade 5.6." },
      { degree: "BSc", field: "Computer Science", university: "ETH Zurich", years: "2016 to 2019", detail: "" },
    ],
    coverLetter: "Uses the word \"synergy\" once and apologises for it in the next sentence.",
    hobbies: "Photographs marmots. Claims they are easier to label than customer data.",
    defaultTrack: "standard",
  },
  {
    id: "C-102",
    name: "Jonas Meier",
    role: ROLE,
    degree: "MSc",
    university: "UZH",
    yearsExperience: 2,
    hasProductionMl: false,
    productionMlYears: 0,
    productionMlAt: "",
    salaryExpectation: 110000,
    currentEmployer: "Zurisee Analytics GmbH",
    employerRelation: null,
    referrer: null,
    referralNote: "",
    workHistory: [
      {
        period: "2023 to today",
        title: "Data Scientist",
        employer: "Zurisee Analytics GmbH",
        detail: "Churn analyses and dashboards for retail clients. Models stay in notebooks, nothing shipped to production.",
      },
    ],
    education: [
      { degree: "MSc", field: "Informatics", university: "UZH", years: "2021 to 2023", detail: "Thesis on customer segmentation. Grade 5.3." },
      { degree: "BSc", field: "Informatics", university: "UZH", years: "2018 to 2021", detail: "" },
    ],
    coverLetter: "Describes UZH as \"like ETH, but with better coffee and a shorter walk\".",
    hobbies: "Competitive fondue. Says the notebooks are \"production-adjacent\".",
    defaultTrack: "standard",
  },
  {
    id: "C-103",
    name: "Priya Nair",
    role: ROLE,
    degree: "PhD",
    university: "EPFL",
    yearsExperience: 3,
    hasProductionMl: false,
    productionMlYears: 0,
    productionMlAt: "",
    salaryExpectation: 120000,
    currentEmployer: "EPFL Machine Learning Lab",
    employerRelation: null,
    referrer: "Luca",
    referralNote: "Luca (ML engineer at Gipfel AI) shared an office with her at a summer school and says she reviews code faster than CI runs.",
    workHistory: [
      {
        period: "2022 to today",
        title: "Research Scientist",
        employer: "EPFL Machine Learning Lab",
        detail: "3 years of research on efficient transformers. Four papers, research code only, nothing shipped to production.",
      },
    ],
    education: [
      { degree: "PhD", field: "Machine Learning", university: "EPFL", years: "2018 to 2022", detail: "Thesis on model compression." },
      { degree: "MSc", field: "Data Science", university: "EPFL", years: "2016 to 2018", detail: "" },
    ],
    coverLetter: "Mentions \"state of the art\" five times, with a citation each time.",
    hobbies: "Thanked the lab coffee machine in her thesis acknowledgements. Sails on Lake Geneva.",
    defaultTrack: "standard",
  },
];

const LEARNER: SeedCandidate[] = [
  {
    id: "C-110",
    name: "Marco Rossi",
    role: ROLE,
    degree: "PhD",
    university: "ETH Zurich",
    yearsExperience: 5,
    hasProductionMl: true,
    productionMlYears: 5,
    productionMlAt: "a bank",
    salaryExpectation: 135000,
    currentEmployer: "Bank Limmat AG",
    employerRelation: null,
    referrer: null,
    referralNote: "",
    workHistory: [
      {
        period: "2020 to today",
        title: "Lead ML Engineer",
        employer: "Bank Limmat AG (bank)",
        detail: "Fraud detection models for card payments. In production for 5 years, scores every transaction in under 40 ms.",
      },
    ],
    education: [
      { degree: "PhD", field: "Computer Science", university: "ETH Zurich", years: "2016 to 2020", detail: "Thesis on anomaly detection in time series." },
      { degree: "MSc", field: "Computer Science", university: "ETH Zurich", years: "2014 to 2016", detail: "" },
    ],
    coverLetter: "States that his models are \"robust, scalable and punctual\".",
    hobbies: "Optimises his commute against the SBB timetable. Current record: 11 seconds of waiting.",
    defaultTrack: "standard",
  },
  {
    id: "C-111",
    name: "Sara Keller",
    role: ROLE,
    degree: "MSc",
    university: "UZH",
    yearsExperience: 3,
    hasProductionMl: false,
    productionMlYears: 0,
    productionMlAt: "",
    salaryExpectation: 115000,
    currentEmployer: "Medisana Insights AG",
    employerRelation: null,
    referrer: null,
    referralNote: "",
    workHistory: [
      {
        period: "2022 to today",
        title: "Data Scientist",
        employer: "Medisana Insights AG",
        detail: "Forecasting studies and reports for health insurers. Prototypes only, nothing shipped to production.",
      },
    ],
    education: [
      { degree: "MSc", field: "Informatics", university: "UZH", years: "2020 to 2022", detail: "Thesis on demand forecasting. Grade 5.5." },
      { degree: "BSc", field: "Informatics", university: "UZH", years: "2017 to 2020", detail: "" },
    ],
    coverLetter: "Notes that she has been up to the ETH main building once, \"for the view\".",
    hobbies: "Bakes sourdough and keeps a changelog for the starter.",
    defaultTrack: "standard",
  },
  {
    id: "C-112",
    name: "David Chen",
    role: ROLE,
    degree: "MSc",
    university: "ETH Zurich",
    yearsExperience: 2,
    hasProductionMl: false,
    productionMlYears: 0,
    productionMlAt: "",
    salaryExpectation: 118000,
    currentEmployer: "Helvetia Ventures",
    employerRelation: "investor",
    referrer: null,
    referralNote: "",
    workHistory: [
      {
        period: "2023 to today",
        title: "ML Analyst",
        employer: "Helvetia Ventures (investor in Gipfel AI)",
        detail: "Internal models that score startup pitches. Used by the investment team, nothing shipped to production.",
      },
    ],
    education: [
      { degree: "MSc", field: "Data Science", university: "ETH Zurich", years: "2021 to 2023", detail: "Thesis on graph neural networks. Grade 5.4." },
      { degree: "BSc", field: "Mathematics", university: "ETH Zurich", years: "2018 to 2021", detail: "" },
    ],
    coverLetter: "Contains the word \"disruptive\" three times in the first paragraph.",
    hobbies: "Has a spreadsheet that ranks every Mensa at ETH. UZH Mensa listed under \"other\".",
    defaultTrack: "standard",
  },
  {
    id: "C-113",
    name: "Lea Fischer",
    role: ROLE,
    degree: "BSc",
    university: "ETH Zurich",
    yearsExperience: 1,
    hasProductionMl: false,
    productionMlYears: 0,
    productionMlAt: "",
    salaryExpectation: 95000,
    currentEmployer: "Alpenblick Software AG",
    employerRelation: null,
    referrer: null,
    referralNote: "",
    workHistory: [
      {
        period: "2024 to today",
        title: "Junior Software Engineer",
        employer: "Alpenblick Software AG",
        detail: "Backend services in Python. Some data pipelines, no ML shipped to production.",
      },
    ],
    education: [
      { degree: "BSc", field: "Computer Science", university: "ETH Zurich", years: "2021 to 2024", detail: "Bachelor thesis on image classification. Grade 5.2." },
    ],
    coverLetter: "Promises \"end-to-end ownership\" and, refreshingly, explains what she means by it.",
    hobbies: "Trained a classifier that tells Rösti from hash browns. 97 percent accuracy, tested at home.",
    defaultTrack: "standard",
  },
];

function hydrate(seed: SeedCandidate): Candidate {
  const fields: EditableFields = { track: seed.defaultTrack, interviewer: "", note: "" };
  return { ...seed, status: "open", saved: { ...fields }, draft: { ...fields } };
}

// Returns a fresh, independent copy of the seed data.
export function seedCandidates(): Record<ErpSet, Candidate[]> {
  const copy = (list: SeedCandidate[]) => (JSON.parse(JSON.stringify(list)) as SeedCandidate[]).map(hydrate);
  return { expert: copy(EXPERT), learner: copy(LEARNER) };
}
