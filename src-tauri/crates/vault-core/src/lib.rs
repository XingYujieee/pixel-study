//! 像素书房的文件层。与 Tauri 无关，可以单独测试。
//!
//! - `scope`：库边界与路径校验（风险 7）
//! - `scan` / `index`：扫描与索引（风险 5、8）
//! - `io`：原子读写与写前校验（风险 4）
//! - `session` / `watch`：运行时状态、监听与自写入过滤（风险 4）
//! - `search`：全文搜索（风险 8）
//! - `import`：复制导入
//! - `appdata`：配置、最近打开、恢复草稿

pub mod appdata;
pub mod audio;
pub mod docx;
pub mod error;
pub mod import;
pub mod index;
pub mod io;
pub mod links;
pub mod scan;
pub mod scope;
pub mod search;
pub mod session;
pub mod watch;

pub use error::{Result, VaultError};
pub use scope::Vault;
pub use session::{VaultEvent, VaultSession};
