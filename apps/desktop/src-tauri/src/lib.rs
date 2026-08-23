#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}. This message came from Rust.")
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri application");
}
