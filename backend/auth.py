from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from . import models, database

from .config import configuracion

CLAVE_SECRETA = configuracion.SECRET_KEY
ALGORITMO = "HS256"
MINUTOS_EXPIRACION_TOKEN_ACCESO = 30

contexto_pwd = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")
esquema_oauth2 = OAuth2PasswordBearer(tokenUrl="auth/login")

def verificar_contrasena(contrasena_plana, contrasena_hash):
    return contexto_pwd.verify(contrasena_plana, contrasena_hash)

def obtener_hash_contrasena(contrasena):
    return contexto_pwd.hash(contrasena)

def crear_token_acceso(datos: dict, delta_expiracion: timedelta | None = None):
    para_codificar = datos.copy()
    if delta_expiracion:
        expira = datetime.utcnow() + delta_expiracion
    else:
        expira = datetime.utcnow() + timedelta(minutes=MINUTOS_EXPIRACION_TOKEN_ACCESO)
    para_codificar.update({"exp": expira})
    jwt_codificado = jwt.encode(para_codificar, CLAVE_SECRETA, algorithm=ALGORITMO)
    return jwt_codificado

async def obtener_usuario_actual(token: str = Depends(esquema_oauth2), bd: AsyncSession = Depends(database.obtener_bd)):
    excepcion_credenciales = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No se pudieron validar las credenciales",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, CLAVE_SECRETA, algorithms=[ALGORITMO])
        nombre_usuario: str = payload.get("sub")
        if nombre_usuario is None:
            raise excepcion_credenciales
    except JWTError:
        raise excepcion_credenciales
    
    # Consultar usuario
    from sqlalchemy import select
    resultado = await bd.execute(select(models.Usuario).filter(models.Usuario.nombre_usuario == nombre_usuario))
    usuario = resultado.scalars().first()
    
    if usuario is None:
        raise excepcion_credenciales
    return usuario
