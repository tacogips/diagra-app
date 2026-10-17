use crate::{files, render};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rquickjs::{Context, Ctx, Exception, Function, Object, Promise, Runtime, TypedArray};
use serde::{Deserialize, Serialize};
use std::io::Read;
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
fn js_error<'js, T>(
    ctx: &Ctx<'js>,
    value: Result<T, impl std::fmt::Display>,
) -> rquickjs::Result<T> {
    value.map_err(|e| {
        let message = e.to_string();
        let hint = if message.contains("Operation not permitted")
            || message.contains("Permission denied")
        {
            " Run nodetto-cli authorize <project-folder> to grant Store CLI access."
        } else {
            ""
        };
        Exception::throw_message(ctx, &format!("{message}{hint}"))
    })
}

fn png_host<'js>(
    ctx: Ctx<'js>,
    svg: String,
    scale: f32,
    font_dir: Option<String>,
) -> rquickjs::Result<TypedArray<'js, u8>> {
    let bytes = js_error(&ctx, render::png(svg, scale, font_dir))?;
    TypedArray::new(ctx, bytes)
}
fn pdf_host<'js>(
    ctx: Ctx<'js>,
    png: TypedArray<'js, u8>,
    layout: String,
) -> rquickjs::Result<TypedArray<'js, u8>> {
    // SAFETY: No JS runs while this host callback borrows the typed array.
    // Copy it before allocating another JS object, so it cannot be detached.
    let bytes = unsafe { png.as_bytes() }
        .ok_or_else(|| Exception::throw_message(&ctx, "Detached PNG buffer"))?
        .to_vec();
    let bytes = js_error(&ctx, render::pdf(bytes, layout))?;
    TypedArray::new(ctx, bytes)
}
fn utf8_host<'js>(ctx: Ctx<'js>, text: String) -> rquickjs::Result<TypedArray<'js, u8>> {
    TypedArray::new(ctx, text.into_bytes())
}
fn attachment_host<'js>(
    ctx: Ctx<'js>,
    document: String,
    path: String,
) -> rquickjs::Result<TypedArray<'js, u8>> {
    let bytes = js_error(&ctx, files::attachment(&document, &path))?;
    TypedArray::new(ctx, bytes)
}
fn write_host<'js>(
    ctx: Ctx<'js>,
    path: String,
    bytes: TypedArray<'js, u8>,
) -> rquickjs::Result<()> {
    // SAFETY: Filesystem I/O does not re-enter JS or detach this array.
    let bytes = unsafe { bytes.as_bytes() }
        .ok_or_else(|| Exception::throw_message(&ctx, "Detached write buffer"))?;
    js_error(&ctx, files::write_atomic(&path, bytes))
}

pub fn context(
    input: Input,
    directory: Option<std::path::PathBuf>,
) -> Result<(Runtime, Context), String> {
    let runtime = Runtime::new().map_err(|e| e.to_string())?;
    runtime.set_memory_limit(512 * 1024 * 1024);
    runtime.set_max_stack_size(8 * 1024 * 1024);
    let context = Context::full(&runtime).map_err(|e| e.to_string())?;
    context.with(|ctx| -> rquickjs::Result<()> {
        let native = Object::new(ctx.clone())?;
        let directory = directory.unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| ".".into()));
        native.set("path", Function::new(ctx.clone(), move |path: String| directory.join(path).to_string_lossy().into_owned())?)?;
        native.set("readText", Function::new(ctx.clone(), |ctx: Ctx<'_>, path: String| js_error(&ctx, std::fs::read_to_string(path)))?)?;
        native.set("exists", Function::new(ctx.clone(), |path: String| std::path::Path::new(&path).exists())?)?;
        native.set("writeBytes", Function::new(ctx.clone(), write_host)?)?;
        native.set("attachment", Function::new(ctx.clone(), attachment_host)?)?;
        native.set("open", Function::new(ctx.clone(), |ctx: Ctx<'_>, path: String, app: Option<String>| js_error(&ctx, files::open_document(&path, app)))?)?;
        native.set("png", Function::new(ctx.clone(), png_host)?)?;
        native.set("pdf", Function::new(ctx.clone(), pdf_host)?)?;
        native.set("readStdin", Function::new(ctx.clone(), move |ctx: Ctx<'_>| {
            match &input {
                Input::Mcp(Some(text)) => Ok(text.clone()),
                Input::Mcp(None) => Err(Exception::throw_message(&ctx, "Supply the MCP tool's stdin field when using --ops -.")),
                Input::Terminal => { let mut text = String::new(); js_error(&ctx, std::io::stdin().read_to_string(&mut text))?; Ok(text) }
            }
        })?)?;
        native.set("graphemes", Function::new(ctx.clone(), |text: String| text.graphemes(true).map(str::to_owned).collect::<Vec<_>>())?)?;
        native.set("utf8", Function::new(ctx.clone(), utf8_host)?)?;
        native.set("decodeUtf8", Function::new(ctx.clone(), |bytes: Vec<u8>| String::from_utf8_lossy(&bytes).into_owned())?)?;
        native.set("base64", Function::new(ctx.clone(), |bytes: Vec<u8>| STANDARD.encode(bytes))?)?;
        native.set("unbase64", Function::new(ctx.clone(), |ctx: Ctx<'_>, text: String| js_error(&ctx, STANDARD.decode(text)))?)?;
        native.set("random", Function::new(ctx.clone(), |length: usize| (0..length).map(|_| rand::random::<u8>()).collect::<Vec<_>>())?)?;
        ctx.globals().set("native", native)?;
        ctx.eval::<(), _>(r#"
            globalThis.TextEncoder = class { encode(text = "") { return new Uint8Array(native.utf8(String(text))); } };
            globalThis.TextDecoder = class { decode(bytes = []) { return native.decodeUtf8(Array.from(bytes)); } };
            globalThis.btoa = text => native.base64(Array.from(text, c => c.charCodeAt(0)));
            globalThis.atob = text => { const bytes = native.unbase64(text); const chunks = []; for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.slice(i, i + 8192))); return chunks.join(""); };
            globalThis.Intl = { Segmenter: class { segment(text) { return native.graphemes(text).map(segment => ({ segment })); } } };
            globalThis.crypto = { getRandomValues: bytes => { bytes.set(native.random(bytes.byteLength)); return bytes; } };
            globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
        "#)?;
        ctx.eval::<(), _>(include_str!(concat!(env!("OUT_DIR"), "/diagram.js")))?;
        Ok(())
    }).map_err(|e| context.with(|ctx| format!("{e}: {:?}", ctx.catch())))?;
    Ok((runtime, context))
}

pub fn run(mut args: Vec<String>, input: Input) -> CommandResult {
    let directory = if args.first().is_some_and(|arg| arg == "--cwd") {
        if args.len() < 3 {
            return CommandResult::error("--cwd requires a project directory and a command");
        }
        let folder = std::path::PathBuf::from(args.remove(1));
        args.remove(0);
        Some(folder)
    } else {
        None
    };
    let (_runtime, context) = match context(input, directory) {
        Ok(value) => value,
        Err(error) => return CommandResult::error(error),
    };
    let result = context.with(|ctx| -> Result<CommandResult, String> {
        let call: Function = ctx.globals().get("nodettoRun").map_err(|e| e.to_string())?;
        let promise: Promise = call
            .call((
                serde_json::to_string(&args).unwrap(),
                env!("CARGO_PKG_VERSION"),
            ))
            .map_err(|e| format!("{e}: {:?}", ctx.catch()))?;
        let text: String = promise
            .finish()
            .map_err(|e| format!("{e}: {:?}", ctx.catch()))?;
        serde_json::from_str(&text).map_err(|e| e.to_string())
    });
    result.unwrap_or_else(CommandResult::error)
}

pub fn help() -> Result<serde_json::Value, String> {
    let (_runtime, context) = context(Input::Mcp(None), None)?;
    context.with(|ctx| {
        let text: String = ctx
            .globals()
            .get("nodettoHelp")
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&text).map_err(|e| e.to_string())
    })
}

#[cfg(test)]
#[path = "engine_tests.rs"]
mod tests;
