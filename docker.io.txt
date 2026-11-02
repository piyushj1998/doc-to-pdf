FROM python:3.12-slim
 
# LibreOffice (Writer only, to keep the image smaller) + fonts for good layout.
# Carlito/Caladea are metric-compatible with Calibri/Cambria; Noto covers Hindi and other scripts.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libreoffice-writer \
        fonts-liberation \
        fonts-crosextra-carlito \
        fonts-crosextra-caladea \
        fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
 
# Run as a normal user, not root
RUN useradd -m appuser
WORKDIR /app/backend
 
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
 
COPY backend/ /app/backend/
COPY frontend/ /app/frontend/
 
USER appuser
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
 