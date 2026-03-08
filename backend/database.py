from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import text
from .config import configuracion

URL_BASE_DATOS = configuracion.DATABASE_URL

motor = create_async_engine(
    URL_BASE_DATOS, 
    echo=False,
    pool_size=20,          # (HU-OPT) Mantener conexiones listas para usar
    max_overflow=10,       # (HU-OPT) Permitir burst de conexiones 
    pool_pre_ping=False    # (HU-OPT) Saltar ping de latencia constante
)

SesionAsincronaLocal = sessionmaker(
    bind=motor,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

Base = declarative_base()

async def obtener_bd():
    async with SesionAsincronaLocal() as sesion:
        yield sesion

async def iniciar_bd():
    async with motor.begin() as conexion:
        await conexion.run_sync(Base.metadata.create_all)

async def reiniciar_articulos_db():
    """
    Elimina y recrea la tabla de artículos de forma exhaustiva.
    """
    async with motor.begin() as conexion:
        # DROP explicito por nombre para evitar problemas si metadata no esta sincronizada
        await conexion.execute(text("DROP TABLE IF EXISTS articulos_inventario CASCADE"))
        # Volver a crear todo segun el modelo actual
        await conexion.run_sync(Base.metadata.create_all)

