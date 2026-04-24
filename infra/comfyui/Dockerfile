ARG NVIDIA_CUDA_IMAGE=nvidia/cuda:12.6.3-cudnn-runtime-ubuntu24.04
FROM ${NVIDIA_CUDA_IMAGE}

ARG COMFYUI_REF=v0.15.1
ARG PYTORCH_CUDA_INDEX_URL=https://download.pytorch.org/whl/cu126

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    ffmpeg \
    git \
    libgl1 \
    libglib2.0-0 \
    python3 \
    python3-dev \
    python3-pip \
    python3-venv \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --branch ${COMFYUI_REF} --depth 1 https://github.com/comfyanonymous/ComfyUI.git /opt/ComfyUI

WORKDIR /opt/ComfyUI
RUN python3 -m pip install --upgrade pip setuptools wheel \
 && python3 -m pip install torch torchvision torchaudio --index-url ${PYTORCH_CUDA_INDEX_URL} \
 && python3 -m pip install -r requirements.txt

COPY docker/entrypoint.sh /usr/local/bin/comfyui-entrypoint.sh
RUN chmod +x /usr/local/bin/comfyui-entrypoint.sh

EXPOSE 8188

ENTRYPOINT ["/usr/local/bin/comfyui-entrypoint.sh"]
