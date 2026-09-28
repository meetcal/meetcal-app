use anyhow::Result;
use serde::{Serialize, de::DeserializeOwned};

use crate::utils::backend::get_json;

/// Query used for routes that take no parameters.
const NO_QUERY: &[(&str, &str)] = &[];

/// path: /route
pub async fn get_api_response<T>(path: &str) -> Result<Vec<T>>
where
    T: DeserializeOwned,
{
    get_json(path, NO_QUERY).await
}

/// path: /route
/// query: array of tuples
pub async fn get_api_response_with_query<T, Q>(path: &str, query: &Q) -> Result<Vec<T>>
where
    T: DeserializeOwned,
    Q: Serialize + ?Sized,
{
    get_json(path, query).await
}
