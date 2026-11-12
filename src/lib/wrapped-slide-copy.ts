type FunFact = { kgEach: number; one: string; many: string };

const ADULT_HUMANS: FunFact = { kgEach: 180, one: "adult human", many: "adult humans" };

const FUN_FACTS: readonly FunFact[] = [
  { kgEach: 1500, one: "grand piano", many: "grand pianos" },
  ADULT_HUMANS,
  { kgEach: 5000, one: "Toyota Camry", many: "Toyota Camrys" },
  { kgEach: 6000, one: "African elephant", many: "African elephants" },
  { kgEach: 0.45, one: "stick of butter", many: "sticks of butter" },
  { kgEach: 4.5, one: "bowling ball", many: "bowling balls" },
  { kgEach: 30, one: "golden retriever", many: "golden retrievers" },
  { kgEach: 900, one: "grizzly bear", many: "grizzly bears" },
  { kgEach: 0.05, one: "chicken nugget", many: "chicken nuggets" },
  { kgEach: 320, one: "vending machine", many: "vending machines" },
  { kgEach: 635, one: "concert grand piano", many: "concert grand pianos" },
  { kgEach: 0.028, one: "AA battery", many: "AA batteries" },
  { kgEach: 2000, one: "SmartCar", many: "SmartCars" },
  { kgEach: 0.5, one: "baseball", many: "baseballs" },
  { kgEach: 150, one: "refrigerator", many: "refrigerators" },
  { kgEach: 0.2, one: "banana", many: "bananas" },
  { kgEach: 80, one: "Labrador Retriever", many: "Labrador Retrievers" },
  { kgEach: 5.5, one: "house cat", many: "house cats" },
  { kgEach: 113, one: "keg of beer", many: "kegs of beer" },
  { kgEach: 0.007, one: "paperclip", many: "paperclips" },
  { kgEach: 20, one: "car tire", many: "car tires" },
  { kgEach: 45000, one: "school bus", many: "school buses" },
  { kgEach: 0.14, one: "iPhone", many: "iPhones" },
];

function factCount(fact: FunFact, kg: number): number {
  return Math.round(kg / fact.kgEach);
}

function factSentence(fact: FunFact, kg: number): string {
  const count = factCount(fact, kg);
  return `That's ${count.toLocaleString()} ${count === 1 ? fact.one : fact.many}`;
}

export function pickFunFact(totalWeightLifted: number, random: () => number = Math.random): string {
  const fitting = FUN_FACTS.filter((fact) => factCount(fact, totalWeightLifted) >= 1);
  const pick = fitting[Math.floor(random() * fitting.length)] ?? ADULT_HUMANS;
  return factSentence(pick, totalWeightLifted);
}

export type AccuracyTier = "ELITE" | "SOLID" | "GROWING";

export function accuracyTier(makePercentage: number): AccuracyTier {
  if (makePercentage >= 80) return "ELITE";
  if (makePercentage >= 60) return "SOLID";
  return "GROWING";
}

export type AttemptIdentity = { title: string; description: string };

export function attemptIdentity(favoriteAttempt: string): AttemptIdentity {
  switch (favoriteAttempt) {
    case "1st":
      return {
        title: "THE OPENER",
        description: "You're an opener specialist.\nConfident and locked in from the start.",
      };
    case "2nd":
      return {
        title: "THE BUILDER",
        description: "The second attempt is your sweet spot.\nBuild, then strike.",
      };
    case "3rd":
      return {
        title: "THE CLOSER",
        description: "You save the best for last.\nClutch performer.",
      };
    default:
      return { title: "THE LIFTER", description: "Every attempt counts." };
  }
}

export function easedCounterValue(progress: number, target: number, decimals: number): number {
  const eased = 1 - Math.pow(1 - progress, 3);
  const scale = Math.pow(10, decimals);
  return Math.round(eased * target * scale) / scale;
}

export function formatCounterValue(value: number, decimals: number): string {
  return decimals > 0
    ? value.toFixed(decimals)
    : value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
