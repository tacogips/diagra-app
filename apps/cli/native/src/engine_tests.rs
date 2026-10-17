use super::*;
use serde_json::{json, Value};

// Engine-independent assertions. Only evaluate() adapts to the interpreter API.
fn evaluate(source: &str, input: Input, directory: Option<std::path::PathBuf>) -> Value {
    let (_runtime, context) = context(input, directory).unwrap();
    context.with(|ctx| {
        let text: String = ctx.eval(format!("JSON.stringify({source})")).unwrap();
        serde_json::from_str(&text).unwrap()
    })
}

#[test]
fn unicode_encoding_and_graphemes_preserve_diagram_labels() {
    assert_eq!(
        evaluate(
            r#"(() => {
        const text = '日本語 e\u0301 👨‍👩‍👧‍👦 𠮷';
        return [new TextDecoder().decode(new TextEncoder().encode(text)),
          [...new Intl.Segmenter().segment('e\u0301👨‍👩‍👧‍👦𠮷')].map(x => x.segment),
          Array.from(new TextEncoder().encode('𠮷'))];
    })()"#,
            Input::Mcp(None),
            None
        ),
        json!([
            "日本語 e\u{301} 👨‍👩‍👧‍👦 𠮷",
            ["e\u{301}", "👨‍👩‍👧‍👦", "𠮷"],
            [240, 160, 174, 183]
        ])
    );
}

#[test]
fn base64_preserves_binary_and_large_attachments() {
    assert_eq!(
        evaluate(
            r#"(() => {
      const bytes = Uint8Array.from({length: 20000}, (_, i) => i % 256);
      const text = Array.from(bytes, b => String.fromCharCode(b)).join('');
      const decoded = atob(btoa(text));
      let invalid = false; try { atob('!invalid!'); } catch { invalid = true; }
      return [decoded.length, Array.from(decoded, c => c.charCodeAt(0)).every((b,i) => b === bytes[i]), invalid];
    })()"#,
            Input::Mcp(None),
            None
        ),
        json!([20000, true, true])
    );
}

#[test]
fn binary_views_write_only_the_selected_bytes_and_attachments_stay_confined() {
    let folder = tempfile::tempdir().unwrap();
    std::fs::write(folder.path().join("doc.jsonl"), "diagram").unwrap();
    assert_eq!(
        evaluate(
            r#"(() => {
      const bytes = new Uint8Array([99,0,128,255,88]);
      native.writeBytes(native.path('image.bin'), bytes.subarray(1,4));
      const data = native.attachment(native.path('doc.jsonl'), 'image.bin');
      let blocked = false;
      try { native.attachment(native.path('doc.jsonl'), '../outside'); } catch { blocked = true; }
      return [Array.from(data), blocked, native.exists(native.path('image.bin')),
        native.readText(native.path('doc.jsonl'))];
    })()"#,
            Input::Mcp(None),
            Some(folder.path().into())
        ),
        json!([[0, 128, 255], true, true, "diagram"])
    );
    assert_eq!(
        std::fs::read(folder.path().join("image.bin")).unwrap(),
        [0, 128, 255]
    );
}

#[test]
fn mcp_input_is_explicit_and_does_not_consume_transport_stdin() {
    assert_eq!(
        evaluate(
            "native.readStdin()",
            Input::Mcp(Some("ops\n日本語".into())),
            None
        ),
        json!("ops\n日本語")
    );
    let missing = evaluate(
        "(() => { try { native.readStdin(); } catch(e) { return e.message; } })()",
        Input::Mcp(None),
        None,
    );
    assert!(missing
        .as_str()
        .unwrap()
        .contains("Supply the MCP tool's stdin field"));
}

#[test]
fn random_values_clone_and_json_preserve_editor_data() {
    assert_eq!(
        evaluate(
            r#"(() => {
      const bytes = new Uint8Array(32); const same = crypto.getRandomValues(bytes) === bytes;
      const original = { label: '日本語', visual: { x: 3 }, list: [null, true, 1.25] };
      const copy = structuredClone(original); copy.visual.x = 9;
      return [same, bytes.length, bytes.some(b => b !== 0), original.visual.x, copy];
    })()"#,
            Input::Mcp(None),
            None
        ),
        json!([true,32,true,3,{"label":"日本語","visual":{"x":9},"list":[null,true,1.25]}])
    );
}

#[test]
fn host_failures_are_catchable_and_do_not_poison_the_context() {
    assert_eq!(
        evaluate(
            r#"(() => {
      let error = ''; try { native.readText('/nodetto-missing-contract-test/doc'); } catch(e) { error = e.message; }
      return [error.length > 0, new TextDecoder().decode(native.utf8('still works'))];
    })()"#,
            Input::Mcp(None),
            None
        ),
        json!([true, "still works"])
    );
}

#[test]
fn fresh_invocations_do_not_share_global_state_and_help_is_valid() {
    assert_eq!(
        evaluate("(globalThis.__contractState = 42)", Input::Mcp(None), None),
        json!(42)
    );
    assert_eq!(
        evaluate("typeof globalThis.__contractState", Input::Mcp(None), None),
        json!("undefined")
    );
    let info = help().unwrap();
    assert!(info["commands"].get("edit").is_some());
    let result = run(vec!["--version".into()], Input::Mcp(None));
    assert_eq!(result.exit_code, 0);
    assert!(result.stdout.contains(env!("CARGO_PKG_VERSION")));
    assert!(result.stderr.is_empty());
}
