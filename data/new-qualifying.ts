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
          name: "University",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "142" },
            { bodyweightDivision: "65kg", qt: "157" },
            { bodyweightDivision: "71kg", qt: "168" },
            { bodyweightDivision: "79kg", qt: "179" },
            { bodyweightDivision: "88kg", qt: "190" },
            { bodyweightDivision: "98kg", qt: "197" },
            { bodyweightDivision: "110kg", qt: "202" },
            { bodyweightDivision: "110+kg", qt: "204" }
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
        },
        {
          name: "Masters 35",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "164" },
            { bodyweightDivision: "65kg", qt: "173" },
            { bodyweightDivision: "71kg", qt: "182" },
            { bodyweightDivision: "79kg", qt: "195" },
            { bodyweightDivision: "88kg", qt: "206" },
            { bodyweightDivision: "98kg", qt: "216" },
            { bodyweightDivision: "110kg", qt: "223" },
            { bodyweightDivision: "110+kg", qt: "228" }
          ]
        },
        {
          name: "Masters 40",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "155" },
            { bodyweightDivision: "65kg", qt: "163" },
            { bodyweightDivision: "71kg", qt: "172" },
            { bodyweightDivision: "79kg", qt: "184" },
            { bodyweightDivision: "88kg", qt: "194" },
            { bodyweightDivision: "98kg", qt: "204" },
            { bodyweightDivision: "110kg", qt: "211" },
            { bodyweightDivision: "110+kg", qt: "215" }
          ]
        },
        {
          name: "Masters 45",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "146" },
            { bodyweightDivision: "65kg", qt: "154" },
            { bodyweightDivision: "71kg", qt: "161" },
            { bodyweightDivision: "79kg", qt: "173" },
            { bodyweightDivision: "88kg", qt: "183" },
            { bodyweightDivision: "98kg", qt: "192" },
            { bodyweightDivision: "110kg", qt: "199" },
            { bodyweightDivision: "110+kg", qt: "203" }
          ]
        },
        {
          name: "Masters 50",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "137" },
            { bodyweightDivision: "65kg", qt: "144" },
            { bodyweightDivision: "71kg", qt: "151" },
            { bodyweightDivision: "79kg", qt: "162" },
            { bodyweightDivision: "88kg", qt: "171" },
            { bodyweightDivision: "98kg", qt: "180" },
            { bodyweightDivision: "110kg", qt: "186" },
            { bodyweightDivision: "110+kg", qt: "191" }
          ]
        },
        {
          name: "Masters 55",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "118" },
            { bodyweightDivision: "65kg", qt: "124" },
            { bodyweightDivision: "71kg", qt: "130" },
            { bodyweightDivision: "79kg", qt: "140" },
            { bodyweightDivision: "88kg", qt: "148" },
            { bodyweightDivision: "98kg", qt: "156" },
            { bodyweightDivision: "110kg", qt: "162" },
            { bodyweightDivision: "110+kg", qt: "165" }
          ]
        },
        {
          name: "Masters 60",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "108" },
            { bodyweightDivision: "65kg", qt: "113" },
            { bodyweightDivision: "71kg", qt: "119" },
            { bodyweightDivision: "79kg", qt: "128" },
            { bodyweightDivision: "88kg", qt: "135" },
            { bodyweightDivision: "98kg", qt: "143" },
            { bodyweightDivision: "110kg", qt: "148" },
            { bodyweightDivision: "110+kg", qt: "152" }
          ]
        },
        {
          name: "Masters 65",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "93" },
            { bodyweightDivision: "65kg", qt: "98" },
            { bodyweightDivision: "71kg", qt: "102" },
            { bodyweightDivision: "79kg", qt: "111" },
            { bodyweightDivision: "88kg", qt: "117" },
            { bodyweightDivision: "98kg", qt: "124" },
            { bodyweightDivision: "110kg", qt: "129" },
            { bodyweightDivision: "110+kg", qt: "132" }
          ]
        },
        {
          name: "Masters 70",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "79" },
            { bodyweightDivision: "65kg", qt: "83" },
            { bodyweightDivision: "71kg", qt: "87" },
            { bodyweightDivision: "79kg", qt: "94" },
            { bodyweightDivision: "88kg", qt: "100" },
            { bodyweightDivision: "98kg", qt: "106" },
            { bodyweightDivision: "110kg", qt: "111" },
            { bodyweightDivision: "110+kg", qt: "113" }
          ]
        },
        {
          name: "Masters 75",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "69" },
            { bodyweightDivision: "65kg", qt: "71" },
            { bodyweightDivision: "71kg", qt: "75" },
            { bodyweightDivision: "79kg", qt: "81" },
            { bodyweightDivision: "88kg", qt: "86" },
            { bodyweightDivision: "98kg", qt: "92" },
            { bodyweightDivision: "110kg", qt: "96" },
            { bodyweightDivision: "110+kg", qt: "99" }
          ]
        },
        {
          name: "Masters 80",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "57" },
            { bodyweightDivision: "65kg", qt: "59" },
            { bodyweightDivision: "71kg", qt: "62" },
            { bodyweightDivision: "79kg", qt: "67" },
            { bodyweightDivision: "88kg", qt: "72" },
            { bodyweightDivision: "98kg", qt: "77" },
            { bodyweightDivision: "110kg", qt: "81" },
            { bodyweightDivision: "110+kg", qt: "83" }
          ]
        },
        {
          name: "Masters 85",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "43" },
            { bodyweightDivision: "65kg", qt: "44" },
            { bodyweightDivision: "71kg", qt: "45" },
            { bodyweightDivision: "79kg", qt: "50" },
            { bodyweightDivision: "88kg", qt: "54" },
            { bodyweightDivision: "98kg", qt: "59" },
            { bodyweightDivision: "110kg", qt: "62" },
            { bodyweightDivision: "110+kg", qt: "64" }
          ]
        },
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
          name: "University",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "85" },
            { bodyweightDivision: "53kg", qt: "99" },
            { bodyweightDivision: "58kg", qt: "114" },
            { bodyweightDivision: "63kg", qt: "119" },
            { bodyweightDivision: "69kg", qt: "122" },
            { bodyweightDivision: "77kg", qt: "130" },
            { bodyweightDivision: "86kg", qt: "132" },
            { bodyweightDivision: "86+kg", qt: "138" }
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
        {
          name: "Masters 35",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "83" },
            { bodyweightDivision: "53kg", qt: "90" },
            { bodyweightDivision: "58kg", qt: "96" },
            { bodyweightDivision: "63kg", qt: "102" },
            { bodyweightDivision: "69kg", qt: "108" },
            { bodyweightDivision: "77kg", qt: "116" },
            { bodyweightDivision: "86kg", qt: "119" },
            { bodyweightDivision: "86+kg", qt: "124" }
          ]
        },
        {
          name: "Masters 40",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "78" },
            { bodyweightDivision: "53kg", qt: "85" },
            { bodyweightDivision: "58kg", qt: "91" },
            { bodyweightDivision: "63kg", qt: "96" },
            { bodyweightDivision: "69kg", qt: "102" },
            { bodyweightDivision: "77kg", qt: "110" },
            { bodyweightDivision: "86kg", qt: "112" },
            { bodyweightDivision: "86+kg", qt: "117" }
          ]
        },
        {
          name: "Masters 45",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "74" },
            { bodyweightDivision: "53kg", qt: "80" },
            { bodyweightDivision: "58kg", qt: "85" },
            { bodyweightDivision: "63kg", qt: "90" },
            { bodyweightDivision: "69kg", qt: "96" },
            { bodyweightDivision: "77kg", qt: "103" },
            { bodyweightDivision: "86kg", qt: "106" },
            { bodyweightDivision: "86+kg", qt: "110" }
          ]
        },
        {
          name: "Masters 50",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "69" },
            { bodyweightDivision: "53kg", qt: "75" },
            { bodyweightDivision: "58kg", qt: "80" },
            { bodyweightDivision: "63kg", qt: "85" },
            { bodyweightDivision: "69kg", qt: "89" },
            { bodyweightDivision: "77kg", qt: "97" },
            { bodyweightDivision: "86kg", qt: "99" },
            { bodyweightDivision: "86+kg", qt: "103" }
          ]
        },
        {
          name: "Masters 55",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "59" },
            { bodyweightDivision: "53kg", qt: "63" },
            { bodyweightDivision: "58kg", qt: "68" },
            { bodyweightDivision: "63kg", qt: "72" },
            { bodyweightDivision: "69kg", qt: "76" },
            { bodyweightDivision: "77kg", qt: "83" },
            { bodyweightDivision: "86kg", qt: "85" },
            { bodyweightDivision: "86+kg", qt: "88" }
          ]
        },
        {
          name: "Masters 60",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "49" },
            { bodyweightDivision: "53kg", qt: "54" },
            { bodyweightDivision: "58kg", qt: "58" },
            { bodyweightDivision: "63kg", qt: "61" },
            { bodyweightDivision: "69kg", qt: "64" },
            { bodyweightDivision: "77kg", qt: "71" },
            { bodyweightDivision: "86kg", qt: "72" },
            { bodyweightDivision: "86+kg", qt: "75" }
          ]
        },
        {
          name: "Masters 65",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "44" },
            { bodyweightDivision: "53kg", qt: "48" },
            { bodyweightDivision: "58kg", qt: "52" },
            { bodyweightDivision: "63kg", qt: "55" },
            { bodyweightDivision: "69kg", qt: "58" },
            { bodyweightDivision: "77kg", qt: "64" },
            { bodyweightDivision: "86kg", qt: "65" },
            { bodyweightDivision: "86+kg", qt: "68" }
          ]
        },
        {
          name: "Masters 70",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "39" },
            { bodyweightDivision: "53kg", qt: "42" },
            { bodyweightDivision: "58kg", qt: "46" },
            { bodyweightDivision: "63kg", qt: "49" },
            { bodyweightDivision: "69kg", qt: "51" },
            { bodyweightDivision: "77kg", qt: "57" },
            { bodyweightDivision: "86kg", qt: "58" },
            { bodyweightDivision: "86+kg", qt: "61" }
          ]
        },
        {
          name: "Masters 75",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "38" },
            { bodyweightDivision: "53kg", qt: "37" },
            { bodyweightDivision: "58kg", qt: "39" },
            { bodyweightDivision: "63kg", qt: "42" },
            { bodyweightDivision: "69kg", qt: "44" },
            { bodyweightDivision: "77kg", qt: "49" },
            { bodyweightDivision: "86kg", qt: "50" },
            { bodyweightDivision: "86+kg", qt: "53" }
          ]
        },
      ]
    }
  },
  'Virus Finals': {
    Men: {
      ageCategories: [
        {
          name: "Senior",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "208" },
            { bodyweightDivision: "65kg", qt: "225" },
            { bodyweightDivision: "71kg", qt: "240" },
            { bodyweightDivision: "79kg", qt: "264" },
            { bodyweightDivision: "88kg", qt: "283" },
            { bodyweightDivision: "98kg", qt: "293" },
            { bodyweightDivision: "110kg", qt: "300" },
            { bodyweightDivision: "110+kg", qt: "304" }
          ]
        },
        {
          name: "Junior",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "189" },
            { bodyweightDivision: "65kg", qt: "201" },
            { bodyweightDivision: "71kg", qt: "221" },
            { bodyweightDivision: "79kg", qt: "235" },
            { bodyweightDivision: "88kg", qt: "248" },
            { bodyweightDivision: "98kg", qt: "258" },
            { bodyweightDivision: "110kg", qt: "266" },
            { bodyweightDivision: "110+kg", qt: "268" }
          ]
        },
        {
          name: "U17",
          weightClasses: [
            { bodyweightDivision: "56kg", qt: "131" },
            { bodyweightDivision: "60kg", qt: "148" },
            { bodyweightDivision: "65kg", qt: "163" },
            { bodyweightDivision: "71kg", qt: "178" },
            { bodyweightDivision: "79kg", qt: "193" },
            { bodyweightDivision: "88kg", qt: "205" },
            { bodyweightDivision: "98kg", qt: "216" },
            { bodyweightDivision: "98+kg", qt: "220" }
          ]
        },
        {
          name: "U15",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "87" },
            { bodyweightDivision: "52kg", qt: "99" },
            { bodyweightDivision: "56kg", qt: "122" },
            { bodyweightDivision: "60kg", qt: "130" },
            { bodyweightDivision: "65kg", qt: "136" },
            { bodyweightDivision: "71kg", qt: "141" },
            { bodyweightDivision: "79kg", qt: "153" },
            { bodyweightDivision: "79+kg", qt: "159" }
          ]
        },
        {
          name: "U13",
          weightClasses: [
            { bodyweightDivision: "40kg", qt: "56" },
            { bodyweightDivision: "44kg", qt: "62" },
            { bodyweightDivision: "48kg", qt: "67" },
            { bodyweightDivision: "52kg", qt: "73" },
            { bodyweightDivision: "56kg", qt: "78" },
            { bodyweightDivision: "60kg", qt: "84" },
            { bodyweightDivision: "65kg", qt: "91" },
            { bodyweightDivision: "65+kg", qt: "92" }
          ]
        },
        {
          name: "Masters 35",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "164" },
            { bodyweightDivision: "65kg", qt: "173" },
            { bodyweightDivision: "71kg", qt: "182" },
            { bodyweightDivision: "79kg", qt: "195" },
            { bodyweightDivision: "88kg", qt: "206" },
            { bodyweightDivision: "98kg", qt: "216" },
            { bodyweightDivision: "110kg", qt: "223" },
            { bodyweightDivision: "110+kg", qt: "228" }
          ]
        },
        {
          name: "Masters 40",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "155" },
            { bodyweightDivision: "65kg", qt: "163" },
            { bodyweightDivision: "71kg", qt: "172" },
            { bodyweightDivision: "79kg", qt: "184" },
            { bodyweightDivision: "88kg", qt: "194" },
            { bodyweightDivision: "98kg", qt: "204" },
            { bodyweightDivision: "110kg", qt: "211" },
            { bodyweightDivision: "110+kg", qt: "215" }
          ]
        },
        {
          name: "Masters 45",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "146" },
            { bodyweightDivision: "65kg", qt: "154" },
            { bodyweightDivision: "71kg", qt: "161" },
            { bodyweightDivision: "79kg", qt: "173" },
            { bodyweightDivision: "88kg", qt: "183" },
            { bodyweightDivision: "98kg", qt: "192" },
            { bodyweightDivision: "110kg", qt: "199" },
            { bodyweightDivision: "110+kg", qt: "203" }
          ]
        },
        {
          name: "Masters 50",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "137" },
              { bodyweightDivision: "65kg", qt: "144" },
              { bodyweightDivision: "71kg", qt: "151" },
              { bodyweightDivision: "79kg", qt: "162" },
              { bodyweightDivision: "88kg", qt: "171" },
              { bodyweightDivision: "98kg", qt: "180" },
              { bodyweightDivision: "110kg", qt: "186" },
              { bodyweightDivision: "110+kg", qt: "191" }
          ]
        },
        {
          name: "Masters 55",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "118" },
            { bodyweightDivision: "65kg", qt: "124" },
            { bodyweightDivision: "71kg", qt: "130" },
            { bodyweightDivision: "79kg", qt: "140" },
            { bodyweightDivision: "88kg", qt: "148" },
            { bodyweightDivision: "98kg", qt: "156" },
            { bodyweightDivision: "110kg", qt: "162" },
            { bodyweightDivision: "110+kg", qt: "165" }
          ]
        },
        {
          name: "Masters 60",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "108" },
            { bodyweightDivision: "65kg", qt: "113" },
            { bodyweightDivision: "71kg", qt: "119" },
            { bodyweightDivision: "79kg", qt: "128" },
            { bodyweightDivision: "88kg", qt: "135" },
            { bodyweightDivision: "98kg", qt: "143" },
            { bodyweightDivision: "110kg", qt: "148" },
            { bodyweightDivision: "110+kg", qt: "152" }
          ]
        },
        {
          name: "Masters 65",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "93" },
            { bodyweightDivision: "65kg", qt: "98" },
            { bodyweightDivision: "71kg", qt: "102" },
            { bodyweightDivision: "79kg", qt: "111" },
            { bodyweightDivision: "88kg", qt: "117" },
            { bodyweightDivision: "98kg", qt: "124" },
            { bodyweightDivision: "110kg", qt: "129" },
            { bodyweightDivision: "110+kg", qt: "132" }
          ]
        },
        {
          name: "Masters 70",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "79" },
            { bodyweightDivision: "65kg", qt: "83" },
            { bodyweightDivision: "71kg", qt: "87" },
            { bodyweightDivision: "79kg", qt: "94" },
            { bodyweightDivision: "88kg", qt: "100" },
            { bodyweightDivision: "98kg", qt: "106" },
            { bodyweightDivision: "110kg", qt: "111" },
            { bodyweightDivision: "110+kg", qt: "113" }
          ]
        },
        {
          name: "Masters 75",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "69" },
            { bodyweightDivision: "65kg", qt: "71" },
            { bodyweightDivision: "71kg", qt: "75" },
            { bodyweightDivision: "79kg", qt: "81" },
            { bodyweightDivision: "88kg", qt: "86" },
            { bodyweightDivision: "98kg", qt: "92" },
            { bodyweightDivision: "110kg", qt: "96" },
            { bodyweightDivision: "110+kg", qt: "99" }
          ]
        },
        {
          name: "Masters 80",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "57" },
            { bodyweightDivision: "65kg", qt: "59" },
            { bodyweightDivision: "71kg", qt: "62" },
            { bodyweightDivision: "79kg", qt: "67" },
            { bodyweightDivision: "88kg", qt: "72" },
            { bodyweightDivision: "98kg", qt: "77" },
            { bodyweightDivision: "110kg", qt: "81" },
            { bodyweightDivision: "110+kg", qt: "83" }
          ]
        },
        {
          name: "Masters 85",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "43" },
            { bodyweightDivision: "65kg", qt: "44" },
            { bodyweightDivision: "71kg", qt: "45" },
            { bodyweightDivision: "79kg", qt: "50" },
            { bodyweightDivision: "88kg", qt: "54" },
            { bodyweightDivision: "98kg", qt: "59" },
            { bodyweightDivision: "110kg", qt: "62" },
            { bodyweightDivision: "110+kg", qt: "64" }
          ]
        },
      ]
    },
    Women: {
      ageCategories: [
        {
          name: "Senior",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "128" },
            { bodyweightDivision: "53kg", qt: "146" },
            { bodyweightDivision: "58kg", qt: "158" },
            { bodyweightDivision: "63kg", qt: "168" },
            { bodyweightDivision: "69kg", qt: "172" },
            { bodyweightDivision: "77kg", qt: "181" },
            { bodyweightDivision: "86kg", qt: "185" },
            { bodyweightDivision: "86+kg", qt: "190" }
          ]
        },
        {
          name: "Junior",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "114" },
            { bodyweightDivision: "53kg", qt: "131" },
            { bodyweightDivision: "58kg", qt: "144" },
            { bodyweightDivision: "63kg", qt: "150" },
            { bodyweightDivision: "69kg", qt: "151" },
            { bodyweightDivision: "77kg", qt: "161" },
            { bodyweightDivision: "86kg", qt: "169" },
            { bodyweightDivision: "86+kg", qt: "175" }
          ]
        },
        {
          name: "U17",
          weightClasses: [
            { bodyweightDivision: "44kg", qt: "78" },
            { bodyweightDivision: "48kg", qt: "89" },
            { bodyweightDivision: "53kg", qt: "97" },
            { bodyweightDivision: "58kg", qt: "112" },
            { bodyweightDivision: "63kg", qt: "127" },
            { bodyweightDivision: "69kg", qt: "129" },
            { bodyweightDivision: "77kg", qt: "136" },
            { bodyweightDivision: "77+kg", qt: "139" }
          ]
        },
        {
          name: "U15",
          weightClasses: [
            { bodyweightDivision: "40kg", qt: "78" },
            { bodyweightDivision: "44kg", qt: "82" },
            { bodyweightDivision: "48kg", qt: "85" },
            { bodyweightDivision: "53kg", qt: "91" },
            { bodyweightDivision: "58kg", qt: "99" },
            { bodyweightDivision: "63kg", qt: "102" },
            { bodyweightDivision: "69kg", qt: "107" },
            { bodyweightDivision: "69+kg", qt: "110" }
          ]
        },
        {
          name: "U13",
          weightClasses: [
            { bodyweightDivision: "36kg", qt: "50" },
            { bodyweightDivision: "40kg", qt: "56" },
            { bodyweightDivision: "44kg", qt: "62" },
            { bodyweightDivision: "48kg", qt: "67" },
            { bodyweightDivision: "53kg", qt: "74" },
            { bodyweightDivision: "58kg", qt: "81" },
            { bodyweightDivision: "63kg", qt: "88" },
            { bodyweightDivision: "63+kg", qt: "90" }
          ]
        },
        {
          name: "Masters 35",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "83" },
            { bodyweightDivision: "53kg", qt: "90" },
            { bodyweightDivision: "58kg", qt: "96" },
            { bodyweightDivision: "63kg", qt: "102" },
            { bodyweightDivision: "69kg", qt: "108" },
            { bodyweightDivision: "77kg", qt: "116" },
            { bodyweightDivision: "86kg", qt: "119" },
            { bodyweightDivision: "86+kg", qt: "124" }
          ]
        },
        {
          name: "Masters 40",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "78" },
            { bodyweightDivision: "53kg", qt: "85" },
            { bodyweightDivision: "58kg", qt: "91" },
            { bodyweightDivision: "63kg", qt: "96" },
            { bodyweightDivision: "69kg", qt: "102" },
            { bodyweightDivision: "77kg", qt: "110" },
            { bodyweightDivision: "86kg", qt: "112" },
            { bodyweightDivision: "86+kg", qt: "117" }
          ]
        },
        {
          name: "Masters 45",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "74" },
            { bodyweightDivision: "53kg", qt: "80" },
            { bodyweightDivision: "58kg", qt: "85" },
            { bodyweightDivision: "63kg", qt: "90" },
            { bodyweightDivision: "69kg", qt: "96" },
            { bodyweightDivision: "77kg", qt: "103" },
            { bodyweightDivision: "86kg", qt: "106" },
            { bodyweightDivision: "86+kg", qt: "110" }
          ]
        },
        {
          name: "Masters 50",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "69" },
            { bodyweightDivision: "53kg", qt: "75" },
            { bodyweightDivision: "58kg", qt: "80" },
            { bodyweightDivision: "63kg", qt: "85" },
            { bodyweightDivision: "69kg", qt: "89" },
            { bodyweightDivision: "77kg", qt: "97" },
            { bodyweightDivision: "86kg", qt: "99" },
            { bodyweightDivision: "86+kg", qt: "103" }
          ]
        },
        {
          name: "Masters 55",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "59" },
            { bodyweightDivision: "53kg", qt: "63" },
            { bodyweightDivision: "58kg", qt: "68" },
            { bodyweightDivision: "63kg", qt: "72" },
            { bodyweightDivision: "69kg", qt: "76" },
            { bodyweightDivision: "77kg", qt: "83" },
            { bodyweightDivision: "86kg", qt: "85" },
            { bodyweightDivision: "86+kg", qt: "88" }
          ]
        },
        {
          name: "Masters 60",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "49" },
            { bodyweightDivision: "53kg", qt: "54" },
            { bodyweightDivision: "58kg", qt: "58" },
            { bodyweightDivision: "63kg", qt: "61" },
            { bodyweightDivision: "69kg", qt: "64" },
            { bodyweightDivision: "77kg", qt: "71" },
            { bodyweightDivision: "86kg", qt: "72" },
            { bodyweightDivision: "86+kg", qt: "75" }
          ]
        },
        {
          name: "Masters 65",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "44" },
            { bodyweightDivision: "53kg", qt: "48" },
            { bodyweightDivision: "58kg", qt: "52" },
            { bodyweightDivision: "63kg", qt: "55" },
            { bodyweightDivision: "69kg", qt: "58" },
            { bodyweightDivision: "77kg", qt: "64" },
            { bodyweightDivision: "86kg", qt: "65" },
            { bodyweightDivision: "86+kg", qt: "68" }
          ]
        },
        {
          name: "Masters 70",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "39" },
            { bodyweightDivision: "53kg", qt: "42" },
            { bodyweightDivision: "58kg", qt: "46" },
            { bodyweightDivision: "63kg", qt: "49" },
            { bodyweightDivision: "69kg", qt: "51" },
            { bodyweightDivision: "77kg", qt: "57" },
            { bodyweightDivision: "86kg", qt: "58" },
            { bodyweightDivision: "86+kg", qt: "61" }
          ]
        },
        {
          name: "Masters 75",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "38" },
            { bodyweightDivision: "53kg", qt: "37" },
            { bodyweightDivision: "58kg", qt: "39" },
            { bodyweightDivision: "63kg", qt: "42" },
            { bodyweightDivision: "69kg", qt: "44" },
            { bodyweightDivision: "77kg", qt: "49" },
            { bodyweightDivision: "86kg", qt: "50" },
            { bodyweightDivision: "86+kg", qt: "53" }
          ]
        },
        {
          name: "Masters 80",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "44" },
            { bodyweightDivision: "53kg", qt: "44" },
            { bodyweightDivision: "58kg", qt: "44" },
            { bodyweightDivision: "63kg", qt: "44" },
            { bodyweightDivision: "69kg", qt: "44" },
            { bodyweightDivision: "77kg", qt: "44" },
            { bodyweightDivision: "86kg", qt: "46" },
            { bodyweightDivision: "86+kg", qt: "48" }
          ]
        },
      ]
    }
  },
  'Virus Series': {
    Men: {
      ageCategories: [
        {
          name: "Senior",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "135" },
            { bodyweightDivision: "65kg", qt: "162" },
            { bodyweightDivision: "71kg", qt: "171" },
            { bodyweightDivision: "79kg", qt: "196" },
            { bodyweightDivision: "88kg", qt: "205" },
            { bodyweightDivision: "98kg", qt: "219" },
            { bodyweightDivision: "110kg", qt: "231" },
            { bodyweightDivision: "110+kg", qt: "236" }
          ]
        },
        {
          name: "Junior",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "136" },
            { bodyweightDivision: "65kg", qt: "162" },
            { bodyweightDivision: "71kg", qt: "171" },
            { bodyweightDivision: "79kg", qt: "196" },
            { bodyweightDivision: "88kg", qt: "206" },
            { bodyweightDivision: "98kg", qt: "219" },
            { bodyweightDivision: "110kg", qt: "223" },
            { bodyweightDivision: "110+kg", qt: "235" }
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
          name: "Masters 35",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "133" },
            { bodyweightDivision: "65kg", qt: "155" },
            { bodyweightDivision: "71kg", qt: "156" },
            { bodyweightDivision: "79kg", qt: "166" },
            { bodyweightDivision: "88kg", qt: "177" },
            { bodyweightDivision: "98kg", qt: "190" },
            { bodyweightDivision: "110kg", qt: "205" },
            { bodyweightDivision: "110+kg", qt: "210" }
          ]
        },
        {
          name: "Masters 40",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "133" },
            { bodyweightDivision: "65kg", qt: "146" },
            { bodyweightDivision: "71kg", qt: "148" },
            { bodyweightDivision: "79kg", qt: "156" },
            { bodyweightDivision: "88kg", qt: "166" },
            { bodyweightDivision: "98kg", qt: "177" },
            { bodyweightDivision: "110kg", qt: "192" },
            { bodyweightDivision: "110+kg", qt: "198" }
          ]
        },
        {
          name: "Masters 45",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "124" },
            { bodyweightDivision: "65kg", qt: "132" },
            { bodyweightDivision: "71kg", qt: "134" },
            { bodyweightDivision: "79kg", qt: "143" },
            { bodyweightDivision: "88kg", qt: "151" },
            { bodyweightDivision: "98kg", qt: "162" },
            { bodyweightDivision: "110kg", qt: "175" },
            { bodyweightDivision: "110+kg", qt: "180" }
          ]
        },
        {
          name: "Masters 50",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "117" },
            { bodyweightDivision: "65kg", qt: "123" },
            { bodyweightDivision: "71kg", qt: "126" },
            { bodyweightDivision: "79kg", qt: "134" },
            { bodyweightDivision: "88kg", qt: "142" },
            { bodyweightDivision: "98kg", qt: "152" },
            { bodyweightDivision: "110kg", qt: "165" },
            { bodyweightDivision: "110+kg", qt: "169" }
          ]
        },
        {
          name: "Masters 55",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "98" },
            { bodyweightDivision: "65kg", qt: "104" },
            { bodyweightDivision: "71kg", qt: "106" },
            { bodyweightDivision: "79kg", qt: "112" },
            { bodyweightDivision: "88kg", qt: "119" },
            { bodyweightDivision: "98kg", qt: "128" },
            { bodyweightDivision: "110kg", qt: "142" },
            { bodyweightDivision: "110+kg", qt: "145" }
          ]
        },
        {
          name: "Masters 60",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "90" },
            { bodyweightDivision: "65kg", qt: "95" },
            { bodyweightDivision: "71kg", qt: "97" },
            { bodyweightDivision: "79kg", qt: "103" },
            { bodyweightDivision: "88kg", qt: "109" },
            { bodyweightDivision: "98kg", qt: "118" },
            { bodyweightDivision: "110kg", qt: "129" },
            { bodyweightDivision: "110+kg", qt: "132" }
          ]
        },
        {
          name: "Masters 65",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "78" },
            { bodyweightDivision: "65kg", qt: "82" },
            { bodyweightDivision: "71kg", qt: "84" },
            { bodyweightDivision: "79kg", qt: "89" },
            { bodyweightDivision: "88kg", qt: "95" },
            { bodyweightDivision: "98kg", qt: "103" },
            { bodyweightDivision: "110kg", qt: "113" },
            { bodyweightDivision: "110+kg", qt: "116" }
          ]
        },
        {
          name: "Masters 70",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "66" },
            { bodyweightDivision: "65kg", qt: "69" },
            { bodyweightDivision: "71kg", qt: "71" },
            { bodyweightDivision: "79kg", qt: "77" },
            { bodyweightDivision: "88kg", qt: "82" },
            { bodyweightDivision: "98kg", qt: "89" },
            { bodyweightDivision: "110kg", qt: "99" },
            { bodyweightDivision: "110+kg", qt: "100" }
          ]
        },
        {
          name: "Masters 75",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "57" },
            { bodyweightDivision: "65kg", qt: "59" },
            { bodyweightDivision: "71kg", qt: "61" },
            { bodyweightDivision: "79kg", qt: "64" },
            { bodyweightDivision: "88kg", qt: "68" },
            { bodyweightDivision: "98kg", qt: "74" },
            { bodyweightDivision: "110kg", qt: "82" },
            { bodyweightDivision: "110+kg", qt: "84" }
          ]
        },
        {
          name: "Masters 80",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "48" },
            { bodyweightDivision: "65kg", qt: "48" },
            { bodyweightDivision: "71kg", qt: "50" },
            { bodyweightDivision: "79kg", qt: "54" },
            { bodyweightDivision: "88kg", qt: "57" },
            { bodyweightDivision: "98kg", qt: "62" },
            { bodyweightDivision: "110kg", qt: "68" },
            { bodyweightDivision: "110+kg", qt: "69" }
          ]
        },
        {
          name: "Masters 85",
          weightClasses: [
            { bodyweightDivision: "60kg", qt: "35" },
            { bodyweightDivision: "65kg", qt: "36" },
            { bodyweightDivision: "71kg", qt: "38" },
            { bodyweightDivision: "79kg", qt: "40" },
            { bodyweightDivision: "88kg", qt: "44" },
            { bodyweightDivision: "98kg", qt: "48" },
            { bodyweightDivision: "110kg", qt: "53" },
            { bodyweightDivision: "110+kg", qt: "54" }
          ]
        },
      ]
    },
    Women: {
      ageCategories: [
        {
          name: "Senior",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "86" },
            { bodyweightDivision: "53kg", qt: "94" },
            { bodyweightDivision: "58kg", qt: "101" },
            { bodyweightDivision: "63kg", qt: "111" },
            { bodyweightDivision: "69kg", qt: "121" },
            { bodyweightDivision: "77kg", qt: "128" },
            { bodyweightDivision: "86kg", qt: "132" },
            { bodyweightDivision: "86+kg", qt: "138" }
          ]
        },
        {
          name: "Junior",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "86" },
            { bodyweightDivision: "53kg", qt: "94" },
            { bodyweightDivision: "58kg", qt: "102" },
            { bodyweightDivision: "63kg", qt: "112" },
            { bodyweightDivision: "69kg", qt: "121" },
            { bodyweightDivision: "77kg", qt: "128" },
            { bodyweightDivision: "86kg", qt: "133" },
            { bodyweightDivision: "86+kg", qt: "136" }
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
          name: "Masters 35",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "73" },
            { bodyweightDivision: "53kg", qt: "79" },
            { bodyweightDivision: "58kg", qt: "87" },
            { bodyweightDivision: "63kg", qt: "91" },
            { bodyweightDivision: "69kg", qt: "95" },
            { bodyweightDivision: "77kg", qt: "101" },
            { bodyweightDivision: "86kg", qt: "105" },
            { bodyweightDivision: "86+kg", qt: "112" }
          ]
        },
        {
          name: "Masters 40",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "66" },
            { bodyweightDivision: "53kg", qt: "71" },
            { bodyweightDivision: "58kg", qt: "78" },
            { bodyweightDivision: "63kg", qt: "82" },
            { bodyweightDivision: "69kg", qt: "87" },
            { bodyweightDivision: "77kg", qt: "93" },
            { bodyweightDivision: "86kg", qt: "96" },
            { bodyweightDivision: "86+kg", qt: "103" }
          ]
        },
        {
          name: "Masters 45",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "63" },
            { bodyweightDivision: "53kg", qt: "67" },
            { bodyweightDivision: "58kg", qt: "73" },
            { bodyweightDivision: "63kg", qt: "79" },
            { bodyweightDivision: "69kg", qt: "80" },
            { bodyweightDivision: "77kg", qt: "87" },
            { bodyweightDivision: "86kg", qt: "91" },
            { bodyweightDivision: "86+kg", qt: "97" }
          ]
        },
        {
          name: "Masters 50",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "59" },
            { bodyweightDivision: "53kg", qt: "63" },
            { bodyweightDivision: "58kg", qt: "69" },
            { bodyweightDivision: "63kg", qt: "73" },
            { bodyweightDivision: "69kg", qt: "77" },
            { bodyweightDivision: "77kg", qt: "82" },
            { bodyweightDivision: "86kg", qt: "85" },
            { bodyweightDivision: "86+kg", qt: "92" }
          ]
        },
        {
          name: "Masters 55",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "44" },
            { bodyweightDivision: "53kg", qt: "47" },
            { bodyweightDivision: "58kg", qt: "53" },
            { bodyweightDivision: "63kg", qt: "56" },
            { bodyweightDivision: "69kg", qt: "58" },
            { bodyweightDivision: "77kg", qt: "63" },
            { bodyweightDivision: "86kg", qt: "66" },
            { bodyweightDivision: "86+kg", qt: "71" }
          ]
        },
        {
          name: "Masters 60",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "40" },
            { bodyweightDivision: "53kg", qt: "43" },
            { bodyweightDivision: "58kg", qt: "48" },
            { bodyweightDivision: "63kg", qt: "51" },
            { bodyweightDivision: "69kg", qt: "53" },
            { bodyweightDivision: "77kg", qt: "58" },
            { bodyweightDivision: "86kg", qt: "61" },
            { bodyweightDivision: "86+kg", qt: "63" }
          ]
        },
        {
          name: "Masters 65",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "37" },
            { bodyweightDivision: "53kg", qt: "39" },
            { bodyweightDivision: "58kg", qt: "43" },
            { bodyweightDivision: "63kg", qt: "45" },
            { bodyweightDivision: "69kg", qt: "47" },
            { bodyweightDivision: "77kg", qt: "52" },
            { bodyweightDivision: "86kg", qt: "55" },
            { bodyweightDivision: "86+kg", qt: "58" }
          ]
        },
        {
          name: "Masters 70",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "33" },
            { bodyweightDivision: "53kg", qt: "35" },
            { bodyweightDivision: "58kg", qt: "38" },
            { bodyweightDivision: "63kg", qt: "40" },
            { bodyweightDivision: "69kg", qt: "42" },
            { bodyweightDivision: "77kg", qt: "47" },
            { bodyweightDivision: "86kg", qt: "49" },
            { bodyweightDivision: "86+kg", qt: "51" }
          ]
        },
        {
          name: "Masters 75",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "28" },
            { bodyweightDivision: "53kg", qt: "30" },
            { bodyweightDivision: "58kg", qt: "33" },
            { bodyweightDivision: "63kg", qt: "35" },
            { bodyweightDivision: "69kg", qt: "36" },
            { bodyweightDivision: "77kg", qt: "41" },
            { bodyweightDivision: "86kg", qt: "43" },
            { bodyweightDivision: "86+kg", qt: "44" }
          ]
        },
        {
          name: "Masters 80",
          weightClasses: [
            { bodyweightDivision: "48kg", qt: "29" },
            { bodyweightDivision: "53kg", qt: "31" },
            { bodyweightDivision: "58kg", qt: "34" },
            { bodyweightDivision: "63kg", qt: "36" },
            { bodyweightDivision: "69kg", qt: "37" },
            { bodyweightDivision: "77kg", qt: "43" },
            { bodyweightDivision: "86kg", qt: "45" },
            { bodyweightDivision: "86+kg", qt: "46" }
          ]
        },
      ]
    }
  },
};