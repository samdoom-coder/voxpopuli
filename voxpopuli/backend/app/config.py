"""VoxPopuli configuration. Loads .env from the project root."""
import os

from dotenv import load_dotenv

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
ENV_PATH = os.path.join(ROOT, ".env")
if os.path.exists(ENV_PATH):
    load_dotenv(ENV_PATH, override=True)
else:
    load_dotenv(override=True)


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, str(default)))
    except (TypeError, ValueError):
        return default


class Config:
    ROOT = ROOT

    LLM_API_KEY = _env("LLM_API_KEY")
    LLM_BASE_URL = _env("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    LLM_MODEL_NAME = _env("LLM_MODEL_NAME", "gpt-4o-mini")

    PORT = _env_int("PORT", 8787)
    FRONTEND_PORT = _env_int("FRONTEND_PORT", 5173)

    DB_PATH = os.path.join(ROOT, "backend", "uploads", "voxpopuli.db")
    UPLOAD_DIR = os.path.join(ROOT, "backend", "uploads")

    # Simulation defaults
    DEFAULT_NUM_AGENTS = 40
    DEFAULT_ROUNDS = 12
    MAX_AGENTS = 200
    MAX_ROUNDS = 60

    # Cost/speed tuning
    LLM_BATCH_SIZE = 12            # agents decided per LLM call
    LLM_CONCURRENCY = 4            # parallel LLM calls
    LLM_TIMEOUT = 90               # seconds
    LLM_MAX_RETRIES = 3
    CONTEXT_RECENT_MESSAGES = 8    # messages each agent sees
    CONTEXT_MAX_SYMBOLS = 2600     # per-agent prompt budget

    @classmethod
    def llm_enabled(cls) -> bool:
        return bool(cls.LLM_API_KEY)

    @classmethod
    def ensure_dirs(cls):
        os.makedirs(cls.UPLOAD_DIR, exist_ok=True)
