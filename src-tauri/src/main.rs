#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use enigo::{
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Settings,
};
use std::{thread, time::Duration};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::PageLoadEvent,
    AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

const SERVICE_NAME: &str = "teleport";
const PROXY_CONFIRM_LABEL: &str = "proxy-confirm";
const PROXY_CONFIRM_CLICK_SCRIPT: &str = r##"
(() => {
  const selectors = [
    "#continueBtn",
    "a#continueBtn",
    "button#continueBtn",
    "input#continueBtn",
    "[id='continueBtn']"
  ];
  const accept = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
  if (!accept || window.__teleportProxyAccepted) return;
  window.__teleportProxyAccepted = true;
  accept.scrollIntoView({ block: "center", inline: "center" });
  accept.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
  accept.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
  accept.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  accept.click();
})();
"##;

fn schedule_proxy_autoclick(window: WebviewWindow) {
    thread::spawn(move || {
        for delay in [350_u64, 900, 1600, 2600] {
            thread::sleep(Duration::from_millis(delay));
            let _ = window.eval(PROXY_CONFIRM_CLICK_SCRIPT);
        }
    });
}

fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is unavailable.".to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn show_mini_window_at(app: &AppHandle, position: Option<(f64, f64)>) -> Result<(), String> {
    let window = app
        .get_webview_window("mini")
        .ok_or_else(|| "Mini window is unavailable.".to_string())?;
    if let Some((x, y)) = position {
        let size = window.outer_size().map_err(|error| error.to_string())?;
        let mut next_x = x as i32 - size.width as i32 + 24;
        let mut next_y = y as i32 - size.height as i32 - 12;

        if let Ok(Some(monitor)) = window.current_monitor() {
            let monitor_position = monitor.position();
            let monitor_size = monitor.size();
            let min_x = monitor_position.x + 8;
            let min_y = monitor_position.y + 8;
            let max_x = monitor_position.x + monitor_size.width as i32 - size.width as i32 - 8;
            let max_y = monitor_position.y + monitor_size.height as i32 - size.height as i32 - 8;
            next_x = next_x.clamp(min_x, max_x.max(min_x));
            next_y = next_y.clamp(min_y, max_y.max(min_y));
        } else {
            next_x = next_x.max(8);
            next_y = next_y.max(8);
        }

        let _ = window.set_position(PhysicalPosition::new(next_x, next_y));
    }
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn focus_main_window(app: AppHandle) -> Result<(), String> {
    show_main_window(&app)
}

#[tauri::command]
fn show_full_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("mini") {
        let _ = window.hide();
    }
    show_main_window(&app)
}

#[tauri::command]
fn show_mini_panel(app: AppHandle) -> Result<(), String> {
    show_mini_window_at(&app, None)
}

#[tauri::command]
fn hide_mini_panel(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("mini")
        .ok_or_else(|| "Mini window is unavailable.".to_string())?;
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_mini_panel(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("mini")
        .ok_or_else(|| "Mini window is unavailable.".to_string())?;
    if window.is_visible().unwrap_or(false) {
        window.hide().map_err(|error| error.to_string())
    } else {
        show_mini_window_at(&app, None)
    }
}

#[tauri::command]
fn open_debug_tools(window: WebviewWindow) {
    window.open_devtools();
}

#[tauri::command]
async fn open_proxy_confirmation(app: AppHandle, url: String) -> Result<(), String> {
    let parsed_url = url
        .parse()
        .map_err(|error| format!("Invalid confirmation URL: {error}"))?;

    if let Some(window) = app.get_webview_window(PROXY_CONFIRM_LABEL) {
        window
            .navigate(parsed_url)
            .map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.unminimize().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        schedule_proxy_autoclick(window);
        return Ok(());
    }

    let window =
        WebviewWindowBuilder::new(&app, PROXY_CONFIRM_LABEL, WebviewUrl::External(parsed_url))
            .title("teleport proxy confirmation")
            .inner_size(760.0, 560.0)
            .min_inner_size(420.0, 320.0)
            .resizable(true)
            .center()
            .on_page_load(|window, payload| {
                if matches!(payload.event(), PageLoadEvent::Finished) {
                    schedule_proxy_autoclick(window);
                }
            })
            .build()
            .map_err(|error| error.to_string())?;

    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    schedule_proxy_autoclick(window);
    Ok(())
}

#[tauri::command]
fn press_system_shortcut(action: String) -> Result<(), String> {
    let key = match action.as_str() {
        "copy" => 'c',
        "paste" => 'v',
        _ => return Err("Unsupported shortcut action.".to_string()),
    };
    let modifier = if cfg!(target_os = "macos") {
        Key::Meta
    } else {
        Key::Control
    };
    let mut enigo = Enigo::new(&Settings::default()).map_err(|error| error.to_string())?;
    enigo
        .key(modifier, Press)
        .map_err(|error| error.to_string())?;
    thread::sleep(Duration::from_millis(20));
    enigo
        .key(Key::Unicode(key), Click)
        .map_err(|error| error.to_string())?;
    thread::sleep(Duration::from_millis(20));
    enigo
        .key(modifier, Release)
        .map_err(|error| error.to_string())
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
    entry
        .set_password(&password)
        .map_err(|error| error.to_string())
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
    let panel_item = MenuItem::with_id(app, "panel", "Open panel", true, None::<&str>)?;
    let show_item = MenuItem::with_id(app, "show", "Open full window", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide", "Hide panel", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&panel_item, &show_item, &hide_item, &quit_item])?;
    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;

    TrayIconBuilder::new()
        .menu(&menu)
        .icon(icon)
        .tooltip("teleport")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "panel" => {
                let _ = show_mini_window_at(app, None);
            }
            "show" => {
                let _ = show_full_window(app.clone());
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("mini") {
                    let _ = window.hide();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                position,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_mini_window_at(&tray.app_handle(), Some((position.x, position.y)));
            }
        })
        .build(app)?;

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = show_mini_window_at(app, None);
        }))
        .invoke_handler(tauri::generate_handler![
            focus_main_window,
            show_full_window,
            show_mini_panel,
            hide_mini_panel,
            toggle_mini_panel,
            open_debug_tools,
            open_proxy_confirmation,
            press_system_shortcut,
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
