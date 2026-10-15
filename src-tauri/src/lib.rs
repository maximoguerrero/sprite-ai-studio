#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![store_provider_secret, get_provider_secret, delete_provider_secret, provider_api_request, download_grok_image])
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}

#[tauri::command]
fn store_provider_secret(profile_id: String, secret: String) -> Result<(), String> {
  let entry = keyring::Entry::new("com.spritestudio.local", &profile_id).map_err(|error| error.to_string())?;
  entry.set_password(&secret).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_provider_secret(profile_id: String) -> Result<String, String> {
  let entry = keyring::Entry::new("com.spritestudio.local", &profile_id).map_err(|error| error.to_string())?;
  entry.get_password().map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_provider_secret(profile_id: String) -> Result<(), String> {
  let entry = keyring::Entry::new("com.spritestudio.local", &profile_id).map_err(|error| error.to_string())?;
  entry.delete_credential().map_err(|error| error.to_string())
}

#[tauri::command]
async fn provider_api_request(profile_id: String, base_url: String, path: String, body: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
  let poll_route = body.is_none() && path.starts_with("/v1/videos/") && path.len() <= 100 && !path.contains('?');
  if !path.starts_with("/v1/") || path.contains("..") || !(["/v1/models", "/v1/images/generations", "/v1/images/edits", "/v1/videos/generations"].contains(&path.as_str()) || poll_route) {
    return Err("Unsupported provider API path".to_string());
  }
  let parsed = reqwest::Url::parse(&base_url).map_err(|_| "Invalid provider base URL".to_string())?;
  if !matches!(parsed.scheme(), "https" | "http") {
    return Err("Provider URL must use HTTP or HTTPS".to_string());
  }
  let proxy_base = std::env::var("SPRITE_PROXY_URL").unwrap_or_else(|_| "http://127.0.0.1:8787".to_string());
  let proxy_url = format!("{}/__provider-proxy", proxy_base.trim_end_matches('/'));
  let entry = keyring::Entry::new("com.spritestudio.local", &profile_id).map_err(|error| error.to_string())?;
  let api_key = entry.get_password().map_err(|_| "No API key is stored for this provider".to_string())?;
  let normalized_base = base_url.trim_end_matches('/');
  let route = if normalized_base.ends_with("/v1") { path.strip_prefix("/v1").unwrap_or(&path) } else { &path };
  let url = format!("{}{}", normalized_base, route);
  let client = reqwest::Client::new();
  let mut request = client.get(&proxy_url).bearer_auth(api_key.clone()).header("x-provider-target", url.clone());
  if let Some(value) = body {
    if path == "/v1/images/edits" && (value.get("image_base64").is_some() || value.get("images").is_some()) {
      let image_references: Vec<(Vec<u8>, String)> = if let Some(images) = value.get("images").and_then(|item| item.as_array()) {
        images.iter().map(|image| -> Result<(Vec<u8>, String), String> {
          let encoded = image.get("image_base64").and_then(|item| item.as_str()).ok_or("Invalid image data")?;
          use base64::Engine;
          let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_| "Invalid base64 image data".to_string())?;
          let mime = image.get("image_mime").and_then(|item| item.as_str()).unwrap_or("image/png").to_string();
          Ok((bytes, mime))
        }).collect::<Result<_, String>>()?
      } else {
      let encoded = value.get("image_base64").and_then(|item| item.as_str()).ok_or("Invalid image data")?;
      use base64::Engine;
      let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_| "Invalid base64 image data")?;
      let mime = value.get("image_mime").and_then(|item| item.as_str()).unwrap_or("image/png").to_string();
      vec![(bytes, mime)]
      };
      if image_references.is_empty() || image_references.len() > 4 { return Err("Image edits require between one and four reference images".to_string()); }
      if image_references.iter().map(|(bytes, _)| bytes.len()).sum::<usize>() > 25 * 1024 * 1024 { return Err("Reference images exceed 25 MB total".to_string()); }
      let single_image = image_references.len() == 1;
      let mut form = reqwest::multipart::Form::new()
        .text("model", value.get("model").and_then(|item| item.as_str()).unwrap_or_default().to_string())
        .text("prompt", value.get("prompt").and_then(|item| item.as_str()).unwrap_or_default().to_string());
      for (index, (image_bytes, mime)) in image_references.into_iter().enumerate() {
        let extension = if mime == "image/jpeg" { "jpg" } else if mime == "image/webp" { "webp" } else { "png" };
        let part = reqwest::multipart::Part::bytes(image_bytes).file_name(format!("reference-{}.{}", index + 1, extension)).mime_str(&mime).map_err(|error| error.to_string())?;
        form = form.part(if single_image { "image" } else { "image[]" }, part);
      }
      if let Some(size) = value.get("size").and_then(|item| item.as_str()) { form = form.text("size", size.to_string()); }
      request = client.post(&proxy_url).bearer_auth(api_key).header("x-provider-target", url.clone()).multipart(form);
    } else {
      if path != "/v1/images/generations" && path != "/v1/images/edits" && path != "/v1/videos/generations" { return Err("Unsupported provider POST route".to_string()); }
      request = client.post(&proxy_url).bearer_auth(api_key).header("x-provider-target", url.clone()).json(&value);
    }
  }
  let response = request.send().await.map_err(|error| format!("Provider request failed: {error}. Is the local proxy running? Start it with `npm run proxy` (expects {proxy_url})"))?;
  let status = response.status();
  let text = response.text().await.map_err(|error| error.to_string())?;
  if !status.is_success() {
    return Err(format!("Provider returned {}: {}", status.as_u16(), text.chars().take(600).collect::<String>()));
  }
  serde_json::from_str(&text).map_err(|_| "Provider returned invalid JSON".to_string())
}

#[tauri::command]
async fn download_grok_image(url: String) -> Result<String, String> {
  let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid image URL".to_string())?;
  let host = parsed.host_str().unwrap_or_default();
  if parsed.scheme() != "https" || !(host == "x.ai" || host.ends_with(".x.ai")) {
    return Err("Grok image URLs must use HTTPS on an x.ai host".to_string());
  }
  let client = reqwest::Client::builder()
    .redirect(reqwest::redirect::Policy::none())
    .build()
    .map_err(|error| error.to_string())?;
  let response = client.get(parsed).send().await.map_err(|error| format!("Image download failed: {error}"))?;
  if !response.status().is_success() {
    return Err(format!("Image download returned HTTP {}", response.status().as_u16()));
  }
  let bytes = response.bytes().await.map_err(|error| error.to_string())?;
  if bytes.len() > 25 * 1024 * 1024 {
    return Err("Generated image exceeds 25 MB".to_string());
  }
  use base64::Engine;
  Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}
