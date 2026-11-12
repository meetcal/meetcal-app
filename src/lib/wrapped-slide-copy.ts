type FunFact = (kg: number) => string;

const adultHumansFact: FunFact = (kg) => `That's ${Math.round(kg / 180).toLocaleString()} adult humans`;

const FUN_FACTS: readonly FunFact[] = [
  (kg) => `That's ${Math.round(kg / 1500).toLocaleString()} grand pianos`,
  adultHumansFact,
  (kg) => `That's ${Math.round(kg / 5000).toLocaleString()} Toyota Camrys`,
  (kg) => `That's ${Math.round(kg / 6000).toLocaleString()} African elephants`,
  (kg) => `That's ${Math.round(kg / 0.45).toLocaleString()} sticks of butter`,
  (kg) => `That's ${Math.round(kg / 4.5).toLocaleString()} bowling balls`,
  (kg) => `That's ${Math.round(kg / 30).toLocaleString()} golden retrievers`,
  (kg) => `That's ${Math.round(kg / 900).toLocaleString()} grizzly bears`,
  (kg) => `That's ${Math.round(kg / 0.05).toLocaleString()} chicken nuggets`,
  (kg) => `That's ${Math.round(kg / 320).toLocaleString()} vending machines`,
  (kg) => `That's ${Math.round(kg / 635).toLocaleString()} concert grand pianos`,
  (kg) => `That's ${Math.round(kg / 0.028).toLocaleString()} AA batteries`,
  (kg) => `That's ${Math.round(kg / 2000).toLocaleString()} SmartCars`,
  (kg) => `That's ${Math.round(kg / 0.5).toLocaleString()} baseballs`,
  (kg) => `That's ${Math.round(kg / 150).toLocaleString()} refrigerators`,
  (kg) => `That's ${Math.round(kg / 0.2).toLocaleString()} bananas`,
  (kg) => `That's ${Math.round(kg / 80).toLocaleString()} Labrador Retrievers`,
  (kg) => `That's ${Math.round(kg / 5.5).toLocaleString()} house cats`,
  (kg) => `That's ${Math.round(kg / 113).toLocaleString()} kegs of beer`,
  (kg) => `That's ${Math.round(kg / 0.007).toLocaleString()} paperclips`,
  (kg) => `That's ${Math.round(kg / 20).toLocaleString()} car tires`,
  (kg) => `That's ${Math.round(kg / 45000).toLocaleString()} school buses`,
  (kg) => `That's ${Math.round(kg / 0.14).toLocaleString()} iPhones`,
];

function countsAtLeastOne(fact: FunFact, kg: number): boolean {
  return parseInt(fact(kg).replace(/\D/g, "")) >= 1;
}

export function pickFunFact(totalWeightLifted: number, random: () => number = Math.random): string {
  const fitting = FUN_FACTS.filter((fact) => countsAtLeastOne(fact, totalWeightLifted));
  const pick = fitting[Math.floor(random() * fitting.length)] ?? adultHumansFact;
  return pick(totalWeightLifted);
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
