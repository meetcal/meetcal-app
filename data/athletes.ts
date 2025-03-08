// Define a union type for all platforms
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

  //13/12 60
  { memberId: "1052137", name: "Akiko Stojek", age: 60, club: "Marble Weightlifting", gender: "Female", weightClass: "49kg", entryTotal: 74, session: {number: 2, platform: "Red"} },
  { memberId: "1074410", name: "gaby morgerman", age: 62, club: "Unaffiliated", gender: "Female", weightClass: "55kg", entryTotal: 57, session: {number: 2, platform: "Red"} },
  { memberId: "1041132", name: "Laura Seals", age: 62, club: "Eastside Barbell", gender: "Female", weightClass: "59kg", entryTotal: 68, session: {number: 2, platform: "Red"} },
  { memberId: "214727", name: "Deanna Johnson", age: 61, club: "Eastside Barbell", gender: "Female", weightClass: "59kg", entryTotal: 78, session: {number: 2, platform: "Red"} },
  { memberId: "170912", name: "Tierney Korotkin", age: 64, club: "Team Aita", gender: "Female", weightClass: "64kg", entryTotal: 90, session: {number: 2, platform: "Red"} },
  { memberId: "1077789", name: "Maureen O'Hagan", age: 60, club: "Cully Strength", gender: "Female", weightClass: "64kg", entryTotal: 77, session: {number: 2, platform: "Red"} },
  { memberId: "1042417", name: "Debbie Bennett", age: 61, club: "Pilchuck Barbell", gender: "Female", weightClass: "64kg", entryTotal: 72, session: {number: 2, platform: "Red"} },
  { memberId: "1045301", name: "Barbara Kazmierczak", age: 61, club: "Unaffiliated", gender: "Female", weightClass: "71kg", entryTotal: 85, session: {number: 2, platform: "Red"} },
  { memberId: "192383", name: "Litsa Olsson", age: 64, club: "Unaffiliated", gender: "Female", weightClass: "71kg", entryTotal: 105, session: {number: 2, platform: "Red"} },
  { memberId: "1061107", name: "Margaret binzer", age: 64, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "76kg", entryTotal: 98, session: {number: 2, platform: "Red"} },
  { memberId: "171116", name: "Gwen Chamberlin", age: 62, club: "Summit Barbell", gender: "Female", weightClass: "81kg", entryTotal: 90, session: {number: 2, platform: "Red"} },
  { memberId: "204710", name: "Debbie Alexander", age: 63, club: "CLEAN SLATE WEIGHTLIFTING", gender: "Female", weightClass: "+87kg", entryTotal: 90, session: {number: 2, platform: "Red"} },


  //w55 45-64, 8/8
  { memberId: "1015618", name: "Alexandra Weill", age: 57, club: "People's Republic of The Dojo", gender: "Female", weightClass: "55kg", entryTotal: 100, session: {number: 3, platform: "Red"} },
  { memberId: "220349", name: "Jennifer Nelson", age: 55, club: "Unaffiliated", gender: "Female", weightClass: "55kg", entryTotal: 100, session: {number: 3, platform: "Red"} },
  { memberId: "1019014", name: "Elizabeth Weil", age: 59, club: "MILLER WEIGHTLIFTING", gender: "Female", weightClass: "55kg", entryTotal: 70, session: {number: 3, platform: "Red"} },
  { memberId: "1058230", name: "Judith Anzaldo", age: 59, club: "PRECISION BARBELL", gender: "Female", weightClass: "59kg", entryTotal: 80, session: {number: 3, platform: "Red"} },
  { memberId: "1079950", name: "Nicole Devine", age: 58, club: "FOUNDATION BARBELL", gender: "Female", weightClass: "59kg", entryTotal: 75, session: {number: 3, platform: "Red"} },
  { memberId: "1014547", name: "Michelle Picking", age: 56, club: "Team SAW", gender: "Female", weightClass: "64kg", entryTotal: 130, session: {number: 3, platform: "Red"} },
  { memberId: "1072884", name: "LeAlyce Miller", age: 58, club: "Pilchuck Barbell", gender: "Female", weightClass: "64kg", entryTotal: 100, session: {number: 3, platform: "Red"} },
  { memberId: "1017548", name: "Evelyn Knight", age: 55, club: "Southern California Weightlifting Club", gender: "Female", weightClass: "64kg", entryTotal: 100, session: {number: 3, platform: "Red"} },


  //w55 71-+87, 10/11
  { memberId: "212824", name: "Gladys Spaulding", age: 56, club: "McKenna Weightlifting", gender: "Female", weightClass: "71kg", entryTotal: 85, session: {number: 4, platform: "Red"} },
  { memberId: "1058478", name: "Helen Shiver", age: 57, club: "Butcher Barbell", gender: "Female", weightClass: "71kg", entryTotal: 80, session: {number: 4, platform: "Red"} },
  { memberId: "1056265", name: "Halelly Azulay", age: 55, club: "PRECISION BARBELL", gender: "Female", weightClass: "71kg", entryTotal: 110, session: {number: 4, platform: "Red"} },
  { memberId: "221757", name: "Lisa Barrow", age: 55, club: "Vardanian Weightlifting", gender: "Female", weightClass: "71kg", entryTotal: 100, session: {number: 4, platform: "Red"} },
  { memberId: "1009713", name: "Kirstin Boddy", age: 56, club: "Eastside Barbell", gender: "Female", weightClass: "76kg", entryTotal: 89, session: {number: 4, platform: "Red"} },
  { memberId: "1058789", name: "Vicki Piper", age: 58, club: "Unaffiliated", gender: "Female", weightClass: "76kg", entryTotal: 131, session: {number: 4, platform: "Red"} },
  { memberId: "1043340", name: "Krista Dornbush", age: 56, club: "Southern California Weightlifting Club", gender: "Female", weightClass: "81kg", entryTotal: 110, session: {number: 4, platform: "Red"} },
  { memberId: "1071871", name: "Kelley Howell", age: 57, club: "Eastside Barbell", gender: "Female", weightClass: "81kg", entryTotal: 100, session: {number: 4, platform: "Red"} },
  { memberId: "207271", name: "Jana Berhow", age: 58, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "+87kg", entryTotal: 96, session: {number: 4, platform: "Red"} },
  { memberId: "1048954", name: "Anna Cannington", age: 58, club: "EAST COAST GOLD W/L TEAM", gender: "Female", weightClass: "87kg", entryTotal: 110, session: {number: 4, platform: "Red"} },



  //w50 45-59, 9/9
  { memberId: "1011426", name: "Janet Chow", age: 50, club: "Oly Concepts", gender: "Female", weightClass: "45kg", entryTotal: 70, session: {number: 5, platform: "Red"} },
  { memberId: "1076734", name: "Julie Carmody", age: 52, club: "Tri State Barbell", gender: "Female", weightClass: "45kg", entryTotal: 75, session: {number: 5, platform: "Red"} },
  { memberId: "1058695", name: "Holly Kauffman", age: 54, club: "GARAGE STRENGTH", gender: "Female", weightClass: "49kg", entryTotal: 80, session: {number: 5, platform: "Red"} },
  { memberId: "204436", name: "Annia Velazquez", age: 52, club: "Unaffiliated", gender: "Female", weightClass: "55kg", entryTotal: 135, session: {number: 5, platform: "Red"} },
  { memberId: "1077607", name: "Barbara Brewer", age: 53, club: "Unaffiliated", gender: "Female", weightClass: "55kg", entryTotal: 93, session: {number: 5, platform: "Red"} },
  { memberId: "170840", name: "Jara MacDermott", age: 50, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "59kg", entryTotal: 136, session: {number: 5, platform: "Red"} },
  { memberId: "165099", name: "Mira Kwon", age: 54, club: "Haworth Weightlifting", gender: "Female", weightClass: "59kg", entryTotal: 125, session: {number: 5, platform: "Red"} },
  { memberId: "1070509", name: "pamela gagnon", age: 51, club: "Unaffiliated", gender: "Female", weightClass: "59kg", entryTotal: 117, session: {number: 5, platform: "Red"} },
  { memberId: "1058542", name: "Wendi Lubinus", age: 54, club: "Tacoma Strength Weightlifting", gender: "Female", weightClass: "59kg", entryTotal: 83, session: {number: 5, platform: "Red"} },


  //w50, 64-71, 10/9
  { memberId: "159150", name: "Amy Farrell", age: 51, club: "MASS Strength", gender: "Female", weightClass: "64kg", entryTotal: 135, session: {number: 5, platform: "Blue"} },
  { memberId: "1016600", name: "Deanna Montalbano", age: 52, club: "Unaffiliated", gender: "Female", weightClass: "64kg", entryTotal: 105, session: {number: 5, platform: "Blue"} },
  { memberId: "1069262", name: "Amy Herrera", age: 52, club: "Attitude Nation Barbell Club", gender: "Female", weightClass: "64kg", entryTotal: 95, session: {number: 5, platform: "Blue"} },
  { memberId: "187109", name: "Christie McNair", age: 50, club: "Unaffiliated", gender: "Female", weightClass: "71kg", entryTotal: 135, session: {number: 5, platform: "Blue"} },
  { memberId: "1020772", name: "Katherine Brown", age: 50, club: "Haworth Weightlifting", gender: "Female", weightClass: "71kg", entryTotal: 160, session: {number: 5, platform: "Blue"} },
  { memberId: "188945", name: "Margaret Dubbin", age: 51, club: "BlueWave Weightlifting", gender: "Female", weightClass: "71kg", entryTotal: 110, session: {number: 5, platform: "Blue"} },
  { memberId: "1067251", name: "Tatiana Nikitina", age: 55, club: "Manhattan Barbell", gender: "Female", weightClass: "71kg", entryTotal: 110, session: {number: 5, platform: "Blue"} },
  { memberId: "1039859", name: "Melanie Kent", age: 51, club: "KC WEIGHTLIFTING", gender: "Female", weightClass: "71kg", entryTotal: 115, session: {number: 5, platform: "Blue"} },
  { memberId: "1060657", name: "Tressie Mullins", age: 52, club: "HEAVY METAL BARBELL", gender: "Female", weightClass: "71kg", entryTotal: 139 , session: {number: 5, platform: "Blue"}},
  { memberId: "1056433", name: "Jolene Bollman", age: 51, club: "CROSSFIT FORT VANCOUVER BARBELL CLUB", gender: "Female", weightClass: "71kg", entryTotal: 117, session: {number: 5, platform: "Blue"} },


//w45 45-55, 11/10
{ memberId: "1022126", name: "Heather Thrush", age: 48, club: "RUBBER CITY WEIGHTLIFTING", gender: "Female", weightClass: "49kg", entryTotal: 118, session: {number: 7, platform: "Red"} },
{ memberId: "219390", name: "Erica Treadway", age: 48, club: "Team SAW", gender: "Female", weightClass: "49kg", entryTotal: 109, session: {number: 7, platform: "Red"} },
{ memberId: "141816", name: "Melissa Sue Jutras Kamphake", age: 45, club: "EAST COAST GOLD W/L TEAM", gender: "Female", weightClass: "49kg", entryTotal: 108, session: {number: 7, platform: "Red"} },
{ memberId: "120641", name: "Kelly Rexroad", age: 47, club: "WILLIAMS WEIGHTLIFTING", gender: "Female", weightClass: "49kg", entryTotal: 101, session: {number: 7, platform: "Red"} },
{ memberId: "1058462", name: "Huyen-Lam Nguyen", age: 48, club: "Catalyst Masters", gender: "Female", weightClass: "49kg", entryTotal: 85, session: {number: 7, platform: "Red"} },
{ memberId: "1054459", name: "Lauren Storck", age: 47, club: "ATLANTA PERFORMANCE", gender: "Female", weightClass: "55kg", entryTotal: 125, session: {number: 7, platform: "Red"} },
{ memberId: "218544", name: "Rebecca Anderson", age: 45, club: "Catalyst Masters", gender: "Female", weightClass: "55kg", entryTotal: 125, session: {number: 7, platform: "Red"} },
{ memberId: "1055512", name: "Karen Agena", age: 44, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "55kg", entryTotal: 110, session: {number: 7, platform: "Red"} },
{ memberId: "170653", name: "ANGELA TUCKER", age: 48, club: "HEAVY METAL BARBELL", gender: "Female", weightClass: "55kg", entryTotal: 110, session: {number: 7, platform: "Red"} },
{ memberId: "1074083", name: "Samantha Mosher", age: 45, club: "Unaffiliated", gender: "Female", weightClass: "55kg", entryTotal: 98, session: {number: 7, platform: "Red"} },
{ memberId: "1002622", name: "Merenciana Paulus", age: 45, club: "Jake Pudenz Strength & Power", gender: "Female", weightClass: "55kg", entryTotal: 90, session: {number: 7, platform: "Red"} },



//w35 45-55
  { memberId: "1065358", name: "Tracy Liu", age: 35, club: "Wellbuilt Strength", gender: "Female", weightClass: "45kg", entryTotal: 79, session: {number: 18, platform: "Red"} },
  { memberId: "1073410", name: "Hannah Sirdofsky", age: 38, club: "West Chester Weightlifting", gender: "Female", weightClass: "49kg", entryTotal: 90, session: {number: 18, platform: "Red"} },
  { memberId: "154480", name: "Suzy Sanchez", age: 35, club: "The Retirement Home", gender: "Female", weightClass: "55kg", entryTotal: 120, session: {number: 18, platform: "Red"} },
  { memberId: "1067064", name: "Marissa Reeves", age: 36, club: "Unaffiliated", gender: "Female", weightClass: "55kg", entryTotal: 115, session: {number: 18, platform: "Red"} },
  { memberId: "1076309", name: "Danielle Funaro", age: 38, club: "Stay Golden Barbell", gender: "Female", weightClass: "55kg", entryTotal: 115, session: {number: 18, platform: "Red"} },
  { memberId: "1049602", name: "Alyson Weidmann", age: 37, club: "Built By Becker Weightlifting Club", gender: "Female", weightClass: "55kg", entryTotal: 114, session: {number: 18, platform: "Red"} },
  { memberId: "1073644", name: "Amy Livingston", age: 39, club: "Heroic Barbell", gender: "Female", weightClass: "55kg", entryTotal: 112, session: {number: 18, platform: "Red"} },
  { memberId: "1057832", name: "Bethany Looney", age: 35, club: "Wolf Pack Weightlifting", gender: "Female", weightClass: "55kg", entryTotal: 111, session: {number: 18, platform: "Red"} },
  { memberId: "1016074", name: "Ashley Bowen", age: 37, club: "Bowen Elite Weightlifting", gender: "Female", weightClass: "55kg", entryTotal: 100, session: {number: 18, platform: "Red"} },


  //w40, 45-55, 8/9
  { memberId: "1078809", name: "Amy Smith", age: 41, club: "Unaffiliated", gender: "Female", weightClass: "55kg", entryTotal: 152, session: {number: 10, platform: "White"}  },
  { memberId: "213487", name: "Katy Large", age: 42, club: "POWER AND GRACE PERFORMANCE.", gender: "Female", weightClass: "55kg", entryTotal: 134 , session: {number: 10, platform: "White"}},
  { memberId: "1066107", name: "Kristin Glab", age: 40, club: "MASS Strength", gender: "Female", weightClass: "55kg", entryTotal: 134, session: {number: 10, platform: "White"} },
  { memberId: "151601", name: "Rachael Bommicino", age: 44, club: "Grow or Die Barbell", gender: "Female", weightClass: "55kg", entryTotal: 127, session: {number: 10, platform: "White"} },
  { memberId: "213908", name: "Emily Lau", age: 40, club: "FOUNDATION BARBELL", gender: "Female", weightClass: "55kg", entryTotal: 123, session: {number: 10, platform: "White"} },
  { memberId: "1047549", name: "Jane Jones", age: 41, club: "Fourteen Forty Collective", gender: "Female", weightClass: "55kg", entryTotal: 119, session: {number: 10, platform: "White"} },
  { memberId: "1007746", name: "Jennifer Fullhart", age: 40, club: "A1 Barbell Club", gender: "Female", weightClass: "49kg", entryTotal: 135, session: {number: 10, platform: "White"} },
  { memberId: "1026496", name: "Nile Franklin", age: 40, club: "Wilder Athletics", gender: "Female", weightClass: "49kg", entryTotal: 130, session: {number: 10, platform: "White"} },


//w45, 59, 12/12
{ memberId: "162704", name: "Rachel Batista", age: 49, club: "Unaffiliated", gender: "Female", weightClass: "59kg", entryTotal: 125, session: {number: 7, platform: "White"} },
{ memberId: "1026840", name: "Heather Albro", age: 49, club: "BLUEGRASS BARBELL CLUB", gender: "Female", weightClass: "59kg", entryTotal: 125, session: {number: 7, platform: "White"} },
{ memberId: "1060484", name: "Lynnette Hull", age: 46, club: "Brave Barbells N Sprinkles WLC", gender: "Female", weightClass: "59kg", entryTotal: 120, session: {number: 7, platform: "White"} },
{ memberId: "1043605", name: "ALEXANDRIA Zikoyanis", age: 45, club: "Unaffiliated", gender: "Female", weightClass: "59kg", entryTotal: 113, session: {number: 7, platform: "White"} },
{ memberId: "1062985", name: "Kamber Sherrod", age: 45, club: "DC WEIGHTLIFTING CLUB", gender: "Female", weightClass: "59kg", entryTotal: 105, session: {number: 7, platform: "White"} },
{ memberId: "1027401", name: "Linda Nguyen", age: 46, club: "HI PERFORMANCE ATHLETICS", gender: "Female", weightClass: "59kg", entryTotal: 104, session: {number: 7, platform: "White"} },
{ memberId: "203090", name: "Kimberly Barham", age: 48, club: "PTW Training", gender: "Female", weightClass: "59kg", entryTotal: 104, session: {number: 7, platform: "White"} },
{ memberId: "1069763", name: "Sally Stephens", age: 47, club: "Echo Weightlifting", gender: "Female", weightClass: "59kg", entryTotal: 97, session: {number: 7, platform: "White"} },
{ memberId: "1076584", name: "Jordan Raymer", age: 46, club: "Siuslaw Strength and Conditioning", gender: "Female", weightClass: "59kg", entryTotal: 92, session: {number: 7, platform: "White"} },
{ memberId: "1078840", name: "Alicia Bryan", age: 48, club: "Unaffiliated", gender: "Female", weightClass: "59kg", entryTotal: 87, session: {number: 7, platform: "White"} },
{ memberId: "212271", name: "Soupha Jones", age: 49, club: "CALAVERA BARBELL", gender: "Female", weightClass: "59kg", entryTotal: 115, session: {number: 7, platform: "White"} },
  { memberId: "1020886", name: "Katherine Hejtmanek", age: 47, club: "Brooklyn Training Hall", gender: "Female", weightClass: "59kg", entryTotal: 145, session: {number: 7, platform: "White"} },



//w40 59, 12/12
  { memberId: "1018007", name: "Joy Munyan", age: 43, club: "HEAVY METAL BARBELL", gender: "Female", weightClass: "59kg", entryTotal: 100, session: {number: 11, platform: "White"} },
  { memberId: "1031154", name: "Mariya Kalishchuk", age: 40, club: "Unaffiliated", gender: "Female", weightClass: "59kg", entryTotal: 110, session: {number: 11, platform: "White"} },
  { memberId: "1065715", name: "Molly Dorrance", age: 43, club: "ALLSOUTH Barbell", gender: "Female", weightClass: "59kg", entryTotal: 110, session: {number: 11, platform: "White"} },
  { memberId: "1073190", name: "Aubrey Raymond", age: 40, club: "Powerhouse Functional Fitness", gender: "Female", weightClass: "59kg", entryTotal: 117, session: {number: 11, platform: "White"} },
  { memberId: "1078041", name: "Maryam Zanbagh", age: 42, club: "Built By Becker Weightlifting Club", gender: "Female", weightClass: "59kg", entryTotal: 130, session: {number: 11, platform: "White"} },
  { memberId: "1065635", name: "Leah EdwArds", age: 44, club: "ALPHA BARBELL", gender: "Female", weightClass: "59kg", entryTotal: 129, session: {number: 11, platform: "White"} },
  { memberId: "209942", name: "Libby Elias", age: 41, club: "Tri State Barbell", gender: "Female", weightClass: "59kg", entryTotal: 140, session: {number: 11, platform: "White"} },
  { memberId: "1036170", name: "Cynthia Rae", age: 40, club: "Down South Barbell", gender: "Female", weightClass: "59kg", entryTotal: 142, session: {number: 11, platform: "White"} },
  { memberId: "1026426", name: "Patricia Lawson", age: 40, club: "Milo Strength Weightlifting Club", gender: "Female", weightClass: "59kg", entryTotal: 146, session: {number: 11, platform: "White"} },
  { memberId: "1049971", name: "Cameron Barden", age: 41, club: "POWER AND GRACE PERFORMANCE.", gender: "Female", weightClass: "59kg", entryTotal: 145, session: {number: 11, platform: "White"} },
  { memberId: "1077592", name: "Tiffany Hoffner", age: 43, club: "BAM Weightlifting Club", gender: "Female", weightClass: "59kg", entryTotal: 115, session: {number: 11, platform: "White"} },
  { memberId: "1062852", name: "Dijana Stojanovski", age: 42, club: "Unaffiliated", gender: "Female", weightClass: "59kg", entryTotal: 104, session: {number: 11, platform: "White"}},


  //w35 59-64 A
  { memberId: "1039718", name: "lydia diggs", age: 36, club: "Jacksonville Weightlifting", gender: "Female", weightClass: "64kg", entryTotal: 154, session: {number: 21, platform: "Red"} },
  { memberId: "1072090", name: "Amanda York", age: 36, club: "ALLSOUTH Barbell", gender: "Female", weightClass: "64kg", entryTotal: 145, session: {number: 21, platform: "Red"} },
  { memberId: "202401", name: "Rachel Garmon", age: 36, club: "McKenna Weightlifting", gender: "Female", weightClass: "64kg", entryTotal: 144, session: {number: 21, platform: "Red"} },
  { memberId: "1076956", name: "Laura Godfrey", age: 37, club: "Unaffiliated", gender: "Female", weightClass: "64kg", entryTotal: 140, session: {number: 21, platform: "Red"} },
  { memberId: "1074605", name: "Kaitlyn Segur", age: 37, club: "People's Republic of The Dojo", gender: "Female", weightClass: "64kg", entryTotal: 135, session: {number: 21, platform: "Red"} },
  { memberId: "1058293", name: "Shayla Ford", age: 39, club: "Eastside Barbell", gender: "Female", weightClass: "64kg", entryTotal: 135, session: {number: 21, platform: "Red"} },
  { memberId: "221237", name: "Julia Falamas", age: 36, club: "Unaffiliated", gender: "Female", weightClass: "64kg", entryTotal: 135, session: {number: 21, platform: "Red"} },
  { memberId: "169922", name: "Samantha Davis", age: 35, club: "BASA Weightlifting", gender: "Female", weightClass: "59kg", entryTotal: 166, session: {number: 21, platform: "Red"} },
  { memberId: "1057771", name: "Tanya LaBell", age: 39, club: "Tri State Barbell", gender: "Female", weightClass: "59kg", entryTotal: 155, session: {number: 21, platform: "Red"} },
  { memberId: "192252", name: "Remedios Timo-Dondoyano", age: 39, club: "Catalyst Masters", gender: "Female", weightClass: "59kg", entryTotal: 140, session: {number: 21, platform: "Red"} },


  //w35 59-64 C
  { memberId: "1052569", name: "Brittany Chudakoff", age: 35, club: "Coffee Weightlifting Team", gender: "Female", weightClass: "59kg", entryTotal: 119, session: {number: 19, platform: "Red"} },
  { memberId: "1011419", name: "Chelsea Eskridge", age: 35, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "59kg", entryTotal: 115, session: {number: 19, platform: "Red"} },
  { memberId: "1027218", name: "Dana Kelly", age: 38, club: "Bexar Barbell", gender: "Female", weightClass: "59kg", entryTotal: 115, session: {number: 19, platform: "Red"} },
  { memberId: "1024371", name: "Stephanie Langdon", age: 37, club: "Wolf Pack Weightlifting", gender: "Female", weightClass: "59kg", entryTotal: 110, session: {number: 19, platform: "Red"} },
  { memberId: "1067513", name: "Meagan Chisholm", age: 39, club: "South Georgia Barbell", gender: "Female", weightClass: "59kg", entryTotal: 108, session: {number: 19, platform: "Red"} },
  { memberId: "1057968", name: "Danielle Gaspar", age: 36, club: "McKenna Weightlifting", gender: "Female", weightClass: "59kg", entryTotal: 105, session: {number: 19, platform: "Red"} },
  { memberId: "1062590", name: "Alyssa Cypher", age: 35, club: "POWER AND GRACE PERFORMANCE.", gender: "Female", weightClass: "59kg", entryTotal: 100, session: {number: 19, platform: "Red"} },
  { memberId: "1073402", name: "Gina Gatlin", age: 39, club: "Greenville Weightlifting", gender: "Female", weightClass: "59kg", entryTotal: 100, session: {number: 19, platform: "Red"} },
  { memberId: "1073635", name: "Lauren Hall", age: 37, club: "Rocket City Lifting", gender: "Female", weightClass: "64kg", entryTotal: 111, session: {number: 19, platform: "Red"} },
  { memberId: "1069929", name: "Andrea Hennings", age: 37, club: "Heartland Strength", gender: "Female", weightClass: "64kg", entryTotal: 104, session: {number: 19, platform: "Red"} },

//w45 64, 10/10
{ memberId: "1015990", name: "Valerie Greenslade", age: 49, club: "Oly Concepts", gender: "Female", weightClass: "64kg", entryTotal: 140, session: {number: 8, platform: "Red"} },
{ memberId: "193544", name: "Crysta Parkin", age: 48, club: "ROCHESTER BARBELL CLUB", gender: "Female", weightClass: "64kg", entryTotal: 137, session: {number: 8, platform: "Red"} },
{ memberId: "1013258", name: "Kelly Smith", age: 46, club: "Boombox Barbell", gender: "Female", weightClass: "64kg", entryTotal: 113, session: {number: 8, platform: "Red"} },
{ memberId: "1031784", name: "Brandi Fallica", age: 48, club: "Southern California Weightlifting Club", gender: "Female", weightClass: "64kg", entryTotal: 110, session: {number: 8, platform: "Red"} },
{ memberId: "1067795", name: "Heidi Siberon", age: 46, club: "Atlas Weightlifting Club", gender: "Female", weightClass: "64kg", entryTotal: 107, session: {number: 8, platform: "Red"} },
{ memberId: "1077877", name: "Jen Kicker", age: 47, club: "Unaffiliated", gender: "Female", weightClass: "64kg", entryTotal: 105, session: {number: 8, platform: "Red"} },
{ memberId: "1053795", name: "Jaime Jones", age: 47, club: "ALLSOUTH Barbell", gender: "Female", weightClass: "64kg", entryTotal: 105, session: {number: 8, platform: "Red"} },
{ memberId: "1079512", name: "Alicia Greer", age: 48, club: "TOUGH TEMPLE BARBELL CLUB", gender: "Female", weightClass: "64kg", entryTotal: 105, session: {number: 8, platform: "Red"} },
{ memberId: "1053717", name: "Carolyn Bryant", age: 46, club: "West Coast Weightlifting", gender: "Female", weightClass: "64kg", entryTotal: 100, session: {number: 8, platform: "Red"} },
{ memberId: "1065191", name: "Natalie Dale", age: 48, club: "Vektløfter Barbell", gender: "Female", weightClass: "64kg", entryTotal: 98, session: {number: 8, platform: "Red"} },


//w40, 64 C 100-120, 11/11
{ memberId: "1003917", name: "Allyson Cochran", age: 43, club: "HEAVY METAL BARBELL", gender: "Female", weightClass: "64kg", entryTotal: 100, session: {number: 10, platform: "Red"} },
{ memberId: "1024113", name: "Jillian Humphreys", age: 43, club: "TOUGH TEMPLE BARBELL CLUB", gender: "Female", weightClass: "64kg", entryTotal: 100, session: {number: 10, platform: "Red"} },
{ memberId: "1048497", name: "Christina Girton", age: 44, club: "Unaffiliated", gender: "Female", weightClass: "64kg", entryTotal: 110, session: {number: 10, platform: "Red"} },
{ memberId: "197990", name: "Christine Kato", age: 40, club: "Southern California Weightlifting Club", gender: "Female", weightClass: "64kg", entryTotal: 106, session: {number: 10, platform: "Red"} },
{ memberId: "1015731", name: "Kathleen Black", age: 42, club: "Wormtown Weightlifting", gender: "Female", weightClass: "64kg", entryTotal: 118, session: {number: 10, platform: "Red"} },
{ memberId: "1072045", name: "Rene Bermudez", age: 41, club: "Cully Strength", gender: "Female", weightClass: "64kg", entryTotal: 116, session: {number: 10, platform: "Red"} },
{ memberId: "1052157", name: "Erica Skinner", age: 41, club: "HEAVY METAL BARBELL", gender: "Female", weightClass: "64kg", entryTotal: 115, session: {number: 10, platform: "Red"} },
{ memberId: "1055769", name: "Juliana Gil", age: 42, club: "TEAM OMNIA", gender: "Female", weightClass: "64kg", entryTotal: 114, session: {number: 10, platform: "Red"} },
{ memberId: "1053744", name: "Christina Tacoronti", age: 41, club: "RVA Weightlifting", gender: "Female", weightClass: "64kg", entryTotal: 112, session: {number: 10, platform: "Red"} },
{ memberId: "1042078", name: "Angela White", age: 44, club: "Unaffiliated", gender: "Female", weightClass: "64kg", entryTotal: 120, session: {number: 10, platform: "Red"} },
{ memberId: "1000798", name: "Shelli Poe", age: 44, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "64kg", entryTotal: 120, session: {number: 10, platform: "Red"} },


//w40 64 B 120-132, 9/10
{ memberId: "1034078", name: "Charlene Sattler", age: 43, club: "Bexar Barbell", gender: "Female", weightClass: "64kg", entryTotal: 125, session: {number: 11, platform: "Red"} },
{ memberId: "1059723", name: "Jillian Wagner-Green", age: 40, club: "Catalyst Masters", gender: "Female", weightClass: "64kg", entryTotal: 125, session: {number: 11, platform: "Red"} },
{ memberId: "203463", name: "Brooke Thompson", age: 40, club: "Unaffiliated", gender: "Female", weightClass: "64kg", entryTotal: 122, session: {number: 11, platform: "Red"} },
{ memberId: "191898", name: "Trina Sumodobila", age: 42, club: "BARBARIAN BARBELL CLUB", gender: "Female", weightClass: "64kg", entryTotal: 121, session: {number: 11, platform: "Red"} },
{ memberId: "195456", name: "Jessica Taylor", age: 42, club: "Team SAW", gender: "Female", weightClass: "64kg", entryTotal: 121, session: {number: 11, platform: "Red"} },
{ memberId: "187344", name: "Lisa Nichols", age: 41, club: "Schuster Athletics", gender: "Female", weightClass: "64kg", entryTotal: 120, session: {number: 11, platform: "Red"} },
{ memberId: "1066878", name: "Jennifer Spafford", age: 41, club: "Kenmore Barbell Club", gender: "Female", weightClass: "64kg", entryTotal: 120, session: {number: 11, platform: "Red"} },
{ memberId: "1035033", name: "Megan Patton", age: 40, club: "Brave Barbells N Sprinkles WLC", gender: "Female", weightClass: "64kg", entryTotal: 132, session: {number: 11, platform: "Red"} },
{ memberId: "1024691", name: "Rachel Bryla", age: 40, club: "Team SAW", gender: "Female", weightClass: "64kg", entryTotal: 132, session: {number: 11, platform: "Red"} },


//w40 64 A, 11/10
  { memberId: "1023608", name: "Abigail Hoskins", age: 43, club: "POWER AND GRACE PERFORMANCE.", gender: "Female", weightClass: "64kg", entryTotal: 168, session: {number: 12, platform: "Red"} },
  { memberId: "1036990", name: "Alise Enriquez", age: 40, club: "Eastside Barbell", gender: "Female", weightClass: "64kg", entryTotal: 166, session: {number: 12, platform: "Red"} },
  { memberId: "194909", name: "Teralyn Carter", age: 40, club: "FRONT RANGE WLC", gender: "Female", weightClass: "64kg", entryTotal: 165, session: {number: 12, platform: "Red"} },
  { memberId: "1060300", name: "Kate Painter", age: 41, club: "Brave Barbells N Sprinkles WLC", gender: "Female", weightClass: "64kg", entryTotal: 151, session: {number: 12, platform: "Red"} },
  { memberId: "150745", name: "Christina Henesian", age: 43, club: "Unaffiliated", gender: "Female", weightClass: "64kg", entryTotal: 148, session: {number: 12, platform: "Red"} },
  { memberId: "1052511", name: "Kristin Maselli", age: 43, club: "Red Eye Barbell Club", gender: "Female", weightClass: "64kg", entryTotal: 148, session: {number: 12, platform: "Red"} },
 { memberId: "1015522", name: "Kelly Nichols", age: 40, club: "BASA Weightlifting", gender: "Female", weightClass: "64kg", entryTotal: 140, session: {number: 12, platform: "Red"} },
  { memberId: "1037118", name: "Erinn Frazer", age: 43, club: "PROJECT LIFT", gender: "Female", weightClass: "64kg", entryTotal: 138, session: {number: 12, platform: "Red"} },
  { memberId: "1070917", name: "Brenda Emery", age: 44, club: "Fourteen Forty Collective", gender: "Female", weightClass: "64kg", entryTotal: 136, session: {number: 12, platform: "Red"} },
  { memberId: "183494", name: "Amy Callori", age: 40, club: "BEANTOWN BARBELL CLUB", gender: "Female", weightClass: "64kg", entryTotal: 133, session: {number: 12, platform: "Red"} },
  { memberId: "1000840", name: "Rebeca Stephenson", age: 40, club: "Oly Concepts", gender: "Female", weightClass: "64kg", entryTotal: 129, session: {number: 12, platform: "Red"} },

//w35 59-64 B
  { memberId: "1065826", name: "Samantha McCauley", age: 39, club: "Unaffiliated", gender: "Female", weightClass: "59kg", entryTotal: 133, session: {number: 20, platform: "Red"} },
  { memberId: "1062813", name: "Priscilla Cavazos", age: 36, club: "Stone Age Barbell Club", gender: "Female", weightClass: "59kg", entryTotal: 120, session: {number: 20, platform: "Red"} },
  { memberId: "1078814", name: "Savannah Quezada", age: 39, club: "Unaffiliated", gender: "Female", weightClass: "64kg", entryTotal: 132, session: {number: 20, platform: "Red"} },
  { memberId: "1008170", name: "Tara Mann", age: 36, club: "Bull City Barbell", gender: "Female", weightClass: "64kg", entryTotal: 131, session: {number: 20, platform: "Red"} },
  { memberId: "1025419", name: "Caitlin Jaeger", age: 37, club: "Wormtown Weightlifting", gender: "Female", weightClass: "64kg", entryTotal: 130, session: {number: 20, platform: "Red"} },
  { memberId: "1058370", name: "Laura Bleiler", age: 35, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "64kg", entryTotal: 127, session: {number: 20, platform: "Red"} },
  { memberId: "1011354", name: "Katelyn Lipa", age: 38, club: "Cherokee Barbell", gender: "Female", weightClass: "64kg", entryTotal: 126, session: {number: 20, platform: "Red"} },
  { memberId: "1075936", name: "Whitney Evans", age: 35, club: "Iron Acres Barbell", gender: "Female", weightClass: "64kg", entryTotal: 120, session: {number: 20, platform: "Red"} },
  { memberId: "1063277", name: "Karisa Hoke", age: 36, club: "JDI BARBELL", gender: "Female", weightClass: "64kg", entryTotal: 120, session: {number: 20, platform: "Red"} },
  { memberId: "1008670", name: "Jeana Boughton", age: 35, club: "Highland Weightlifting", gender: "Female", weightClass: "64kg", entryTotal: 120, session: {number: 20, platform: "Red"} },


//w45 71, 11/11
{ memberId: "1065939", name: "Jennifer Riley", age: 46, club: "Unaffiliated", gender: "Female", weightClass: "71kg", entryTotal: 123, session: {number: 8, platform: "White"} },
{ memberId: "1037487", name: "Samantha Artiga", age: 49, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "71kg", entryTotal: 122, session: {number: 8, platform: "White"} },
{ memberId: "1042155", name: "Alexis Horn", age: 47, club: "Team Aita", gender: "Female", weightClass: "71kg", entryTotal: 117, session: {number: 8, platform: "White"} },
{ memberId: "1079810", name: "Jodi Lin", age: 45, club: "BARBARIAN BARBELL CLUB", gender: "Female", weightClass: "71kg", entryTotal: 112, session: {number: 8, platform: "White"} },
{ memberId: "1068771", name: "Megan Vickery", age: 48, club: "CROSSFIT FORT VANCOUVER BARBELL CLUB", gender: "Female", weightClass: "71kg", entryTotal: 110, session: {number: 8, platform: "White"} },
{ memberId: "1033112", name: "Pennye Stansel", age: 49, club: "HEAVY METAL BARBELL", gender: "Female", weightClass: "71kg", entryTotal: 110, session: {number: 8, platform: "White"} },
{ memberId: "1009124", name: "Kirsten Spargo", age: 45, club: "People's Republic of The Dojo", gender: "Female", weightClass: "71kg", entryTotal: 104, session: {number: 8, platform: "White"} },
{ memberId: "1072118", name: "Alison Blaum", age: 48, club: "PTW Training", gender: "Female", weightClass: "71kg", entryTotal: 100, session: {number: 8, platform: "White"} },
{ memberId: "1067705", name: "Torie Mathis", age: 47, club: "Unaffiliated", gender: "Female", weightClass: "71kg", entryTotal: 100, session: {number: 8, platform: "White"} },
{ memberId: "1049317", name: "Alison Roark", age: 47, club: "Swamp Cabbage Barbell Club", gender: "Female", weightClass: "71kg", entryTotal: 92, session: {number: 8, platform: "White"} },
  { memberId: "125033", name: "Aimee Anaya", age: 48, club: "CATALYST ATHLETICS", gender: "Female", weightClass: "71kg", entryTotal: 155, session: {number: 8, platform: "White"} },


//w40 71 A, 13/13
  { memberId: "1004193", name: "Traci Beaune", age: 40, club: "Optimus Barbell Club", gender: "Female", weightClass: "71kg", entryTotal: 180, session: {number: 15, platform: "Blue"} },
  { memberId: "1041767", name: "Jennifer White", age: 42, club: "POWER AND GRACE PERFORMANCE.", gender: "Female", weightClass: "71kg", entryTotal: 175, session: {number: 15, platform: "Blue"} },
 { memberId: "184726", name: "Laura Meador", age: 43, club: "Unaffiliated", gender: "Female", weightClass: "71kg", entryTotal: 165, session: {number: 15, platform: "Blue"} },
  { memberId: "1009437", name: "Stephanie Jefferson", age: 40, club: "Unaffiliated", gender: "Female", weightClass: "71kg", entryTotal: 165, session: {number: 15, platform: "Blue"} },
  { memberId: "1060262", name: "Angelica Rosales", age: 40, club: "RVA Weightlifting", gender: "Female", weightClass: "71kg", entryTotal: 151, session: {number: 15, platform: "Blue"} },
  { memberId: "215048", name: "Courtney Shoemaker", age: 40, club: "HEAVY METAL BARBELL", gender: "Female", weightClass: "71kg", entryTotal: 150, session: {number: 15, platform: "Blue"} },
  { memberId: "1026471", name: "Corinne Van", age: 41, club: "Root 18 Weightlifting", gender: "Female", weightClass: "71kg", entryTotal: 140, session: {number: 15, platform: "Blue"} },
  { memberId: "186662", name: "Jessica Cummings", age: 43, club: "Providence Barbell Club", gender: "Female", weightClass: "71kg", entryTotal: 138, session: {number: 15, platform: "Blue"} },
  { memberId: "1054280", name: "Kalina Lesseva", age: 40, club: "People's Republic of The Dojo", gender: "Female", weightClass: "71kg", entryTotal: 135, session: {number: 15, platform: "Blue"} },
  { memberId: "1037220", name: "Danielle Ashley", age: 40, club: "DSSC Weightlifting", gender: "Female", weightClass: "71kg", entryTotal: 135, session: {number: 15, platform: "Blue"} },
  { memberId: "1045676", name: "Rebekah Horn", age: 41, club: "Unaffiliated", gender: "Female", weightClass: "71kg", entryTotal: 133, session: {number: 15, platform: "Blue"} },
  { memberId: "1055936", name: "Karen O'Donnell", age: 42, club: "Built By Becker Weightlifting Club", gender: "Female", weightClass: "71kg", entryTotal: 129, session: {number: 15, platform: "Blue"} },
  { memberId: "1069906", name: "Ashley Cullen", age: 42, club: "RVA Weightlifting", gender: "Female", weightClass: "71kg", entryTotal: 127, session: {number: 15, platform: "Blue"} },

  //w40 71 B, 13/13
  { memberId: "1067087", name: "Stormy Weather", age: 41, club: "Unaffiliated", gender: "Female", weightClass: "71kg", entryTotal: 126, session: {number: 13, platform: "Red"} },
  { memberId: "1001910", name: "Daisy May Gutierrez", age: 44, club: "FOUNDATION BARBELL", gender: "Female", weightClass: "71kg", entryTotal: 125, session: {number: 13, platform: "Red"} },
  { memberId: "1078834", name: "Morgan Memmott", age: 43, club: "Unaffiliated", gender: "Female", weightClass: "71kg", entryTotal: 124, session: {number: 13, platform: "Red"} },
  { memberId: "1077440", name: "Nikki Ouellette", age: 40, club: "Wormtown Weightlifting", gender: "Female", weightClass: "71kg", entryTotal: 121, session: {number: 13, platform: "Red"} },
  { memberId: "1029768", name: "Jessica Lake", age: 43, club: "POWER AND GRACE PERFORMANCE.", gender: "Female", weightClass: "71kg", entryTotal: 125, session: {number: 13, platform: "Red"} },
  { memberId: "1077765", name: "Tiffany Pan", age: 41, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "71kg", entryTotal: 120, session: {number: 13, platform: "Red"} },
  { memberId: "1023122", name: "Nastaran Whitson", age: 43, club: "Tri State Barbell", gender: "Female", weightClass: "71kg", entryTotal: 120, session: {number: 13, platform: "Red"} },
  { memberId: "1060482", name: "Andrea Dyar", age: 42, club: "Jake Pudenz Strength & Power", gender: "Female", weightClass: "71kg", entryTotal: 115, session: {number: 13, platform: "Red"} },
  { memberId: "1056754", name: "Roslyn Taylor", age: 44, club: "Littleton Performance Barbell", gender: "Female", weightClass: "71kg", entryTotal: 114, session: {number: 13, platform: "Red"} },
  { memberId: "1073664", name: "Sara Liu", age: 40, club: "Echo Weightlifting", gender: "Female", weightClass: "71kg", entryTotal: 110, session: {number: 13, platform: "Red"} },
  { memberId: "1074590", name: "Charina Vintson", age: 43, club: "Butcher Barbell", gender: "Female", weightClass: "71kg", entryTotal: 109, session: {number: 13, platform: "Red"} },
  { memberId: "1048000", name: "Rachel Romano", age: 43, club: "Unaffiliated", gender: "Female", weightClass: "71kg", entryTotal: 109, session: {number: 13, platform: "Red"} },
  { memberId: "1022456", name: "Jennifer Fite", age: 41, club: "POWER AND GRACE PERFORMANCE.", gender: "Female", weightClass: "71kg", entryTotal: 109, session: {number: 13, platform: "Red"} },

//w35 71 A
  { memberId: "1035943", name: "Christina Richards", age: 38, club: "CATALYST ATHLETICS", gender: "Female", weightClass: "71kg", entryTotal: 170, session: {number: 21, platform: "White"} },
  { memberId: "208175", name: "Amanda Scrementi", age: 37, club: "Team SAW", gender: "Female", weightClass: "71kg", entryTotal: 151, session: {number: 21, platform: "White"} },
  { memberId: "180401", name: "Amanda Street", age: 38, club: "Shoofly Barbell Club", gender: "Female", weightClass: "71kg", entryTotal: 149, session: {number: 21, platform: "White"} },
  { memberId: "1065201", name: "Katy Posithai", age: 37, club: "HEAVY METAL BARBELL", gender: "Female", weightClass: "71kg", entryTotal: 140, session: {number: 21, platform: "White"} },
  { memberId: "1022115", name: "Katie Baldrich", age: 36, club: "KiloDelphia", gender: "Female", weightClass: "71kg", entryTotal: 140, session: {number: 21, platform: "White"} },
  { memberId: "1068471", name: "Esme Hovekamp", age: 37, club: "Unaffiliated", gender: "Female", weightClass: "71kg", entryTotal: 138, session: {number: 21, platform: "White"} },
  { memberId: "1062416", name: "Melissa Lingafeldt", age: 36, club: "HEAVY METAL BARBELL", gender: "Female", weightClass: "71kg", entryTotal: 135, session: {number: 21, platform: "White"} },
  { memberId: "1077258", name: "Kelley Roberts", age: 39, club: "West Georgia Weightlifting", gender: "Female", weightClass: "71kg", entryTotal: 134, session: {number: 21, platform: "White"} },
  { memberId: "1011858", name: "Amelia Obra", age: 38, club: "HI PERFORMANCE ATHLETICS", gender: "Female", weightClass: "71kg", entryTotal: 133, session: {number: 21, platform: "White"} },
  { memberId: "1008759", name: "Cooper Wall", age: 35, club: "Synergy Barbell", gender: "Female", weightClass: "71kg", entryTotal: 131, session: {number: 21, platform: "White"} },
  { memberId: "1077781", name: "Kristina Ho-on", age: 37, club: "Unaffiliated", gender: "Female", weightClass: "71kg", entryTotal: 131, session: {number: 21, platform: "White"} },
{ memberId: "1020077", name: "Georgina Moss", age: 35, club: "EAST COAST GOLD W/L TEAM", gender: "Female", weightClass: "71kg", entryTotal: 130, session: {number: 21, platform: "White"} },

//w35 71 B
{ memberId: "1079843", name: "Nicole Kosakowski", age: 37, club: "Blackheart Barbell", gender: "Female", weightClass: "71kg", entryTotal: 130, session: {number: 19, platform: "Blue"} },
  { memberId: "1034157", name: "ASHLEY KNIGHT", age: 36, club: "BARBARIAN BARBELL CLUB", gender: "Female", weightClass: "71kg", entryTotal: 128, session: {number: 19, platform: "Blue"} },
  { memberId: "1021690", name: "Ashley Burnell", age: 39, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "71kg", entryTotal: 125, session: {number: 19, platform: "Blue"} },
  { memberId: "1058192", name: "Anne Core", age: 36, club: "Full Steam Barbell", gender: "Female", weightClass: "71kg", entryTotal: 120, session: {number: 19, platform: "Blue"} },
  { memberId: "1075479", name: "Christina Belknap", age: 39, club: "Jacksonville Weightlifting", gender: "Female", weightClass: "71kg", entryTotal: 120, session: {number: 19, platform: "Blue"} },
  { memberId: "1009938", name: "Carly Jamieson", age: 38, club: "Butcher Barbell", gender: "Female", weightClass: "71kg", entryTotal: 120, session: {number: 19, platform: "Blue"} },
  { memberId: "1059133", name: "Danielle Gallant", age: 35, club: "Brave Barbells N Sprinkles WLC", gender: "Female", weightClass: "71kg", entryTotal: 115, session: {number: 19, platform: "Blue"} },
  { memberId: "1065562", name: "Monica Long", age: 36, club: "DIESEL WEIGHTLIFTING", gender: "Female", weightClass: "71kg", entryTotal: 115, session: {number: 19, platform: "Blue"} },
  { memberId: "1027461", name: "Danielle Palmer", age: 36, club: "Heartland Strength", gender: "Female", weightClass: "71kg", entryTotal: 115, session: {number: 19, platform: "Blue"} },
  { memberId: "1072475", name: "Delaney Geissinger", age: 36, club: "Carson City Barbell Club", gender: "Female", weightClass: "71kg", entryTotal: 113, session: {number: 19, platform: "Blue"} },
  { memberId: "1073127", name: "Michaela Flaherty", age: 36, club: "FOUNDATION BARBELL", gender: "Female", weightClass: "71kg", entryTotal: 111, session: {number: 19, platform: "Blue"} },
  { memberId: "217909", name: "Laura Dionisio", age: 39, club: "Manhattan Barbell", gender: "Female", weightClass: "71kg", entryTotal: 110, session: {number: 19, platform: "Blue"} },
  { memberId: "206005", name: "Maryann Teichman", age: 39, club: "Cheshire Weightlifting Club", gender: "Female", weightClass: "71kg", entryTotal: 110, session: {number: 19, platform: "Blue"} },



  //w45 76, 7/8
  { memberId: "1045922", name: "Faith Hilterbrand", age: 47, club: "Superfly Barbell Club", gender: "Female", weightClass: "76kg", entryTotal: 125, session: {number: 9, platform: "Red"} },
  { memberId: "199497", name: "Ayse Sukola", age: 45, club: "Cherokee Barbell", gender: "Female", weightClass: "76kg", entryTotal: 125, session: {number: 9, platform: "Red"} },
  { memberId: "1039843", name: "Jewelyn Cabigon", age: 48, club: "HI PERFORMANCE ATHLETICS", gender: "Female", weightClass: "76kg", entryTotal: 120, session: {number: 9, platform: "Red"} },
  { memberId: "1057708", name: "Hanna Estevez", age: 45, club: "Unaffiliated", gender: "Female", weightClass: "76kg", entryTotal: 120, session: {number: 9, platform: "Red"} },
  { memberId: "1015014", name: "Angela Di", age: 48, club: "Catalyst Masters", gender: "Female", weightClass: "76kg", entryTotal: 113, session: {number: 9, platform: "Red"} },
  { memberId: "1079881", name: "Kelley Marsh", age: 48, club: "Down South Barbell", gender: "Female", weightClass: "76kg", entryTotal: 109, session: {number: 9, platform: "Red"} },
  { memberId: "1063240", name: "Misty Hill", age: 49, club: "Vektløfter Barbell", gender: "Female", weightClass: "76kg", entryTotal: 103, session: {number: 9, platform: "Red"} },


//w50 76-87+, 10/10
{ memberId: "1013598", name: "Elisa Leporini", age: 54, club: "SAYRE PARK WLC", gender: "Female", weightClass: "76kg", entryTotal: 123, session: {number: 6, platform: "Blue"} },
{ memberId: "1059448", name: "Gwendolyn Montgomery", age: 50, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "76kg", entryTotal: 116, session: {number: 6, platform: "Blue"} },
{ memberId: "1066238", name: "Tiffany Pezzulo", age: 50, club: "MILLER WEIGHTLIFTING", gender: "Female", weightClass: "76kg", entryTotal: 100, session: {number: 6, platform: "Blue"} },
{ memberId: "1006806", name: "Elizabeth Korchnak", age: 51, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "81kg", entryTotal: 125, session: {number: 6, platform: "Blue"} },
{ memberId: "1036940", name: "Jennifer Valosek", age: 50, club: "CALIFORNIA STRENGTH", gender: "Female", weightClass: "81kg", entryTotal: 125, session: {number: 6, platform: "Blue"} },
{ memberId: "1057718", name: "Chris Brown", age: 54, club: "CLEAN SLATE WEIGHTLIFTING", gender: "Female", weightClass: "81kg", entryTotal: 112, session: {number: 6, platform: "Blue"} },
{ memberId: "1060937", name: "Joy Baganz", age: 51, club: "Unaffiliated", gender: "Female", weightClass: "81kg", entryTotal: 100, session: {number: 6, platform: "Blue"} },
{ memberId: "1053565", name: "Brandy Thomas", age: 51, club: "Unaffiliated", gender: "Female", weightClass: "87kg", entryTotal: 98, session: {number: 6, platform: "Blue"} },
{ memberId: "1015150", name: "Kristina Teel", age: 54, club: "The Strength Shack", gender: "Female", weightClass: "+87kg", entryTotal: 138, session: {number: 6, platform: "Blue"} },
{ memberId: "1003534", name: "Tammy Berry", age: 51, club: "CROSSFIT FORT VANCOUVER BARBELL CLUB", gender: "Female", weightClass: "+87kg", entryTotal: 113, session: {number: 6, platform: "Blue"} },


//w40 76 B 112-137, 11/1
  { memberId: "1055600", name: "Tristin Miller", age: 43, club: "Unaffiliated", gender: "Female", weightClass: "76kg", entryTotal: 112, session: {number: 14, platform: "Red"} },
 { memberId: "1074385", name: "Kristin Brimhall", age: 42, club: "Unaffiliated", gender: "Female", weightClass: "76kg", entryTotal: 123, session: {number: 14, platform: "Red"} },
  { memberId: "213493", name: "Emily Heiberg", age: 41, club: "Industrial Strength WLC", gender: "Female", weightClass: "76kg", entryTotal: 120, session: {number: 14, platform: "Red"} },
  { memberId: "1047314", name: "Tracy Wong", age: 40, club: "FOUNDATION BARBELL", gender: "Female", weightClass: "76kg", entryTotal: 120, session: {number: 14, platform: "Red"} },
  { memberId: "211722", name: "Paige Hernandez", age: 41, club: "CALAVERA BARBELL", gender: "Female", weightClass: "76kg", entryTotal: 120, session: {number: 14, platform: "Red"} },
  { memberId: "1069167", name: "Erica Fenech", age: 43, club: "CLEAN SLATE WEIGHTLIFTING", gender: "Female", weightClass: "76kg", entryTotal: 127, session: {number: 14, platform: "Red"} },
  { memberId: "1077578", name: "Silvia Mangas", age: 43, club: "Unaffiliated", gender: "Female", weightClass: "76kg", entryTotal: 133, session: {number: 14, platform: "Red"} },
  { memberId: "1067597", name: "Lynsey Hathcock", age: 41, club: "Unaffiliated", gender: "Female", weightClass: "76kg", entryTotal: 134, session: {number: 14, platform: "Red"} },
  { memberId: "1040277", name: "Catherine Paulsen", age: 43, club: "FORZA WEIGHTLIFTING CLUB", gender: "Female", weightClass: "76kg", entryTotal: 137, session: {number: 14, platform: "Red"} },
  { memberId: "1039416", name: "Alba Fortuna", age: 41, club: "Unaffiliated", gender: "Female", weightClass: "76kg", entryTotal: 136, session: {number: 14, platform: "Red"} },
  { memberId: "1013597", name: "Brigitte Bieyro", age: 41, club: "LuxFit Barbell Club", gender: "Female", weightClass: "76kg", entryTotal: 135, session: {number: 14, platform: "Red"} },


  //w40 76 A, 10/10
   { memberId: "1001800", name: "Kimberly Andrew", age: 40, club: "Eastside Barbell", gender: "Female", weightClass: "76kg", entryTotal: 170, session: {number: 16, platform: "Red"} },
  { memberId: "1021984", name: "Stephanie Rosario", age: 42, club: "FORZA WEIGHTLIFTING CLUB", gender: "Female", weightClass: "76kg", entryTotal: 160, session: {number: 16, platform: "Red"} },
  { memberId: "1040503", name: "Angie Cornejo", age: 41, club: "Wolf Pack Weightlifting", gender: "Female", weightClass: "76kg", entryTotal: 160, session: {number: 16, platform: "Red"} },
  { memberId: "1066481", name: "Lucille Murphy", age: 41, club: "Gryphon Strength Barbell", gender: "Female", weightClass: "76kg", entryTotal: 160, session: {number: 16, platform: "Red"} },
  { memberId: "1034932", name: "Selena Cearley", age: 43, club: "Bexar Barbell", gender: "Female", weightClass: "76kg", entryTotal: 155, session: {number: 16, platform: "Red"} },
  { memberId: "198976", name: "Cherisse Taylor", age: 43, club: "RFS Barbell", gender: "Female", weightClass: "76kg", entryTotal: 154, session: {number: 16, platform: "Red"} },
  { memberId: "1040164", name: "Jennifer Miller", age: 44, club: "Bexar Barbell", gender: "Female", weightClass: "76kg", entryTotal: 150, session: {number: 16, platform: "Red"} },
  { memberId: "1073209", name: "Lacey Sotelo", age: 43, club: "Jake Pudenz Strength & Power", gender: "Female", weightClass: "76kg", entryTotal: 150, session: {number: 16, platform: "Red"} },
  { memberId: "1033347", name: "Rachel Kremer", age: 43, club: "Superfly Barbell Club", gender: "Female", weightClass: "76kg", entryTotal: 150, session: {number: 16, platform: "Red"} },
  { memberId: "1051976", name: "Jamie Adams", age: 44, club: "Atlas Weightlifting Club", gender: "Female", weightClass: "76kg", entryTotal: 145, session: {number: 16, platform: "Red"} },


  //w35 76-81 B
  { memberId: "1025287", name: "Bethany Farrar", age: 36, club: "Wormtown Weightlifting", gender: "Female", weightClass: "76kg", entryTotal: 135, session: {number: 20, platform: "Blue"} },
  { memberId: "1060832", name: "Reneshawn Whyte", age: 38, club: "CALAVERA BARBELL", gender: "Female", weightClass: "76kg", entryTotal: 130, session: {number: 20, platform: "Blue"} },
  { memberId: "1067238", name: "Hope Justice", age: 38, club: "CLEAN SLATE WEIGHTLIFTING", gender: "Female", weightClass: "76kg", entryTotal: 125, session: {number: 20, platform: "Blue"} },
  { memberId: "1063114", name: "Sherilyn Wilman-DePeña", age: 36, club: "McKenna Weightlifting", gender: "Female", weightClass: "76kg", entryTotal: 120, session: {number: 20, platform: "Blue"} },
  { memberId: "1059340", name: "Jane Kruszewski", age: 38, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "76kg", entryTotal: 117, session: {number: 20, platform: "Blue"} },
  { memberId: "1080333", name: "Alice Agnew", age: 35, club: "COASTAL EMPIRE WEIGHTLIFTING", gender: "Female", weightClass: "76kg", entryTotal: 116, session: {number: 20, platform: "Blue"} },
  { memberId: "1057948", name: "Raquel Barreto", age: 39, club: "McKenna Weightlifting", gender: "Female", weightClass: "76kg", entryTotal: 115, session: {number: 20, platform: "Blue"} },
  { memberId: "1069925", name: "Grace Chin", age: 39, club: "Unaffiliated", gender: "Female", weightClass: "76kg", entryTotal: 115, session: {number: 20, platform: "Blue"} },
  { memberId: "1052959", name: "Ashley Castro", age: 35, club: "Millennium Weightlifting", gender: "Female", weightClass: "76kg", entryTotal: 115, session: {number: 20, platform: "Blue"} },
  { memberId: "1069999", name: "Rebecca Murdoch", age: 38, club: "PAWSitive Barbell Club", gender: "Female", weightClass: "81kg", entryTotal: 130, session: {number: 20, platform: "Blue"} },
  { memberId: "1023027", name: "Nicole Long", age: 39, club: "PROJECT LIFT", gender: "Female", weightClass: "81kg", entryTotal: 122, session: {number: 20, platform: "Blue"} },
  { memberId: "1063139", name: "Christina Ramirez", age: 39, club: "McKenna Weightlifting", gender: "Female", weightClass: "81kg", entryTotal: 120, session: {number: 20, platform: "Blue"} },
  { memberId: "1069254", name: "Rhoda Ko", age: 38, club: "FOUNDATION BARBELL", gender: "Female", weightClass: "81kg", entryTotal: 115, session: {number: 20, platform: "Blue"} },


//w45 81-87+, 15,15
{ memberId: "1012314", name: "Amy Hovan", age: 48, club: "Eastside Barbell", gender: "Female", weightClass: "81kg", entryTotal: 174, session: {number: 9, platform: "White"} },
{ memberId: "213030", name: "Jessica Beal", age: 45, club: "Oly Concepts", gender: "Female", weightClass: "81kg", entryTotal: 148, session: {number: 9, platform: "White"} },
{ memberId: "1021027", name: "Paula Habel", age: 46, club: "PAWSitive Barbell Club", gender: "Female", weightClass: "81kg", entryTotal: 147, session: {number: 9, platform: "White"} },
{ memberId: "1077482", name: "Colleen Moon", age: 45, club: "Desert Devil Barbell", gender: "Female", weightClass: "81kg", entryTotal: 141, session: {number: 9, platform: "White"} },
{ memberId: "204114", name: "Brandi Eustice", age: 45, club: "Buff City Barbell", gender: "Female", weightClass: "81kg", entryTotal: 120, session: {number: 9, platform: "White"} },
{ memberId: "1033110", name: "Melissa Melvin-Rodriguez", age: 46, club: "HEAVY METAL BARBELL", gender: "Female", weightClass: "81kg", entryTotal: 120, session: {number: 9, platform: "White"} },
{ memberId: "1024091", name: "Melissa Selk", age: 48, club: "Unaffiliated", gender: "Female", weightClass: "81kg", entryTotal: 113, session: {number: 9, platform: "White"} },
{ memberId: "1032192", name: "Marissa Sterrett", age: 46, club: "Vardanian Weightlifting", gender: "Female", weightClass: "87kg", entryTotal: 140, session: {number: 9, platform: "White"} },
{ memberId: "1059335", name: "Lindsay Pitzer", age: 47, club: "12 Labours Barbell", gender: "Female", weightClass: "87kg", entryTotal: 125, session: {number: 9, platform: "White"} },
{ memberId: "1007638", name: "Chelsea Hopkins", age: 49, club: "Eastside Barbell", gender: "Female", weightClass: "+87kg", entryTotal: 164, session: {number: 9, platform: "White"} },
{ memberId: "1077602", name: "Kelly Smotherman", age: 45, club: "Unaffiliated", gender: "Female", weightClass: "+87kg", entryTotal: 128, session: {number: 9, platform: "White"} },
{ memberId: "210157", name: "Natasha Wunderlich", age: 46, club: "McKenna Weightlifting", gender: "Female", weightClass: "+87kg", entryTotal: 130, session: {number: 9, platform: "White"} },
{ memberId: "1047593", name: "Kelli Wells", age: 48, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "+87kg", entryTotal: 120, session: {number: 9, platform: "White"} },
{ memberId: "1074554", name: "Rebecca Pearce", age: 45, club: "3P Weightlifting", gender: "Female", weightClass: "+87kg", entryTotal: 112, session: {number: 9, platform: "White"} },
{ memberId: "178347", name: "Donna Richards", age: 48, club: "CROSSFIT FORT VANCOUVER BARBELL CLUB", gender: "Female", weightClass: "+87kg", entryTotal: 115, session: {number: 9, platform: "White"} },


//w40 81-87, 13/14
  { memberId: "1076454", name: "Tereka Clark", age: 40, club: "12 Labours Barbell", gender: "Female", weightClass: "81kg", entryTotal: 160, session: {number: 16, platform: "Blue"} },
  { memberId: "1001670", name: "Catharine Messersmith", age: 41, club: "Category 5 Athletics", gender: "Female", weightClass: "81kg", entryTotal: 154, session: {number: 16, platform: "Blue"} },
  { memberId: "1051777", name: "Rachel Reiboldt", age: 42, club: "POWER AND GRACE PERFORMANCE.", gender: "Female", weightClass: "81kg", entryTotal: 145, session: {number: 16, platform: "Blue"} },
 { memberId: "200649", name: "Sara Soto", age: 44, club: "MURDER OF CROWS", gender: "Female", weightClass: "81kg", entryTotal: 125, session: {number: 16, platform: "Blue"} },
  { memberId: "1078385", name: "Caroline Kim", age: 41, club: "BARBARIAN BARBELL CLUB", gender: "Female", weightClass: "81kg", entryTotal: 125, session: {number: 16, platform: "Blue"} },
  { memberId: "1054433", name: "Ashley Richardson", age: 44, club: "Unaffiliated", gender: "Female", weightClass: "81kg", entryTotal: 125, session: {number: 16, platform: "Blue"} },
  { memberId: "1048300", name: "Keli Holley", age: 41, club: "EAST ALABAMA WEIGHTLIFTING", gender: "Female", weightClass: "81kg", entryTotal: 120, session: {number: 16, platform: "Blue"} },
 { memberId: "1054219", name: "LeslieAnne Pester", age: 43, club: "Oly Concepts", gender: "Female", weightClass: "81kg", entryTotal: 119, session: {number: 16, platform: "Blue"} },
  { memberId: "1077041", name: "Heather Myers", age: 40, club: "BAM Weightlifting Club", gender: "Female", weightClass: "81kg", entryTotal: 117, session: {number: 16, platform: "Blue"} },
  { memberId: "1005755", name: "Amanda Cann", age: 44, club: "Lupo Barbell Club", gender: "Female", weightClass: "87kg", entryTotal: 161, session: {number: 16, platform: "Blue"} },
  { memberId: "213435", name: "Kate Jensen", age: 41, club: "Giffy’s Barbell Club", gender: "Female", weightClass: "87kg", entryTotal: 116, session: {number: 16, platform: "Blue"} },
{ memberId: "1076028", name: "Eunice Rho", age: 40, club: "Unaffiliated", gender: "Female", weightClass: "87kg", entryTotal: 155, session: {number: 16, platform: "Blue"} },
  { memberId: "1068167", name: "Lisa Bagby", age: 41, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "87kg", entryTotal: 140, session: {number: 16, platform: "Blue"} },

//w35 76-81 A
  { memberId: "188752", name: "Carly Best", age: 38, club: "People's Republic of The Dojo", gender: "Female", weightClass: "81kg", entryTotal: 183, session: {number: 21, platform: "Blue"} },
  { memberId: "208662", name: "Amanda Cook", age: 43, club: "CALAVERA BARBELL", gender: "Female", weightClass: "81kg", entryTotal: 175, session: {number: 21, platform: "Blue"} },
  { memberId: "190338", name: "Chelsey Tharp", age: 36, club: "CATALYST ATHLETICS", gender: "Female", weightClass: "81kg", entryTotal: 170, session: {number: 21, platform: "Blue"} },
  { memberId: "174686", name: "Erin Nelson", age: 37, club: "Denver Barbell Club", gender: "Female", weightClass: "81kg", entryTotal: 160, session: {number: 21, platform: "Blue"} },
  { memberId: "1053616", name: "Christine Miller", age: 38, club: "Heartland Strength", gender: "Female", weightClass: "81kg", entryTotal: 157, session: {number: 21, platform: "Blue"} },
  { memberId: "1075473", name: "Amanda Shirley", age: 37, club: "Atlas Weightlifting Club", gender: "Female", weightClass: "81kg", entryTotal: 150, session: {number: 21, platform: "Blue"} },
  { memberId: "1016289", name: "Mallory Fountain", age: 39, club: "Strength Ratio", gender: "Female", weightClass: "81kg", entryTotal: 140, session: {number: 21, platform: "Blue"} },
  { memberId: "1011948", name: "Lisa Blevens", age: 38, club: "Boombox Barbell", gender: "Female", weightClass: "81kg", entryTotal: 140, session: {number: 21, platform: "Blue"} },
  { memberId: "169822", name: "Tayler Harris", age: 38, club: "HEAVY METAL BARBELL", gender: "Female", weightClass: "76kg", entryTotal: 200, session: {number: 21, platform: "Blue"} },
  { memberId: "1074508", name: "Amanda Feist", age: 38, club: "GARAGE STRENGTH", gender: "Female", weightClass: "76kg", entryTotal: 179, session: {number: 21, platform: "Blue"} },
  { memberId: "1026052", name: "Carlyn Winston", age: 38, club: "RVA Weightlifting", gender: "Female", weightClass: "76kg", entryTotal: 174, session: {number: 21, platform: "Blue"} },
  { memberId: "213161", name: "Nadia Khan", age: 35, club: "NEW YORK WEIGHTLIFTING ACADEMY", gender: "Female", weightClass: "76kg", entryTotal: 172, session: {number: 21, platform: "Blue"} },
  { memberId: "1056295", name: "Ericha Flateau", age: 37, club: "People's Republic of The Dojo", gender: "Female", weightClass: "76kg", entryTotal: 155, session: {number: 21, platform: "Blue"} },
  { memberId: "1039562", name: "Emily Garrett", age: 38, club: "Bexar Barbell", gender: "Female", weightClass: "76kg", entryTotal: 144, session: {number: 21, platform: "Blue"} },
  { memberId: "1065649", name: "Kathleen Marquez", age: 39, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "76kg", entryTotal: 140, session: {number: 21, platform: "Blue"} },

//w35 87
  { memberId: "1018357", name: "Annirose Womack", age: 37, club: "Team Variant", gender: "Female", weightClass: "87kg", entryTotal: 181, session: {number: 22, platform: "Red"} },
  { memberId: "219435", name: "Sasha Jarquin", age: 37, club: "Orlando Strength", gender: "Female", weightClass: "87kg", entryTotal: 171, session: {number: 22, platform: "Red"} },
  { memberId: "1070271", name: "Beth Simon", age: 36, club: "Unaffiliated", gender: "Female", weightClass: "87kg", entryTotal: 170, session: {number: 22, platform: "Red"} },
  { memberId: "192430", name: "Lauren McHugh", age: 37, club: "CHFP WEIGHTLIFTING CLUB", gender: "Female", weightClass: "87kg", entryTotal: 170, session: {number: 22, platform: "Red"} },
  { memberId: "1004315", name: "Yvgeni Henderson", age: 37, club: "HEAVY METAL BARBELL", gender: "Female", weightClass: "87kg", entryTotal: 162, session: {number: 22, platform: "Red"} },
  { memberId: "1064482", name: "Maria Lopez", age: 39, club: "Manhattan Barbell", gender: "Female", weightClass: "87kg", entryTotal: 160, session: {number: 22, platform: "Red"} },
  { memberId: "1053645", name: "Elyssabeth Beers", age: 39, club: "Vardanian Weightlifting", gender: "Female", weightClass: "87kg", entryTotal: 160, session: {number: 22, platform: "Red"} },
  { memberId: "1077393", name: "Cleonie Meraz", age: 36, club: "Built By Becker Weightlifting Club", gender: "Female", weightClass: "87kg", entryTotal: 126, session: {number: 22, platform: "Red"} },
  { memberId: "1075332", name: "Nikki Holt", age: 35, club: "Winston Salem Weightlifting", gender: "Female", weightClass: "87kg", entryTotal: 126, session: {number: 22, platform: "Red"} },
  { memberId: "1051780", name: "Melanie Vance", age: 36, club: "ALLSOUTH Barbell", gender: "Female", weightClass: "87kg", entryTotal: 125, session: {number: 22, platform: "Red"} },
  { memberId: "198477", name: "Yecenia Feliz", age: 43, club: "FOREVER YOUNG BARBELL", gender: "Female", weightClass: "87kg", entryTotal: 110, session: {number: 22, platform: "Red"} },

  
  //w40 +87, 
  { memberId: "1062471", name: "Amber Englebright", age: 41, club: "Gary’s Gym", gender: "Female", weightClass: "+87kg", entryTotal: 120, session: {number: 17, platform: "Red"} },
  { memberId: "1021885", name: "Janice White", age: 43, club: "HEAVY METAL BARBELL", gender: "Female", weightClass: "+87kg", entryTotal: 114, session: {number: 17, platform: "Red"} },
  { memberId: "217058", name: "Christina Brockington", age: 40, club: "Swamp Cabbage Barbell Club", gender: "Female", weightClass: "+87kg", entryTotal: 120, session: {number: 17, platform: "Red"} },
  { memberId: "1037989", name: "Tacora Beasley", age: 44, club: "Unaffiliated", gender: "Female", weightClass: "+87kg", entryTotal: 125, session: {number: 17, platform: "Red"} },
  { memberId: "1049517", name: "Marjorie Gottier", age: 42, club: "Rising Tide Weightlifting", gender: "Female", weightClass: "+87kg", entryTotal: 150, session: {number: 17, platform: "Red"} },
  { memberId: "1050297", name: "Diana Thorne", age: 44, club: "Unaffiliated", gender: "Female", weightClass: "+87kg", entryTotal: 135, session: {number: 17, platform: "Red"} },
  { memberId: "1074441", name: "Amy Grano", age: 42, club: "Unaffiliated", gender: "Female", weightClass: "+87kg", entryTotal: 129, session: {number: 17, platform: "Red"} },
  { memberId: "219697", name: "Katerina Athanassiadou", age: 40, club: "DC WEIGHTLIFTING CLUB", gender: "Female", weightClass: "+87kg", entryTotal: 127, session: {number: 17, platform: "Red"} },
  { memberId: "1058900", name: "Stephanie Dickhute", age: 42, club: "Heartland Strength", gender: "Female", weightClass: "+87kg", entryTotal: 161, session: {number: 17, platform: "Red"} },
  { memberId: "206027", name: "Jamie Martin", age: 40, club: "CLEAN SLATE WEIGHTLIFTING", gender: "Female", weightClass: "+87kg", entryTotal: 160, session: {number: 17, platform: "Red"} },
  { memberId: "1077210", name: "Liz Earley", age: 40, club: "Unaffiliated", gender: "Female", weightClass: "+87kg", entryTotal: 170, session: {number: 17, platform: "Red"} },
  { memberId: "1027076", name: "Erin Becker", age: 40, club: "Standard Strength", gender: "Female", weightClass: "+87kg", entryTotal: 166, session: {number: 17, platform: "Red"} },
  { memberId: "208485", name: "Megan Haymaker", age: 41, club: "1Kilo", gender: "Female", weightClass: "+87kg", entryTotal: 165, session: {number: 17, platform: "Red"} },
  { memberId: "218640", name: "Sarah Tyler", age: 43, club: "HEAVY METAL BARBELL", gender: "Female", weightClass: "+87kg", entryTotal: 190, session: {number: 17, platform: "Red"} },
  { memberId: "1045014", name: "Kimberlee Douglas", age: 44, club: "Haworth Weightlifting", gender: "Female", weightClass: "+87kg", entryTotal: 190, session: {number: 17, platform: "Red"} },

//w35 87+
  { memberId: "1056680", name: "LeKiesha White", age: 36, club: "RVA Weightlifting", gender: "Female", weightClass: "+87kg", entryTotal: 200, session: {number: 22, platform: "White"} },
  { memberId: "206417", name: "Samantha Dowgin", age: 37, club: "CROSSFIT FORT VANCOUVER BARBELL CLUB", gender: "Female", weightClass: "+87kg", entryTotal: 185, session: {number: 22, platform: "White"} },
  { memberId: "1007644", name: "Amanda Roberts", age: 38, club: "POWER AND GRACE PERFORMANCE.", gender: "Female", weightClass: "+87kg", entryTotal: 180, session: {number: 22, platform: "White"} },
  { memberId: "1026022", name: "Caitlin Whealy", age: 38, club: "RUBBER CITY WEIGHTLIFTING", gender: "Female", weightClass: "+87kg", entryTotal: 180, session: {number: 22, platform: "White"} },
  { memberId: "1065074", name: "Georgia Stone", age: 36, club: "Endless Strength Weightlifting", gender: "Female", weightClass: "+87kg", entryTotal: 162, session: {number: 22, platform: "White"} },
  { memberId: "1048895", name: "Kali Fernandez", age: 36, club: "People's Republic of The Dojo", gender: "Female", weightClass: "+87kg", entryTotal: 160, session: {number: 22, platform: "White"} },
  { memberId: "1061587", name: "Elyce Johnson", age: 37, club: "Unaffiliated", gender: "Female", weightClass: "+87kg", entryTotal: 155, session: {number: 22, platform: "White"} },
  { memberId: "1041545", name: "Corinn Williams", age: 37, club: "Manhattan Barbell", gender: "Female", weightClass: "+87kg", entryTotal: 154, session: {number: 22, platform: "White"} },
  { memberId: "1078886", name: "Christine Harris", age: 35, club: "Unaffiliated", gender: "Female", weightClass: "+87kg", entryTotal: 126, session: {number: 22, platform: "White"} },
  { memberId: "1070074", name: "Rose Seibold", age: 38, club: "Wormtown Weightlifting", gender: "Female", weightClass: "+87kg", entryTotal: 126, session: {number: 22, platform: "White"} },
  { memberId: "1076225", name: "Ayesha Athar", age: 35, club: "Unaffiliated", gender: "Female", weightClass: "+87kg", entryTotal: 124, session: {number: 22, platform: "White"} },
  { memberId: "1078998", name: "Emily Thompson", age: 36, club: "Unaffiliated", gender: "Female", weightClass: "+87kg", entryTotal: 120, session: {number: 22, platform: "White"} },
//////////////////////////////////////////////

  //m70-80
  { memberId: "1046687", name: "JEROME MILLER", age: 76, club: "Unaffiliated", gender: "Male", weightClass: "61kg", entryTotal: 110, session: {number: 1, platform: "Blue"} },
  { memberId: "574", name: "Joe DeLago", age: 72, club: "MOORESTOWN WLC", gender: "Male", weightClass: "61kg", entryTotal: 90, session: {number: 1, platform: "Blue"}},
  { memberId: "177609", name: "Nicholas Weingarten", age: 74, club: "MILLER WEIGHTLIFTING", gender: "Male", weightClass: "73kg", entryTotal: 110, session: {number: 1, platform: "Blue"} },
  { memberId: "125914", name: "Thomas Zucca", age: 73, club: "Unaffiliated", gender: "Male", weightClass: "81kg", entryTotal: 98, session: {number: 1, platform: "Blue"} },
  { memberId: "1012598", name: "James Tracy", age: 71, club: "Unaffiliated", gender: "Male", weightClass: "81kg", entryTotal: 118, session: {number: 1, platform: "Blue"} },
  { memberId: "1006491", name: "Barry Lewis", age: 82, club: "Boulder Barbell Club", gender: "Male", weightClass: "89kg", entryTotal: 90, session: {number: 1, platform: "Blue"} },
  { memberId: "1045911", name: "Philip Arnold", age: 77, club: "PARAMOUNT BARBELL CLUB", gender: "Male", weightClass: "89kg", entryTotal: 127, session: {number: 1, platform: "Blue"} },
  { memberId: "1076969", name: "John West", age: 71, club: "Unaffiliated", gender: "Male", weightClass: "96kg", entryTotal: 125, session: {number: 1, platform: "Blue"} },
  { memberId: "623", name: "Christopher Polakowski", age: 70, club: "Delaware and Vermont Weightlifting", gender: "Male", weightClass: "96kg", entryTotal: 121, session: {number: 1, platform: "Blue"} },


  //m65 
    { memberId: "1043978", name: "Arthur Slade", age: 66, club: "Unaffiliated", gender: "Male", weightClass: "73kg", entryTotal: 110, session: {number: 2, platform: "Blue"} },
    { memberId: "220019", name: "Donald Glab", age: 65, club: "Unaffiliated", gender: "Male", weightClass: "81kg", entryTotal: 135, session: {number: 2, platform: "Blue"} },
    { memberId: "123475", name: "Teddy Binette", age: 65, club: "Beyond The Barbell", gender: "Male", weightClass: "81kg", entryTotal: 120, session: {number: 2, platform: "Blue"} },
    { memberId: "1059852", name: "Robert Gallup", age: 67, club: "ALLSOUTH Barbell", gender: "Male", weightClass: "81kg", entryTotal: 110, session: {number: 2, platform: "Blue"} },
    { memberId: "1032757", name: "Carlos Martinez", age: 67, club: "Unaffiliated", gender: "Male", weightClass: "89kg", entryTotal: 120, session: {number: 2, platform: "Blue"} },
    { memberId: "1020961", name: "Charlie Simmons", age: 66, club: "Unaffiliated", gender: "Male", weightClass: "89kg", entryTotal: 135, session: {number: 2, platform: "Blue"} },
    { memberId: "1030610", name: "Samuel Starkey", age: 67, club: "Stomp Weightlifting", gender: "Male", weightClass: "89kg", entryTotal: 145, session: {number: 2, platform: "Blue"} },
    { memberId: "196953", name: "Kevin Kreamer", age: 65, club: "MISSISSIPPI BARBELL", gender: "Male", weightClass: "109kg", entryTotal: 140, session: {number: 2, platform: "Blue"} },


  //M60
  { memberId: "1032753", name: "Russell Seay", age: 64, club: "HARRISBURG WEIGHTLIFTING CLUB", gender: "Male", weightClass: "61kg", entryTotal: 109, session: {number: 3, platform: "Blue"} },
  { memberId: "1071101", name: "Fernando Chaviano", age: 61, club: "Oly Concepts", gender: "Male", weightClass: "73kg", entryTotal: 216, session: {number: 3, platform: "Blue"} },
  { memberId: "116672", name: "Kevin Dittler", age: 60, club: "Unaffiliated", gender: "Male", weightClass: "81kg", entryTotal: 160, session: {number: 3, platform: "Blue"} },
  { memberId: "1049685", name: "Gary Shiffman", age: 60, club: "HEAVY METAL BARBELL", gender: "Male", weightClass: "81kg", entryTotal: 135, session: {number: 3, platform: "Blue"} },
  { memberId: "1034700", name: "Daniel Nelson", age: 61, club: "Unaffiliated", gender: "Male", weightClass: "81kg", entryTotal: 167, session: {number: 3, platform: "Blue"} },
  { memberId: "1059863", name: "Jerry Wigger", age: 62, club: "Lowcountry Barbell", gender: "Male", weightClass: "89kg", entryTotal: 130, session: {number: 3, platform: "Blue"} },
  { memberId: "1024283", name: "Robert O'Day", age: 61, club: "Attitude Nation Barbell Club", gender: "Male", weightClass: "89kg", entryTotal: 201, session: {number: 3, platform: "Blue"} },
  { memberId: "1062620", name: "RAYMOND BERRY", age: 61, club: "CROSSFIT FORT VANCOUVER BARBELL CLUB", gender: "Male", weightClass: "102kg", entryTotal: 133, session: {number: 3, platform: "Blue"} },
  { memberId: "1022722", name: "Mark Lado", age: 60, club: "Greenville Weightlifting", gender: "Male", weightClass: "102kg", entryTotal: 194, session: {number: 3, platform: "Blue"} },


  //m55
    { memberId: "139242", name: "Eric Bramwell", age: 55, club: "POWER AND GRACE PERFORMANCE.", gender: "Male", weightClass: "67kg", entryTotal: 150, session: {number: 4, platform: "Blue"}  },
  { memberId: "1048158", name: "Marc Silverstein", age: 56, club: "West Chester Weightlifting", gender: "Male", weightClass: "73kg", entryTotal: 150, session: {number: 4, platform: "Blue"} },
  { memberId: "1063653", name: "Matthew Mediatore", age: 57, club: "Unaffiliated", gender: "Male", weightClass: "81kg", entryTotal: 160, session: {number: 4, platform: "Blue"} },
  { memberId: "1440", name: "Dean Goad", age: 57, club: "CALPIANS WLC", gender: "Male", weightClass: "81kg", entryTotal: 194, session: {number: 4, platform: "Blue"} },
  { memberId: "1006162", name: "Raymond Loser", age: 57, club: "Strength Ratio", gender: "Male", weightClass: "89kg", entryTotal: 152, session: {number: 4, platform: "Blue"} },
  { memberId: "1065481", name: "Steve Schang", age: 56, club: "HEAVY METAL BARBELL", gender: "Male", weightClass: "89kg", entryTotal: 140, session: {number: 4, platform: "Blue"} },
  { memberId: "1026070", name: "Tim Hennessey", age: 58, club: "FORZA WEIGHTLIFTING CLUB", gender: "Male", weightClass: "89kg", entryTotal: 200, session: {number: 4, platform: "Blue"} },
  { memberId: "1049325", name: "John Dalessio", age: 57, club: "CALIFORNIA STRENGTH", gender: "Male", weightClass: "89kg", entryTotal: 190, session: {number: 4, platform: "Blue"} },
  { memberId: "1053240", name: "Darin Dehle", age: 58, club: "Eastside Barbell", gender: "Male", weightClass: "96kg", entryTotal: 170, session: {number: 4, platform: "Blue"} },
  { memberId: "1070592", name: "Gary Gill", age: 56, club: "Unaffiliated", gender: "Male", weightClass: "96kg", entryTotal: 166, session: {number: 4, platform: "Blue"} },
  { memberId: "1017100", name: "Eric Brown", age: 56, club: "CROSSFIT FORT VANCOUVER BARBELL CLUB", gender: "Male", weightClass: "102kg", entryTotal: 227, session: {number: 4, platform: "Blue"} },
  { memberId: "1073165", name: "Johnny Williams", age: 56, club: "Freedom Weightlifting", gender: "Male", weightClass: "102kg", entryTotal: 195, session: {number: 4, platform: "Blue"} },
  { memberId: "1057698", name: "Robert Fezza", age: 55, club: "POWER AND GRACE PERFORMANCE.", gender: "Male", weightClass: "96kg", entryTotal: 205, session: {number: 4, platform: "Blue"} },
  { memberId: "121790", name: "Christopher Follenius", age: 58, club: "Team Florida Gainesville", gender: "Male", weightClass: "67kg", entryTotal: 165, session: {number: 4, platform: "Blue"} },



  //m50 55-89
    { memberId: "1026012", name: "Michael Herzog", age: 53, club: "ATLANTA PERFORMANCE", gender: "Male", weightClass: "73kg", entryTotal: 210, session: {number: 6, platform: "Red"} },
  { memberId: "1059433", name: "Jonathan Willmoth", age: 50, club: "Parish Barbell Club", gender: "Male", weightClass: "73kg", entryTotal: 182, session: {number: 6, platform: "Red"} },
  { memberId: "213544", name: "Michael Romero", age: 50, club: "Unaffiliated", gender: "Male", weightClass: "73kg", entryTotal: 170, session: {number: 6, platform: "Red"} },
  { memberId: "1078548", name: "Greg Darian", age: 53, club: "Unaffiliated", gender: "Male", weightClass: "81kg", entryTotal: 172, session: {number: 6, platform: "Red"} },
  { memberId: "1026254", name: "Brian Zimmerman", age: 50, club: "Unaffiliated", gender: "Male", weightClass: "81kg", entryTotal: 175, session: {number: 6, platform: "Red"} },
  { memberId: "1071593", name: "Jay Jernigan", age: 51, club: "Wheelhouse Academy", gender: "Male", weightClass: "89kg", entryTotal: 175, session: {number: 6, platform: "Red"} },
  { memberId: "1080137", name: "William Loheide", age: 54, club: "Unaffiliated", gender: "Male", weightClass: "89kg", entryTotal: 168, session: {number: 6, platform: "Red"} },
  { memberId: "1060015", name: "Jimmy Kantor", age: 51, club: "Unaffiliated", gender: "Male", weightClass: "89kg", entryTotal: 204, session: {number: 6, platform: "Red"} },
  { memberId: "1033032", name: "Greg Karas", age: 51, club: "4 Star Strength", gender: "Male", weightClass: "89kg", entryTotal: 195, session: {number: 6, platform: "Red"} },
  { memberId: "1077141", name: "Armando Ordonez", age: 52, club: "Stonehenge Weightlifting", gender: "Male", weightClass: "89kg", entryTotal: 191, session: {number: 6, platform: "Red"} },
  { memberId: "1057440", name: "Mike Osborn", age: 51, club: "Unaffiliated", gender: "Male", weightClass: "89kg", entryTotal: 190, session: {number: 6, platform: "Red"} },
  { memberId: "183269", name: "Jeven Sloan", age: 50, club: "Wheelhouse Academy", gender: "Male", weightClass: "89kg", entryTotal: 190, session: {number: 6, platform: "Red"} },
  { memberId: "1038834", name: "Brad Baldwin", age: 52, club: "CLEAN SLATE WEIGHTLIFTING", gender: "Male", weightClass: "67kg", entryTotal: 210, session: {number: 6, platform: "Red"} },


  //m45 55-81
  { memberId: "1016795", name: "Tony Lau", age: 47, club: "FOUNDATION BARBELL", gender: "Male", weightClass: "67kg", entryTotal: 187, session: {number: 8, platform: "Blue"} },
  { memberId: "1034158", name: "Eric Chang", age: 48, club: "HI PERFORMANCE ATHLETICS", gender: "Male", weightClass: "67kg", entryTotal: 170, session: {number: 8, platform: "Blue"} },
  { memberId: "1049374", name: "Keith Whitmore", age: 45, club: "CROSSFIT FORT VANCOUVER BARBELL CLUB", gender: "Male", weightClass: "67kg", entryTotal: 163, session: {number: 8, platform: "Blue"} },
  { memberId: "1077866", name: "Chris Miller", age: 46, club: "Unaffiliated", gender: "Male", weightClass: "73kg", entryTotal: 200, session: {number: 8, platform: "Blue"} },
  { memberId: "1068187", name: "David Seltzer", age: 45, club: "Tri State Barbell", gender: "Male", weightClass: "73kg", entryTotal: 170, session: {number: 8, platform: "Blue"} },
  { memberId: "1076106", name: "Shawn Robertson", age: 45, club: "Unaffiliated", gender: "Male", weightClass: "81kg", entryTotal: 220, session: {number: 8, platform: "Blue"} },
  { memberId: "1071144", name: "Fred Macaraeg", age: 48, club: "12 Labours Barbell", gender: "Male", weightClass: "81kg", entryTotal: 210, session: {number: 8, platform: "Blue"} },
  { memberId: "1011860", name: "matthew gonzalez", age: 46, club: "HEAVY METAL BARBELL", gender: "Male", weightClass: "81kg", entryTotal: 210, session: {number: 8, platform: "Blue"} },
  { memberId: "1001303", name: "Nathan Black", age: 46, club: "Unaffiliated", gender: "Male", weightClass: "81kg", entryTotal: 208, session: {number: 8, platform: "Blue"} },
  { memberId: "1028641", name: "Corey Johnson", age: 45, club: "Heartland Strength", gender: "Male", weightClass: "81kg", entryTotal: 175, session: {number: 8, platform: "Blue"} },



//m40 55-81
  { memberId: "1076701", name: "Shunsuke Nakao", age: 42, club: "Koyano Weightlifting", gender: "Male", weightClass: "61kg", entryTotal: 169, session: {number: 11, platform: "Blue"} },
  { memberId: "1077237", name: "Jethro Acenas", age: 42, club: "Unaffiliated", gender: "Male", weightClass: "67kg", entryTotal: 171, session: {number: 11, platform: "Blue"} },
  { memberId: "209562", name: "Wes Richardson", age: 43, club: "HEAVY METAL BARBELL", gender: "Male", weightClass: "67kg", entryTotal: 170, session: {number: 11, platform: "Blue"} },
  { memberId: "188287", name: "Christopher Douglas", age: 44, club: "PARAMOUNT BARBELL CLUB", gender: "Male", weightClass: "73kg", entryTotal: 249, session: {number: 11, platform: "Blue"} },
  { memberId: "1063667", name: "Edwin Johnson", age: 43, club: "Unaffiliated", gender: "Male", weightClass: "73kg", entryTotal: 188, session: {number: 11, platform: "Blue"} },
  { memberId: "1043351", name: "Brian Leung", age: 42, club: "CHFP WEIGHTLIFTING CLUB", gender: "Male", weightClass: "81kg", entryTotal: 220, session: {number: 11, platform: "Blue"} },
  { memberId: "1034160", name: "Carl Nelson", age: 42, club: "MURDER OF CROWS", gender: "Male", weightClass: "81kg", entryTotal: 217, session: {number: 11, platform: "Blue"} },
  { memberId: "174681", name: "John Erwin", age: 40, club: "COASTAL EMPIRE WEIGHTLIFTING", gender: "Male", weightClass: "81kg", entryTotal: 215, session: {number: 11, platform: "Blue"} },
  { memberId: "191984", name: "Carlos Hernandez", age: 44, club: "CALAVERA BARBELL", gender: "Male", weightClass: "81kg", entryTotal: 200, session: {number: 11, platform: "Blue"} },
  { memberId: "1014810", name: "Lionel Bravo", age: 42, club: "BARBARIAN BARBELL CLUB", gender: "Male", weightClass: "81kg", entryTotal: 198, session: {number: 11, platform: "Blue"} },
  { memberId: "1077421", name: "Carlos Concepcion", age: 41, club: "Unaffiliated", gender: "Male", weightClass: "81kg", entryTotal: 190, session: {number: 11, platform: "Blue"} },
  { memberId: "166139", name: "Phillip Bost", age: 43, club: "HEAVY METAL BARBELL", gender: "Male", weightClass: "81kg", entryTotal: 189, session: {number: 11, platform: "Blue"} },
  { memberId: "1078495", name: "Terrence O'Neil", age: 43, club: "True North Weightlifting", gender: "Male", weightClass: "81kg", entryTotal: 200, session: {number: 11, platform: "Blue"} },


//m35 55-73
  { memberId: "1038280", name: "Trent Hagiya", age: 37, club: "Daidalos Weightlifting", gender: "Male", weightClass: "67kg", entryTotal: 240, session: {number: 15, platform: "Red"} },
  { memberId: "1062735", name: "Brian Horwath", age: 36, club: "Tri State Barbell", gender: "Male", weightClass: "67kg", entryTotal: 200, session: {number: 15, platform: "Red"} },
  { memberId: "1074950", name: "Shamil Parbhoo", age: 38, club: "Lupo Barbell Club", gender: "Male", weightClass: "67kg", entryTotal: 194, session: {number: 15, platform: "Red"} },
  { memberId: "1017774", name: "Nico Paulo Tolentino", age: 35, club: "Kim Barbell", gender: "Male", weightClass: "67kg", entryTotal: 190, session: {number: 15, platform: "Red"} },
  { memberId: "1001423", name: "donald keller", age: 37, club: "Unaffiliated", gender: "Male", weightClass: "67kg", entryTotal: 181, session: {number: 15, platform: "Red"} },
  { memberId: "1061509", name: "Joseph Crossett", age: 36, club: "RFS Barbell", gender: "Male", weightClass: "67kg", entryTotal: 180, session: {number: 15, platform: "Red"} },
  { memberId: "213343", name: "Bryan Jow", age: 37, club: "Gryphon Strength Barbell", gender: "Male", weightClass: "73kg", entryTotal: 250, session: {number: 15, platform: "Red"} },
  { memberId: "214538", name: "Jacob Howard", age: 37, club: "Wolf Pack Weightlifting", gender: "Male", weightClass: "73kg", entryTotal: 225, session: {number: 15, platform: "Red"} },
  { memberId: "1020581", name: "Joshua Claravall", age: 37, club: "Unaffiliated", gender: "Male", weightClass: "73kg", entryTotal: 220, session: {number: 15, platform: "Red"} },
  { memberId: "1060633", name: "Timothy Everhart", age: 35, club: "CHFP WEIGHTLIFTING CLUB", gender: "Male", weightClass: "73kg", entryTotal: 220, session: {number: 15, platform: "Red"} },
  { memberId: "1047015", name: "Tim Lorenz", age: 36, club: "Denver Barbell Club", gender: "Male", weightClass: "73kg", entryTotal: 205, session: {number: 15, platform: "Red"} },
  { memberId: "1072888", name: "Sean Higgins", age: 37, club: "Unaffiliated", gender: "Male", weightClass: "73kg", entryTotal: 193, session: {number: 15, platform: "Red"} },
  { memberId: "1020862", name: "Ryan Miller", age: 39, club: "Industrial Strength WLC", gender: "Male", weightClass: "73kg", entryTotal: 191, session: {number: 15, platform: "Red"} },


  //m35 81
  { memberId: "1023047", name: "Sean Nguyen", age: 35, club: "BARBARIAN BARBELL CLUB", gender: "Male", weightClass: "81kg", entryTotal: 265, session: {number: 17, platform: "Blue"} },
  { memberId: "1033000", name: "Javan Freyenberger", age: 35, club: "Jake Pudenz Strength & Power", gender: "Male", weightClass: "81kg", entryTotal: 260, session: {number: 17, platform: "Blue"} },
  { memberId: "1024431", name: "Aaron Denney", age: 37, club: "ALLSOUTH Barbell", gender: "Male", weightClass: "81kg", entryTotal: 245, session: {number: 17, platform: "Blue"} },
  { memberId: "1074884", name: "steven franklin", age: 37, club: "Unaffiliated", gender: "Male", weightClass: "81kg", entryTotal: 240, session: {number: 17, platform: "Blue"} },
  { memberId: "181960", name: "Tony Schuster", age: 38, club: "Heartland Strength", gender: "Male", weightClass: "81kg", entryTotal: 240, session: {number: 17, platform: "Blue"} },
  { memberId: "1029106", name: "Luis Martinez", age: 36, club: "West Georgia Weightlifting", gender: "Male", weightClass: "81kg", entryTotal: 220, session: {number: 17, platform: "Blue"} },
  { memberId: "196311", name: "Jeff Boughton", age: 37, club: "Highland Weightlifting", gender: "Male", weightClass: "81kg", entryTotal: 215, session: {number: 17, platform: "Blue"} },
  { memberId: "1022923", name: "John Fasulo", age: 36, club: "Unaffiliated", gender: "Male", weightClass: "81kg", entryTotal: 204, session: {number: 17, platform: "Blue"} },
  { memberId: "1075999", name: "Matt Reeves", age: 37, club: "Unaffiliated", gender: "Male", weightClass: "81kg", entryTotal: 200, session: {number: 17, platform: "Blue"} },
  { memberId: "1036169", name: "Justin Rae", age: 36, club: "Down South Barbell", gender: "Male", weightClass: "81kg", entryTotal: 200, session: {number: 17, platform: "Blue"} },


  //m45 89
  { memberId: "214576", name: "Neil Roberts", age: 45, club: "TOUGH TEMPLE BARBELL CLUB", gender: "Male", weightClass: "89kg", entryTotal: 205, session: {number: 9, platform: "Blue"} },
  { memberId: "1074487", name: "Efe Sozkesen", age: 45, club: "Standard Strength", gender: "Male", weightClass: "89kg", entryTotal: 205, session: {number: 9, platform: "Blue"} },
  { memberId: "1016213", name: "Noah Oliphant", age: 46, club: "Wheelhouse Academy", gender: "Male", weightClass: "89kg", entryTotal: 195, session: {number: 9, platform: "Blue"} },
  { memberId: "1070549", name: "Garret St.", age: 46, club: "Wormtown Weightlifting", gender: "Male", weightClass: "89kg", entryTotal: 190, session: {number: 9, platform: "Blue"} },
  { memberId: "1078940", name: "David Jones", age: 48, club: "ALLSOUTH Barbell", gender: "Male", weightClass: "89kg", entryTotal: 187, session: {number: 9, platform: "Blue"} },
  { memberId: "1072507", name: "Benton Ives", age: 49, club: "Unaffiliated", gender: "Male", weightClass: "89kg", entryTotal: 185, session: {number: 9, platform: "Blue"} },
  { memberId: "1010844", name: "Michael Ben-Hain", age: 49, club: "Bexar Barbell", gender: "Male", weightClass: "89kg", entryTotal: 184, session: {number: 9, platform: "Blue"} },
  { memberId: "218887", name: "Christopher Robertson", age: 45, club: "Unaffiliated", gender: "Male", weightClass: "89kg", entryTotal: 246, session: {number: 9, platform: "Blue"} },
  { memberId: "1070829", name: "Jason Adams", age: 45, club: "Unaffiliated", gender: "Male", weightClass: "89kg", entryTotal: 210, session: {number: 9, platform: "Blue"} },


  //m40 89-96
  { memberId: "1010482", name: "John Gilleland", age: 41, club: "Unaffiliated", gender: "Male", weightClass: "89kg", entryTotal: 275, session: {number: 12, platform: "White"} },
  { memberId: "1073135", name: "Bryann Turner", age: 41, club: "Eastside Barbell", gender: "Male", weightClass: "89kg", entryTotal: 270, session: {number: 12, platform: "White"} },
  { memberId: "221288", name: "Jonathan Raymond", age: 44, club: "Steadfast Barbell", gender: "Male", weightClass: "89kg", entryTotal: 250, session: {number: 12, platform: "White"} },
  { memberId: "1077125", name: "Nathan Pickard", age: 42, club: "Unaffiliated", gender: "Male", weightClass: "89kg", entryTotal: 250, session: {number: 12, platform: "White"} },
  { memberId: "1068439", name: "Terrence Roland", age: 43, club: "ALLSOUTH Barbell", gender: "Male", weightClass: "89kg", entryTotal: 210, session: {number: 12, platform: "White"} },
  { memberId: "171206", name: "Neville Chu", age: 42, club: "Unaffiliated", gender: "Male", weightClass: "96kg", entryTotal: 225, session: {number: 12, platform: "White"} },
  { memberId: "142006", name: "Mike Garrett", age: 41, club: "95East Barbell Club", gender: "Male", weightClass: "96kg", entryTotal: 250, session: {number: 12, platform: "White"} },
  { memberId: "1073201", name: "Erik Schreiber", age: 41, club: "Unaffiliated", gender: "Male", weightClass: "96kg", entryTotal: 261, session: {number: 12, platform: "White"} },
  { memberId: "215478", name: "Marciano Pimentel", age: 43, club: "Unaffiliated", gender: "Male", weightClass: "96kg", entryTotal: 202, session: {number: 12, platform: "White"} },


  //m35 81
  { memberId: "218977", name: "Jacob Elder", age: 38, club: "Bull City Barbell", gender: "Male", weightClass: "89kg", entryTotal: 260, session: {number: 18, platform: "Blue"} },
  { memberId: "1075684", name: "John Casselberry", age: 36, club: "Rise Weightlifting", gender: "Male", weightClass: "89kg", entryTotal: 260, session: {number: 18, platform: "Blue"} },
  { memberId: "206572", name: "Alexander Arquilla", age: 37, club: "SAYRE PARK WLC", gender: "Male", weightClass: "89kg", entryTotal: 255, session: {number: 18, platform: "Blue"} },
  { memberId: "1009344", name: "Dominic Montoya", age: 39, club: "GARAGE STRENGTH", gender: "Male", weightClass: "89kg", entryTotal: 253, session: {number: 18, platform: "Blue"} },
  { memberId: "1050379", name: "Evan Melendez", age: 37, club: "PROJECT LIFT", gender: "Male", weightClass: "89kg", entryTotal: 250, session: {number: 18, platform: "Blue"} },
  { memberId: "159190", name: "Jeremy Jackson", age: 38, club: "Orlando Strength", gender: "Male", weightClass: "89kg", entryTotal: 250, session: {number: 18, platform: "Blue"} },
  { memberId: "153578", name: "Jacob Bockelmann", age: 38, club: "Mad Hammer Barbell", gender: "Male", weightClass: "89kg", entryTotal: 240, session: {number: 18, platform: "Blue"} },
  { memberId: "1049384", name: "Joseph Ward", age: 35, club: "House of Weightlifting", gender: "Male", weightClass: "89kg", entryTotal: 229, session: {number: 18, platform: "Blue"} },
  { memberId: "1016656", name: "James Dantoni", age: 39, club: "Unaffiliated", gender: "Male", weightClass: "89kg", entryTotal: 225, session: {number: 18, platform: "Blue"} },
  { memberId: "1079326", name: "Greg Foote", age: 38, club: "Unaffiliated", gender: "Male", weightClass: "89kg", entryTotal: 217, session: {number: 18, platform: "Blue"} },
  { memberId: "1069030", name: "Dan Sokolow", age: 39, club: "CLEAN SLATE WEIGHTLIFTING", gender: "Male", weightClass: "89kg", entryTotal: 216, session: {number: 18, platform: "Blue"} },
  { memberId: "1077460", name: "Sean Rabourn", age: 39, club: "Lupo Barbell Club", gender: "Male", weightClass: "89kg", entryTotal: 215, session: {number: 18, platform: "Blue"} },
  { memberId: "1078987", name: "Brian Sasaki", age: 35, club: "Unaffiliated", gender: "Male", weightClass: "89kg", entryTotal: 212, session: {number: 18, platform: "Blue"} },
  { memberId: "1045250", name: "Kentaro Majima", age: 37, club: "RVA Weightlifting", gender: "Male", weightClass: "89kg", entryTotal: 208, session: {number: 18, platform: "Blue"} },
  { memberId: "1075047", name: "Maxwell Anderson", age: 37, club: "PHILADELPHIA BARBELL", gender: "Male", weightClass: "89kg", entryTotal: 207, session: {number: 18, platform: "Blue"} },



  //m50 96-109+
    { memberId: "1017920", name: "kurby Brown", age: 50, club: "McKenna Weightlifting", gender: "Male", weightClass: "96kg", entryTotal: 225, session: {number: 7, platform: "Blue"} },
  { memberId: "1028872", name: "Christopher Gregg", age: 54, club: "Root 18 Weightlifting", gender: "Male", weightClass: "96kg", entryTotal: 196, session: {number: 7, platform: "Blue"} },
  { memberId: "1066893", name: "Roy Lesui", age: 53, club: "Unaffiliated", gender: "Male", weightClass: "102kg", entryTotal: 220, session: {number: 7, platform: "Blue"} },
  { memberId: "1074196", name: "Steve Griffin", age: 54, club: "PTW Training", gender: "Male", weightClass: "102kg", entryTotal: 200, session: {number: 7, platform: "Blue"} },
  { memberId: "1074947", name: "Chris Wagner", age: 53, club: "Cherokee Barbell", gender: "Male", weightClass: "102kg", entryTotal: 190, session: {number: 7, platform: "Blue"} },
  { memberId: "1042543", name: "Joseph DeStasio", age: 54, club: "Shoofly Barbell Club", gender: "Male", weightClass: "102kg", entryTotal: 190, session: {number: 7, platform: "Blue"} },
  { memberId: "1005727", name: "Tony Keeler", age: 52, club: "Oly Concepts", gender: "Male", weightClass: "109kg", entryTotal: 210, session: {number: 7, platform: "Blue"} },
  { memberId: "140115", name: "Gregory Vallee", age: 52, club: "Swamp Cabbage Barbell Club", gender: "Male", weightClass: "109kg", entryTotal: 210, session: {number: 7, platform: "Blue"} },
  { memberId: "1000658", name: "Jason Long", age: 52, club: "Unaffiliated", gender: "Male", weightClass: "109kg", entryTotal: 200, session: {number: 7, platform: "Blue"} },


  //m45 96-109+
 { memberId: "1067843", name: "Jonathan Herrera", age: 48, club: "Unaffiliated", gender: "Male", weightClass: "96kg", entryTotal: 220, session: {number: 10, platform: "Blue"} },
  { memberId: "1060944", name: "Lee Sikon", age: 46, club: "North 41 Barbell", gender: "Male", weightClass: "96kg", entryTotal: 215, session: {number: 10, platform: "Blue"} },
  { memberId: "1071030", name: "Marq Cerqua", age: 48, club: "Unaffiliated", gender: "Male", weightClass: "96kg", entryTotal: 210, session: {number: 10, platform: "Blue"} },
  { memberId: "190769", name: "Peter Schied", age: 45, club: "Tsunami Weightlifting System", gender: "Male", weightClass: "96kg", entryTotal: 200, session: {number: 10, platform: "Blue"} },
  { memberId: "1045460", name: "Max Sterling", age: 48, club: "Haworth Weightlifting", gender: "Male", weightClass: "102kg", entryTotal: 207, session: {number: 10, platform: "Blue"} },
  { memberId: "182163", name: "Kevin Wright", age: 49, club: "FOREVER YOUNG BARBELL", gender: "Male", weightClass: "102kg", entryTotal: 205, session: {number: 10, platform: "Blue"} },
  { memberId: "1030261", name: "Ruben Martinez", age: 47, club: "Bexar Barbell", gender: "Male", weightClass: "102kg", entryTotal: 200, session: {number: 10, platform: "Blue"} },
  { memberId: "134382", name: "Jason Dinius", age: 46, club: "PR WEIGHTLIFTING", gender: "Male", weightClass: "109kg", entryTotal: 275, session: {number: 10, platform: "Blue"} },
  { memberId: "190889", name: "Cody Looney", age: 45, club: "Wolf Pack Weightlifting", gender: "Male", weightClass: "109kg", entryTotal: 220, session: {number: 10, platform: "Blue"} },
  { memberId: "123541", name: "Jason Kristal", age: 46, club: "Unaffiliated", gender: "Male", weightClass: "+109kg", entryTotal: 275, session: {number: 10, platform: "Blue"} },
  { memberId: "1057798", name: "Jonathan Schultz", age: 46, club: "Unaffiliated", gender: "Male", weightClass: "+109kg", entryTotal: 200, session: {number: 10, platform: "Blue"} },
  { memberId: "1072030", name: "Chris Walls", age: 45, club: "CROSSFIT FORT VANCOUVER BARBELL CLUB", gender: "Male", weightClass: "+109kg", entryTotal: 244 , session: {number: 10, platform: "Blue"}},
  { memberId: "1080160", name: "Bryan Bee", age: 46, club: "Wheelhouse Academy", gender: "Male", weightClass: "102kg", entryTotal: 220, session: {number: 10, platform: "Blue"} },


//m35 96-109+ A
  { memberId: "1035283", name: "Daniel Dodd", age: 35, club: "HEAVY METAL BARBELL", gender: "Male", weightClass: "96kg", entryTotal: 340, session: {number: 22, platform: "Blue"} },
  { memberId: "1065967", name: "Joshua Gonet", age: 36, club: "ALLSOUTH Barbell", gender: "Male", weightClass: "96kg", entryTotal: 275, session: {number: 22, platform: "Blue"} },
  { memberId: "166728", name: "Jacob Pudenz", age: 37, club: "Unaffiliated", gender: "Male", weightClass: "102kg", entryTotal: 300, session: {number: 22, platform: "Blue"} },
  { memberId: "139348", name: "Brett Keith", age: 37, club: "Tsunami Weightlifting System", gender: "Male", weightClass: "109kg", entryTotal: 300, session: {number: 22, platform: "Blue"} },
  { memberId: "1053080", name: "Norman Carreiro", age: 38, club: "RUBBER CITY WEIGHTLIFTING", gender: "Male", weightClass: "109kg", entryTotal: 300, session: {number: 22, platform: "Blue"} },
  { memberId: "1047995", name: "Jason Cappetta", age: 37, club: "Tri State Barbell", gender: "Male", weightClass: "109kg", entryTotal: 270, session: {number: 22, platform: "Blue"} },
  { memberId: "131110", name: "Caine Wilkes", age: 38, club: "HEAVY METAL BARBELL", gender: "Male", weightClass: "+109kg", entryTotal: 350, session: {number: 22, platform: "Blue"} },
  { memberId: "168728", name: "Sean Rigsby", age: 37, club: "HEAVY METAL BARBELL", gender: "Male", weightClass: "+109kg", entryTotal: 285, session: {number: 22, platform: "Blue"} },

  //m35 96-109+ B 240-265
  { memberId: "201959", name: "Zachary Leach", age: 37, club: "Pensacola Strength", gender: "Male", weightClass: "96kg", entryTotal: 260, session: {number: 20, platform: "White"} },
  { memberId: "183505", name: "Justin Frimmel", age: 39, club: "1Kilo", gender: "Male", weightClass: "96kg", entryTotal: 258, session: {number: 20, platform: "White"} },
  { memberId: "1037926", name: "Kevin Real", age: 37, club: "Unaffiliated", gender: "Male", weightClass: "96kg", entryTotal: 255, session: {number: 20, platform: "White"} },
  { memberId: "1003872", name: "Thomas Boatswain", age: 39, club: "Unaffiliated", gender: "Male", weightClass: "96kg", entryTotal: 250, session: {number: 20, platform: "White"} },
  { memberId: "1065293", name: "Emilio Azukwu", age: 38, club: "JDI BARBELL", gender: "Male", weightClass: "102kg", entryTotal: 250, session: {number: 20, platform: "White"} },
  { memberId: "200619", name: "Seth Lingafeldt", age: 36, club: "HEAVY METAL BARBELL", gender: "Male", weightClass: "102kg", entryTotal: 240, session: {number: 20, platform: "White"} },
  { memberId: "206035", name: "Michael Pott", age: 35, club: "Unaffiliated", gender: "Male", weightClass: "+109kg", entryTotal: 265, session: {number: 20, platform: "White"} },
  { memberId: "1002089", name: "Andrew Pupo", age: 35, club: "Unaffiliated", gender: "Male", weightClass: "+109kg", entryTotal: 260, session: {number: 20, platform: "White"} },
  { memberId: "186654", name: "Zachary Mayer", age: 37, club: "Ironside Weightlifting", gender: "Male", weightClass: "109kg", entryTotal: 265, session: {number: 20, platform: "White"} },
  { memberId: "1069660", name: "Ralph Seidler", age: 35, club: "GARAGE STRENGTH", gender: "Male", weightClass: "109kg", entryTotal: 250, session: {number: 20, platform: "White"} },
  { memberId: "1078847", name: "Seth Day", age: 39, club: "Vektløfter Barbell", gender: "Male", weightClass: "109kg", entryTotal: 245, session: {number: 20, platform: "White"} },


  //m35 96-109+ C 200-236
  { memberId: "1049660", name: "Nathan Morris", age: 36, club: "Unaffiliated", gender: "Male", weightClass: "96kg", entryTotal: 236, session: {number: 19, platform: "White"} },
  { memberId: "1056897", name: "James Wagner", age: 38, club: "Unaffiliated", gender: "Male", weightClass: "96kg", entryTotal: 235, session: {number: 19, platform: "White"} },
  { memberId: "1065950", name: "Christopher Butler", age: 35, club: "MASS Strength", gender: "Male", weightClass: "96kg", entryTotal: 230, session: {number: 19, platform: "White"} },
  { memberId: "178563", name: "Chris Wong", age: 37, club: "SENSE Weightlifting Village", gender: "Male", weightClass: "96kg", entryTotal: 230, session: {number: 19, platform: "White"} },
  { memberId: "1031802", name: "krystofer bussell", age: 38, club: "MURDER OF CROWS", gender: "Male", weightClass: "96kg", entryTotal: 230, session: {number: 19, platform: "White"} },
    { memberId: "1069843", name: "Matthew Michel", age: 37, club: "Lupo Barbell Club", gender: "Male", weightClass: "96kg", entryTotal: 214, session: {number: 19, platform: "White"} },
  { memberId: "1055032", name: "Christopher Yandle", age: 39, club: "HEAVY METAL BARBELL", gender: "Male", weightClass: "96kg", entryTotal: 200, session: {number: 19, platform: "White"} },
  { memberId: "1059394", name: "Jose Cruz", age: 38, club: "Bexar Barbell", gender: "Male", weightClass: "102kg", entryTotal: 230, session: {number: 19, platform: "White"} },
  { memberId: "207465", name: "Aaron Butcher", age: 36, club: "BARBARIAN BARBELL CLUB", gender: "Male", weightClass: "102kg", entryTotal: 220, session: {number: 19, platform: "White"} },
  { memberId: "184004", name: "Evan Chelini", age: 39, club: "Unaffiliated", gender: "Male", weightClass: "109kg", entryTotal: 226, session: {number: 19, platform: "White"} },


  //m40 102-109+ B 211-250
  { memberId: "1034005", name: "Mike Isman", age: 43, club: "Unaffiliated", gender: "Male", weightClass: "102kg", entryTotal: 217, session: {number: 13, platform: "Blue"} },
  { memberId: "1039382", name: "Herrick Chang", age: 40, club: "Polaris Weightlifting", gender: "Male", weightClass: "102kg", entryTotal: 211, session: {number: 13, platform: "Blue"} },
  { memberId: "1065581", name: "Eligio Sotelo", age: 40, club: "Jake Pudenz Strength & Power", gender: "Male", weightClass: "102kg", entryTotal: 225, session: {number: 13, platform: "Blue"} },
  { memberId: "169178", name: "Daniel Brown", age: 41, club: "Bexar Barbell", gender: "Male", weightClass: "109kg", entryTotal: 250, session: {number: 13, platform: "Blue"} },
  { memberId: "1018512", name: "Steven Doughty", age: 43, club: "Stay Golden Barbell", gender: "Male", weightClass: "109kg", entryTotal: 235, session: {number: 13, platform: "Blue"} },
  { memberId: "1076730", name: "George Gallaway", age: 42, club: "CHFP WEIGHTLIFTING CLUB", gender: "Male", weightClass: "109kg", entryTotal: 211, session: {number: 13, platform: "Blue"} },
  { memberId: "1053053", name: "Mike Preston", age: 43, club: "POWER AND GRACE PERFORMANCE.", gender: "Male", weightClass: "+109kg", entryTotal: 250, session: {number: 13, platform: "Blue"} },
  { memberId: "176199", name: "Matthew Boyd", age: 42, club: "Team SAW", gender: "Male", weightClass: "+109kg", entryTotal: 250, session: {number: 13, platform: "Blue"} },
  { memberId: "1056263", name: "Thomas Reynolds", age: 42, club: "Unaffiliated", gender: "Male", weightClass: "+109kg", entryTotal: 218, session: {number: 13, platform: "Blue"}},
  { memberId: "1072481", name: "Cyrus Rasnavad", age: 40, club: "First Coast Weightlifting", gender: "Male", weightClass: "+109kg", entryTotal: 218, session: {number: 13, platform: "Blue"} },


  //m40 102-109 a
    { memberId: "172428", name: "Ryan Hansen", age: 41, club: "Warwick Weightlifting Club", gender: "Male", weightClass: "102kg", entryTotal: 280, session: {number: 14, platform: "Blue"} },
  { memberId: "1004378", name: "Anthony Pantazides", age: 41, club: "Cherokee Barbell", gender: "Male", weightClass: "102kg", entryTotal: 260, session: {number: 14, platform: "Blue"} },
  { memberId: "213951", name: "Adrian Francis", age: 42, club: "Wellbuilt Strength", gender: "Male", weightClass: "102kg", entryTotal: 257, session: {number: 14, platform: "Blue"} },
  { memberId: "213890", name: "Steven Bambinelli", age: 40, club: "Vardanian Weightlifting", gender: "Male", weightClass: "102kg", entryTotal: 255, session: {number: 14, platform: "Blue"} },
  { memberId: "210519", name: "david ethier", age: 42, club: "Providence Barbell Club", gender: "Male", weightClass: "102kg", entryTotal: 250, session: {number: 14, platform: "Blue"} },
  { memberId: "162873", name: "Eric Brandom", age: 40, club: "Cheshire Weightlifting Club", gender: "Male", weightClass: "102kg", entryTotal: 245, session: {number: 14, platform: "Blue"} },
  { memberId: "1070027", name: "Mateo Villa", age: 40, club: "RUBBER CITY WEIGHTLIFTING", gender: "Male", weightClass: "109kg", entryTotal: 290, session: {number: 14, platform: "Blue"} },
  { memberId: "206676", name: "John Smith", age: 42, club: "Brave Barbells N Sprinkles WLC", gender: "Male", weightClass: "109kg", entryTotal: 270, session: {number: 14, platform: "Blue"} },
  { memberId: "1051344", name: "Jeffrey Gerlach", age: 41, club: "Vardanian Weightlifting", gender: "Male", weightClass: "109kg", entryTotal: 255, session: {number: 14, platform: "Blue"} },
  { memberId: "206626", name: "Timothy Clouatre", age: 41, club: "Blackheart Barbell", gender: "Male", weightClass: "+109kg", entryTotal: 285, session: {number: 14, platform: "Blue"} },




];