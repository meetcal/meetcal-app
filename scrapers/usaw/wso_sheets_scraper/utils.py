from typing import Dict, Any


def wso_record_ingest_args(record: Dict[str, Any], scraper_secret: str) -> Dict[str, Any]:
    args: Dict[str, Any] = {
        "scraperSecret": scraper_secret,
        "wso": record["wso"],
        "ageCategory": record["age_category"],
        "gender": record["gender"],
        "weightClass": record["weight_class"],
    }
    if record.get("snatch_record") is not None:
        args["snatchRecord"] = record["snatch_record"]
    if record.get("cj_record") is not None:
        args["cjRecord"] = record["cj_record"]
    if record.get("total_record") is not None:
        args["totalRecord"] = record["total_record"]
    return args
