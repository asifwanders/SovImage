# Third-Party and Model Notices

SovImage application code is licensed under [LICENSE](LICENSE). Dependencies
and downloaded models retain separate terms.

## Included runtime components

- Tauri and official Tauri plugins: Apache-2.0 or MIT, as identified by each package.
- `stable-diffusion.cpp`: MIT, copyright 2023 leejet.
- `ggml`: MIT, copyright 2023–2026 the ggml authors.
- Next.js, React, Zustand, Framer Motion, Tailwind CSS, and their shipped
  dependencies: the license recorded by `frontend/package-lock.json` and the
  package's license file.
- Rust crates: the versions fixed by `frontend/src-tauri/Cargo.lock` and each
  crate's published license file.
- Windows CUDA/cuBLAS redistributables: NVIDIA CUDA Toolkit redistribution
  terms. SovImage does not bundle an NVIDIA display driver.

The reviewed direct dependency versions, copyright notices, and license grants
are in [DEPENDENCY_NOTICES.md](DEPENDENCY_NOTICES.md). That notice also records
the Windows and transitive-license work that still blocks public distribution.

Apache-2.0 components and models are accompanied by the full
[Apache License 2.0](APACHE-2.0.txt), which is also included in application
resources.

## Downloaded model packs

SovImage 0.2.0 downloads these Apache-2.0 repositories at immutable revisions:

- [FLUX.2 Klein 4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)
  and the [GGUF conversion](https://huggingface.co/leejet/FLUX.2-klein-4B-GGUF).
- [FLUX.2 small decoder](https://huggingface.co/black-forest-labs/FLUX.2-small-decoder).
- [Qwen3-4B GGUF](https://huggingface.co/unsloth/Qwen3-4B-GGUF).

Models are not relicensed by SovImage's MIT license. Quantization does not
remove upstream copyright, trademark, model-card, or license obligations.

## Darts-clone BSD license used by the inference engine

Copyright (c) 2008-2011, Susumu Yata. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

- Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.
- Neither the name of the copyright holder nor the names of contributors may
  be used to endorse or promote products derived from this software without
  specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS “AS IS”
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

## stable-diffusion.cpp MIT License

MIT License

Copyright (c) 2023 leejet

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## ggml MIT License

MIT License

Copyright (c) 2023-2026 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
