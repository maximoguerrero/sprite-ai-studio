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
  if !path.starts_with("/v1/") || path.contains("..") || !["/v1/models", "/v1/images/generations", "/v1/images/edits"].contains(&path.as_str()) {
    return Err("Unsupported provider API path".to_string());
  }
  let parsed = reqwest::Url::parse(&base_url).map_err(|_| "Invalid provider base URL".to_string())?;
  if !matches!(parsed.scheme(), "https" | "http") || (parsed.scheme() == "http" && parsed.host_str() != Some("localhost") && parsed.host_str() != Some("127.0.0.1")) {
    return Err("Provider URL must use HTTPS except for localhost".to_string());
  }
  let entry = keyring::Entry::new("com.spritestudio.local", &profile_id).map_err(|error| error.to_string())?;
  let api_key = entry.get_password().map_err(|_| "No API key is stored for this provider".to_string())?;
  let normalized_base = base_url.trim_end_matches('/');
  let route = if normalized_base.ends_with("/v1") { path.strip_prefix("/v1").unwrap_or(&path) } else { &path };
  let url = format!("{}{}", normalized_base, route);
  let client = reqwest::Client::new();
  let mut request = client.get(&url).bearer_auth(api_key.clone());
  if let Some(value) = body {
    if path == "/v1/images/edits" && value.get("image_base64").is_some() {
      let encoded = value.get("image_base64").and_then(|item| item.as_str()).ok_or("Invalid image data")?;
      use base64::Engine;
      let image_bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_| "Invalid base64 image data")?;
      if image_bytes.len() > 25 * 1024 * 1024 { return Err("Reference image exceeds 25 MB".to_string()); }
      let mime = value.get("image_mime").and_then(|item| item.as_str()).unwrap_or("image/png");
      let filename = value.get("image_filename").and_then(|item| item.as_str()).unwrap_or("reference.png");
      let mut form = reqwest::multipart::Form::new()
        .text("model", value.get("model").and_then(|item| item.as_str()).unwrap_or_default().to_string())
        .text("prompt", value.get("prompt").and_then(|item| item.as_str()).unwrap_or_default().to_string())
        .part("image", reqwest::multipart::Part::bytes(image_bytes).file_name(filename.to_string()).mime_str(mime).map_err(|error| error.to_string())?);
      if let Some(size) = value.get("size").and_then(|item| item.as_str()) { form = form.text("size", size.to_string()); }
      request = client.post(&url).bearer_auth(api_key).multipart(form);
    } else {
      if path != "/v1/images/generations" && path != "/v1/images/edits" { return Err("Unsupported provider POST route".to_string()); }
      request = client.post(&url).bearer_auth(api_key).json(&value);
    }
  }
  let response = request.send().await.map_err(|error| format!("Provider request failed: {error}"))?;
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
