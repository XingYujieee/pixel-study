use serde::Serialize;

/// 文件层统一错误。序列化为 `{ kind, message }` 交给前端显示。
#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("路径超出笔记库范围：{0}")]
    OutsideVault(String),
    #[error("路径无效：{0}")]
    InvalidPath(String),
    #[error("文件不存在：{0}")]
    NotFound(String),
    #[error("文件已存在：{0}")]
    AlreadyExists(String),
    #[error("文件不是 UTF-8 文本：{0}")]
    NotUtf8(String),
    #[error("没有打开的笔记库")]
    NoVault,
    #[error("文件读写失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("数据格式错误：{0}")]
    Json(#[from] serde_json::Error),
    #[error("文件监听失败：{0}")]
    Watch(String),
}

impl VaultError {
    pub fn kind(&self) -> &'static str {
        match self {
            VaultError::OutsideVault(_) => "outside_vault",
            VaultError::InvalidPath(_) => "invalid_path",
            VaultError::NotFound(_) => "not_found",
            VaultError::AlreadyExists(_) => "already_exists",
            VaultError::NotUtf8(_) => "not_utf8",
            VaultError::NoVault => "no_vault",
            VaultError::Io(_) => "io",
            VaultError::Json(_) => "json",
            VaultError::Watch(_) => "watch",
        }
    }
}

impl Serialize for VaultError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("VaultError", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub type Result<T> = std::result::Result<T, VaultError>;
