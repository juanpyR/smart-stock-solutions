from fastapi import FastAPI, Depends, HTTPException, status, Query, UploadFile, File, BackgroundTasks, Request
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from . import models, database, auth, processing, ai_utils
from .security import (
    security_headers_middleware,
    global_rate_limit_middleware,
    rate_login, rate_register, rate_ai, rate_upload,
    get_client_ip,
    sanitizar_input_usuario,
    validar_nombre_archivo,
    validar_id_recurso,
    validar_entero_rango,
    validar_fuente_id,
)
import os
import shutil
import json
import time
from datetime import datetime
from google.oauth2 import id_token
from google.auth.transport import requests

app = FastAPI(
    title="Smart Stock Solutions API",
    docs_url=None,     # Deshabilitar Swagger doc en produccion
    redoc_url=None,    # Deshabilitar ReDoc en produccion
    openapi_url=None,  # Deshabilitar OpenAPI schema en produccion
)

from backend.config import configuracion

# Middlewares de seguridad (orden importa: primero rate limit, luego CORS, luego headers)
app.middleware("http")(global_rate_limit_middleware)
app.middleware("http")(security_headers_middleware)

# CORS — solo origenes configurados
origenes_permitidos = [orig.strip() for orig in configuracion.ALLOWED_ORIGINS.split(",") if orig.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origenes_permitidos,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

# Startup
@app.on_event("startup")
async def iniciar():
    await database.iniciar_bd()
    async with database.SesionAsincronaLocal() as bd:
        # Detectar desincronización de esquema (Columna en inglés vs español)
        try:
            res = await bd.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'articulos_inventario' AND column_name = 'producto_id'"))
            if res.fetchone():
                print("🚨 Detectado esquema antiguo (inglés). Recreando tabla...")
                await database.reiniciar_articulos_db()
                # Opcional: limpiar archivos parquet huérfanos
                if os.path.exists("data"):
                    for root, dirs, files in os.walk("data"):
                        for f in files:
                            if f.endswith(".parquet"): os.remove(os.path.join(root, f))
            else:
                # Asegurar id_unico si no existe (migración incremental)
                await bd.execute(text("ALTER TABLE articulos_inventario ADD COLUMN IF NOT EXISTS id_unico VARCHAR"))
                # Asegurar columna email en usuarios
                await bd.execute(text("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email VARCHAR"))
                # Asegurar columna proveedor en inventario
                await bd.execute(text("ALTER TABLE articulos_inventario ADD COLUMN IF NOT EXISTS proveedor VARCHAR"))
                await bd.execute(text("ALTER TABLE articulos_inventario ADD COLUMN IF NOT EXISTS marca VARCHAR"))
                # Asegurar nuevas columnas en donaciones (proveedor + sucursal origen)
                await bd.execute(text("ALTER TABLE donaciones ADD COLUMN IF NOT EXISTS proveedor VARCHAR"))
                await bd.execute(text("ALTER TABLE donaciones ADD COLUMN IF NOT EXISTS nombre_ubicacion VARCHAR"))
                await bd.commit()

        except Exception as e:
            print(f"⚠️ Error en migración startup: {e}")
            await bd.rollback()
        
        await processing.limpiar_restricciones_obsoletas(bd)

# Auth Routes
from pydantic import BaseModel

class RegistroUsuario(BaseModel):
    nombre_usuario: str
    email: str
    contrasena: str
    empresa: str | None = None
    telefono: str | None = None

@app.post("/auth/register")
async def registrar(datos_usuario: RegistroUsuario, request: Request, bd: AsyncSession = Depends(database.obtener_bd)):
    # Rate limit: 3 registros por IP cada 5 min
    rate_register.check_or_raise(get_client_ip(request), "Demasiados intentos de registro. Espera 5 minutos.")

    # Sanitizar inputs
    nombre_limpio = sanitizar_input_usuario(datos_usuario.nombre_usuario, "nombre_usuario")
    if not nombre_limpio or len(nombre_limpio) < 3:
        raise HTTPException(status_code=400, detail="Nombre de usuario demasiado corto (mínimo 3 caracteres).")
    if len(datos_usuario.contrasena) < 8:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 8 caracteres.")

    resultado = await bd.execute(select(models.Usuario).filter(models.Usuario.nombre_usuario == nombre_limpio))
    if resultado.scalars().first():
        raise HTTPException(status_code=400, detail="El usuario ya está registrado")
    
    contrasena_hasheada = auth.obtener_hash_contrasena(datos_usuario.contrasena)
    nuevo_usuario = models.Usuario(
        nombre_usuario=nombre_limpio,
        email=datos_usuario.email,
        contrasena_hash=contrasena_hasheada,
        empresa=datos_usuario.empresa,
        telefono=datos_usuario.telefono
    )
    bd.add(nuevo_usuario)
    try:
        await bd.commit()
    except Exception as e:
        await bd.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    return {"mensaje": "Usuario registrado exitosamente"}

@app.post("/auth/login")
async def login(request: Request, datos_formulario: OAuth2PasswordRequestForm = Depends(), bd: AsyncSession = Depends(database.obtener_bd)):
    # Rate limit: 5 intentos de login por IP por minuto
    rate_login.check_or_raise(get_client_ip(request), "Demasiados intentos de inicio de sesión. Espera 1 minuto.")

    # Buscar por nombre de usuario
    resultado = await bd.execute(select(models.Usuario).filter(models.Usuario.nombre_usuario == datos_formulario.username))
    usuario = resultado.scalars().first()
    
    # Si no se encuentra, buscar por email (HU-AUTH-01)
    if not usuario:
        resultado = await bd.execute(select(models.Usuario).filter(models.Usuario.email == datos_formulario.username))
        usuario = resultado.scalars().first()
    
    if not usuario or not auth.verificar_contrasena(datos_formulario.password, usuario.contrasena_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token_acceso = auth.crear_token_acceso(datos={"sub": usuario.nombre_usuario})
    return {"token_acceso": token_acceso, "tipo_token": "bearer"}

class GoogleLogin(BaseModel):
    token: str

@app.post("/auth/google")
async def google_login(data: GoogleLogin, bd: AsyncSession = Depends(database.obtener_bd)):
    try:
        from backend.config import configuracion
        
        # ID de Cliente de Google desde variables de entorno
        CLIENT_ID = configuracion.GOOGLE_CLIENT_ID
        if not CLIENT_ID:
            raise HTTPException(status_code=500, detail="Google Login no está configurado (falta GOOGLE_CLIENT_ID en .env)")
        
        # Verificar el token con Google
        idinfo = id_token.verify_oauth2_token(data.token, requests.Request(), CLIENT_ID)

        # Obtener información del usuario
        email = idinfo['email']
        # HU-AUTH (STRICT): BUSCAR ÚNICAMENTE POR EMAIL
        # Ahora no se permiten combinaciones ni adivinanzas por nombre. 
        # El email debe estar registrado previamente en la base de datos de forma manual.
        resultado = await bd.execute(select(models.Usuario).filter(models.Usuario.email == email))
        usuario = resultado.scalars().first()
        
        # MODO ULTRA-CERRADO: Si el email no está en la BD, se bloquea el acceso.
        if not usuario:
            raise HTTPException(
                status_code=403, 
                detail=f"Acceso Denegado: El correo '{email}' no está autorizado en este sistema. Por favor, regístrate manualmente con este correo primero."
            )
            
        token_acceso = auth.crear_token_acceso(datos={"sub": usuario.nombre_usuario})
        return {"token_acceso": token_acceso, "tipo_token": "bearer", "nombre_usuario": usuario.nombre_usuario}
        
    except ValueError:
        # Token inválido
        raise HTTPException(status_code=403, detail="Token de Google inválido o expirado")
    except Exception as e:
        print(f"Error en Google Login: {e}")
        raise HTTPException(status_code=500, detail="Error interno durante el login con Google")

def obtener_parte_fecha(item, parte):
    f = item.get("fecha_vencimiento") or item.get("fecha_datos")
    if not f: return None
    try:
        # f puede ser date object o string
        if isinstance(f, str):
            dt = datetime.fromisoformat(f.split('T')[0])
        else:
            dt = f
        return str(dt.month) if parte == "mes" else str(dt.year)
    except: return None

# API Routes
@app.get("/api/analysis")
async def obtener_analisis_estrategico(
    dias_horizonte: int = Query(0, alias="horizonte"),
    descuento: float = Query(0.0, alias="descuento"),
    fuente: str = Query(None, alias="fuente"),
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    # Validar parámetros GET
    validar_entero_rango(dias_horizonte, 0, 3650, "horizonte")
    validar_entero_rango(int(descuento * 100), 0, 100, "descuento")
    fuente = validar_fuente_id(fuente)
    try:
        from datetime import date, timedelta
        analisis = await processing.obtener_inventario_analisis(bd, usuario_actual.id, factor_descuento=descuento, fuente_id=fuente)
        datos = analisis["items"]

        # Filtrar por análisis activo (fuente/archivo/ID de análisis) para independencia de datasets
        if fuente:
            analyses = processing.cargar_analyses(usuario_actual.id)
            if fuente in analyses:
                archivos_permitidos = {f.lower() for f in analyses[fuente].get("archivos", [])}
                datos = [d for d in datos if (d.get("nombre_fuente") or "").lower() in archivos_permitidos]
            else:
                datos = [d for d in datos if (d.get("nombre_fuente") or "") == fuente]

        # Filtrar ruido: Solo productos con ID válido
        datos = [d for d in datos if d.get("id_producto")]

        total_inicial = len(datos)

        # Filtrar por Horizonte de Análisis relativo a HOY (no por mes fijo)
        if dias_horizonte and dias_horizonte > 0:
            hoy_str = analisis.get("hoy")
            if hoy_str:
                hoy = date.fromisoformat(hoy_str.split('T')[0])
            else:
                hoy = date.today()
            fecha_limite = hoy + timedelta(days=dias_horizonte)
            def dentro_horizonte(item):
                # HU-CRITICIDAD: Los quiebres de stock (<=0) siempre son relevantes independientemente del horizonte temporal
                if float(item.get("cantidad_stock") or 0) <= 0: return True
                
                f = item.get("fecha_vencimiento") or item.get("fecha_datos")
                if not f: return True  # sin fecha: siempre incluir
                try:
                    if isinstance(f, str): fd = date.fromisoformat(f.split('T')[0])
                    else: fd = f
                    # Incluir vencidos (<=hoy) + los que vencen dentro del horizonte
                    return fd <= fecha_limite
                except: return True
            datos = [d for d in datos if dentro_horizonte(d)]

        if total_inicial > 0:
            print(f"📡 FILTRO HORIZONTE: {dias_horizonte}d -> Quedan {len(datos)} de {total_inicial}")
        
        perdida_total = sum(item["valor_stock"] for item in datos if item.get("estado_alerta") == "VENCIDO")
        capital_en_riesgo = sum(item["valor_stock"] for item in datos if item.get("estado_alerta") == "CRÍTICO")
        items_cerca_quiebre = len([i for i in datos if i.get("forecast_quiebre_dias") is not None and i["forecast_quiebre_dias"] < 5])
        
        estados = {
            "VENCIDO": {"productos": 0, "unidades": 0, "valor": 0.0},
            "CRÍTICO": {"productos": 0, "unidades": 0, "valor": 0.0},
            "URGENTE": {"productos": 0, "unidades": 0, "valor": 0.0},
            "PREVENTIVO": {"productos": 0, "unidades": 0, "valor": 0.0},
            "NORMAL": {"productos": 0, "unidades": 0, "valor": 0.0},
        }

        for item in datos:
            estado = item.get("estado_alerta", "NORMAL")
            if estado in estados:
                estados[estado]["productos"] += 1
                estados[estado]["unidades"] += item.get("cantidad_stock", 0) or 0
                estados[estado]["valor"] += item.get("valor_stock", 0.0) or 0.0

        limites = await processing.obtener_limites_fecha(bd, usuario_actual.id, fuente_id=fuente)
        insights = await processing.obtener_insighs_ia(datos, usuario_actual.id)

        return {
            "hoy": analisis.get("hoy"),
            "hoy_dataset": analisis.get("hoy_dataset"),
            "tipo_analisis": analisis.get("tipo_analisis", "EXPIRACION"),
            "min_fecha": analisis.get("min_fecha"),
            "metricas": {
                "perdida_vencidos": perdida_total,
                "riesgo_critico": capital_en_riesgo,
                "items_con_quiebre_proximo": items_cerca_quiebre,
                "estados": estados,
                "insights": insights,
                "hoy": analisis.get("hoy"),
                "min_fecha": analisis.get("min_fecha")
            },
            "inventario": datos,
            "limites": limites,
            "indicadores": analisis["indicadores"]
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/dashboard")
async def obtener_dashboard(
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    try:
        # En processing.py aún usamos obtener_datos_dashboard (o el nuevo nombre si lo cambié)
        # Veo que me faltó traducir esa función en processing.py. La llamaré obtener_analisis_mapa por ahora.
        return await processing.obtener_datos_mapa(bd, usuario_actual.id)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/sensitivity/{id_producto}")
async def obtener_analisis_sensibilidad(
    id_producto: str,
    fuente: str = Query(None),
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    fuente = validar_fuente_id(fuente)
    try:
        datos = await processing.obtener_matriz_sensibilidad(bd, id_producto, usuario_actual.id, fuente_id=fuente)
        return datos
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/branch-impact/{id_producto}")
async def obtener_analisis_impacto_sucursal(
    id_producto: str,
    descuento: float = Query(0.0, alias="descuento"),
    fuente: str = Query(None),
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    fuente = validar_fuente_id(fuente)
    try:
        datos = await processing.obtener_sensibilidad_avanzada(bd, id_producto, usuario_actual.id, descuento=descuento, fuente_id=fuente)
        return datos
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/ai-recommendations")
async def obtener_recomendaciones_ia(
    request: Request,
    horizonte: int = Query(0, alias="horizonte"),
    fuente: str = Query(None),
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    rate_ai.check_or_raise(str(usuario_actual.id), "Límite de consultas IA alcanzado. Espera 1 minuto.")
    # Validar parámetros
    validar_entero_rango(horizonte, 0, 3650, "horizonte")
    fuente = validar_fuente_id(fuente)
    try:
        from datetime import date, timedelta
        analisis = await processing.obtener_inventario_analisis(bd, usuario_actual.id, fuente_id=fuente)
        datos = analisis.get("items", [])
        
        # Filtrar ruido: Eliminar productos con stock <= 0
        datos = [d for d in datos if (d.get("cantidad_stock") or 0) > 0]

        # Filtrar por horizonte (mismo criterio que /api/analysis)
        if horizonte and horizonte > 0:
            hoy = date.today()
            fecha_limite = hoy + timedelta(days=horizonte)
            def dentro_horizonte_ia(item):
                f = item.get("fecha_vencimiento") or item.get("fecha_datos")
                if not f: return True
                try:
                    fd = date.fromisoformat(str(f).split('T')[0]) if isinstance(f, str) else f
                    return fd <= fecha_limite
                except: return True
            datos = [d for d in datos if dentro_horizonte_ia(d)]

        # Filtrar solo productos con riesgo
        productos_riesgo = [
            d for d in datos 
            if d.get("estado_alerta") in ["VENCIDO", "CRÍTICO", "URGENTE", "PREVENTIVO"]
        ]
        
        # ── KPIs de Sensibilidad Global ──────────────────────────────────────
        v_pre = sum(p.get("valor_stock", 0) for p in productos_riesgo if p.get("estado_alerta") == "PREVENTIVO")
        v_urg = sum(p.get("valor_stock", 0) for p in productos_riesgo if p.get("estado_alerta") == "URGENTE")
        v_cri = sum(p.get("valor_stock", 0) for p in productos_riesgo if p.get("estado_alerta") == "CRÍTICO")
        v_ven = sum(p.get("valor_stock", 0) for p in productos_riesgo if p.get("estado_alerta") == "VENCIDO")
        n_ven = len([p for p in productos_riesgo if p.get("estado_alerta") == "VENCIDO"])
        
        sensibilidad_global = {
            "valor_total_riesgo": sum(p.get("valor_stock", 0) for p in productos_riesgo),
            "vencidos": {"valor": v_ven, "cantidad": n_ven},
            "escenario_preventivo": {
                "descuento": "15%",
                "recuperacion_estimada": v_pre * 0.85,
                "lotes_afectados": len([p for p in productos_riesgo if p.get("estado_alerta") == "PREVENTIVO"])
            },
            "escenario_urgente": {
                "descuento": "30%",
                "recuperacion_estimada": v_urg * 0.70,
                "lotes_afectados": len([p for p in productos_riesgo if p.get("estado_alerta") == "URGENTE"])
            },
            "riesgo_critico_inminente": v_cri
        }

        # ── Plan de Crisis pre-calculado (lo mismo que hace el frontend) ─────
        def clasificar_accion(item, estado):
            dias = item.get("dias_riesgo_total") or 0
            demanda = item.get("demanda_diaria") or 0
            valor = item.get("valor_stock") or 0
            if estado == "VENCIDO":
                if dias <= -15: return "merma"
                elif demanda < 0.1 or valor < 50000: return "reetiquetado"
                else: return "donacion"
            elif estado == "CRÍTICO":
                return "donacion_preventiva" if demanda < 0.5 else "venta_flash"
            elif estado == "URGENTE":
                return "pack_combo" if valor > 250000 else "descuento_40"
            else:  # PREVENTIVO
                return "oferta_flash" if valor > 100000 else "monitorear"

        plan_accion_crisis: dict = {}
        for estado in ["VENCIDO", "CRÍTICO", "URGENTE", "PREVENTIVO"]:
            grupo = [p for p in productos_riesgo if p.get("estado_alerta") == estado]
            if not grupo: continue
            categorias: dict = {}
            for p in grupo:
                cat = clasificar_accion(p, estado)
                if cat not in categorias:
                    categorias[cat] = {"cantidad": 0, "valor": 0.0}
                categorias[cat]["cantidad"] += 1
                categorias[cat]["valor"] += p.get("valor_stock", 0)
            plan_accion_crisis[estado] = {
                "total": len(grupo),
                "valor_total": sum(p.get("valor_stock", 0) for p in grupo),
                "categorias": categorias
            }
            
        recomendaciones = await ai_utils.generar_recomendaciones_ia(
            productos_riesgo,
            sensibilidad_global,
            plan_accion_crisis,
            todos_los_productos=analisis.get("items", [])
        )
        return {
            "recomendaciones": recomendaciones,
            "sensibilidad_global": sensibilidad_global,
            "plan_accion_crisis": plan_accion_crisis
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ai/forecast-insight")
async def generar_insight_ia(contexto: dict, usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)):
    """HU-AI: Genera un análisis profundo de toda la operación de forecasting."""
    try:
        insight = await ai_utils.generar_insight_demanda_agregada(contexto)
        return {"insight": insight}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/logistics/optimize")
async def optimizar_redistribucion(
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    """
    Optimización de redistribución de stock entre sucursales.

    Pipeline de dos fases:
    1. FASE MATEMÁTICA (Python puro, sin IA):
       El módulo optimization.py aplica un algoritmo greedy para calcular:
       - Qué productos mover
       - Desde qué sucursal (excedente) hacia dónde (déficit)
       - Cuántas unidades trasladar
       - Distancia aproximada (km) si hay coordenadas disponibles

    2. FASE INTERPRETATIVA (IA - Groq):
       El LLM recibe los resultados numéricos exactos y redacta un plan
       operativo legible en español. La IA NO calcula: solo interpreta.

    Columnas necesarias en el inventario (ver optimization.py para detalles):
       - nombre_ubicacion  [REQUERIDO]
       - id_producto / nombre_producto [REQUERIDO]
       - cantidad_stock    [REQUERIDO]
       - demanda_diaria    [RECOMENDADO]
       - estado_alerta     [RECOMENDADO]
       - latitud / longitud [OPCIONAL - para calcular distancias reales]
    """
    try:
        from backend.optimization import calcular_redistribucion_optima
        from collections import defaultdict as _dd

        # Obtener inventario del usuario actual
        analisis = await processing.obtener_inventario_analisis(bd, usuario_actual.id)
        inventario = analisis.get("items", [])

        if not inventario:
            return {
                "traslados"    : [],
                "metricas"     : {"hay_traslados_posibles": False},
                "sucursales"   : {},
                "interpretacion_ia": "No hay inventario disponible para analizar.",
            }

        # ── DIAGNÓSTICO: loguear estructura del inventario ─────────────────────
        sucursales_unicas = set(i.get("nombre_ubicacion","") for i in inventario if i.get("nombre_ubicacion"))
        nombres_unicos = set((i.get("nombre_producto") or "").lower().strip() for i in inventario if i.get("nombre_producto"))
        prod_x_suc = _dd(set)
        for it in inventario:
            n = (it.get("nombre_producto") or "").lower().strip()
            s = (it.get("nombre_ubicacion") or "").strip()
            if n and s:
                prod_x_suc[n].add(s)
        cross_branch = {k: list(v) for k, v in prod_x_suc.items() if len(v) > 1}
        print(f"🔍 OPTIMIZE: {len(inventario)} items | {len(sucursales_unicas)} sucursales | {len(nombres_unicos)} productos únicos")
        print(f"   Sucursales: {list(sucursales_unicas)[:8]}")
        print(f"   Productos en >1 sucursal: {len(cross_branch)} → {list(cross_branch.keys())[:8]}")

        # ── FASE 1: Algoritmo Python de optimización ───────────────────────────
        resultado = calcular_redistribucion_optima(inventario, max_traslados=8)
        print(f"   → Traslados calculados: {len(resultado['traslados'])}")

        # ── FASE 2: Interpretación IA ──────────────────────────────────────────
        interpretacion = await ai_utils.interpretar_redistribucion_ia(resultado)

        return {
            "traslados"        : resultado["traslados"],
            "metricas"         : resultado["metricas"],
            "sucursales"       : resultado["sucursales"],
            "interpretacion_ia": interpretacion,
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))





@app.get("/api/forecast/summary")
async def obtener_resumen_forecasting(
    mes: int = Query(None),
    anio: int = Query(None),
    fuente: str = Query(None),
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    # Validar parámetros de fecha para evitar valores absurdos
    if mes is not None:
        validar_entero_rango(mes, 1, 12, "mes")
    if anio is not None:
        validar_entero_rango(anio, 2000, 2100, "anio")
    fuente = validar_fuente_id(fuente)
    try:
        data = await processing.obtener_resumen_forecasting(bd, usuario_actual.id, mes, anio, fuente_id=fuente)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/forecast/{id_producto}")
async def obtener_prediccion_demanda(
    id_producto: str,
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    # Validar ID: solo UUIDs o slugs alfanuméricos seguros
    id_producto = validar_id_recurso(id_producto, "id_producto")
    try:
        # 1. Obtener producto para saber el nombre
        res = await bd.execute(select(models.ArticuloInventario).where(
            models.ArticuloInventario.id_producto == id_producto,
            models.ArticuloInventario.usuario_id == usuario_actual.id
        ))
        art = res.scalars().first()
        if not art:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
            
        # 2. Simular historial de ventas (En un caso real vendría de una tabla de ventas)
        # Por ahora generamos datos basados en su demanda_diaria actual con ruido
        historico = []
        base_demand = art.demanda_diaria or 5
        import random
        for i in range(30, 0, -1):
            unidades = max(0, base_demand + random.uniform(-2, 2))
            historico.append({"dia": i, "unidades": round(unidades, 1)})
            
        prediccion = await ai_utils.predecir_demanda_ia(historico, art.nombre_producto)
        return {
            "prediccion": prediccion,
            "historico": historico
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/data/upload")
async def subir_archivo(
    request: Request,
    modo: str = Query("fusionar"),
    file: UploadFile = File(...),
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    """Sube un CSV, ejecuta mapeo IA + consolidar en Polars, sincroniza a Postgres."""
    # Rate limit en uploads
    rate_upload.check_or_raise(str(usuario_actual.id), "Límite de subida de archivos alcanzado. Espera 5 minutos.")
    # Validar tipo de archivo
    if not file.filename or not file.filename.lower().endswith(".csv"):
        if file.filename and not file.filename.lower().endswith((".csv", ".xlsx", ".xls")):
            raise HTTPException(status_code=400, detail="Solo se permiten archivos CSV.")
    try:
        if modo == "nuevo":
            processing.limpiar_datos_usuario(usuario_actual.id)

        dir_datos = processing.obtener_ruta_datos_usuario(usuario_actual.id)
        ruta_archivo = os.path.join(dir_datos, file.filename)
        contenido = await file.read()
        with open(ruta_archivo, "wb") as buffer:
            buffer.write(contenido)

        if not file.filename.endswith(".csv"):
            return {"nombre_archivo": file.filename, "estado": "subido"}

        # 1. Mapeo IA (con timeout corto, fallback automático)
        columnas = processing.obtener_columnas_archivo(ruta_archivo)
        try:
            import asyncio
            mapeo = await asyncio.wait_for(
                ai_utils.mapear_columnas_con_ia(columnas), timeout=8.0
            )
        except Exception:
            mapeo = {}  # MAPEO_RESPALDO se usará en normalizar_dataframe

        # Guardar mappings
        ruta_mappings = os.path.join(dir_datos, "ai_mappings.json")
        mapeos_guardados = {}
        if os.path.exists(ruta_mappings):
            try:
                with open(ruta_mappings, "r") as mf:
                    mapeos_guardados = json.load(mf)
            except: pass
        mapeos_guardados[file.filename] = mapeo
        with open(ruta_mappings, "w") as f:
            json.dump(mapeos_guardados, f, indent=4)

        # 2. Consolidar inventario (Polars, síncrono)
        await processing.consolidar_inventario(usuario_actual.id)

        # 3. Sincronizar a Postgres usando el bd inyectado por FastAPI (mismo loop OK)
        await processing.sincronizar_a_postgres(bd, usuario_actual.id, limpiar_todo=(modo == "nuevo"))

        return {"nombre_archivo": file.filename, "estado": "completado", "modo": modo}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))





@app.get("/api/data/status/{filename}")
async def estado_procesamiento(
    filename: str,
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    """Consulta el estado de procesamiento de un archivo subido."""
    nombre = validar_nombre_archivo(filename)  # protege contra path traversal
    dir_datos = processing.obtener_ruta_datos_usuario(usuario_actual.id)
    estado_path = os.path.join(dir_datos, f".estado_{nombre}.json")
    if os.path.exists(estado_path):
        with open(estado_path, "r") as f:
            return json.load(f)
    ruta_csv = os.path.join(dir_datos, nombre)
    if os.path.exists(ruta_csv):
        return {"estado": "completado", "nombre": nombre}
    return {"estado": "no_encontrado", "nombre": nombre}

@app.get("/api/data/relationships")
async def obtener_relaciones_archivos(
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    try:
        from backend import processing
        import polars as pl
        import os
        
        dir_u = processing.obtener_ruta_datos_usuario(usuario_actual.id)
        archivos = [f for f in os.listdir(dir_u) if f.endswith(".csv")]
        
        nodes = []
        links = []
        
        file_cols = {}
        for arch in archivos:
            ruta_csv = os.path.join(dir_u, arch)
            try:
                # Leer solo primeras filas para obtener el esquema sin crashear
                df = pl.read_csv(ruta_csv, infer_schema_length=100, ignore_errors=True, n_rows=10)
                real_cols = [processing.limpiar_string(c) for c in df.columns]
                file_cols[arch] = {
                    "size": os.path.getsize(ruta_csv),
                    "columns": real_cols
                }
                nodes.append({
                    "id": arch,
                    "name": arch.replace(".csv", ""),
                    "size": file_cols[arch]["size"],
                    "columns": real_cols
                })
            except Exception:
                pass
                
        KEYS = {"id_producto", "id_lote", "id_ubicacion", "nombre_ubicacion", "categoria", "nombre_producto", "sucursal_id", "producto_id", "lote_id"}
        for i in range(len(nodes)):
            for j in range(i + 1, len(nodes)):
                n1 = nodes[i]
                n2 = nodes[j]
                
                c1 = set(n1["columns"])
                c2 = set(n2["columns"])
                
                common_keys = sorted(list(c1.intersection(c2).intersection(KEYS)))
                if not common_keys:
                    ignore = {"fecha", "estado", "observaciones", "cantidad"}
                    common_keys = sorted(list(c1.intersection(c2) - ignore))
                
                if common_keys:
                    links.append({
                        "source": n1["id"],
                        "target": n2["id"],
                        "columns": common_keys
                    })
                    
        return {"nodes": nodes, "links": links}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/data/files/{filename}")
async def borrar_archivo(
    filename: str,
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    try:
        nombre = validar_nombre_archivo(filename)  # protege contra path traversal
        dir_datos = processing.obtener_ruta_datos_usuario(usuario_actual.id)
        ruta = os.path.join(dir_datos, nombre)
        # ELIMINAR DE ANALYSES.JSON (PERSISTENCIA) — Incluso si el archivo físico no existe
        # (Para limpiar referencias huérfanas)
        import time
        analyses = processing.cargar_analyses(usuario_actual.id)
        modificado = False
        for aid, adata in analyses.items():
            if nombre in adata.get("archivos", []):
                adata["archivos"].remove(nombre)
                adata["actualizado"] = int(time.time() * 1000)
                modificado = True
        if modificado:
            processing.guardar_analyses(usuario_actual.id, analyses)

        # ELIMINAR CACHE PARQUET
        ruta_cache = os.path.join(dir_datos, f".cache_{nombre}.parquet")
        if os.path.exists(ruta_cache):
            os.remove(ruta_cache)

        if os.path.exists(ruta):
            os.remove(ruta)
            await processing.consolidar_inventario(usuario_actual.id)
            await processing.sincronizar_a_postgres(bd, usuario_actual.id)
            return {"estado": "Eliminado", "nombre_archivo": nombre, "mensaje": "Archivo borrado y sincronizado"}
        
        # Si no existía el archivo pero limpiamos la referencia
        if modificado:
            await processing.consolidar_inventario(usuario_actual.id)
            await processing.sincronizar_a_postgres(bd, usuario_actual.id)
            return {"estado": "Eliminado", "nombre_archivo": nombre, "mensaje": "Referencia eliminada (el archivo ya no existía)"}

        raise HTTPException(status_code=404, detail="No existe el archivo ni referencias al mismo")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─────────────────────────────────────────────────────────────────────────────
# Endpoints de Análisis (sistema multi-CSV por análisis)
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/analyses")
async def listar_analyses(
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    """Lista todos los análisis del usuario (desde analyses.json), filtrando archivos huérfanos."""
    analyses = processing.cargar_analyses(usuario_actual.id)
    dir_datos = processing.obtener_ruta_datos_usuario(usuario_actual.id)
    
    # Validar que los archivos referenciados existan en disco (eliminar huérfanos al vuelo)
    changed = False
    for aid, adata in analyses.items():
        archivos_validos = [f for f in adata.get("archivos", []) if os.path.exists(os.path.join(dir_datos, f))]
        if len(archivos_validos) != len(adata.get("archivos", [])):
            analyses[aid]["archivos"] = archivos_validos
            changed = True
    if changed:
        processing.guardar_analyses(usuario_actual.id, analyses)
    
    resultado = sorted(analyses.values(), key=lambda a: a.get("actualizado", 0), reverse=True)
    return resultado



@app.post("/api/analyses")
async def crear_analisis(
    body: dict,
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    """Crea un nuevo análisis vacío con el nombre indicado."""
    nombre = (body.get("nombre") or "Análisis sin nombre").strip()
    
    # Validar nombre único
    analyses = processing.cargar_analyses(usuario_actual.id)
    if any(a.get("nombre", "").lower() == nombre.lower() for a in analyses.values()):
        raise HTTPException(status_code=400, detail=f"Ya existe un análisis con el nombre '{nombre}'")
        
    aid = processing.crear_analisis_entry(usuario_actual.id, nombre)
    # Recargar para devolver el objeto completo
    analyses = processing.cargar_analyses(usuario_actual.id)
    return analyses[aid]


@app.post("/api/analyses/{analysis_id}/files")
async def subir_archivo_a_analisis(
    analysis_id: str,
    file: UploadFile = File(...),
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    """Sube un CSV y lo agrega al análisis especificado."""
    try:
        analysis_id = validar_id_recurso(analysis_id, "analysis_id")
        analyses = processing.cargar_analyses(usuario_actual.id)
        if analysis_id not in analyses:
            raise HTTPException(status_code=404, detail=f"Análisis '{analysis_id}' no encontrado")

        dir_datos = processing.obtener_ruta_datos_usuario(usuario_actual.id)
        ruta_archivo = os.path.join(dir_datos, file.filename)
        contenido = await file.read()
        with open(ruta_archivo, "wb") as buf:
            buf.write(contenido)

        if not file.filename.endswith(".csv"):
            processing.agregar_archivo_a_analisis(usuario_actual.id, analysis_id, file.filename)
            return {"nombre_archivo": file.filename, "estado": "subido"}

        # Mapeo IA
        columnas = processing.obtener_columnas_archivo(ruta_archivo)
        try:
            import asyncio
            mapeo = await asyncio.wait_for(
                ai_utils.mapear_columnas_con_ia(columnas), timeout=8.0
            )
        except Exception:
            mapeo = {}

        ruta_mappings = os.path.join(dir_datos, "ai_mappings.json")
        mapeos_guardados = {}
        if os.path.exists(ruta_mappings):
            try:
                with open(ruta_mappings, "r") as mf:
                    mapeos_guardados = json.load(mf)
            except: pass
        mapeos_guardados[file.filename] = mapeo
        with open(ruta_mappings, "w") as mf:
            json.dump(mapeos_guardados, mf, indent=4)

        # Agregar al manifesto
        processing.agregar_archivo_a_analisis(usuario_actual.id, analysis_id, file.filename)

        # Consolidar SOLO los archivos de este análisis y sincronizar
        archivos_analisis = processing.cargar_analyses(usuario_actual.id)[analysis_id]["archivos"]
        await processing.consolidar_analisis_especifico(usuario_actual.id, archivos_analisis)
        await processing.sincronizar_a_postgres(bd, usuario_actual.id, limpiar_todo=True)

        return {"nombre_archivo": file.filename, "estado": "completado", "analysis_id": analysis_id}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/analyses/{analysis_id}/files/{filename}")
async def quitar_archivo_de_analisis(
    analysis_id: str,
    filename: str,
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    """Quita un archivo de la definición de un análisis sin borrarlo del disco."""
    try:
        analysis_id = validar_id_recurso(analysis_id, "analysis_id")
        analyses = processing.cargar_analyses(usuario_actual.id)
        if analysis_id not in analyses:
            raise HTTPException(status_code=404, detail="Análisis no encontrado")
        
        if filename in analyses[analysis_id].get("archivos", []):
            analyses[analysis_id]["archivos"].remove(filename)
            analyses[analysis_id]["actualizado"] = int(time.time() * 1000)
            processing.guardar_analyses(usuario_actual.id, analyses)
            
            # Si el análisis editado es el activo, necesitamos resincronizar Postgres
            # para que los datos desaparezcan del dashboard/inspector
            archivos_actuales = analyses[analysis_id].get("archivos", [])
            await processing.consolidar_analisis_especifico(usuario_actual.id, archivos_actuales)
            await processing.sincronizar_a_postgres(bd, usuario_actual.id, limpiar_todo=True)
            
            return {"estado": "ok", "mensaje": f"Archivo {filename} quitado del análisis"}
        
        return {"estado": "ignorado", "mensaje": "El archivo no pertenecía a este análisis"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/analyses/{analysis_id}")
async def eliminar_analisis(
    analysis_id: str,
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    """Elimina un análisis y sus CSVs huérfanos del disco."""
    try:
        analysis_id = validar_id_recurso(analysis_id, "analysis_id")
        huerfanos = processing.eliminar_analisis_entry(usuario_actual.id, analysis_id)
        dir_datos = processing.obtener_ruta_datos_usuario(usuario_actual.id)
        for fn in huerfanos:
            ruta = os.path.join(dir_datos, fn)
            if os.path.exists(ruta):
                os.remove(ruta)
            ruta_cache = os.path.join(dir_datos, f".cache_{fn}.parquet")
            if os.path.exists(ruta_cache):
                os.remove(ruta_cache)
        return {"estado": "ok", "eliminados": huerfanos}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/analyses/{analysis_id}/rename")
async def renombrar_analisis(
    analysis_id: str,
    body: dict,
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    """Renombra un análisis existente."""
    try:
        nuevo_nombre = body.get("nombre", "").strip()
        if not nuevo_nombre:
            raise HTTPException(status_code=400, detail="Falta el nuevo nombre")
            
        analysis_id = validar_id_recurso(analysis_id, "analysis_id")
        analyses = processing.cargar_analyses(usuario_actual.id)
        if analysis_id not in analyses:
            raise HTTPException(status_code=404, detail="Análisis no encontrado")
            
        # Validar que el nombre no esté ocupado por OTRO análisis
        if any(a.get("nombre", "").lower() == nuevo_nombre.lower() and aid != analysis_id 
               for aid, a in analyses.items()):
            raise HTTPException(status_code=400, detail=f"El nombre '{nuevo_nombre}' ya está en uso por otro análisis")

        old_name = analyses[analysis_id].get("nombre")
        analyses[analysis_id]["nombre"] = nuevo_nombre
        analyses[analysis_id]["actualizado"] = int(time.time() * 1000)
        processing.guardar_analyses(usuario_actual.id, analyses)
        
        return {"estado": "ok", "id": analysis_id, "nombre": nuevo_nombre, "anterior": old_name}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/analyses/{analysis_id}/activate")
async def activar_analisis(
    analysis_id: str,
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    """
    Activa un análisis: consolida SOLO sus archivos y sincroniza Postgres.
    Garantiza aislamiento total entre análisis.
    """
    try:
        analysis_id = validar_id_recurso(analysis_id, "analysis_id")
        analyses = processing.cargar_analyses(usuario_actual.id)
        if analysis_id not in analyses:
            raise HTTPException(status_code=404, detail=f"Análisis '{analysis_id}' no encontrado")

        archivos = analyses[analysis_id].get("archivos", [])
        if not archivos:
            # Análisis vacío: limpiar Postgres
            await bd.execute(delete(models.ArticuloInventario).where(
                models.ArticuloInventario.usuario_id == usuario_actual.id
            ))
            await bd.commit()
            return {"estado": "ok", "archivos": [], "mensaje": "Análisis vacío activado"}

        await processing.consolidar_analisis_especifico(usuario_actual.id, archivos)
        await processing.sincronizar_a_postgres(bd, usuario_actual.id, limpiar_todo=True)

        print(f"✅ activate: análisis '{analysis_id}' ({len(archivos)} archivos) cargado en Postgres")
        return {"estado": "ok", "archivos": archivos}

    except HTTPException:
        raise
    except Exception as e:
        await bd.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# Mantener compatibilidad con el endpoint antiguo (por si queda alguna referencia)
@app.post("/api/data/switch-analisis")
async def switch_analisis_legacy(
    filename: str = Query(...),
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    """Legacy: redirige al nuevo sistema de análisis."""
    nombre = validar_nombre_archivo(filename)  # validación contra path traversal
    await processing.consolidar_analisis_especifico(usuario_actual.id, [nombre])
    await processing.sincronizar_a_postgres(bd, usuario_actual.id, limpiar_todo=True)
    return {"estado": "ok", "archivo": nombre}


@app.delete("/api/data/reset")
async def resetear_datos(
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    try:
        dir_datos = processing.obtener_ruta_datos_usuario(usuario_actual.id)
        if os.path.exists(dir_datos):
            for f in os.listdir(dir_datos):
                try: os.remove(os.path.join(dir_datos, f))
                except: pass
        
        # Borrado quirúrgico por usuario (Multi-tenancy Fix)
        await bd.execute(delete(models.ArticuloInventario).where(models.ArticuloInventario.usuario_id == usuario_actual.id))
        await bd.execute(delete(models.Donacion).where(models.Donacion.usuario_id == usuario_actual.id))
        await bd.commit()
        
        return {"estado": "Todos los datos del usuario han sido eliminados correctamente."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/data/files")
async def listar_archivos(usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)):
    return processing.listar_archivos_datos(usuario_actual.id)

@app.get("/api/data/sessions")
async def obtener_sesiones(
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    """Obtiene lista de sesiones (nombres de archivos) únicas del inventario."""
    try:
        from sqlalchemy import select, func
        # Buscamos en ArticuloInventario y Donacion para tener todas las fuentes presentes
        stmt1 = select(models.ArticuloInventario.nombre_fuente).where(models.ArticuloInventario.usuario_id == usuario_actual.id).distinct()
        stmt2 = select(models.Donacion.nombre_fuente).where(models.Donacion.usuario_id == usuario_actual.id).distinct()
        
        res1 = await bd.execute(stmt1)
        res2 = await bd.execute(stmt2)
        
        sesiones = set(r[0] for r in res1.all() if r[0])
        sesiones.update(r[0] for r in res2.all() if r[0])
        
        return {"sesiones": sorted(list(sesiones))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/data/schema/{filename}")
async def obtener_esquema(
    filename: str,
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    try:
        nombre = validar_nombre_archivo(filename)  # protege contra path traversal
        res = processing.obtener_esquema_archivo(nombre, usuario_actual.id)
        if "error" in res:
            raise HTTPException(status_code=404, detail=res["error"])
        return res
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SolicitudDonacion(BaseModel):
    id_producto: str
    cantidad: int
    organizacion: str | None = "Banco de Alimentos Regional"
    accion: str | None = "Donar"

@app.post("/api/donations")
async def registrar_donacion(
    datos: SolicitudDonacion,
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    try:
        # 1. Obtener producto de la BD para sacar info y costo
        res = await bd.execute(select(models.ArticuloInventario).where(
            models.ArticuloInventario.id_producto == datos.id_producto,
            models.ArticuloInventario.usuario_id == usuario_actual.id
        ))
        art = res.scalars().first()
        if not art:
            raise HTTPException(status_code=404, detail="Producto no encontrado")
        
        cantidad_donar = min(datos.cantidad, art.cantidad_stock)
        valor_donado = cantidad_donar * art.costo_unitario
        
        # 2. Calcular Impacto Social/Ambiental (HU-08)
        tipo_final = datos.accion or "Donación"
        huella_carbono = (cantidad_donar * 0.45) if any(x in tipo_final.lower() for x in ["donar", "donación", "merma"]) else 0.0
        raciones = (cantidad_donar * 1.8) if "donar" in tipo_final.lower() or "donación" in tipo_final.lower() else 0.0
        
        # Ahorro / Recuperación
        ahorro = 0.0
        v_total = cantidad_donar * (art.precio_unitario or 0)
        if "donar" in tipo_final.lower(): ahorro = valor_donado * 0.35
        elif "merma" in tipo_final.lower(): ahorro = valor_donado * 0.25
        else: ahorro = v_total * 0.70 # Recuperación por venta
        
        # 3. Crear registro de donación / tratamiento
        import json
        nueva_donacion = models.Donacion(
            usuario_id=usuario_actual.id,
            id_producto=art.id_producto,
            nombre_producto=art.nombre_producto,
            cantidad=cantidad_donar,
            valor_monetario=valor_donado,
            tipo_accion=tipo_final,
            ahorro_estimado=ahorro,
            organizacion_receptora=datos.organizacion or "Gestión Manual",
            huella_carbono_evitada=huella_carbono,
            raciones_estimadas=raciones,
            nombre_fuente=art.nombre_fuente, # IMPORTANTE: Linkeamos a la fuente del producto
            proveedor=art.proveedor,
            nombre_ubicacion=art.nombre_ubicacion,
            comentarios=json.dumps([{"id_unico": art.id_unico, "sku": art.id_producto, "cantidad": cantidad_donar}])
        )
        bd.add(nueva_donacion)
        
        # 4. Actualizar stock (Descontar lo donado)
        art.cantidad_stock -= cantidad_donar
        # No borrar para permitir reversión y persistencia de estado (HU-07)
        # if art.cantidad_stock <= 0:
        #     await bd.delete(art)
        
        await bd.commit()
        return {"estado": "Donación Registrada", "impacto": {"co2": huella_carbono, "raciones": raciones}}
    except Exception as e:
        await bd.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/donations/impact")
async def obtener_resumen_impacto(
    fuente: str = Query(None), # Filtro por archivo/sesión
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    from sqlalchemy import func, select
    
    # 1. Totales Generales (EXISTENTE)
    stmt_total = select(
        func.sum(models.Donacion.valor_monetario).label("valor"),
        func.sum(models.Donacion.huella_carbono_evitada).label("co2"),
        func.sum(models.Donacion.raciones_estimadas).label("raciones"),
        func.sum(models.Donacion.ahorro_estimado).label("ahorro"),
        func.count(models.Donacion.id).label("total_acciones")
    ).where(models.Donacion.usuario_id == usuario_actual.id)
    
    if fuente:
        stmt_total = stmt_total.where(models.Donacion.nombre_fuente == fuente)
        
    res_total = await bd.execute(stmt_total)
    stats = res_total.fetchone()
    
    # Manejar caso de sin registros para evitar crash de 'NoneType'
    total_ahorro = 0.0
    total_valor = 0.0
    total_co2 = 0.0
    total_raciones = 0.0
    total_acciones = 0
    
    if stats:
        total_valor = float(stats.valor or 0)
        total_co2 = float(stats.co2 or 0)
        total_raciones = float(stats.raciones or 0)
        total_ahorro = float(stats.ahorro or 0)
        total_acciones = int(stats.total_acciones or 0)

    # 2. Desglose por Categoría ...
    # (El resto sigue igual, pero con el check de seguridad)
    
    stmt_cat = select(
        models.Donacion.tipo_accion,
        func.sum(models.Donacion.valor_monetario).label("valor"),
        func.sum(models.Donacion.huella_carbono_evitada).label("co2"),
        func.sum(models.Donacion.raciones_estimadas).label("raciones"),
        func.sum(models.Donacion.ahorro_estimado).label("ahorro"),
        func.count(models.Donacion.id).label("conteo")
    ).where(models.Donacion.usuario_id == usuario_actual.id).group_by(models.Donacion.tipo_accion)
    
    if fuente:
        stmt_cat = stmt_cat.where(models.Donacion.nombre_fuente == fuente)
        
    res_cat = await bd.execute(stmt_cat)
    categories = res_cat.all()
    
    desglose = {}
    for c in categories:
        desglose[c[0] or "Otros"] = {
            "valor": float(c[1] or 0),
            "co2": float(c[2] or 0),
            "raciones": float(c[3] or 0),
            "ahorro": float(c[4] or 0),
            "conteo": int(c[5] or 0)
        }
        
    return {
        "valor_total_donado": total_valor,
        "co2_evitado": total_co2,
        "raciones_entregadas": total_raciones,
        "ahorro_total": total_ahorro,
        "cantidad_acciones": total_acciones,
        "desglose_por_categoria": desglose
    }

@app.get("/api/donations")
async def listar_donaciones(
    fuente: str = Query(None),
    limit: int = Query(100), # Limitar a 100 por defecto para velocidad
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    from sqlalchemy import select
    cols = [
        models.Donacion.id, models.Donacion.id_producto, models.Donacion.nombre_producto,
        models.Donacion.cantidad, models.Donacion.valor_monetario, models.Donacion.tipo_accion,
        models.Donacion.ahorro_estimado, models.Donacion.organizacion_receptora,
        models.Donacion.huella_carbono_evitada, models.Donacion.raciones_estimadas,
        models.Donacion.fecha_donacion, models.Donacion.nombre_fuente,
        models.Donacion.proveedor, models.Donacion.nombre_ubicacion,  # nuevas columnas
    ]
    stmt = select(*cols).where(models.Donacion.usuario_id == usuario_actual.id)
    if fuente:
        stmt = stmt.where(models.Donacion.nombre_fuente == fuente)
    res = await bd.execute(stmt.order_by(models.Donacion.fecha_donacion.desc()).limit(limit))
    rows = res.all()
    # Contar total (sin limit) para saber si hay más registros de los que se muestran
    from sqlalchemy import func
    stmt_count = select(func.count()).select_from(models.Donacion).where(models.Donacion.usuario_id == usuario_actual.id)
    if fuente:
        stmt_count = stmt_count.where(models.Donacion.nombre_fuente == fuente)
    total_count = (await bd.execute(stmt_count)).scalar() or 0
    return {
        "total": total_count,
        "limit": limit,
        "items": [
             {
                 "id": r[0], "id_producto": r[1], "nombre_producto": r[2],
                 "cantidad": float(r[3] or 0), "valor_monetario": float(r[4] or 0),
                 "tipo_accion": r[5], "ahorro_estimado": float(r[6] or 0),
                 "organizacion_receptora": r[7], "huella_carbono_evitada": float(r[8] or 0),
                 "raciones_estimadas": float(r[9] or 0),
                 "fecha_donacion": r[10].isoformat() if r[10] else None,
                 "nombre_fuente": r[11],
                 "proveedor": r[12] or "",
                 "nombre_ubicacion": r[13] or "",
             } for r in rows
        ]
    }

@app.get("/api/donations/tactics/csv")
async def descargar_csv_tacticas(
    ids: str = Query(...),
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    try:
        from fastapi.responses import Response
        from sqlalchemy import select
        import json
        import csv
        import io
        
        id_list = [int(i) for i in ids.split(",") if i.strip().isdigit()]
        if not id_list:
            raise HTTPException(status_code=400, detail="IDs inválidos")
            
        res = await bd.execute(
            select(models.Donacion).where(
                models.Donacion.id.in_(id_list),
                models.Donacion.usuario_id == usuario_actual.id
            )
        )
        donaciones = res.scalars().all()
        if not donaciones:
            raise HTTPException(status_code=404, detail="Registros no encontrados")
            
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID Registro", "ID Único", "SKU", "Producto", "Marca", "Cantidad", "Valor", "Proveedor", "Ubicación", "Categoría Local"])
        
        for d in donaciones:
            if d.comentarios:
                try:
                    skus = json.loads(d.comentarios)
                    if isinstance(skus, list):
                        for s in skus:
                            writer.writerow([
                                d.id, 
                                s.get("id_unico", ""), 
                                s.get("sku", ""), 
                                s.get("producto", ""), 
                                s.get("marca", "N/A"),
                                s.get("cantidad", ""), 
                                s.get("valor", ""), 
                                s.get("proveedor", "N/A"), 
                                s.get("ubicacion", "N/A"), 
                                s.get("categoria", "N/A")
                            ])
                        continue
                except:
                    pass
            # Fallback if no detailed json
            writer.writerow([d.id, "MASIVO", "N/A", d.nombre_producto, "N/A", d.cantidad, d.valor_monetario, d.proveedor or "N/A", d.nombre_ubicacion or "N/A", "N/A"])
                
        output.seek(0)
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=detalle_tactica_ia_{id_list[0]}.csv"}
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/donations/csv")
async def descargar_donaciones_csv(
    fuente: str = Query(None),
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    """
    Descarga el historial completo de donaciones/acciones de sostenibilidad como CSV.
    Útil cuando hay muchos registros que no se deben mostrar todos en pantalla.
    """
    from sqlalchemy import select
    from fastapi.responses import StreamingResponse
    import csv, io
    cols = [
        models.Donacion.id, models.Donacion.nombre_producto, models.Donacion.id_producto,
        models.Donacion.cantidad, models.Donacion.valor_monetario, models.Donacion.tipo_accion,
        models.Donacion.ahorro_estimado, models.Donacion.organizacion_receptora,
        models.Donacion.huella_carbono_evitada, models.Donacion.raciones_estimadas,
        models.Donacion.fecha_donacion, models.Donacion.nombre_fuente,
        models.Donacion.proveedor, models.Donacion.nombre_ubicacion,
    ]
    stmt = select(*cols).where(models.Donacion.usuario_id == usuario_actual.id)
    if fuente:
        stmt = stmt.where(models.Donacion.nombre_fuente == fuente)
    res = await bd.execute(stmt.order_by(models.Donacion.fecha_donacion.desc()))
    rows = res.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "ID", "Producto", "ID Producto", "Unidades", "Valor Monetario (CLP)",
        "Tipo Acción", "Ahorro Estimado (CLP)", "Organización Receptora",
        "Huella CO2 Evitada (kg)", "Raciones Estimadas",
        "Fecha", "Dataset Origen", "Proveedor", "Sucursal Origen"
    ])
    for r in rows:
        writer.writerow([
            r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7],
            r[8], r[9],
            r[10].strftime("%Y-%m-%d %H:%M") if r[10] else "",
            r[11], r[12] or "", r[13] or ""
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=donaciones_sostenibilidad.csv"}
    )

@app.delete("/api/donations/clear_all")
async def limpiar_historial_donaciones(
    fuente: str = Query(None), # Nueva opción para limpieza parcial solicitada por el usuario
    analisis_id: str = Query(None), # ID del análisis activo para re-consolidar correctamente
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    try:
        if fuente:
            # 1. Obtener donaciones de esta sesión para revertir stock
            stmt = select(models.Donacion).where(
                models.Donacion.usuario_id == usuario_actual.id,
                models.Donacion.nombre_fuente == fuente
            )
            res_d = await bd.execute(stmt)
            donaciones = res_d.scalars().all()

            # 2. Revertir stocks en la BD
            for d in donaciones:
                # Buscamos el artículo original en esta fuente (sesión)
                stmt_art = select(models.ArticuloInventario).where(
                    models.ArticuloInventario.usuario_id == usuario_actual.id,
                    models.ArticuloInventario.id_producto == d.id_producto,
                    models.ArticuloInventario.nombre_fuente == fuente
                )
                res_art = await bd.execute(stmt_art)
                art = res_art.scalars().first()
                if art:
                    art.cantidad_stock += d.cantidad # Devolvemos lo procesado al stock

            # 3. Borrar solo las donaciones de esa fuente
            await bd.execute(delete(models.Donacion).where(
                models.Donacion.usuario_id == usuario_actual.id,
                models.Donacion.nombre_fuente == fuente
            ))
            await bd.commit()
            
            # --- PERSISTENCIA: Refrescar el inventario consolidado ---
            # Borrar inventario.parquet para forzar re-consolidación con los stocks restaurados
            ruta_parquet = processing.obtener_ruta_parquet_usuario(usuario_actual.id)
            if os.path.exists(ruta_parquet):
                os.remove(ruta_parquet)
                
            # Re-consolidar y sincronizar respetando el aislamiento (HU-AISLAMIENTO)
            analyses = processing.cargar_analyses(usuario_actual.id)
            if analisis_id and analisis_id in analyses:
                archivos_analisis = analyses[analisis_id].get("archivos", [])
                await processing.consolidar_analisis_especifico(usuario_actual.id, archivos_analisis)
            else:
                await processing.consolidar_inventario(usuario_actual.id)
            
            await processing.sincronizar_a_postgres(bd, usuario_actual.id)

            print(f"🗑️ Limpieza parcial: Sesión '{fuente}' para usuario {usuario_actual.id}")
            return {"estado": "ok", "mensaje": f"Se limpiaron los registros de la sesión '{fuente}' y se restauró el stock localmente y en base de datos."}

        # --- LIMPIEZA GLOBAL (Fallback original) ---
        # 1. Borrar todas las donaciones del usuario
        await bd.execute(delete(models.Donacion).where(models.Donacion.usuario_id == usuario_actual.id))
        await bd.commit()

        # 2. Borrar el inventario.parquet modificado (tiene stocks reducidos por donaciones)
        ruta_parquet = processing.obtener_ruta_parquet_usuario(usuario_actual.id)
        if os.path.exists(ruta_parquet):
            os.remove(ruta_parquet)

        # 3. Re-consolidar: si hay un análisis activo, solo sus archivos; si no, todos
        analyses = processing.cargar_analyses(usuario_actual.id)
        if analisis_id and analisis_id in analyses:
            archivos_analisis = analyses[analisis_id].get("archivos", [])
            print(f"🔄 Re-consolidando análisis '{analisis_id}' ({len(archivos_analisis)} archivos) tras limpieza global")
            await processing.consolidar_analisis_especifico(usuario_actual.id, archivos_analisis)
        else:
            # Sin análisis activo: consolidar todos los CSVs
            await processing.consolidar_inventario(usuario_actual.id)

        # 4. Re-sincronizar Postgres con el inventario restaurado
        await processing.sincronizar_a_postgres(bd, usuario_actual.id, limpiar_todo=False)

        return {"estado": "ok", "mensaje": "Historial global eliminado e inventario restaurado al estado original."}
    except Exception as e:
        await bd.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/donations/bulk")
async def crear_donaciones_bulk(
    donaciones: list[dict],
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    try:
        from datetime import datetime
        # OPTIMIZACIÓN C-SPEED: Carga en lote de artículos para evitar N+1 (HU-OPT)
        id_productos = set()
        id_unicos = set()
        for d in donaciones:
            if d.get("id_producto") != "MASIVO":
                id_productos.add(d["id_producto"])
            for sub_sku in d.get("skus_afectados", []):
                uid = sub_sku.get("id_unico") or sub_sku.get("id")
                if uid: id_unicos.add(uid)
                
        articulos_dict = {}
        if id_productos:
            res_arts = await bd.execute(
                select(models.ArticuloInventario).where(
                    models.ArticuloInventario.id_producto.in_(id_productos),
                    models.ArticuloInventario.usuario_id == usuario_actual.id
                )
            )
            for a in res_arts.scalars().all():
                articulos_dict[a.id_producto] = a

        # Recopilar todos los id_unico afectados para hacer UPDATE directo
        # (evita bug de duplicados: el dict anterior solo descontaba 1 fila por id_unico)
        from sqlalchemy import update as sa_update

        for d in donaciones:
            cantidad = d.get("cantidad", 0)
            valor = d.get("valor", 0.0)
            tipo = d.get("tipo", "Donación")
            id_p = d["id_producto"]
            
            # Heurísticas de impacto
            co2 = (cantidad * 0.45) if tipo in ["Donación", "Donación Social", "Donación Urgente", "Merma"] else 0.0
            raciones = (cantidad * 1.8) if "Donación" in tipo else 0.0
            
            ahorro = 0.0
            if "Donación" in tipo: ahorro = valor * 0.35
            elif "Merma" in tipo: ahorro = valor * 0.25
            elif tipo in ["Venta Flash", "Pack Rescate", "Oferta Flash", "Liquidar"]: ahorro = valor * 0.70
            
            import json
            donacion = models.Donacion(
                usuario_id=usuario_actual.id,
                id_producto=id_p,
                nombre_producto=d.get("nombre_producto", "Producto"),
                cantidad=cantidad,
                valor_monetario=valor,
                tipo_accion=tipo,
                ahorro_estimado=ahorro,
                organizacion_receptora=d.get("organizacion", "Gestión Masiva"),
                huella_carbono_evitada=co2,
                raciones_estimadas=raciones,
                fecha_donacion=datetime.utcnow(),
                comentarios=json.dumps(d.get("skus_afectados", []))
            )
            donacion.nombre_fuente = d.get("fuente")
            # Buscar el proveedor y la sucursal original si los tenemos cargados
            art_db = articulos_dict.get(id_p)
            if art_db:
                donacion.proveedor = art_db.proveedor
                donacion.nombre_ubicacion = art_db.nombre_ubicacion
                
            bd.add(donacion)

        # UPDATE DIRECTO para poner a 0 TODAS las filas con los id_unico afectados
        # Esto maneja duplicados correctamente (el ORM dict solo actualiza 1 fila por key)
        if id_unicos:
            await bd.execute(
                sa_update(models.ArticuloInventario)
                .where(
                    models.ArticuloInventario.id_unico.in_(list(id_unicos)),
                    models.ArticuloInventario.usuario_id == usuario_actual.id
                )
                .values(cantidad_stock=0, valor_stock=0.0)
            )
            print(f"✅ UPDATE directo: {len(id_unicos)} id_unicos puestos a stock=0")

        # Para id_producto explícito (no MASIVO), descontar por ORM
        for d in donaciones:
            id_p = d.get("id_producto", "MASIVO")
            if id_p != "MASIVO" and id_p in articulos_dict:
                art = articulos_dict[id_p]
                art.cantidad_stock = max(0, art.cantidad_stock - d.get("cantidad", 0))

        await bd.commit()

        # ── Parchear el Parquet cache para PERSISTIR los descuentos ─────────────
        # Sin esto, la próxima sincronización desde el Parquet restauraría el stock original.
        try:
            import polars as pl
            ruta_parquet = processing.obtener_ruta_parquet_usuario(usuario_actual.id)
            if os.path.exists(ruta_parquet) and id_unicos:
                df_p = pl.read_parquet(ruta_parquet)

                if "id_unico" in df_p.columns and "cantidad_stock" in df_p.columns:
                    # Poner a 0 todas las filas cuyo id_unico es afectado
                    id_unicos_list = list(id_unicos)
                    df_p = df_p.with_columns(
                        pl.when(pl.col("id_unico").is_in(id_unicos_list))
                        .then(pl.lit(0, dtype=pl.Int64))
                        .otherwise(pl.col("cantidad_stock"))
                        .alias("cantidad_stock")
                    )
                    # Recalcular valor_stock
                    if "costo_unitario" in df_p.columns:
                        df_p = df_p.with_columns(
                            pl.when(pl.col("cantidad_stock").fill_null(0) < 0)
                            .then(pl.lit(0.0)) # Si es negativo, el valor de stock es 0 o se puede marcar de otra forma
                            .otherwise(pl.col("cantidad_stock").cast(pl.Float64) * pl.col("costo_unitario"))
                            .alias("valor_stock")
                        )

                    # Guardar solo las columnas estándar que existan en el dataframe
                    from backend.processing import COLUMNAS_ESTANDAR
                    cols_presentes = [c for c in COLUMNAS_ESTANDAR if c in df_p.columns]
                    df_p.select(cols_presentes).write_parquet(ruta_parquet)

                    # Invalidar caches individuales
                    dir_u = processing.obtener_ruta_datos_usuario(usuario_actual.id)
                    for f in os.listdir(dir_u):
                        if f.startswith(".cache_") and f.endswith(".parquet"):
                            try: os.remove(os.path.join(dir_u, f))
                            except: pass
                    print(f"✅ Parquet parcheado: {len(id_unicos)} id_unicos puestos a 0")
        except Exception as e_parquet:

            print(f"⚠️ No se pudo parchear parquet (no crítico): {e_parquet}")

        return {"estado": "exito", "cantidad": len(donaciones)}
    except Exception as e:
        await bd.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/donations/{donation_id}")
async def revertir_donacion(
    donation_id: int,
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    try:
        # 1. Buscar la donación
        res = await bd.execute(select(models.Donacion).where(
            models.Donacion.id == donation_id,
            models.Donacion.usuario_id == usuario_actual.id
        ))
        donacion = res.scalars().first()
        if not donacion:
            raise HTTPException(status_code=404, detail="Donación no encontrada")
        
        # 2. Buscar el producto original (por SKU ya que es lo que tenemos)
        # Nota: Tomamos el primero que coincida por ahora (HU-07)
        res_art = await bd.execute(select(models.ArticuloInventario).where(
            models.ArticuloInventario.id_producto == donacion.id_producto,
            models.ArticuloInventario.usuario_id == usuario_actual.id
        ))
        art = res_art.scalars().first()
        
        if art:
            # Si el producto existe, le devolvemos el stock
            art.cantidad_stock += donacion.cantidad
        else:
            # Si el producto fue borrado (por lógica antigua), podríamos recrearlo, 
            # pero por ahora informamos que no se puede restaurar stock si el registro base desapareció.
            # Sin embargo, con el cambio anterior de NO borrar, esto debería ser menos común.
            pass

        # 3. Eliminar el registro de donación
        await bd.delete(donacion)
        await bd.commit()
        
        return {"estado": "Donación Revertida", "producto": donacion.nombre_producto}
    except Exception as e:
        await bd.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@app.patch("/api/donations/{donation_id}/type")
async def actualizar_tipo_donacion(
    donation_id: int,
    body: dict,
    bd: AsyncSession = Depends(database.obtener_bd),
    usuario_actual: models.Usuario = Depends(auth.obtener_usuario_actual)
):
    try:
        nuevo_tipo = body.get("tipo_accion")
        if not nuevo_tipo:
            raise HTTPException(status_code=400, detail="Falta tipo_accion")

        # 1. Buscar la donación
        res = await bd.execute(select(models.Donacion).where(
            models.Donacion.id == donation_id,
            models.Donacion.usuario_id == usuario_actual.id
        ))
        donacion = res.scalars().first()
        if not donacion:
            raise HTTPException(status_code=404, detail="Donación no encontrada")
        
        # 2. Actualizar tipo y recalcular ahorros/impacto (basado en la misma lógica de registro)
        donacion.tipo_accion = nuevo_tipo
        
        # Recalcular heurísticas de impacto (Copiado de registrar_donacion)
        tipo_l = nuevo_tipo.lower()
        donacion.huella_carbono_evitada = (donacion.cantidad * 0.45) if any(x in tipo_l for x in ["donar", "donación", "merma"]) else 0.0
        donacion.raciones_estimadas = (donacion.cantidad * 1.8) if "donar" in tipo_l or "donación" in tipo_l else 0.0
        
        # Ahorro / Recuperación
        res_art = await bd.execute(select(models.ArticuloInventario).where(
            models.ArticuloInventario.id_producto == donacion.id_producto,
            models.ArticuloInventario.usuario_id == usuario_actual.id
        ))
        art = res_art.scalars().first()
        
        if art:
            valor_base = donacion.cantidad * art.costo_unitario
            if "donar" in tipo_l or "donación" in tipo_l:
                donacion.ahorro_estimado = valor_base * 0.35
            elif "merma" in tipo_l:
                donacion.ahorro_estimado = valor_base * 0.25
            else:
                donacion.ahorro_estimado = (donacion.cantidad * (art.precio_unitario or 0)) * 0.70

        await bd.commit()
        return {"estado": "Actualizado", "tipo_final": nuevo_tipo}
    except Exception as e:
        await bd.rollback()
        raise HTTPException(status_code=500, detail=str(e))

# Estáticos
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
