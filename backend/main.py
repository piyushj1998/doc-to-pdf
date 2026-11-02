import asyncio
import os
import re
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask

# ---------- Settings (override with environment variables) ----------
MAX_MB = int(os.getenv("MAX_MB", "20"))                    # max upload size
MAX_PARALLEL = int(os.getenv("MAX_PARALLEL", "2"))         # simultaneous conversions
TIMEOUT_SEC = int(os.getenv("TIMEOUT_SEC", "90"))          # kill a stuck conversion
SOFFICE = os.getenv("SOFFICE_BIN", "soffice")              # LibreOffice binary
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "").split(",")  # only needed if frontend is hosted elsewhere

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
WORK_ROOT = Path(tempfile.gettempdir()) / "docx2pdf"
WORK_ROOT.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="PDFly – DOCX to PDF")
slots = asyncio.Semaphore(MAX_PARALLEL)

if any(ALLOWED_ORIGINS):
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in ALLOWED_ORIGINS if o.strip()],
        allow_methods=["POST", "GET"],
        allow_headers=["*"],
    )


def safe_stem(filename: str) -> str:
    """Make a harmless download name from the uploaded file name."""
    stem = Path(filename or "document").stem
    stem = re.sub(r"[^\w\- ]+", "", stem, flags=re.UNICODE).strip()
    return (stem or "document")[:80]


def looks_like_docx(path: Path) -> bool:
    """A .docx is a zip that contains word/document.xml."""
    try:
        if not zipfile.is_zipfile(path):
            return False
        with zipfile.ZipFile(path) as z:
            return "word/document.xml" in z.namelist()
    except Exception:
        return False


async def save_upload(upload: UploadFile, dest: Path) -> None:
    """Stream the upload to disk and stop if it is too big."""
    limit = MAX_MB * 1024 * 1024
    size = 0
    with open(dest, "wb") as out:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                raise HTTPException(413, f"File is larger than {MAX_MB} MB.")
            out.write(chunk)
    if size == 0:
        raise HTTPException(400, "The file is empty.")


async def run_libreoffice(src: Path, job: Path) -> Path:
    profile = job / "profile"  # separate profile per job, so parallel runs don't clash
    cmd = [
        SOFFICE,
        f"-env:UserInstallation={profile.as_uri()}",
        "--headless",
        "--norestore",
        "--nologo",
        "--convert-to", "pdf",
        "--outdir", str(job),
        str(src),
    ]
    env = {**os.environ, "HOME": str(job)}
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
        env=env,
    )
    try:
        await asyncio.wait_for(proc.wait(), timeout=TIMEOUT_SEC)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise HTTPException(504, "Conversion took too long. Try a smaller file.")

    pdf = job / (src.stem + ".pdf")
    if proc.returncode != 0 or not pdf.exists():
        raise HTTPException(500, "Could not convert this file. Check that it opens in Word.")
    return pdf


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/convert")
async def convert(file: UploadFile = File(...)):
    name = file.filename or ""
    if not name.lower().endswith(".docx"):
        raise HTTPException(400, "Only .docx files are supported.")

    job = WORK_ROOT / uuid.uuid4().hex
    job.mkdir(parents=True)
    cleanup = BackgroundTask(shutil.rmtree, job, ignore_errors=True)

    try:
        src = job / "input.docx"
        await save_upload(file, src)
        if not looks_like_docx(src):
            raise HTTPException(400, "This does not look like a valid .docx file.")

        async with slots:
            pdf = await run_libreoffice(src, job)
    except Exception:
        shutil.rmtree(job, ignore_errors=True)
        raise

    return FileResponse(
        pdf,
        media_type="application/pdf",
        filename=f"{safe_stem(name)}.pdf",
        background=cleanup,  # delete the job folder after the response is sent
    )


# Serve the website. Must stay LAST so it doesn't shadow the API routes.
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
