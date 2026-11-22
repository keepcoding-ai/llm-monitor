// LLM Monitor desktop: ao abrir, garante o modo servido (UM processo node,
// `dist-server/index.mjs`, UI + API em 4780) e carrega a UI dele. Exige
// `npm run build` prévio (dist/ + dist-server/); não depende mais do Vite.
//
// Ciclo de vida: o que já respondia antes é reusado e nunca é tocado. O que
// esta janela sobe tem o PID guardado e, ao sair, só essa árvore morre
// (taskkill /PID <pid> /T /F) — nunca por nome.
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Filhos que ESTA instância criou. Server pré-existente nunca entra aqui.
struct Spawned(Mutex<Vec<Child>>);

/// true quando o usuário pediu "Sair"; sem isso, ExitRequested (última janela
/// destruída) é vetado e o app segue vivo na bandeja.
struct Quitting(AtomicBool);

fn env_port(name: &str, default: u16) -> u16 {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

/// Checkout do llm-monitor: LLM_MONITOR_DIR, senão a pasta do repo onde foi buildado.
fn app_dir() -> PathBuf {
    std::env::var("LLM_MONITOR_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/..")))
}

/// GET simples em 127.0.0.1; true se 200 e o corpo contém `needle`.
fn http_ok(port: u16, path: &str, needle: &str) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_secs(3)));
    let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if s.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = Vec::new();
    let _ = s.take(256 * 1024).read_to_end(&mut buf);
    let txt = String::from_utf8_lossy(&buf);
    txt.starts_with("HTTP/1.1 200") && txt.to_lowercase().contains(needle)
}

const HEALTH: &str = "/llm-monitor/api/v1/auto-analysis";

fn api_up(port: u16) -> bool {
    http_ok(port, HEALTH, "enabled")
}
fn web_up(port: u16) -> bool {
    http_ok(port, "/llm-monitor/", "<html")
}

fn spawn_node(dir: &PathBuf, script: &str, args: &[&str], api: u16, log: &str) -> std::io::Result<Child> {
    let node = std::env::var("LLM_MONITOR_NODE").unwrap_or_else(|_| "node".into());
    let logf = std::fs::OpenOptions::new().create(true).append(true).open(std::env::temp_dir().join(log))?;
    let mut cmd = Command::new(node);
    cmd.args(["--max-old-space-size=96", "--max-semi-space-size=1"])
        .arg(dir.join(script))
        .args(args)
        .current_dir(dir)
        .env("LLM_MONITOR_PORT", api.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::from(logf.try_clone()?))
        .stderr(Stdio::from(logf));
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn()
}

fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").arg(pid.to_string()).status();
    }
}

fn js_string(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn set_status(win: &WebviewWindow, msg: &str) {
    let js = format!("(()=>{{const e=document.getElementById('status');if(e)e.textContent={};}})()", js_string(msg));
    let _ = win.eval(&js);
}

fn boot(app: tauri::AppHandle) {
    let win = app.get_webview_window("main").expect("janela main");
    let port = env_port("LLM_MONITOR_PORT", 4780);
    let dir = app_dir();
    {
        let state = app.state::<Spawned>();
        let mut kids = state.0.lock().unwrap();
        if api_up(port) && web_up(port) {
            eprintln!("[desktop] server já respondia em {port}; reusando (não será encerrado)");
        } else {
            if !dir.join("dist-server/index.mjs").exists() || !dir.join("dist/index.html").exists() {
                return set_status(&win, "Build ausente: rode `npm run build` em llm-monitor.");
            }
            match spawn_node(&dir, "dist-server/index.mjs", &[], port, "llm-monitor-desktop-server.log") {
                Ok(c) => {
                    eprintln!("[desktop] server iniciado, pid {}", c.id());
                    set_status(&win, &format!("Subindo o server (pid {})…", c.id()));
                    kids.push(c);
                }
                Err(e) => return set_status(&win, &format!("Não consegui iniciar o server em {}: {e}", dir.display())),
            }
        }
    }
    let t0 = Instant::now();
    // saudável = API + UI servidas pelo mesmo processo na mesma porta
    while !(api_up(port) && web_up(port)) {
        if t0.elapsed() > Duration::from_secs(60) {
            let tmp = std::env::temp_dir();
            return set_status(&win, &format!("O server não respondeu em 1 min. Log: {}", tmp.join("llm-monitor-desktop-server.log").display()));
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    let url: Url = format!("http://localhost:{port}/llm-monitor/").parse().unwrap();
    eprintln!("[desktop] saudável em {:?}; abrindo {url}", t0.elapsed());
    let _ = win.navigate(url);
}

/// Abre/foca a janela. Fechar o X DESTRÓI a janela (libera os processos
/// WebView2); aqui ela é recriada com o mesmo label/tamanho, já na URL do server.
fn show_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let port = env_port("LLM_MONITOR_PORT", 4780);
    let url: Url = format!("http://localhost:{port}/llm-monitor/").parse().unwrap();
    let built = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("LLM Monitor")
        .inner_size(1280.0, 860.0)
        .min_inner_size(380.0, 600.0)
        .build();
    match built {
        Ok(w) => {
            let _ = w.set_focus();
        }
        Err(e) => eprintln!("[desktop] falha ao recriar a janela: {e}"),
    }
}

fn quit(app: &tauri::AppHandle) {
    app.state::<Quitting>().0.store(true, Ordering::SeqCst);
    app.exit(0);
}

fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<Spawned>();
    let mut kids = state.0.lock().unwrap();
    for mut c in kids.drain(..) {
        eprintln!("[desktop] encerrando a árvore do pid {}", c.id());
        kill_tree(c.id());
        let _ = c.wait();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_window(app)))
        .manage(Spawned(Mutex::new(Vec::new())))
        .manage(Quitting(AtomicBool::new(false)))
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Abrir", true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &exit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("LLM Monitor")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| match ev.id().as_ref() {
                    "open" => show_window(app),
                    "quit" => quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                        show_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            let h = app.handle().clone();
            std::thread::spawn(move || boot(h));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erro ao montar o app")
        .run(|app, ev| match ev {
            // última janela destruída (X): segue na bandeja, node vivo
            RunEvent::ExitRequested { api, .. } => {
                if !app.state::<Quitting>().0.load(Ordering::SeqCst) {
                    api.prevent_exit();
                }
            }
            RunEvent::Exit => shutdown(app),
            _ => {}
        });
}
