import { RecordsData } from "@/types/records";

const AGE_GROUP_KEY = "Adaptive";

const MENS_WEIGHT_CLASSES = [
  "60kg",
  "65kg",
  "71kg",
  "79kg",
  "88kg",
  "94kg",
  "110kg",
  "110+kg",
];
const WOMENS_WEIGHT_CLASSES = [
  "48kg",
  "53kg",
  "58kg",
  "63kg",
  "69kg",
  "77kg",
  "86kg",
  "86+kg",
];

const EMPTY_RECORDS_DATA: RecordsData = {} as RecordsData;

export { AGE_GROUP_KEY, EMPTY_RECORDS_DATA, MENS_WEIGHT_CLASSES, WOMENS_WEIGHT_CLASSES };
