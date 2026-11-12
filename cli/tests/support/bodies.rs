use std::sync::Mutex;

use serde_json::Value;

pub(crate) fn request_bodies(requests: &Mutex<Vec<String>>) -> Vec<Value> {
    requests
        .lock()
        .unwrap()
        .iter()
        .map(|request| {
            serde_json::from_str(&request[request.find("\r\n\r\n").unwrap() + 4..]).unwrap()
        })
        .collect()
}
