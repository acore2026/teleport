#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
  image::Image,
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Manager,
};

const SERVICE_NAME: &str = "teleport";

fn show_main_window(app: &AppHandle) -> Result<(), String> {
  let window = app
    .get_webview_window("main")
    .ok_or_else(|| "Main window is unavailable.".to_string())?;
  window.show().map_err(|error| error.to_string())?;
  window.unminimize().map_err(|error| error.to_string())?;
  window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn focus_main_window(app: AppHandle) -> Result<(), String> {
  show_main_window(&app)
}

#[tauri::command]
fn keychain_get(room: String) -> Result<Option<String>, String> {
  match keyring::Entry::new(SERVICE_NAME, &format!("room:{room}")) {
    Ok(entry) => match entry.get_password() {
      Ok(value) => Ok(Some(value)),
      Err(keyring::Error::NoEntry) => Ok(None),
      Err(error) => Err(error.to_string()),
    },
    Err(error) => Err(error.to_string()),
  }
}

#[tauri::command]
fn keychain_set(room: String, password: String) -> Result<(), String> {
  let entry = keyring::Entry::new(SERVICE_NAME, &format!("room:{room}"))
    .map_err(|error| error.to_string())?;
  entry.set_password(&password).map_err(|error| error.to_string())
}

#[tauri::command]
fn keychain_delete(room: String) -> Result<(), String> {
  let entry = keyring::Entry::new(SERVICE_NAME, &format!("room:{room}"))
    .map_err(|error| error.to_string())?;
  match entry.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(error) => Err(error.to_string()),
  }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
  let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
  let hide_item = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
  let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;
  let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;

  TrayIconBuilder::new()
    .menu(&menu)
    .icon(icon)
    .tooltip("teleport")
    .on_menu_event(|app, event| match event.id.as_ref() {
      "show" => {
        let _ = show_main_window(app);
      }
      "hide" => {
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.hide();
        }
      }
      "quit" => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        let _ = show_main_window(&tray.app_handle());
      }
    })
    .build(app)?;

  Ok(())
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![
      focus_main_window,
      keychain_get,
      keychain_set,
      keychain_delete
    ])
    .setup(|app| {
      build_tray(app)?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running teleport desktop");
}
