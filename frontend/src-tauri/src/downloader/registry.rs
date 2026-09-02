//! Immutable, commercially usable model packs for SovImage.
//!
//! FLUX.2 Klein 4B unifies text generation and reference editing. The model,
//! small VAE decoder, and Qwen3 encoder are all Apache-2.0. Every URL pins the
//! exact Hugging Face repository revision whose LFS metadata supplied the
//! byte length and SHA-256 below.

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
    Llm,
}

#[derive(Debug, Clone, Copy)]
pub struct ModelProfile {
    pub id: &'static str,
    pub files: &'static [&'static ModelSpec],
    pub width: u32,
    pub height: u32,
    pub steps: u32,
    pub cfg: f32,
    pub guidance: f32,
    pub sampler: &'static str,
    pub vae_tiling: bool,
}

pub const FLUX2_KLEIN_Q4: ModelSpec = ModelSpec {
    id: "flux2-klein-4b-q4_0",
    file: "flux-2-klein-4b-Q4_0.gguf",
    url: "https://huggingface.co/leejet/FLUX.2-klein-4B-GGUF/resolve/3b1f5a9dc3abb32238b053aeb3d823c30afdacbd/flux-2-klein-4b-Q4_0.gguf",
    sha256: "d1023499ef3f2f82ff7c50e6778495195c1b6cc34835741778868428111f9ff4",
    bytes: 2_460_378_560,
    role: ModelRole::Diffusion,
};

pub const FLUX2_KLEIN_Q8: ModelSpec = ModelSpec {
    id: "flux2-klein-4b-q8_0",
    file: "flux-2-klein-4b-Q8_0.gguf",
    url: "https://huggingface.co/leejet/FLUX.2-klein-4B-GGUF/resolve/3b1f5a9dc3abb32238b053aeb3d823c30afdacbd/flux-2-klein-4b-Q8_0.gguf",
    sha256: "0bba6951258ec8f92d51114a8fa13e66828297bfff58a738f52729b3ef66fa28",
    bytes: 4_300_629_440,
    role: ModelRole::Diffusion,
};

pub const FLUX2_VAE: ModelSpec = ModelSpec {
    id: "flux2-full-encoder-small-decoder",
    file: "flux2-full-encoder-small-decoder.safetensors",
    url: "https://huggingface.co/black-forest-labs/FLUX.2-small-decoder/resolve/a3efc24f613ef42d9428af62fdbd6f5fd8856c4a/full_encoder_small_decoder.safetensors",
    sha256: "ea4273f02d1fafbf8e1d1c2cf6018ed8748652eb0bf34f2dd91171f16f15ab62",
    bytes: 249_519_092,
    role: ModelRole::Vae,
};

pub const QWEN3_Q4: ModelSpec = ModelSpec {
    id: "qwen3-4b-q4_k_m",
    file: "Qwen3-4B-Q4_K_M.gguf",
    url: "https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/22c9fc8a8c7700b76a1789366280a6a5a1ad1120/Qwen3-4B-Q4_K_M.gguf",
    sha256: "f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a",
    bytes: 2_497_281_312,
    role: ModelRole::Llm,
};

pub const QWEN3_Q8: ModelSpec = ModelSpec {
    id: "qwen3-4b-q8_0",
    file: "Qwen3-4B-Q8_0.gguf",
    url: "https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/22c9fc8a8c7700b76a1789366280a6a5a1ad1120/Qwen3-4B-Q8_0.gguf",
    sha256: "eed555233267a33c7e8ee31682762cc7751b3f6d224039086e0e846f05fffa5d",
    bytes: 4_280_405_792,
    role: ModelRole::Llm,
};

const TIER1_FILES: &[&ModelSpec] = &[&FLUX2_KLEIN_Q4, &FLUX2_VAE, &QWEN3_Q4];
const TIER2_FILES: &[&ModelSpec] = &[&FLUX2_KLEIN_Q4, &FLUX2_VAE, &QWEN3_Q4];
const TIER3_FILES: &[&ModelSpec] = &[&FLUX2_KLEIN_Q8, &FLUX2_VAE, &QWEN3_Q8];
const ALL_MODELS: &[&ModelSpec] = &[
    &FLUX2_KLEIN_Q4,
    &FLUX2_KLEIN_Q8,
    &FLUX2_VAE,
    &QWEN3_Q4,
    &QWEN3_Q8,
];

const TIER1: ModelProfile = ModelProfile {
    id: "flux2-klein-4b-q4-qwen3-q4",
    files: TIER1_FILES,
    width: 768,
    height: 768,
    steps: 4,
    cfg: 1.0,
    // The pinned sd.cpp FLUX.2 Klein recipe uses CFG 1 with its default
    // distilled guidance value, made explicit so CLI defaults cannot drift.
    guidance: 3.5,
    sampler: "euler",
    vae_tiling: true,
};

const TIER2: ModelProfile = ModelProfile {
    id: "flux2-klein-4b-q4-qwen3-q4",
    files: TIER2_FILES,
    width: 1024,
    height: 1024,
    steps: 4,
    cfg: 1.0,
    guidance: 3.5,
    sampler: "euler",
    vae_tiling: true,
};

const TIER3: ModelProfile = ModelProfile {
    id: "flux2-klein-4b-q8-qwen3-q8",
    files: TIER3_FILES,
    width: 1024,
    height: 1024,
    steps: 4,
    cfg: 1.0,
    guidance: 3.5,
    sampler: "euler",
    vae_tiling: false,
};

pub fn profile(tier: Tier) -> &'static ModelProfile {
    match tier {
        Tier::One => &TIER1,
        Tier::Two => &TIER2,
        Tier::Three => &TIER3,
    }
}

pub fn manifest(tier: Tier) -> &'static [&'static ModelSpec] {
    profile(tier).files
}

pub fn all_models() -> &'static [&'static ModelSpec] {
    ALL_MODELS
}

pub fn total_bytes(tier: Tier) -> u64 {
    manifest(tier).iter().map(|m| m.bytes).sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profiles_are_complete_and_immutable() {
        for tier in [Tier::One, Tier::Two, Tier::Three] {
            let profile = profile(tier);
            assert_eq!(profile.steps, 4);
            assert_eq!(profile.cfg, 1.0);
            for role in [ModelRole::Diffusion, ModelRole::Vae, ModelRole::Llm] {
                assert!(profile.files.iter().any(|spec| spec.role == role));
            }
            for spec in profile.files {
                assert_eq!(spec.sha256.len(), 64, "missing SHA-256 for {}", spec.id);
                assert!(spec.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
                assert!(spec.bytes > 0);
                assert!(spec.url.starts_with("https://huggingface.co/"));
                assert!(!spec.url.contains("/resolve/main/"));
            }
        }
    }

    #[test]
    fn pack_sizes_match_pinned_files() {
        assert_eq!(total_bytes(Tier::One), 5_207_178_964);
        assert_eq!(total_bytes(Tier::Two), 5_207_178_964);
        assert_eq!(total_bytes(Tier::Three), 8_830_554_324);
    }
}
