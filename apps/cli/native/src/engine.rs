use crate::{files, render};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use boa_engine::{
    builtins::promise::PromiseState,
    context::HostHooks,
    js_string,
    object::builtins::{JsArray, JsPromise, JsUint8Array},
    Context, JsArgs, JsNativeError, JsResult, JsValue, NativeFunction, Source,
};
use serde::{Deserialize, Serialize};
use std::{io::Read, path::PathBuf, rc::Rc};
use unicode_segmentation::UnicodeSegmentation;
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}
impl CommandResult {
    pub fn error(message: impl std::fmt::Display) -> Self {
        Self {
            exit_code: 2,
            stdout: String::new(),
            stderr: format!("nodetto-cli: {message}\n"),
        }
    }
}

pub enum Input {
    Terminal,
    Mcp(Option<String>),
}

struct HostState {
    input: Input,
    directory: PathBuf,
}

fn host_error(error: impl std::fmt::Display) -> boa_engine::JsError {
    let message = error.to_string();
    let hint =
        if message.contains("Operation not permitted") || message.contains("Permission denied") {
            " Run nodetto-cli authorize <project-folder> to grant Store CLI access."
        } else {
            ""
        };
    JsNativeError::error()
        .with_message(format!("{message}{hint}"))
        .into()
}

fn string(args: &[JsValue], index: usize, ctx: &mut Context) -> JsResult<String> {
    Ok(args
        .get_or_undefined(index)
        .to_string(ctx)?
        .to_std_string_lossy())
}
fn optional_string(args: &[JsValue], index: usize, ctx: &mut Context) -> JsResult<Option<String>> {
    if args.get_or_undefined(index).is_undefined() {
        Ok(None)
    } else {
        string(args, index, ctx).map(Some)
    }
}
fn bytes(value: &JsValue, ctx: &mut Context) -> JsResult<Vec<u8>> {
    let object = value
        .as_object()
        .ok_or_else(|| JsNativeError::typ().with_message("Expected Uint8Array"))?;
    JsUint8Array::from_object(object)?.to_vec(ctx)
}
fn byte_value(bytes: Vec<u8>, ctx: &mut Context) -> JsResult<JsValue> {
    Ok(JsUint8Array::from_iter(bytes, ctx)?.into())
}

// Context-owned Rust data avoids unsafe native closures or global mutable state.
// No JavaScript object is retained outside Boa's garbage-collected handles.
fn host(_this: &JsValue, args: &[JsValue], ctx: &mut Context) -> JsResult<JsValue> {
    let operation = string(args, 0, ctx)?;
    let args = args.get(1..).unwrap_or_default();
    match operation.as_str() {
        "path" => {
            let path = string(args, 0, ctx)?;
            let directory = &ctx
                .get_data::<HostState>()
                .expect("host state installed")
                .directory;
            Ok(js_string!(directory.join(path).to_string_lossy().as_ref()).into())
        }
        "readText" => Ok(js_string!(
            std::fs::read_to_string(string(args, 0, ctx)?).map_err(host_error)?
        )
        .into()),
        "exists" => Ok(std::path::Path::new(&string(args, 0, ctx)?).exists().into()),
        "writeBytes" => {
            let path = string(args, 0, ctx)?;
            let data = bytes(args.get_or_undefined(1), ctx)?;
            files::write_atomic(&path, &data).map_err(host_error)?;
            Ok(JsValue::undefined())
        }
        "attachment" => {
            let document = string(args, 0, ctx)?;
            let path = string(args, 1, ctx)?;
            byte_value(
                files::attachment(&document, &path).map_err(host_error)?,
                ctx,
            )
        }
        "open" => {
            let path = string(args, 0, ctx)?;
            let app = optional_string(args, 1, ctx)?;
            files::open_document(&path, app).map_err(host_error)?;
            Ok(JsValue::undefined())
        }
        "png" => {
            let svg = string(args, 0, ctx)?;
            let scale = args.get_or_undefined(1).to_number(ctx)? as f32;
            let fonts = optional_string(args, 2, ctx)?;
            byte_value(render::png(svg, scale, fonts).map_err(host_error)?, ctx)
        }
        "pdf" => {
            let png = bytes(args.get_or_undefined(0), ctx)?;
            let layout = string(args, 1, ctx)?;
            byte_value(render::pdf(png, layout).map_err(host_error)?, ctx)
        }
        "readStdin" => {
            let text = match &ctx
                .get_data::<HostState>()
                .expect("host state installed")
                .input
            {
                Input::Mcp(Some(text)) => text.clone(),
                Input::Mcp(None) => {
                    return Err(host_error(
                        "Supply the MCP tool's stdin field when using --ops -.",
                    ))
                }
                Input::Terminal => {
                    let mut text = String::new();
                    std::io::stdin()
                        .read_to_string(&mut text)
                        .map_err(host_error)?;
                    text
                }
            };
            Ok(js_string!(text).into())
        }
        "graphemes" => {
            let text = string(args, 0, ctx)?;
            Ok(JsArray::from_iter(
                text.graphemes(true).map(|s| JsValue::from(js_string!(s))),
                ctx,
            )
            .into())
        }
        "utf8" => byte_value(string(args, 0, ctx)?.into_bytes(), ctx),
        "decodeUtf8" => Ok(js_string!(String::from_utf8_lossy(&bytes(
            args.get_or_undefined(0),
            ctx
        )?)
        .as_ref())
        .into()),
        "base64" => Ok(js_string!(STANDARD.encode(bytes(args.get_or_undefined(0), ctx)?)).into()),
        "unbase64" => byte_value(
            STANDARD.decode(string(args, 0, ctx)?).map_err(host_error)?,
            ctx,
        ),
        "random" => {
            let length = args.get_or_undefined(0).to_index(ctx)?;
            if length > 65536 {
                return Err(JsNativeError::range()
                    .with_message("Random request exceeds 65536 bytes")
                    .into());
            }
            byte_value((0..length).map(|_| rand::random::<u8>()).collect(), ctx)
        }
        _ => Err(host_error("Unknown native operation")),
    }
}

// Boa exposes buffer and execution limits, but no QuickJS-style total heap quota.
// Bound individual binary allocations as well as recursion and loop execution.
#[derive(Debug)]
struct EngineHooks;
impl HostHooks for EngineHooks {
    fn max_buffer_size(&self, _context: &mut Context) -> u64 {
        512 * 1024 * 1024
    }
}

pub fn context(input: Input, directory: Option<PathBuf>) -> Result<Context, String> {
    let mut ctx = Context::builder()
        .host_hooks(Rc::new(EngineHooks))
        .build()
        .map_err(|e| e.to_string())?;
    ctx.runtime_limits_mut().set_recursion_limit(512);
    ctx.runtime_limits_mut()
        .set_loop_iteration_limit(100_000_000);
    ctx.insert_data(HostState {
        input,
        directory: directory
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| ".".into())),
    });
    ctx.register_global_builtin_callable(
        js_string!("__nodettoHost"),
        1,
        NativeFunction::from_fn_ptr(host),
    )
    .map_err(|e| e.to_string())?;
    ctx.eval(Source::from_bytes(r#"
        globalThis.native = Object.fromEntries([
          'path','readText','exists','writeBytes','attachment','open','png','pdf',
          'readStdin','graphemes','utf8','decodeUtf8','base64','unbase64','random'
        ].map(name => [name, (...args) => __nodettoHost(name, ...args)]));
        globalThis.TextEncoder = class { encode(text = "") { return native.utf8(String(text)); } };
        globalThis.TextDecoder = class { decode(bytes = []) { return native.decodeUtf8(new Uint8Array(bytes)); } };
        globalThis.btoa = text => native.base64(Uint8Array.from(text, c => c.charCodeAt(0)));
        globalThis.atob = text => { const bytes = native.unbase64(text); const chunks = []; for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.slice(i, i + 8192))); return chunks.join(""); };
        globalThis.Intl = { Segmenter: class { segment(text) { return native.graphemes(text).map(segment => ({ segment })); } } };
        globalThis.crypto = { getRandomValues: bytes => { bytes.set(native.random(bytes.byteLength)); return bytes; } };
        globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
    "#)).map_err(|e| e.to_string())?;
    ctx.eval(Source::from_bytes(include_str!(concat!(
        env!("OUT_DIR"),
        "/diagram.js"
    ))))
    .map_err(|e| e.to_string())?;
    Ok(ctx)
}

pub fn run(mut args: Vec<String>, input: Input) -> CommandResult {
    let directory = if args.first().is_some_and(|arg| arg == "--cwd") {
        if args.len() < 3 {
            return CommandResult::error("--cwd requires a project directory and a command");
        }
        let folder = PathBuf::from(args.remove(1));
        args.remove(0);
        Some(folder)
    } else {
        None
    };
    let mut ctx = match context(input, directory) {
        Ok(ctx) => ctx,
        Err(error) => return CommandResult::error(error),
    };
    execute(&mut ctx, args).unwrap_or_else(CommandResult::error)
}

fn execute(ctx: &mut Context, args: Vec<String>) -> Result<CommandResult, String> {
    let call = ctx
        .global_object()
        .get(js_string!("nodettoRun"), ctx)
        .map_err(|e| e.to_string())?
        .as_callable()
        .ok_or("Missing diagram entrypoint")?;
    let value = call
        .call(
            &JsValue::undefined(),
            &[
                js_string!(serde_json::to_string(&args).unwrap()).into(),
                js_string!(env!("CARGO_PKG_VERSION")).into(),
            ],
            ctx,
        )
        .map_err(|e| e.to_string())?;
    let promise = JsPromise::from_object(value.as_object().ok_or("Expected command promise")?)
        .map_err(|e| e.to_string())?;
    ctx.run_jobs().map_err(|e| e.to_string())?;
    match promise.state() {
        PromiseState::Fulfilled(value) => {
            let text = value
                .as_string()
                .ok_or("Expected command result JSON")?
                .to_std_string_lossy();
            serde_json::from_str(&text).map_err(|e| e.to_string())
        }
        PromiseState::Rejected(error) => Err(error
            .to_string(ctx)
            .map_err(|e| e.to_string())?
            .to_std_string_lossy()),
        PromiseState::Pending => Err("Command promise did not settle".into()),
    }
}

pub fn help() -> Result<serde_json::Value, String> {
    let mut ctx = context(Input::Mcp(None), None)?;
    let value = ctx
        .global_object()
        .get(js_string!("nodettoHelp"), &mut ctx)
        .map_err(|e| e.to_string())?;
    let text = value
        .as_string()
        .ok_or("Missing diagram help")?
        .to_std_string_lossy();
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "engine_tests.rs"]
mod tests;
