export type Platform = 'Red' | 'White' | 'Blue' | 'Stars' | 'Stripes' | 'Rogue';

export interface LiftResult {
  memberId: string;
  name: string;
  age: number;
  club: string;
  gender: string;
  //group: string;
  weightClass: string;
  entryTotal: number;
  session?: {
    number: number;
    platform: Platform;
  };
}

export const liftingResults: LiftResult[] = [
  //10/11 65-80
  { memberId: "1033583", name: "Beth Lamoreaux", age: 65, club: "BASA Weightlifting", gender: "Female", weightClass: "55kg", entryTotal: 88, session: {number: 1, platform: "Red"} },
  { memberId: "200053", name: "Valerie Matsunaga", age: 68, club: "HI PERFORMANCE ATHLETICS", gender: "Female", weightClass: "55kg", entryTotal: 68, session: {number: 1, platform: "Red"} },
  { memberId: "138564", name: "Kellie Moylan", age: 65, club: "1Kilo", gender: "Female", weightClass: "59kg", entryTotal: 72, session: {number: 1, platform: "Red"} },
  { memberId: "1068806", name: "Carrie Thompson", age: 67, club: "5 Rings Barbell", gender: "Female", weightClass: "64kg", entryTotal: 70, session: {number: 1, platform: "Red"} },
  { memberId: "1071965", name: "Kate Mitchell", age: 66, club: "Brave Barbells N Sprinkles WLC", gender: "Female", weightClass: "64kg", entryTotal: 70, session: {number: 1, platform: "Red"} },
  { memberId: "1078277", name: "Kim Washington", age: 67, club: "Optimus Barbell Club", gender: "Female", weightClass: "64kg", entryTotal: 60, session: {number: 1, platform: "Red"} },
  { memberId: "1000883", name: "Laurie Nelson", age: 80, club: "Polaris Weightlifting", gender: "Female", weightClass: "71kg", entryTotal: 64, session: {number: 1, platform: "Red"} },
  { memberId: "172047", name: "Holly Arrow", age: 70, club: "Eastside Barbell", gender: "Female", weightClass: "71kg", entryTotal: 100, session: {number: 1, platform: "Red"} },
  { memberId: "1045185", name: "Bennie Jarvis", age: 66, club: "Unaffiliated", gender: "Female", weightClass: "76kg", entryTotal: 78, session: {number: 1, platform: "Red"} },
  { memberId: "1066549", name: "Doncella Young", age: 66, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "87kg", entryTotal: 80, session: {number: 1, platform: "Red"} },
  { memberId: "1007364", name: "Deborah Strobel", age: 67, club: "Pure Health Barbell", gender: "Female", weightClass: "87kg", entryTotal: 98, session: {number: 1, platform: "Red"} },

];