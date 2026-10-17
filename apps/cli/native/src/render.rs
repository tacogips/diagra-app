use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref};
use resvg::{tiny_skia, usvg};
use serde::Deserialize;
use std::{io::Cursor, path::Path};

const FONT_FILES: &[&str] = &[
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
    "C:\\Windows\\Fonts\\consola.ttf",
    "C:\\Windows\\Fonts\\YuGothR.ttc",
];

pub fn png(svg: String, scale: f32, font_dir: Option<String>) -> Result<Vec<u8>, String> {
    let mut options = usvg::Options::default();
    let fonts = options.fontdb_mut();
    let files: Vec<_> = FONT_FILES
        .iter()
        .filter(|p| Path::new(p).is_file())
        .collect();
    for file in &files {
        fonts.load_font_file(file).map_err(|e| e.to_string())?;
    }
    if let Some(dir) = &font_dir {
        fonts.load_fonts_dir(dir);
    }
    if files.is_empty() && font_dir.is_none() {
        fonts.load_system_fonts();
    }
    let sans = if files.iter().any(|p| p.contains("Helvetica")) {
        "Helvetica"
    } else if files.iter().any(|p| p.contains("DejaVuSans")) {
        "DejaVuSans"
    } else {
        "Arial"
    };
    fonts.set_sans_serif_family(sans);
    fonts.set_monospace_family(if files.iter().any(|p| p.contains("Menlo")) {
        "Menlo"
    } else if files.iter().any(|p| p.contains("DejaVuSansMono")) {
        "DejaVuSansMono"
    } else {
        "Consolas"
    });
    options.font_family = sans.into();
    let tree = usvg::Tree::from_str(&svg, &options).map_err(|e| e.to_string())?;
    let width = (tree.size().width() * scale).ceil() as u32;
    let height = (tree.size().height() * scale).ceil() as u32;
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || u64::from(width) * u64::from(height) > 32_000_000
    {
        return Err("Raster dimensions exceed the pixel limit".into());
    }
    let mut pixels =
        tiny_skia::Pixmap::new(width, height).ok_or("Cannot allocate render surface")?;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale),
        &mut pixels.as_mut(),
    );
    pixels.encode_png().map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    page_width: f32,
    page_height: f32,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}
pub fn pdf(png: Vec<u8>, layout: String) -> Result<Vec<u8>, String> {
    let layout: Layout = serde_json::from_str(&layout).map_err(|e| e.to_string())?;
    let decoder = png::Decoder::new(Cursor::new(png));
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut buffer = vec![0; reader.output_buffer_size().ok_or("Invalid PNG size")?];
    let image = reader.next_frame(&mut buffer).map_err(|e| e.to_string())?;
    if image.color_type != png::ColorType::Rgba {
        return Err("Expected RGBA PNG from native renderer".into());
    }
    let mut rgb = Vec::with_capacity(image.width as usize * image.height as usize * 3);
    let mut alpha = Vec::with_capacity(image.width as usize * image.height as usize);
    for pixel in buffer[..image.buffer_size()].as_chunks::<4>().0 {
        rgb.extend_from_slice(&pixel[..3]);
        alpha.push(pixel[3]);
    }
    let rgb = miniz_oxide::deflate::compress_to_vec_zlib(&rgb, 6);
    let alpha = miniz_oxide::deflate::compress_to_vec_zlib(&alpha, 6);
    let mut pdf = Pdf::new();
    pdf.catalog(Ref::new(1)).pages(Ref::new(2));
    pdf.pages(Ref::new(2)).kids([Ref::new(3)]).count(1);
    let mut page = pdf.page(Ref::new(3));
    page.parent(Ref::new(2))
        .media_box(Rect::new(0., 0., layout.page_width, layout.page_height))
        .contents(Ref::new(6));
    page.resources()
        .x_objects()
        .pair(Name(b"Image"), Ref::new(4));
    page.finish();
    let mut image_obj = pdf.image_xobject(Ref::new(4), &rgb);
    image_obj.filter(Filter::FlateDecode);
    image_obj
        .width(image.width as i32)
        .height(image.height as i32)
        .bits_per_component(8)
        .s_mask(Ref::new(5));
    image_obj.color_space().device_rgb();
    image_obj.finish();
    let mut mask = pdf.image_xobject(Ref::new(5), &alpha);
    mask.filter(Filter::FlateDecode);
    mask.width(image.width as i32)
        .height(image.height as i32)
        .bits_per_component(8);
    mask.color_space().device_gray();
    mask.finish();
    let mut content = Content::new();
    content
        .save_state()
        .transform([layout.width, 0., 0., layout.height, layout.x, layout.y])
        .x_object(Name(b"Image"))
        .restore_state();
    pdf.stream(Ref::new(6), &content.finish());
    pdf.document_info(Ref::new(7))
        .creator(pdf_writer::TextStr("Nodetto"));
    Ok(pdf.finish())
}
