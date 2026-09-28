use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfTextItem {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub is_red: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsamwScraperArgs {
    pub meet: Option<String>,
    pub date: Option<String>,
    pub adaptive: bool,
    pub pdf_urls: Vec<String>,
}
