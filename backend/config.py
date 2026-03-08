from pydantic_settings import BaseSettings, SettingsConfigDict

class Configuracion(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    GOOGLE_CLIENT_ID: str | None = None
    ALLOWED_ORIGINS: str = "*"
    GROQ_API_KEY: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

configuracion = Configuracion()
