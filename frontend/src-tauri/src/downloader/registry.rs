//! Compile-time registry of GGUF model files SovImage downloads on first
//! launch.
//!
//! URLs pinned to specific HuggingFace blobs. SHA256 verified against the
//! `x-linked-etag` header on each file's CDN response — see commit log.
//!
//! Note on `ae.safetensors`: the original `black-forest-labs/FLUX.1-schnell`
//! repo is license-gated (HTTP 401 without auth + license acceptance),
//! unsuitable for one-click installs. We pull the identical VAE blob from
//! `Comfy-Org/Lumina_Image_2.0_Repackaged` which mirrors it ungated.

use crate::hardware::Tier;

#[derive(Debug, Clone, Copy)]
pub struct ModelSpec {
    pub id: &'static str,
    pub file: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub bytes: u64,
    pub role: ModelRole,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelRole {
    Diffusion,
    Vae,
    ClipL,
    T5xxl,
}

// ---------- Diffusion models, one per tier ----------

pub const DIFFUSION_TIER1: ModelSpec = ModelSpec {
    id: "flux1-schnell-q4_0",
    file: "flux1-schnell-Q4_0.gguf",
    url: "https://huggingface.co/city96/FLUX.1-schnell-gguf/resolve/main/flux1-schnell-Q4_0.gguf",
    sha256: "90a393d3a44bec691c707003f434fdde06064b870bb3c206eb7a4f109b25ff4e",
    bytes: 6_770_707_360,
    role: ModelRole::Diffusion,
};

pub const DIFFUSION_TIER2: ModelSpec = ModelSpec {
    id: "flux1-schnell-q8_0",
    file: "flux1-schnell-Q8_0.gguf",
    url: "https://huggingface.co/city96/FLUX.1-schnell-gguf/resolve/main/flux1-schnell-Q8_0.gguf",
    sha256: "f6694941193b10148dbf1f0f498d4ccd3e9875c127fc53946213b68580c66f10",
    bytes: 12_687_821_728,
    role: ModelRole::Diffusion,
};

pub const DIFFUSION_TIER3: ModelSpec = ModelSpec {
    id: "flux1-dev-q8_0",
    file: "flux1-dev-Q8_0.gguf",
    url: "https://huggingface.co/city96/FLUX.1-dev-gguf/resolve/main/flux1-dev-Q8_0.gguf",
    sha256: "129032f32224bf7138f16e18673d8008ba5f84c1ec74063bf4511a8bb4cf553d",
    bytes: 12_708_281_504,
    role: ModelRole::Diffusion,
};

// ---------- Companion files ----------

// VAE: ungated mirror under Comfy-Org/Lumina_Image_2.0_Repackaged. The BFL
// upstream is license-gated and would require interactive auth on first run,
// which breaks the one-click install paradigm.
pub const VAE: ModelSpec = ModelSpec {
    id: "flux-ae",
    file: "ae.safetensors",
    url: "https://huggingface.co/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors",
    sha256: "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
    bytes: 335_304_388,
    role: ModelRole::Vae,
};

pub const CLIP_L: ModelSpec = ModelSpec {
    id: "clip-l",
    file: "clip_l.safetensors",
    url: "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors",
    sha256: "660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd",
    bytes: 246_144_152,
    role: ModelRole::ClipL,
};

pub const T5XXL_FP16: ModelSpec = ModelSpec {
    id: "t5xxl-fp16",
    file: "t5xxl_fp16.safetensors",
    url: "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors",
    sha256: "6e480b09fae049a72d2a8c5fbccb8d3e92febeb233bbe9dfe7256958a9167635",
    bytes: 9_787_841_024,
    role: ModelRole::T5xxl,
};

pub const T5XXL_Q4_K: ModelSpec = ModelSpec {
    id: "t5xxl-q4k",
    file: "t5-v1_1-xxl-encoder-Q4_K_M.gguf",
    url: "https://huggingface.co/city96/t5-v1_1-xxl-encoder-gguf/resolve/main/t5-v1_1-xxl-encoder-Q4_K_M.gguf",
    sha256: "6be2b0b7e2de7cf2919340c88cb802a103a997ce46c53131cec91958c1db1af4",
    bytes: 2_896_123_072,
    role: ModelRole::T5xxl,
};

/// Full set of GGUF files required for a given hardware tier.
///
/// Tier 1 uses the quantized T5 to keep the M1 8 GB box alive; tier 2/3 use
/// fp16 T5.
pub fn manifest(tier: Tier) -> &'static [&'static ModelSpec] {
    match tier {
        Tier::One => &[&DIFFUSION_TIER1, &VAE, &CLIP_L, &T5XXL_Q4_K],
        Tier::Two => &[&DIFFUSION_TIER2, &VAE, &CLIP_L, &T5XXL_FP16],
        Tier::Three => &[&DIFFUSION_TIER3, &VAE, &CLIP_L, &T5XXL_FP16],
    }
}

pub fn total_bytes(tier: Tier) -> u64 {
    manifest(tier).iter().map(|m| m.bytes).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_per_tier_is_complete() {
        for t in [Tier::One, Tier::Two, Tier::Three] {
            let m = manifest(t);
            assert!(m.iter().any(|s| s.role == ModelRole::Diffusion));
            assert!(m.iter().any(|s| s.role == ModelRole::Vae));
            assert!(m.iter().any(|s| s.role == ModelRole::ClipL));
            assert!(m.iter().any(|s| s.role == ModelRole::T5xxl));
        }
    }

    #[test]
    fn total_bytes_roughly_sane() {
        assert!(total_bytes(Tier::One) < total_bytes(Tier::Three));
    }

    #[test]
    fn all_sha256_present() {
        // Guard: if anyone adds a new spec they must populate the hash.
        for spec in [
            &DIFFUSION_TIER1,
            &DIFFUSION_TIER2,
            &DIFFUSION_TIER3,
            &VAE,
            &CLIP_L,
            &T5XXL_FP16,
            &T5XXL_Q4_K,
        ] {
            assert_eq!(
                spec.sha256.len(),
                64,
                "missing sha256 for {}",
                spec.id
            );
            assert!(
                spec.sha256.chars().all(|c| c.is_ascii_hexdigit()),
                "non-hex sha256 for {}: {}",
                spec.id,
                spec.sha256
            );
        }
    }
}
