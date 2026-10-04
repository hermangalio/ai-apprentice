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
  university: string; // exactly "ETH Zurich", "UZH", "EPFL", "HEC Lausanne"
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
  // Final grade of the highest degree on the Swiss scale: 6.0 is best, 4.0 is the pass mark.
  finalGrade: number;
  gradeNote: string; // "Summa cum laude", "Passed on the second attempt". Empty when there is nothing to add.
  yearsExperience: number;
  hasProductionMl: boolean;
  productionMlYears: number;
  // Where the production ML was shipped, "Limmat Robotics AG". Empty when there is none.
  productionMlAt: string;
  salaryExpectation: number; // CHF per year
  currentEmployer: string; // "none" when the candidate has no employer
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
    degree: "BSc",
    university: "ETH Zurich",
    finalGrade: 4.0,
    gradeNote: "Passed on the second attempt",
    yearsExperience: 0,
    hasProductionMl: false,
    productionMlYears: 0,
    productionMlAt: "",
    salaryExpectation: 125000,
    currentEmployer: "none",
    employerRelation: null,
    referrer: null,
    referralNote: "",
    workHistory: [],
    education: [
      {
        degree: "BSc",
        field: "Computer Science",
        university: "ETH Zurich",
        years: "2021 to 2026",
        detail: "Final grade 4.0. Passed on the second attempt.",
      },
    ],
    coverLetter: "States that she \"attended most lectures\".",
    hobbies: "Sitting on the Polyterrasse. Lists it under \"fieldwork\".",
    defaultTrack: "standard",
  },
  {
    id: "C-102",
    name: "Jonas Meier",
    role: ROLE,
    degree: "PhD",
    university: "UZH",
    finalGrade: 6.0,
    gradeNote: "Summa cum laude",
    yearsExperience: 6,
    hasProductionMl: true,
    productionMlYears: 6,
    productionMlAt: "Limmat Robotics AG",
    salaryExpectation: 110000,
    currentEmployer: "Limmat Robotics AG",
    employerRelation: null,
    referrer: null,
    referralNote: "",
    workHistory: [
      {
        period: "2020 to today",
        title: "Staff ML Engineer",
        employer: "Limmat Robotics AG",
        detail: "Leads the perception models on every robot the company ships. 6 years in production, retrained weekly, no outage on record.",
      },
    ],
    education: [
      {
        degree: "PhD",
        field: "Machine Learning",
        university: "UZH",
        years: "2016 to 2020",
        detail: "Summa cum laude, final grade 6.0. Three best-paper awards.",
      },
      { degree: "MSc", field: "Informatics", university: "UZH", years: "2014 to 2016", detail: "Final grade 6.0." },
    ],
    coverLetter: "Three best-paper awards. His thesis is on exactly the model Gipfel AI builds.",
    hobbies: "Maintains the open-source library the Gipfel AI product depends on. Calls it a weekend project.",
    defaultTrack: "standard",
  },
  {
    id: "C-103",
    name: "Priya Nair",
    role: ROLE,
    degree: "PhD",
    university: "EPFL",
    finalGrade: 5.5,
    gradeNote: "",
    yearsExperience: 3,
    hasProductionMl: false,
    productionMlYears: 0,
    productionMlAt: "",
    salaryExpectation: 120000,
    currentEmployer: "EPFL",
    employerRelation: null,
    referrer: "Luca",
    referralNote: "Luca (ML engineer at Gipfel AI) shared an office with her at a summer school and says she reviews code faster than CI runs.",
    workHistory: [
      {
        period: "2023 to today",
        title: "Research Scientist",
        employer: "EPFL, Machine Learning Lab",
        detail: "3 years of research on efficient transformers. Four papers, research code only, nothing shipped to production.",
      },
    ],
    education: [
      { degree: "PhD", field: "Machine Learning", university: "EPFL", years: "2019 to 2023", detail: "Thesis on model compression. Final grade 5.5." },
      { degree: "MSc", field: "Data Science", university: "EPFL", years: "2017 to 2019", detail: "" },
    ],
    coverLetter: "Mentions \"state of the art\" five times, with a citation each time.",
    hobbies: "Thanked the lab coffee machine in her thesis acknowledgements. Sails on Lake Geneva.",
    defaultTrack: "standard",
  },
  {
    id: "C-104",
    name: "Maxime Dubois",
    role: ROLE,
    degree: "BSc",
    university: "HEC Lausanne",
    finalGrade: 4.0,
    gradeNote: "",
    yearsExperience: 0,
    hasProductionMl: false,
    productionMlYears: 0,
    productionMlAt: "",
    salaryExpectation: 140000,
    currentEmployer: "none",
    employerRelation: null,
    referrer: null,
    referralNote: "",
    workHistory: [],
    education: [{ degree: "BSc", field: "Management", university: "HEC Lausanne", years: "2022 to 2026", detail: "Final grade 4.0." }],
    coverLetter: "Describes himself as \"AI-curious\". Lists \"Excel (advanced)\" under machine learning.",
    hobbies: "Networking. Has read the first chapter of several books on AI strategy.",
    defaultTrack: "standard",
  },
];

const LEARNER: SeedCandidate[] = [
  {
    id: "C-110",
    name: "Marco Rossi",
    role: ROLE,
    degree: "MSc",
    university: "ETH Zurich",
    finalGrade: 4.25,
    gradeNote: "",
    yearsExperience: 1,
    hasProductionMl: false,
    productionMlYears: 0,
    productionMlAt: "",
    salaryExpectation: 120000,
    currentEmployer: "Alpenblick Software AG",
    employerRelation: null,
    referrer: null,
    referralNote: "",
    workHistory: [
      {
        period: "2025 to today",
        title: "Junior Software Engineer",
        employer: "Alpenblick Software AG",
        detail: "Maintains internal dashboards. Once renamed a column in a training set. Nothing shipped to production.",
      },
    ],
    education: [
      { degree: "MSc", field: "Computer Science", university: "ETH Zurich", years: "2022 to 2025", detail: "Final grade 4.25. Thesis handed in on the last possible day." },
      { degree: "BSc", field: "Computer Science", university: "ETH Zurich", years: "2018 to 2022", detail: "" },
    ],
    coverLetter: "Explains that grades \"do not capture his potential\". Attaches a photo of the ETH main building.",
    hobbies: "Optimises his commute against the SBB timetable. Current record: 11 seconds of waiting.",
    defaultTrack: "standard",
  },
  {
    id: "C-111",
    name: "Sara Keller",
    role: ROLE,
    degree: "PhD",
    university: "UZH",
    finalGrade: 6.0,
    gradeNote: "Summa cum laude",
    yearsExperience: 8,
    hasProductionMl: true,
    productionMlYears: 8,
    productionMlAt: "Medisana Insights AG",
    salaryExpectation: 115000,
    currentEmployer: "Medisana Insights AG",
    employerRelation: null,
    referrer: null,
    referralNote: "",
    workHistory: [
      {
        period: "2018 to today",
        title: "Principal ML Engineer",
        employer: "Medisana Insights AG",
        detail: "Built and runs the forecasting models used by health insurers across Switzerland. 8 years in production.",
      },
    ],
    education: [
      { degree: "PhD", field: "Machine Learning", university: "UZH", years: "2014 to 2018", detail: "Summa cum laude, final grade 6.0. NeurIPS paper from the thesis." },
      { degree: "MSc", field: "Informatics", university: "UZH", years: "2012 to 2014", detail: "Final grade 6.0." },
    ],
    coverLetter: "Mentions her NeurIPS paper in a footnote. Notes that she has been up to the ETH main building once, \"for the view\".",
    hobbies: "Bakes sourdough and keeps a changelog for the starter.",
    defaultTrack: "standard",
  },
  {
    id: "C-112",
    name: "David Chen",
    role: ROLE,
    degree: "MSc",
    university: "EPFL",
    finalGrade: 5.0,
    gradeNote: "",
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
        period: "2024 to today",
        title: "ML Analyst",
        employer: "Helvetia Ventures (investor in Gipfel AI)",
        detail: "Internal models that score startup pitches. Used by the investment team, nothing shipped to production.",
      },
    ],
    education: [
      { degree: "MSc", field: "Data Science", university: "EPFL", years: "2022 to 2024", detail: "Thesis on graph neural networks. Final grade 5.0." },
      { degree: "BSc", field: "Mathematics", university: "EPFL", years: "2019 to 2022", detail: "" },
    ],
    coverLetter: "Contains the word \"disruptive\" three times in the first paragraph.",
    hobbies: "Keeps a spreadsheet that ranks every pitch deck he has seen. Gipfel AI is in the top ten.",
    defaultTrack: "standard",
  },
  {
    id: "C-113",
    name: "Lea Fischer",
    role: ROLE,
    degree: "MSc",
    university: "University of Bern",
    finalGrade: 5.0,
    gradeNote: "",
    yearsExperience: 2,
    hasProductionMl: false,
    productionMlYears: 0,
    productionMlAt: "",
    salaryExpectation: 105000,
    currentEmployer: "Aare Software AG",
    employerRelation: null,
    referrer: null,
    referralNote: "",
    workHistory: [
      {
        period: "2024 to today",
        title: "Software Engineer",
        employer: "Aare Software AG",
        detail: "Backend services in Python. Some data pipelines, no ML shipped to production.",
      },
    ],
    education: [
      { degree: "MSc", field: "Computer Science", university: "University of Bern", years: "2022 to 2024", detail: "Thesis on image classification. Final grade 5.0." },
      { degree: "BSc", field: "Computer Science", university: "University of Bern", years: "2019 to 2022", detail: "" },
    ],
    coverLetter: "Promises \"end-to-end ownership\" and, refreshingly, explains what she means by it.",
    hobbies: "Trained a classifier that tells Rösti from hash browns. 97 percent accuracy, tested at home.",
    defaultTrack: "standard",
  },
  {
    id: "C-114",
    name: "Chloé Martin",
    role: ROLE,
    degree: "BSc",
    university: "HEC Lausanne",
    finalGrade: 4.0,
    gradeNote: "",
    yearsExperience: 0,
    hasProductionMl: false,
    productionMlYears: 0,
    productionMlAt: "",
    salaryExpectation: 135000,
    currentEmployer: "none",
    employerRelation: null,
    referrer: null,
    referralNote: "",
    workHistory: [],
    education: [{ degree: "BSc", field: "Management", university: "HEC Lausanne", years: "2022 to 2026", detail: "Final grade 4.0." }],
    coverLetter: "Calls a pivot table \"a kind of neural network, if you think about it\".",
    hobbies: "Writes LinkedIn posts about the future of AI. Three so far, all with the same chart.",
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
