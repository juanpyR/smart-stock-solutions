from pydantic_settings import BaseSettings, SettingsConfigDict

class Configuracion(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    GOOGLE_CLIENT_ID: str | None = None
    ALLOWED_ORIGINS: str = "*"
    GROQ_API_KEY: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    def __init__(self, **values):
        super().__init__(**values)
        # Ajuste para compatibilidad con Render y SQLAlchemy Async
        if self.DATABASE_URL.startswith("postgres://"):
            self.DATABASE_URL = self.DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
        elif self.DATABASE_URL.startswith("postgresql://"):
             self.DATABASE_URL = self.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

configuracion = Configuracion()
