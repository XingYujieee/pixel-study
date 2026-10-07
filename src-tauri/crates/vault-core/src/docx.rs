//! 从 .docx 中提取纯文本，供全文搜索使用（不用于编辑）。

use std::io::{Cursor, Read};

/// 读取 word/document.xml，段落之间换行，去掉标签并还原实体。
pub fn docx_text(bytes: &[u8]) -> Option<String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).ok()?;
    let mut xml = String::new();
    zip.by_name("word/document.xml").ok()?.read_to_string(&mut xml).ok()?;
    Some(xml_to_text(&xml))
}

fn xml_to_text(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len() / 4);
    let mut rest = xml;
    while let Some(lt) = rest.find('<') {
        out.push_str(&unescape(&rest[..lt]));
        let Some(gt) = rest[lt..].find('>') else { break };
        let tag = &rest[lt + 1..lt + gt];
        if tag == "/w:p" || tag.starts_with("w:br") || tag.starts_with("w:cr") {
            out.push('\n');
        } else if tag.starts_with("w:tab") && !tag.starts_with("w:tabs") {
            out.push('\t');
        }
        rest = &rest[lt + gt + 1..];
    }
    out
}

fn unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    pub fn make_docx(paragraphs: &[&str]) -> Vec<u8> {
        let body: String = paragraphs.iter().map(|p| format!("<w:p><w:r><w:t>{p}</w:t></w:r></w:p>")).collect();
        let xml = format!(r#"<?xml version="1.0"?><w:document xmlns:w="x"><w:body>{body}</w:body></w:document>"#);
        let mut buf = Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            z.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(xml.as_bytes()).unwrap();
            z.finish().unwrap();
        }
        buf.into_inner()
    }

    #[test]
    fn extracts_paragraphs() {
        let d = make_docx(&["第一段 &amp; 符号", "第二段"]);
        assert_eq!(docx_text(&d).unwrap(), "第一段 & 符号\n第二段\n");
        assert!(docx_text(b"not a zip").is_none());
    }
}
