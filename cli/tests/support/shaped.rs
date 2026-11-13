use std::io::Write;

use super::server::Reply;

impl Reply {
    pub(crate) fn gzipped(mut self) -> Self {
        use flate2::{Compression, write::GzEncoder};
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&self.body).unwrap();
        self.body = encoder.finish().unwrap();
        self.encoding = Some("gzip");
        self
    }

    pub(crate) fn cut_after(mut self, bytes: usize) -> Self {
        self.cut_after = Some(bytes);
        self
    }
}
