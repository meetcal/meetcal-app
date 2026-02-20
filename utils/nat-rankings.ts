import { Gender } from "@/types/nat-rankings";

export function getWeightClasses(gender: Gender, ageGroup: string): string[] {
    let prefix = `Open ${gender}`;
  
    switch (ageGroup) {
      case "U11":
        prefix = `${gender}'s 11 Under Age Group`;
        break;
      case "U13":
        prefix = `${gender}'s 13 Under Age Group`;
        break;
      case "U15":
        prefix = `${gender}'s 14-15 Age Group`;
        break;
      case "U17":
        prefix = `${gender}'s 16-17 Age Group`;
        break;
      case "Junior":
        prefix = `Junior ${gender}`;
        break;
      case "Senior":
        prefix = `Open ${gender}`;
        break;
      case "Masters 35":
        prefix = `${gender}'s Masters (35-39)`;
        break;
      case "Masters 40":
        prefix = `${gender}'s Masters (40-44)`;
        break;
      case "Masters 45":
        prefix = `${gender}'s Masters (45-49)`;
        break;
      case "Masters 50":
        prefix = `${gender}'s Masters (50-54)`;
        break;
      case "Masters 55":
        prefix = `${gender}'s Masters (55-59)`;
        break;
      case "Masters 60":
        prefix = `${gender}'s Masters (60-64)`;
        break;
      case "Masters 65":
        prefix = `${gender}'s Masters (65-69)`;
        break;
      case "Masters 70":
        prefix = `${gender}'s Masters (70-74)`;
        break;
      case "Masters 75":
        prefix = `${gender}'s Masters (75-79)`;
        break;
      case "Masters 80":
        prefix = `${gender}'s Masters (80-84)`;
        break;
      case "Masters 85":
        prefix = `${gender}'s Masters (85-89)`;
        break;
      case "Masters 90+":
        prefix = `${gender}'s Masters (90+)`;
        break;
      default:
        prefix = `Open ${gender}`;
    }
  
    switch (`${gender}-${ageGroup}`) {
      case "Men-Masters 35":
      case "Men-Masters 40":
      case "Men-Masters 45":
      case "Men-Masters 50":
      case "Men-Masters 55":
      case "Men-Masters 60":
      case "Men-Masters 65":
      case "Men-Masters 70":
      case "Men-Masters 75":
      case "Men-Masters 80":
      case "Men-Masters 85":
      case "Men-Masters 90+":
        return [
          "60kg",
          "65kg",
          "71kg",
          "79kg",
          "88kg",
          "94kg",
          "110kg",
          "110+kg",
        ].map((w) => `${prefix} ${w}`);
      case "Women-Masters 35":
      case "Women-Masters 40":
      case "Women-Masters 45":
      case "Women-Masters 50":
      case "Women-Masters 55":
      case "Women-Masters 60":
      case "Women-Masters 65":
      case "Women-Masters 70":
      case "Women-Masters 75":
      case "Women-Masters 80":
      case "Women-Masters 85":
      case "Women-Masters 90+":
        return [
          "48kg",
          "53kg",
          "58kg",
          "63kg",
          "69kg",
          "77kg",
          "86kg",
          "86+kg",
        ].map((w) => `${prefix} ${w}`);
      case "Men-Junior":
      case "Men-Senior":
        return [
          "60kg",
          "65kg",
          "71kg",
          "79kg",
          "88kg",
          "94kg",
          "110kg",
          "110+kg",
        ].map((w) => `${prefix}'s ${w}`);
      case "Women-Junior":
      case "Women-Senior":
        return [
          "48kg",
          "53kg",
          "58kg",
          "63kg",
          "69kg",
          "77kg",
          "86kg",
          "86+kg",
        ].map((w) => `${prefix}'s ${w}`);
      case "Men-U17":
        return [
          "56kg",
          "60kg",
          "65kg",
          "71kg",
          "79kg",
          "88kg",
          "94kg",
          "94+kg",
        ].map((w) => `${prefix} ${w}`);
      case "Women-U17":
        return [
          "44kg",
          "48kg",
          "53kg",
          "58kg",
          "63kg",
          "69kg",
          "77kg",
          "77+kg",
        ].map((w) => `${prefix} ${w}`);
      case "Men-U15":
        return [
          "48kg",
          "52kg",
          "56kg",
          "60kg",
          "65kg",
          "71kg",
          "79kg",
          "79+kg",
        ].map((w) => `${prefix} ${w}`);
      case "Women-U15":
        return [
          "40kg",
          "44kg",
          "48kg",
          "53kg",
          "58kg",
          "63kg",
          "69kg",
          "69+kg",
        ].map((w) => `${prefix} ${w}`);
      case "Men-U13":
      case "Men-U11":
        return [
          "40kg",
          "44kg",
          "48kg",
          "52kg",
          "56kg",
          "60kg",
          "65kg",
          "65+kg",
        ].map((w) => `${prefix} ${w}`);
      case "Women-U13":
      case "Women-U11":
        return [
          "36kg",
          "40kg",
          "44kg",
          "48kg",
          "53kg",
          "58kg",
          "63kg",
          "63+kg",
        ].map((w) => `${prefix} ${w}`);
      default:
        return [];
    }
  }