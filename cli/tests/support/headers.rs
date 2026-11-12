use std::sync::Mutex;

pub(crate) fn request_paths(requests: &Mutex<Vec<String>>) -> Vec<String> {
    requests
        .lock()
        .unwrap()
        .iter()
        .map(|request| request.split(' ').nth(1).unwrap_or_default().to_string())
        .collect()
}

pub(crate) fn authorizations(requests: &Mutex<Vec<String>>) -> Vec<Option<String>> {
    requests
        .lock()
        .unwrap()
        .iter()
        .map(|request| {
            request[..request.find("\r\n\r\n").unwrap()]
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("authorization")
                        .then(|| value.trim().to_string())
                })
        })
        .collect()
}
