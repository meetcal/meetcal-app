interface WeightClass {
  bodyweightDivision: string;
  qt: string;
}

interface AgeCategory {
  name: string;
  weightClasses: WeightClass[];
}

interface GenderCategory {
  ageCategories: AgeCategory[];
}

interface Event {
  Men: GenderCategory;
  Women: GenderCategory;
}

interface QualifyingTotals {
  Nationals: Event;
  'Virus Series'?: Event;
  'Virus Finals'?: Event;
}

export const qualifyingTotals: QualifyingTotals = {
  Nationals: {
    Men: {
      ageCategories: [
        {
          name: "Senior",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "209" },
            { bodyweightDivision: "65kg", qt: "227" },
            { bodyweightDivision: "71kg", qt: "256" },
            { bodyweightDivision: "79kg", qt: "272" },
            { bodyweightDivision: "88kg", qt: "289" },
            { bodyweightDivision: "98kg", qt: "305" },
            { bodyweightDivision: "110kg", qt: "309" },
            { bodyweightDivision: "110+kg", qt: "312" }
          ]
        },
        {
          name: "U25",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "168" },
            { bodyweightDivision: "65kg", qt: "179" },
            { bodyweightDivision: "71kg", qt: "196" },
            { bodyweightDivision: "79kg", qt: "208" },
            { bodyweightDivision: "88kg", qt: "220" },
            { bodyweightDivision: "98kg", qt: "228" },
            { bodyweightDivision: "110kg", qt: "235" },
            { bodyweightDivision: "110+kg", qt: "237" }
          ]
        },
        {
          name: "U23",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "166" },
            { bodyweightDivision: "65kg", qt: "177" },
            { bodyweightDivision: "71kg", qt: "194" },
            { bodyweightDivision: "79kg", qt: "206" },
            { bodyweightDivision: "88kg", qt: "218" },
            { bodyweightDivision: "98kg", qt: "226" },
            { bodyweightDivision: "110kg", qt: "233" },
            { bodyweightDivision: "110+kg", qt: "235" }
          ]
        },
        {
          name: "Junior",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "164" },
            { bodyweightDivision: "65kg", qt: "175" },
            { bodyweightDivision: "71kg", qt: "192" },
            { bodyweightDivision: "79kg", qt: "204" },
            { bodyweightDivision: "88kg", qt: "216" },
            { bodyweightDivision: "98kg", qt: "224" },
            { bodyweightDivision: "110kg", qt: "231" },
            { bodyweightDivision: "110+kg", qt: "233" }
          ]
        },
        {
          name: "U17",
          weightClasses: [
            { bodyweightDivision: "56kg", qt: "114" },
            { bodyweightDivision: "60kg", qt: "129" },
            { bodyweightDivision: "65kg", qt: "142" },
            { bodyweightDivision: "71kg", qt: "155" },
            { bodyweightDivision: "79kg", qt: "168" },
            { bodyweightDivision: "88kg", qt: "178" },
            { bodyweightDivision: "98kg", qt: "188" },
            { bodyweightDivision: "98+kg", qt: "191" }
          ]
        },
        {
          name: "U15",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "76" },
            { bodyweightDivision: "52kg", qt: "86" },
            { bodyweightDivision: "56kg", qt: "106" },
            { bodyweightDivision: "60kg", qt: "113" },
            { bodyweightDivision: "65kg", qt: "118" },
            { bodyweightDivision: "71kg", qt: "123" },
            { bodyweightDivision: "79kg", qt: "133" },
            { bodyweightDivision: "79+kg", qt: "138" }
          ]
        },
        {
          name: "U13",
          weightClasses: [
            { bodyweightDivision: "40kg", qt: "40" },
            { bodyweightDivision: "44kg", qt: "44" },
            { bodyweightDivision: "48kg", qt: "48" },
            { bodyweightDivision: "52kg", qt: "52" },
            { bodyweightDivision: "56kg", qt: "56" },
            { bodyweightDivision: "60kg", qt: "60" },
            { bodyweightDivision: "65kg", qt: "65" },
            { bodyweightDivision: "65+kg", qt: "66" }
          ]
        },
        {
          name: "U11",
          weightClasses: [
            { bodyweightDivision: "40kg", qt: "40" },
            { bodyweightDivision: "44kg", qt: "44" },
            { bodyweightDivision: "48kg", qt: "48" },
            { bodyweightDivision: "52kg", qt: "52" },
            { bodyweightDivision: "56kg", qt: "56" },
            { bodyweightDivision: "60kg", qt: "60" },
            { bodyweightDivision: "65kg", qt: "65" },
            { bodyweightDivision: "65+kg", qt: "66" }
          ]
        }
      ]
    },
    Women: {
      ageCategories: [
        {
          name: "Senior",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "135" },
            { bodyweightDivision: "53kg", qt: "148" },
            { bodyweightDivision: "58kg", qt: "164" },
            { bodyweightDivision: "63kg", qt: "175" },
            { bodyweightDivision: "69kg", qt: "182" },
            { bodyweightDivision: "77kg", qt: "191" },
            { bodyweightDivision: "86kg", qt: "193" },
            { bodyweightDivision: "86+kg", qt: "195" }
          ]
        },
        {
          name: "U25",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "103" },
            { bodyweightDivision: "53kg", qt: "118" },
            { bodyweightDivision: "58kg", qt: "129" },
            { bodyweightDivision: "63kg", qt: "134" },
            { bodyweightDivision: "69kg", qt: "135" },
            { bodyweightDivision: "77kg", qt: "144" },
            { bodyweightDivision: "86kg", qt: "151" },
            { bodyweightDivision: "86+kg", qt: "156" }
          ]
        },
        {
          name: "U23",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "101" },
            { bodyweightDivision: "53kg", qt: "116" },
            { bodyweightDivision: "58kg", qt: "127" },
            { bodyweightDivision: "63kg", qt: "132" },
            { bodyweightDivision: "69kg", qt: "133" },
            { bodyweightDivision: "77kg", qt: "142" },
            { bodyweightDivision: "86kg", qt: "149" },
            { bodyweightDivision: "86+kg", qt: "154" }
          ]
        },
        {
          name: "Junior",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "99" },
            { bodyweightDivision: "53kg", qt: "114" },
            { bodyweightDivision: "58kg", qt: "125" },
            { bodyweightDivision: "63kg", qt: "130" },
            { bodyweightDivision: "69kg", qt: "131" },
            { bodyweightDivision: "77kg", qt: "140" },
            { bodyweightDivision: "86kg", qt: "147" },
            { bodyweightDivision: "86+kg", qt: "152" }
          ]
        },
        {
          name: "U17",
          weightClasses: [
            { bodyweightDivision: "44kg", qt: "68" },
            { bodyweightDivision: "48kg", qt: "77" },
            { bodyweightDivision: "53kg", qt: "84" },
            { bodyweightDivision: "58kg", qt: "97" },
            { bodyweightDivision: "63kg", qt: "110" },
            { bodyweightDivision: "69kg", qt: "112" },
            { bodyweightDivision: "77kg", qt: "118" },
            { bodyweightDivision: "77+kg", qt: "121" }
          ]
        },
        {
          name: "U15",
          weightClasses: [
            { bodyweightDivision: "40kg", qt: "68" },
            { bodyweightDivision: "44kg", qt: "71" },
            { bodyweightDivision: "48kg", qt: "74" },
            { bodyweightDivision: "53kg", qt: "79" },
            { bodyweightDivision: "58kg", qt: "86" },
            { bodyweightDivision: "63kg", qt: "89" },
            { bodyweightDivision: "69kg", qt: "93" },
            { bodyweightDivision: "69+kg", qt: "96" }
          ]
        },
        {
          name: "U13",
          weightClasses: [
            { bodyweightDivision: "36kg", qt: "36" },
            { bodyweightDivision: "40kg", qt: "40" },
            { bodyweightDivision: "44kg", qt: "44" },
            { bodyweightDivision: "48kg", qt: "48" },
            { bodyweightDivision: "53kg", qt: "53" },
            { bodyweightDivision: "58kg", qt: "58" },
            { bodyweightDivision: "63kg", qt: "63" },
            { bodyweightDivision: "63+kg", qt: "64" }
          ]
        },
        {
          name: "U11",
          weightClasses: [
            { bodyweightDivision: "36kg", qt: "36" },
            { bodyweightDivision: "40kg", qt: "40" },
            { bodyweightDivision: "44kg", qt: "44" },
            { bodyweightDivision: "48kg", qt: "48" },
            { bodyweightDivision: "53kg", qt: "53" },
            { bodyweightDivision: "58kg", qt: "58" },
            { bodyweightDivision: "63kg", qt: "63" },
            { bodyweightDivision: "63+kg", qt: "64" }
          ]
        },
      ]
    }
  }
};