use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;
use tracing::error;

use crate::commands::db::Message;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Emit an `error` event on the per-message channel BEFORE returning Err
/// from `generate_image`. Without this the frontend (which inserted a
/// placeholder DB row and a listener BEFORE calling us) would have no way
/// to know the request failed; the bubble would stay `pending` forever.
fn emit_failure(app: &AppHandle, message_id: &str, msg: &str) {
    let _ = app.emit(
        &format!("generation://{message_id}"),
        json!({ "event": "error", "message": msg }),
    );
}

#[cfg(not(feature = "stub_runtime"))]
use crate::hardware::Tier as HwTier;
#[cfg(not(feature = "stub_runtime"))]
use crate::sidecar::{self, GenerateRequest, ModelPaths, Tier};

#[tauri::command]
pub async fn generate_image(
    app: AppHandle,
    state: State<'_, AppState>,
    message_id: String,
    chat_id: String,
    prompt: String,
    init_image_path: Option<String>,
    negative: Option<String>,
    _meta: Option<serde_json::Value>,
) -> AppResult<Message> {
    // The frontend (lib/db.ts) inserts the placeholder row + subscribes to
    // `generation://<message_id>` events. The Rust sidecar must emit on
    // exactly that channel — never invent its own id here.
    //
    // Validate strictly: empty would collide on `generation://` and write
    // to `<images_dir>/.png`. Restrict to UUID-shape (any RFC4122 variant +
    // hyphens or hex). Anything else is a buggy/malicious caller.
    if message_id.is_empty()
        || message_id.len() > 64
        || !message_id
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        // No emit here — without a valid id we have no channel to emit on.
        return Err(AppError::Other("invalid message_id".into()));
    }
    let id = message_id;
    let now = Utc::now().to_rfc3339();
    let placeholder = Message {
        id: id.clone(),
        chat_id: chat_id.clone(),
        role: "assistant".into(),
        kind: "image".into(),
        content: None,
        image_path: None,
        meta: None,
        parent_id: None,
        status: "pending".into(),
        created_at: now,
    };

    #[cfg(feature = "stub_runtime")]
    {
        let _ = (init_image_path, &prompt);
        return Ok(placeholder);
    }

    #[cfg(not(feature = "stub_runtime"))]
    {
        // Every Err path below must also emit on `generation://<id>` so the
        // frontend listener flips the placeholder to "error" instead of
        // hanging on "pending" forever. The `prepare` helper wraps the
        // pre-spawn setup so we have a single matchpoint for emit + return.
        async fn prepare(
            app: &AppHandle,
            state: &State<'_, AppState>,
            id: &str,
            init_image_path: Option<String>,
        ) -> Result<(Tier, PathBuf, Option<PathBuf>), AppError> {
            let paths = state
                .model_paths
                .lock()
                .await
                .clone()
                .ok_or_else(|| AppError::Other("models not ready yet".into()))?;
            let tier_num = state
                .setup
                .lock()
                .await
                .tier
                .ok_or_else(|| AppError::Other("tier not detected".into()))?;
            let tier = match tier_num {
                1 => Tier::One,
                2 => Tier::Two,
                _ => Tier::Three,
            };

            let data_dir: PathBuf = app
                .path()
                .app_data_dir()
                .map_err(|e| AppError::Other(format!("app_data_dir: {e}")))?;
            let images_dir = data_dir.join("images");
            let attachments_dir = data_dir.join("attachments");
            tokio::fs::create_dir_all(&images_dir).await?;
            let output_png = images_dir.join(format!("{id}.png"));

            let init_image = match init_image_path.as_deref().map(PathBuf::from) {
                None => None,
                Some(raw) => {
                    let canon_root = tokio::fs::canonicalize(&attachments_dir).await.ok();
                    let canon_init = tokio::fs::canonicalize(&raw).await.ok();
                    match (canon_root, canon_init) {
                        (Some(root), Some(p)) if p.starts_with(&root) && p.is_file() => Some(p),
                        _ => {
                            return Err(AppError::Other(
                                "init image must reside under app_data/attachments".into(),
                            ))
                        }
                    }
                }
            };
            // Stash paths through the tuple — model paths re-fetched below.
            let _ = paths;
            Ok((tier, output_png, init_image))
        }

        let (tier, output_png, init_image) =
            match prepare(&app, &state, &id, init_image_path).await {
                Ok(t) => t,
                Err(e) => {
                    emit_failure(&app, &id, &e.to_string());
                    return Err(e);
                }
            };
        // Re-fetch paths after prepare (cheap, mutex already released).
        let paths = state.model_paths.lock().await.clone().unwrap();

        let (steps, cfg, dim) = match tier {
            Tier::One => (4u32, 1.0f32, 512u32),
            Tier::Two => (4, 1.0, 1024),
            Tier::Three => (28, 3.5, 1024),
        };

        let req = GenerateRequest {
            message_id: id.clone(),
            chat_id: chat_id.clone(),
            tier,
            model_paths: ModelPaths {
                diffusion: paths.diffusion,
                vae: paths.vae,
                clip_l: paths.clip_l,
                t5xxl: paths.t5xxl,
            },
            prompt,
            // Negative prompt is honored only at tier 3 (Flux-dev w/ cfg 3.5);
            // schnell tiers ignore CFG so a negative would have no effect.
            negative: if matches!(tier, Tier::Three) {
                negative.filter(|s| !s.trim().is_empty())
            } else {
                None
            },
            init_image,
            width: dim,
            height: dim,
            steps,
            cfg,
            seed: -1,
            output_png: output_png.clone(),
        };

        let cancel = Arc::new(CancellationToken::new());
        state
            .generations
            .lock()
            .await
            .insert(id.clone(), cancel.clone());

        let slot = state.generation_slot.clone();
        let app_for_task = app.clone();
        let id_for_task = id.clone();
        tauri::async_runtime::spawn(async move {
            let _permit = match slot.acquire_owned().await {
                Ok(p) => p,
                Err(_) => return,
            };
            if let Err(e) = sidecar::run(app_for_task.clone(), req, cancel).await {
                error!(message_id = %id_for_task, error = %e, "generation failed");
            }
            if let Some(st) = app_for_task.try_state::<AppState>() {
                st.generations.lock().await.remove(&id_for_task);
            }
        });

        Ok(placeholder)
    }
}

#[tauri::command]
pub async fn cancel_generation(
    state: State<'_, AppState>,
    message_id: String,
) -> AppResult<()> {
    if let Some(tok) = state.generations.lock().await.get(&message_id) {
        tok.cancel();
    }
    Ok(())
}
