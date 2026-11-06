use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

fn resolve_workspace_root() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("GUMMY_ROOT") {
        let path = PathBuf::from(p);
        if path.is_dir() {
            return Ok(path);
        }
        return Err(format!("GUMMY_ROOT 不是有效目录：{}", path.display()));
    }
    // desktop/src-tauri → 仓库根
    let from_manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    from_manifest
        .canonicalize()
        .map_err(|e| format!("无法定位仓库根目录：{e}"))
}

fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let cleaned = rel.replace('\\', "/");
    if cleaned.contains("..") {
        return Err("路径不允许包含 ..".into());
    }
    Ok(root.join(cleaned))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CharacterInfo {
    name: String,
    has_toyspec: bool,
    has_chart: bool,
    has_gummy: bool,
}

#[tauri::command]
fn workspace_root() -> Result<String, String> {
    Ok(resolve_workspace_root()?.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_workspace_file(rel_path: String) -> Result<String, String> {
    let root = resolve_workspace_root()?;
    let path = safe_join(&root, &rel_path)?;
    fs::read_to_string(&path).map_err(|e| format!("读取失败 {}：{e}", path.display()))
}

#[tauri::command]
fn write_workspace_file(rel_path: String, contents: String) -> Result<(), String> {
    let root = resolve_workspace_root()?;
    let path = safe_join(&root, &rel_path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    fs::write(&path, contents).map_err(|e| format!("写入失败 {}：{e}", path.display()))
}

#[tauri::command]
fn list_characters() -> Result<Vec<CharacterInfo>, String> {
    let root = resolve_workspace_root()?;
    let dir = root.join("characters");
    if !dir.is_dir() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('_') || name.starts_with('.') {
            continue;
        }
        out.push(CharacterInfo {
            has_toyspec: path.join("toyspec.json").is_file(),
            has_chart: path.join("chart.json").is_file(),
            has_gummy: path.join("gummy.html").is_file(),
            name,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
fn ensure_character_dir(name: String) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("角色名不能为空".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("角色名不能包含路径分隔符".into());
    }
    let root = resolve_workspace_root()?;
    let dir = root.join("characters").join(name);
    fs::create_dir_all(&dir).map_err(|e| format!("创建角色目录失败：{e}"))?;
    Ok(format!("characters/{name}"))
}

#[tauri::command]
fn open_path(app: AppHandle, abs_or_rel: String) -> Result<(), String> {
    let path = if Path::new(&abs_or_rel).is_absolute() {
        PathBuf::from(&abs_or_rel)
    } else {
        safe_join(&resolve_workspace_root()?, &abs_or_rel)?
    };
    if !path.exists() {
        return Err(format!("文件不存在：{}", path.display()));
    }
    app.opener()
        .open_path(path.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| format!("无法打开：{e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            workspace_root,
            read_workspace_file,
            write_workspace_file,
            list_characters,
            ensure_character_dir,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
