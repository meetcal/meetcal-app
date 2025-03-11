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
  }
  
  export const qualifyingTotals: QualifyingTotals = {
    Nationals: {
      Men: {
        ageCategories: [
          {
            name: "Senior",
            weightClasses: [
              { bodyweightDivision: "55kg", qt: "195" },
              { bodyweightDivision: "61kg", qt: "210" },
              { bodyweightDivision: "67kg", qt: "230" },
              { bodyweightDivision: "73kg", qt: "260" },
              { bodyweightDivision: "81kg", qt: "274" },
              { bodyweightDivision: "89kg", qt: "290" },
              { bodyweightDivision: "96kg", qt: "303" },
              { bodyweightDivision: "102kg", qt: "305" },
              { bodyweightDivision: "109kg", qt: "308" },
              { bodyweightDivision: "+109kg", qt: "311" }
            ]
          },
          {
            name: "U25",
            weightClasses: [
              { bodyweightDivision: "55kg", qt: "139" },
              { bodyweightDivision: "61kg", qt: "169" },
              { bodyweightDivision: "67kg", qt: "182" },
              { bodyweightDivision: "73kg", qt: "199" },
              { bodyweightDivision: "81kg", qt: "211" },
              { bodyweightDivision: "89kg", qt: "221" },
              { bodyweightDivision: "96kg", qt: "226" },
              { bodyweightDivision: "102kg", qt: "231" },
              { bodyweightDivision: "109kg", qt: "234" },
              { bodyweightDivision: "+109kg", qt: "236" }
            ]
          },
          {
            name: "U23",
            weightClasses: [
              { bodyweightDivision: "55kg", qt: "137" },
              { bodyweightDivision: "61kg", qt: "167" },
              { bodyweightDivision: "67kg", qt: "180" },
              { bodyweightDivision: "73kg", qt: "197" },
              { bodyweightDivision: "81kg", qt: "209" },
              { bodyweightDivision: "89kg", qt: "219" },
              { bodyweightDivision: "96kg", qt: "224" },
              { bodyweightDivision: "102kg", qt: "229" },
              { bodyweightDivision: "109kg", qt: "232" },
              { bodyweightDivision: "+109kg", qt: "234" }
            ]
          },
          {
            name: "Junior",
            weightClasses: [
              { bodyweightDivision: "55kg", qt: "135" },
              { bodyweightDivision: "61kg", qt: "165" },
              { bodyweightDivision: "67kg", qt: "178" },
              { bodyweightDivision: "73kg", qt: "195" },
              { bodyweightDivision: "81kg", qt: "207" },
              { bodyweightDivision: "89kg", qt: "217" },
              { bodyweightDivision: "96kg", qt: "222" },
              { bodyweightDivision: "102kg", qt: "227" },
              { bodyweightDivision: "109kg", qt: "230" },
              { bodyweightDivision: "+109kg", qt: "232" }
            ]
          },
          {
            name: "U17",
            weightClasses: [
              {bodyweightDivision: "49kg", qt: "103"},
              {bodyweightDivision: "55kg", qt: "115"},
              {bodyweightDivision: "61kg", qt: "130"},
              {bodyweightDivision: "67kg", qt: "145"},
              {bodyweightDivision: "73kg", qt: "158"},
              {bodyweightDivision: "81kg", qt: "170"},
              {bodyweightDivision: "89kg", qt: "180"},
              {bodyweightDivision: "96kg", qt: "190"},
              {bodyweightDivision: "102kg", qt: "194"},
              {bodyweightDivision: "+102kg", qt: "198"}
            ]
          },
          {
            name: "U15",
            weightClasses: [
              {bodyweightDivision: "39kg", qt: "60"},
              {bodyweightDivision: "44kg", qt: "70"},
              {bodyweightDivision: "49kg", qt: "80"},
              {bodyweightDivision: "55kg", qt: "105"},
              {bodyweightDivision: "61kg", qt: "115"},
              {bodyweightDivision: "67kg", qt: "120"},
              {bodyweightDivision: "73kg", qt: "125"},
              {bodyweightDivision: "81kg", qt: "135"},
              {bodyweightDivision: "89kg", qt: "141"},
              {bodyweightDivision: "+89kg", qt: "147"}
            ]
          },
          {
            name: "U13",
            weightClasses: [
              {bodyweightDivision: "32kg", qt: "32"},
              {bodyweightDivision: "36kg", qt: "36"},
              {bodyweightDivision: "39kg", qt: "39"},
              {bodyweightDivision: "44kg", qt: "44"},
              {bodyweightDivision: "49kg", qt: "49"},
              {bodyweightDivision: "55kg", qt: "55"},
              {bodyweightDivision: "61kg", qt: "61"},
              {bodyweightDivision: "67kg", qt: "67"},
              {bodyweightDivision: "73kg", qt: "73"},
              {bodyweightDivision: "+73kg", qt: "74"},
            ]
          }
        ]
      },
      Women: {
        ageCategories: [
          {
            name: "Senior",
            weightClasses: [
              { bodyweightDivision: "45kg", qt: "120" },
              { bodyweightDivision: "49kg", qt: "137" },
              { bodyweightDivision: "55kg", qt: "151" },
              { bodyweightDivision: "59kg", qt: "166" },
              { bodyweightDivision: "64kg", qt: "177" },
              { bodyweightDivision: "71kg", qt: "185" },
              { bodyweightDivision: "76kg", qt: "190" },
              { bodyweightDivision: "81kg", qt: "193" },
              { bodyweightDivision: "87kg", qt: "194" },
              { bodyweightDivision: "+87kg", qt: "195" }
            ]
          },
          {
            name: "U25",
            weightClasses: [
              { bodyweightDivision: "45kg", qt: "89" },
              { bodyweightDivision: "49kg", qt: "104" },
              { bodyweightDivision: "55kg", qt: "121" },
              { bodyweightDivision: "59kg", qt: "130" },
              { bodyweightDivision: "64kg", qt: "135" },
              { bodyweightDivision: "71kg", qt: "138" },
              { bodyweightDivision: "76kg", qt: "143" },
              { bodyweightDivision: "81kg", qt: "147" },
              { bodyweightDivision: "87kg", qt: "152" },
              { bodyweightDivision: "+87kg", qt: "158" }
            ]
          },
          {
            name: "U23",
            weightClasses: [
              { bodyweightDivision: "45kg", qt: "87" },
              { bodyweightDivision: "49kg", qt: "102" },
              { bodyweightDivision: "55kg", qt: "119" },
              { bodyweightDivision: "59kg", qt: "128" },
              { bodyweightDivision: "64kg", qt: "133" },
              { bodyweightDivision: "71kg", qt: "136" },
              { bodyweightDivision: "76kg", qt: "141" },
              { bodyweightDivision: "81kg", qt: "145" },
              { bodyweightDivision: "87kg", qt: "150" },
              { bodyweightDivision: "+87kg", qt: "156" }
            ]
          },
          {
            name: "Junior",
            weightClasses: [
              { bodyweightDivision: "45kg", qt: "85" },
              { bodyweightDivision: "49kg", qt: "100" },
              { bodyweightDivision: "55kg", qt: "117" },
              { bodyweightDivision: "59kg", qt: "126" },
              { bodyweightDivision: "64kg", qt: "131" },
              { bodyweightDivision: "71kg", qt: "134" },
              { bodyweightDivision: "76kg", qt: "139" },
              { bodyweightDivision: "81kg", qt: "143" },
              { bodyweightDivision: "87kg", qt: "148" },
              { bodyweightDivision: "+87kg", qt: "154" }
            ]
          },
          {
            name: "U17",
            weightClasses: [
              {bodyweightDivision: "40kg", qt: "62"},
              {bodyweightDivision: "45kg", qt: "69"},
              {bodyweightDivision: "49kg", qt: "78"},
              {bodyweightDivision: "55kg", qt: "87"},
              {bodyweightDivision: "59kg", qt: "98"},
              {bodyweightDivision: "64kg", qt: "111"},
              {bodyweightDivision: "71kg", qt: "114"},
              {bodyweightDivision: "76kg", qt: "117"},
              {bodyweightDivision: "81kg", qt: "120"},
              {bodyweightDivision: "+81kg", qt: "122"}
            ]
          },
          {
            name: "U15",
            weightClasses: [
              {bodyweightDivision: "36kg", qt: "53"},
              {bodyweightDivision: "40kg", qt: "68"},
              {bodyweightDivision: "45kg", qt: "72"},
              {bodyweightDivision: "49kg", qt: "75"},
              {bodyweightDivision: "55kg", qt: "81"},
              {bodyweightDivision: "59kg", qt: "87"},
              {bodyweightDivision: "64kg", qt: "90"},
              {bodyweightDivision: "71kg", qt: "95"},
              {bodyweightDivision: "76kg", qt: "98"},
              {bodyweightDivision: "+76kg", qt: "100"}
            ]
          },
          {
            name: "U13",
            weightClasses: [
              {bodyweightDivision: "30kg", qt: "30"},
              {bodyweightDivision: "33kg", qt: "33"},
              {bodyweightDivision: "36kg", qt: "36"},
              {bodyweightDivision: "40kg", qt: "40"},
              {bodyweightDivision: "45kg", qt: "45"},
              {bodyweightDivision: "49kg", qt: "49"},
              {bodyweightDivision: "55kg", qt: "55"},
              {bodyweightDivision: "59kg", qt: "59"},
              {bodyweightDivision: "64kg", qt: "64"},
              {bodyweightDivision: "+64kg", qt: "65"}
            ]
          },
        ]
      }
    }
  };