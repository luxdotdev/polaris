//! Minimal unified-diff parser. Produces one flat row list (file headers, hunk
//! headers and code lines) so the view can be a single uniform list, plus the
//! reconstructed old/new source of each file for syntax highlighting.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    FileHeader,
    Hunk,
    Context,
    Add,
    Del,
}

#[derive(Clone, Copy, Debug)]
pub struct Row {
    pub kind: Kind,
    pub file: u32,
    pub old_no: u32,
    pub new_no: u32,
    /// Byte range of the display text in `Doc::text`.
    pub start: u32,
    pub len: u32,
    /// Byte offset of this line in its side's reconstructed source
    /// (`FileInfo::new_src` for context/add, `old_src` for del).
    pub src_off: u32,
}

pub struct FileInfo {
    pub path: String,
    pub first_row: u32,
    pub end_row: u32,
    pub added: u32,
    pub removed: u32,
    pub is_rust: bool,
    pub old_src: String,
    pub new_src: String,
}

pub struct Doc {
    pub name: String,
    pub text: String,
    pub rows: Vec<Row>,
    pub files: Vec<FileInfo>,
}

impl Doc {
    pub fn line(&self, row: &Row) -> &str {
        &self.text[row.start as usize..(row.start + row.len) as usize]
    }

    pub fn file_of_row(&self, ix: usize) -> usize {
        self.rows.get(ix).map(|r| r.file as usize).unwrap_or(0)
    }
}

fn parse_hunk_header(line: &str) -> (u32, u32) {
    // @@ -a,b +c,d @@
    let mut old = 1;
    let mut new = 1;
    for part in line.split_whitespace().skip(1) {
        if let Some(rest) = part.strip_prefix('-') {
            old = rest.split(',').next().and_then(|s| s.parse().ok()).unwrap_or(1);
        } else if let Some(rest) = part.strip_prefix('+') {
            new = rest.split(',').next().and_then(|s| s.parse().ok()).unwrap_or(1);
            break;
        }
    }
    (old, new)
}

pub fn parse(name: &str, input: &str) -> Doc {
    let mut text = String::with_capacity(input.len());
    let mut rows: Vec<Row> = Vec::with_capacity(input.len() / 40);
    let mut files: Vec<FileInfo> = Vec::new();
    let (mut old_no, mut new_no) = (0u32, 0u32);
    let mut in_hunk = false;

    let push_text = |text: &mut String, s: &str| -> (u32, u32) {
        let start = text.len() as u32;
        if s.contains('\t') {
            text.push_str(&s.replace('\t', "    "));
        } else {
            text.push_str(s);
        }
        (start, text.len() as u32 - start)
    };

    for line in input.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            if let Some(f) = files.last_mut() {
                f.end_row = rows.len() as u32;
            }
            let path = rest
                .rsplit_once(" b/")
                .map(|(_, b)| b.to_string())
                .unwrap_or_else(|| rest.to_string());
            let (start, len) = push_text(&mut text, &path);
            files.push(FileInfo {
                is_rust: path.ends_with(".rs"),
                path,
                first_row: rows.len() as u32,
                end_row: 0,
                added: 0,
                removed: 0,
                old_src: String::new(),
                new_src: String::new(),
            });
            rows.push(Row {
                kind: Kind::FileHeader,
                file: files.len() as u32 - 1,
                old_no: 0,
                new_no: 0,
                start,
                len,
                src_off: 0,
            });
            in_hunk = false;
            continue;
        }
        let Some(file_ix) = files.len().checked_sub(1) else { continue };
        if line.starts_with("@@") {
            (old_no, new_no) = parse_hunk_header(line);
            in_hunk = true;
            let (start, len) = push_text(&mut text, line);
            rows.push(Row {
                kind: Kind::Hunk,
                file: file_ix as u32,
                old_no: 0,
                new_no: 0,
                start,
                len,
                src_off: 0,
            });
            // Keep hunks visually separated in the reconstructed sources.
            let f = &mut files[file_ix];
            if !f.old_src.is_empty() {
                f.old_src.push('\n');
                f.new_src.push('\n');
            }
            continue;
        }
        if !in_hunk {
            continue; // index / --- / +++ / mode lines
        }
        let (kind, body) = match line.as_bytes().first() {
            Some(b'+') => (Kind::Add, &line[1..]),
            Some(b'-') => (Kind::Del, &line[1..]),
            Some(b' ') => (Kind::Context, &line[1..]),
            None => (Kind::Context, ""),
            _ => continue, // "\ No newline at end of file"
        };
        let (start, len) = push_text(&mut text, body);
        let shown = &text[start as usize..(start + len) as usize];
        let f = &mut files[file_ix];
        let src_off;
        let (o, n) = match kind {
            Kind::Add => {
                src_off = f.new_src.len() as u32;
                f.new_src.push_str(shown);
                f.new_src.push('\n');
                f.added += 1;
                new_no += 1;
                (0, new_no - 1)
            }
            Kind::Del => {
                src_off = f.old_src.len() as u32;
                f.old_src.push_str(shown);
                f.old_src.push('\n');
                f.removed += 1;
                old_no += 1;
                (old_no - 1, 0)
            }
            _ => {
                src_off = f.new_src.len() as u32;
                f.new_src.push_str(shown);
                f.new_src.push('\n');
                f.old_src.push_str(shown);
                f.old_src.push('\n');
                old_no += 1;
                new_no += 1;
                (old_no - 1, new_no - 1)
            }
        };
        rows.push(Row { kind, file: file_ix as u32, old_no: o, new_no: n, start, len, src_off });
    }
    if let Some(f) = files.last_mut() {
        f.end_row = rows.len() as u32;
    }
    Doc { name: name.to_string(), text, rows, files }
}
