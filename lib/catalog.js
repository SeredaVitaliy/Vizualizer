// Что качаем и откуда. Имена файлов на Hugging Face и в релизах GitHub подбираются по шаблонам,
// поэтому мелкие переименования у авторов не ломают загрузку.
'use strict';

const engines = {
  sdcpp: {
    title: 'Движок картинок (stable-diffusion.cpp, Vulkan)',
    gh: { repo: 'leejet/stable-diffusion.cpp', tag: 'master-1017-be48649', pattern: /bin-win-vulkan-x64\.zip$/i },
    exe: 'sd-server.exe', approx: 40e6, license: 'MIT'
  },
  llama: {
    title: 'Движок текста (llama.cpp, Vulkan)',
    gh: { repo: 'ggml-org/llama.cpp', tag: 'b11900', pattern: /-bin-win-vulkan-x64\.zip$/i },
    exe: 'llama-server.exe', approx: 60e6, license: 'MIT'
  },
  esrgan: {
    title: 'Улучшение качества (Real-ESRGAN, Vulkan)',
    gh: { repo: 'xinntao/Real-ESRGAN', tag: 'v0.2.5.0', pattern: /ncnn-vulkan.*windows\.zip$/i },
    exe: 'realesrgan-ncnn-vulkan.exe', approx: 45e6, license: 'BSD-3-Clause'
  }
};

const models = {
  klein: {
    title: 'FLUX.2 klein 4B — рисование и правка', approx: 2.6e9, license: 'Apache-2.0',
    hf: { repo: 'leejet/FLUX.2-klein-4B-GGUF', patterns: [/q4_k_m\.gguf$/i, /q4_k\.gguf$/i, /q4_0\.gguf$/i, /q5_k.*\.gguf$/i] }
  },
  kleinTe: {
    title: 'Qwen3 4B — понимание запроса для FLUX.2', approx: 2.5e9, license: 'Apache-2.0',
    hf: { repo: 'unsloth/Qwen3-4B-GGUF', patterns: [/Qwen3-4B-Q4_K_M\.gguf$/i, /Q4_K_M\.gguf$/i] }
  },
  flux2vae: {
    title: 'FLUX.2 VAE — декодер картинок', approx: 0.34e9, license: 'Apache-2.0',
    hf: { repo: 'Comfy-Org/flux2-dev', patterns: [/split_files\/vae\/flux2-vae\.safetensors$/i] }
  },
  vlm8: {
    title: 'Qwen3-VL 8B — тексты и проверка макета', approx: 5.0e9, license: 'Apache-2.0',
    hf: { repo: 'Qwen/Qwen3-VL-8B-Instruct-GGUF', patterns: [/Instruct-Q4_K_M\.gguf$/i, /Q4_K_M\.gguf$/i] }
  },
  vlm8proj: {
    title: 'Qwen3-VL 8B — зрение', approx: 0.75e9, license: 'Apache-2.0',
    hf: { repo: 'Qwen/Qwen3-VL-8B-Instruct-GGUF', patterns: [/mmproj.*Q8_0\.gguf$/i, /mmproj.*F16\.gguf$/i] }
  },
  vlm4: {
    title: 'Qwen3-VL 4B — тексты (быстрее, проще)', approx: 2.5e9, license: 'Apache-2.0',
    hf: { repo: 'Qwen/Qwen3-VL-4B-Instruct-GGUF', patterns: [/Instruct-Q4_K_M\.gguf$/i, /Q4_K_M\.gguf$/i] }
  },
  vlm4proj: {
    title: 'Qwen3-VL 4B — зрение', approx: 0.45e9, license: 'Apache-2.0',
    hf: { repo: 'Qwen/Qwen3-VL-4B-Instruct-GGUF', patterns: [/mmproj.*Q8_0\.gguf$/i, /mmproj.*F16\.gguf$/i] }
  },
  birefnet: {
    title: 'BiRefNet lite — вырезание фона', approx: 0.23e9, license: 'MIT',
    hf: { repo: 'onnx-community/BiRefNet_lite-ONNX', patterns: [/^onnx\/model\.onnx$/i] }
  },
  lama: {
    title: 'LaMa — удаление предметов', approx: 0.21e9, license: 'Apache-2.0',
    hf: { repo: 'Carve/LaMa-ONNX', patterns: [/^lama_fp32\.onnx$/i] }
  }
};

// Наборы — то, что видит пользователь на вкладке «Модели»
function packs(settings) {
  const vlm = settings.vlm === '4b' ? ['vlm4', 'vlm4proj'] : ['vlm8', 'vlm8proj'];
  return [
    { id: 'quality', title: 'Улучшение качества', what: 'Резкость, увеличение в 2–4 раза, очистка от шума и артефактов JPEG', needs: ['esrgan'] },
    { id: 'cutout', title: 'Фон и лишние предметы', what: 'Вырезание объекта с фона, удаление предметов кистью', needs: ['birefnet', 'lama'] },
    { id: 'image', title: 'Рисование и правка по описанию', what: 'Создание картинок и правки словами: свет, стиль, детали', needs: ['sdcpp', 'klein', 'kleinTe', 'flux2vae'] },
    { id: 'text', title: 'Проверка макета и ассистент', what: 'Корректура текстов меню, разбор дизайна, чат с помощником', needs: ['llama'].concat(vlm) }
  ];
}

module.exports = { engines, models, packs };
