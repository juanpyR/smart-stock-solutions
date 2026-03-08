import polars as pl
import numpy as np
import os, math, random
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict
from sqlalchemy.future import select
from sqlalchemy import select, text, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from . import models, ai_utils

# Rutas y Aislamiento (Multi-Tenancy)
DIRECTORIO_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def obtener_ruta_datos_usuario(user_id: int) -> str:
    """Devuelve la ruta al directorio de datos específico de un usuario."""
    ruta = os.path.join(DIRECTORIO_BASE, "data", f"u_{user_id}")
    if not os.path.exists(ruta):
        os.makedirs(ruta, exist_ok=True)
    return ruta

def limpiar_datos_usuario(user_id: int):
    """Limpia todos los CSV y cache del usuario para empezar de cero."""
    d = obtener_ruta_datos_usuario(user_id)
    if os.path.exists(d):
        for f in os.listdir(d):
            if (f.endswith(".csv") or f.startswith(".cache") or
                    f in ("ai_mappings.json", "inventario.parquet", "analyses.json")):
                try: os.remove(os.path.join(d, f))
                except: pass

def obtener_ruta_parquet_usuario(user_id: int) -> str:
    """Devuelve la ruta al archivo Parquet consolidado del usuario."""
    return os.path.join(obtener_ruta_datos_usuario(user_id), "inventario.parquet")

# ─────────────────────────────────────────────────────────────────────────────
# Sistema de Manifesto de Análisis (analyses.json)
# Cada análisis tiene: id, nombre, archivos[], creado, actualizado
# ─────────────────────────────────────────────────────────────────────────────
import json as _json_mod
import uuid as _uuid_mod
import time as _time_mod

ANALYSES_FILE = "analyses.json"

def cargar_analyses(user_id: int) -> dict:
    ruta = os.path.join(obtener_ruta_datos_usuario(user_id), ANALYSES_FILE)
    if not os.path.exists(ruta):
        return {}
    try:
        with open(ruta, "r", encoding="utf-8") as f:
            return _json_mod.load(f)
    except:
        return {}

def guardar_analyses(user_id: int, analyses: dict):
    dir_u = obtener_ruta_datos_usuario(user_id)
    ruta = os.path.join(dir_u, ANALYSES_FILE)
    with open(ruta, "w", encoding="utf-8") as f:
        _json_mod.dump(analyses, f, indent=2, ensure_ascii=False)

def crear_analisis_entry(user_id: int, nombre: str) -> str:
    """Crea una entrada nueva en el manifesto y retorna su ID."""
    aid = "a_" + _uuid_mod.uuid4().hex[:8]
    analyses = cargar_analyses(user_id)
    now = int(_time_mod.time() * 1000)
    analyses[aid] = {
        "id": aid,
        "nombre": nombre.strip() or "Análisis sin nombre",
        "archivos": [],
        "creado": now,
        "actualizado": now
    }
    guardar_analyses(user_id, analyses)
    return aid

def agregar_archivo_a_analisis(user_id: int, analysis_id: str, filename: str):
    """Agrega un CSV al manifesto de un análisis."""
    analyses = cargar_analyses(user_id)
    if analysis_id not in analyses:
        raise ValueError(f"Análisis '{analysis_id}' no encontrado")
    if filename not in analyses[analysis_id]["archivos"]:
        analyses[analysis_id]["archivos"].append(filename)
    analyses[analysis_id]["actualizado"] = int(_time_mod.time() * 1000)
    guardar_analyses(user_id, analyses)

def eliminar_analisis_entry(user_id: int, analysis_id: str) -> list:
    """Elimina análisis del manifesto. Retorna lista de CSVs huérfanos (no usados en otros análisis)."""
    analyses = cargar_analyses(user_id)
    if analysis_id not in analyses:
        return []
    archivos_del_analisis = analyses[analysis_id].get("archivos", [])
    del analyses[analysis_id]
    guardar_analyses(user_id, analyses)
    # Archivos usados en otros análisis
    usados = set()
    for a in analyses.values():
        usados.update(a.get("archivos", []))
    return [f for f in archivos_del_analisis if f not in usados]

async def consolidar_analisis_especifico(user_id: int, archivos_lista: list[str]):
    """
    Consolida SOLO los CSVs indicados en archivos_lista.
    Garantiza aislamiento total entre análisis al filtrar los archivos antes de consolidar.
    """
    ruta_p = obtener_ruta_parquet_usuario(user_id)
    if os.path.exists(ruta_p):
        try: os.remove(ruta_p)
        except: pass
    await consolidar_inventario(user_id, archivos_permitidos=archivos_lista)



COLUMNAS_ESTANDAR = [
    "id_unico", "id_producto", "id_lote", "nombre_producto", "categoria", 
    "cantidad_stock", "punto_reorden", "costo_unitario", "precio_unitario", "valor_stock", 
    "fecha_vencimiento", "demanda_diaria", "tiempo_entrega", "elasticidad",
    "id_ubicacion", "nombre_ubicacion", "latitud", "longitud",
    "rotacion_abc", "eta_dias", "fecha_datos", "nombre_fuente", "proveedor", "marca",
    "clima", "descuento", "unidades_vendidas", "unidades_pedidas", "precio_competencia", "es_festivo"
]

# Configuración de Alertas
UMBRALES_RIESGO = {
    "VENCIDO": 0,
    "CRITICO": 3,
    "URGENTE": 7,
    "PREVENTIVO": 10
}

MAPEO_RESPALDO = {
    # El orden dentro de cada lista define la prioridad: el primero encontrado gana
    "nombre_producto": ["nombre_producto", "nombre_del_producto", "producto", "nombre", "item", "articulo", "desc", "descripcion", "product_name", "product", "item_description", "art"],
    "cantidad_stock": ["stock_final", "cantidad_stock", "stock_actual", "stock", "existencias", "stock_teorico_unidades", "qty", "count", "stock_inicial", "unidades", "stock_qty", "inventory_level", "inventory", "on_hand", "quantity", "disp", "disponibilidad"],
    "fecha_vencimiento": ["fecha_vencimiento", "fecha_vencimiento_lote", "vencimiento", "fecha_de_vencimiento", "expiry_date", "expiry", "exp", "expiration_date", "expiry_dt", "f_venc"],
    "precio_unitario": ["precio_unitario", "precio_venta_bruto", "precio_venta_promedio", "precio_venta", "precio_promedio", "precio_final", "precio", "p_venta", "precio_venta_clp", "unit_price", "price", "sale_price", "list_price", "pvp"],
    "costo_unitario": ["costo_unitario", "costo_unitario_neto", "costo", "costo_compra", "valor_unitario_clp", "compra", "unit_cost", "cost", "buying_price", "purchase_price", "p_costo"],
    # Demanda diaria: units_sold o demand_forecast
    "demanda_diaria": ["demanda_diaria", "demanda", "ventas_diarias", "unidades_vendidas", "daily_demand", "sales_daily", "units_sold", "demand_forecast", "demand", "avg_demand", "vel_venta"],
    "id_producto": ["id_producto", "sku", "producto_id", "codigo", "codigo_producto", "id", "id del producto", "product_id", "item_id", "cod"],
    "id_lote": ["id_lote", "lote", "lote_id", "nro_lote", "batch", "batch_id", "lot_number", "lote_nro"],
    "categoria": ["categoria", "categoría", "familia", "linea", "rubro", "category", "product_category", "type", "fam"],
    "nombre_ubicacion": ["nombre_ubicacion", "sucursal", "ubicacion", "tienda", "bodega", "almacen", "location_name", "store_id", "warehouse", "location", "region", "store", "ubic"],
    "eta_dias": ["eta_dias", "eta_proveedor_dias", "eta", "dias_entrega", "lead_time", "delivery_days", "lead"],
    "latitud": ["latitud", "latitude", "lat", "coord_y"],
    "longitud": ["longitud", "longitude", "lon", "coord_x"],
    "fecha_datos": ["fecha_datos", "fecha", "fecha_movimiento", "fecha_reporte", "fecha_carga", "snapshot_date", "date", "report_date"],
    "proveedor": ["proveedor", "nombre_proveedor", "vendor", "supplier", "distribuidor", "fabricante", "source"],
    "marca": ["marca", "brand", "fabricante", "laboratorio"],
    "clima": ["clima", "weather", "condicion_climatica", "weather_condition", "climatologia"],
    "descuento": ["descuento", "discount", "rebaja", "promo", "off"],
    "unidades_vendidas": ["unidades_vendidas", "units_sold", "ventas", "sold_qty", "sales_units"],
    "unidades_pedidas": ["unidades_pedidas", "unidades_ordenadas", "units_ordered", "ordered_qty", "pedidos", "reorden", "reposicion", "reposición", "entrada", "entradas"],
    "precio_competencia": ["precio_competencia", "competitor_pricing", "precio_mercado", "market_price", "comp_price"],
    "es_festivo": ["es_festivo", "holiday", "promotion", "holiday_promotion", "promo_day"]
}

def limpiar_string(s: str) -> str:
    if not s: return ""
    import re
    s = str(s).lower().strip()
    # Limpiar caracteres invisibles de excel/crlf
    s = s.replace("\r", "").replace("\n", "").strip()
    s = s.replace("á","a").replace("é","e").replace("í","i").replace("ó","o").replace("ú","u").replace("ñ","n")
    s = re.sub(r'[^a-z0-9]', '_', s)
    return re.sub(r'_+', '_', s).strip('_')

def _parsear_fechas_vectorizado(df: pl.DataFrame, col: str) -> pl.DataFrame:
    if col not in df.columns: return df
    return df.with_columns([
        pl.coalesce([
            pl.col(col).cast(pl.Utf8).str.strptime(pl.Date, "%Y-%m-%d", strict=False),
            pl.col(col).cast(pl.Utf8).str.strptime(pl.Date, "%d/%m/%Y", strict=False),
            pl.col(col).cast(pl.Utf8).str.strptime(pl.Date, "%m/%d/%Y", strict=False),
            pl.col(col).cast(pl.Utf8).str.strptime(pl.Date, "%Y/%m/%d", strict=False),
            pl.col(col).cast(pl.Utf8).str.slice(0, 10).str.strptime(pl.Date, "%Y-%m-%d", strict=False)
        ]).alias(col)
    ])

def procesar_csv(ruta_entrada: str, mapeo: dict = None) -> pl.DataFrame:
    try:
        try:
            df = pl.read_csv(ruta_entrada, infer_schema_length=0, ignore_errors=True)
        except Exception:
            df = pl.read_csv(ruta_entrada, infer_schema_length=0, ignore_errors=True, encoding="latin-1")
        if df.height == 0: return None
        # Renombrar columnas de forma segura evitando duplicados tras limpiar_string
        nombres_nuevos = {}
        usados = set()
        for col in df.columns:
            base = limpiar_string(col)
            final = base
            counter = 1
            while final in usados:
                final = f"{base}_{counter}"
                counter += 1
            nombres_nuevos[col] = final
            usados.add(final)
        
        df = df.rename(nombres_nuevos)

        # Strip embedded newlines and whitespace from every string column (CRLF / Excel issue)
        str_cols = [c for c in df.columns if df[c].dtype == pl.Utf8]
        if str_cols:
            df = df.with_columns([
                pl.col(c).str.strip_chars().str.replace_all(r"[\r\n]+", " ").alias(c)
                for c in str_cols
            ])
        df = normalizar_dataframe(df, mapeo)
        return df
    except Exception as e:
        print(f"❌ Error procesando CSV {ruta_entrada}: {e}")
        return None

def aplicar_relaciones_inteligentes(dfs: list[pl.DataFrame]) -> pl.DataFrame:
    """Detecta esquemas estrella/copo de nieve en multiples archivos y efectua
    Joins inteligentes en vez de simples concatenaciones. """
    if not dfs:
        return pl.DataFrame([], schema={c: pl.Utf8 for c in COLUMNAS_ESTANDAR})
    if len(dfs) == 1:
        return dfs[0]

    analizados = []
    for df in dfs:
        reales = set()
        for c in df.columns:
            if c in ("id_unico", "nombre_fuente"): continue
            if df.select(pl.col(c).is_not_null().sum()).item() > 0:
                reales.add(c)
        analizados.append({
            "df": df.select(list(reales) + ["nombre_fuente"]),
            "reales": reales
        })

    facts = [a for a in analizados if "cantidad_stock" in a["reales"]]
    dims = [a for a in analizados if "cantidad_stock" not in a["reales"]]
            
    if facts:
        base_df = pl.concat([a["df"] for a in facts], how="diagonal")
    elif dims:
        base_df = dims[0]["df"]
        dims = dims[1:]
    else:
        return pl.DataFrame([], schema={c: pl.Utf8 for c in COLUMNAS_ESTANDAR})

    # Llaves ordenadas de más únicas a más genéricas
    KEYS = ["id_producto", "id_lote", "id_ubicacion", "nombre_producto", "nombre_ubicacion", "categoria"]

    for a in dims:
        dim_df = a["df"]
        reales = a["reales"]
        
        pk_candidates = [k for k in KEYS if k in reales]
        if pk_candidates:
            dim_df = dim_df.unique(subset=pk_candidates, keep="first")
            join_keys = [k for k in pk_candidates if k in base_df.columns]
        else:
            join_keys = []
            
        if not join_keys:
            # Revertir a apendice simple si no coinciden llaves
            base_df = pl.concat([base_df, dim_df], how="diagonal")
            continue
            
        base_df = base_df.join(dim_df, on=join_keys, how="left", suffix="_dim")
        
        coalesce_exprs = []
        drop_cols = []
        for c in dim_df.columns:
            if c not in join_keys and f"{c}_dim" in base_df.columns:
                coalesce_exprs.append(pl.coalesce([pl.col(c), pl.col(f"{c}_dim")]).alias(c))
                drop_cols.append(f"{c}_dim")
                
        if coalesce_exprs:
            base_df = base_df.with_columns(coalesce_exprs).drop(drop_cols)

    for c in COLUMNAS_ESTANDAR:
        if c not in base_df.columns:
            base_df = base_df.with_columns(pl.lit(None, dtype=pl.Utf8).alias(c))
            
    base_df = base_df.with_columns([
        (pl.col("id_producto").fill_null("NA").cast(pl.Utf8) + "_" +
         pl.col("id_lote").fill_null("0").cast(pl.Utf8) + "_" +
         pl.col("nombre_ubicacion").fill_null("NA").cast(pl.Utf8) + "_" +
         pl.col("fecha_vencimiento").fill_null("").cast(pl.Utf8)).alias("id_unico")
    ])
    
    return base_df.select(COLUMNAS_ESTANDAR)


async def consolidar_inventario(user_id: int, archivos_permitidos: list[str] = None):
    """Consolida los CSV del usuario en un Parquet unificado.
    Si se pasa archivos_permitidos, solo usa esos archivos.
    """
    dir_u = obtener_ruta_datos_usuario(user_id)
    archivos = [f for f in os.listdir(dir_u) if f.endswith(".csv")]
    if archivos_permitidos is not None:
        archivos = [f for f in archivos if f in archivos_permitidos]

    import json
    ruta_mappings = os.path.join(dir_u, "ai_mappings.json")
    mapeos = {}
    if os.path.exists(ruta_mappings):
        try:
            with open(ruta_mappings, "r") as mf:
                mapeos = json.load(mf)
        except: pass

    dfs = []
    for arch in archivos:
        ruta_csv = os.path.join(dir_u, arch)
        ruta_cache = os.path.join(dir_u, f".cache_{arch}.parquet")

        # Si el cache existe y es más nuevo que el CSV, reusar sin reprocesar
        if (os.path.exists(ruta_cache) and
                os.path.getmtime(ruta_cache) >= os.path.getmtime(ruta_csv)):
            try:
                dfs.append(pl.read_parquet(ruta_cache))
                continue
            except: pass  # Si falla la lectura del cache, reprocesar

        # Procesar CSV y guardar cache
        df = procesar_csv(ruta_csv, mapeos.get(arch))
        if df is not None:
            # HU-UNIQUE (MEJORA): No colapsamos filas del mismo CSV para no perder productos.
            # Solo eliminamos duplicados exactos si el usuario subió el mismo archivo dos veces.
            df = df.with_row_count("original_row_index")
            df = df.with_columns([
                # Generamos un ID único por fila física del CSV
                (pl.col("id_producto").cast(pl.Utf8).fill_null("UNK") + "_" +
                 pl.col("id_lote").fill_null("0").cast(pl.Utf8) + "_" +
                 pl.col("nombre_ubicacion").fill_null("NA").cast(pl.Utf8) + "_" +
                 pl.col("fecha_datos").fill_null("NA").cast(pl.Utf8) + "_" +
                 pl.col("original_row_index").cast(pl.Utf8)).alias("id_unico"),
                pl.lit(arch).alias("nombre_fuente")
            ]).drop("original_row_index")
            try:
                # Asegurar columnas estándar
                for c in COLUMNAS_ESTANDAR:
                    if c not in df.columns:
                        df = df.with_columns(pl.lit(None).alias(c))
                df.select(COLUMNAS_ESTANDAR).write_parquet(ruta_cache)
            except: pass
            dfs.append(df)

    base_df = aplicar_relaciones_inteligentes(dfs)

    # --- CATEGORIZACIÓN INTELIGENTE CON IA (HU-ADV) ---
    if base_df.height > 0 and "categoria" in base_df.columns:
        # 1. Identificar productos sin categoría
        sin_cat = base_df.filter(
            (pl.col("categoria").is_null()) | 
            (pl.col("categoria") == "") | 
            (pl.col("categoria") == "Sin Categoría")
        )
        
        if sin_cat.height > 0:
            try:
                nombres_unicos = sin_cat["nombre_producto"].unique().to_list()
                
                # 2. Llamar a la IA para categorizar
                mapeo_cats = await ai_utils.categorizar_productos_ia(nombres_unicos)
                
                if mapeo_cats:
                    # 3. Aplicar las categorías encontradas de forma vectorizada
                    base_df = base_df.with_columns(
                        pl.col("nombre_producto").map_elements(
                            lambda x: mapeo_cats.get(x, "Sin Categoría"),
                            return_dtype=pl.Utf8
                        ).alias("categoria_ia")
                    ).with_columns(
                        pl.when(
                            (pl.col("categoria").is_null()) | 
                            (pl.col("categoria") == "") | 
                            (pl.col("categoria") == "Sin Categoría")
                        )
                        .then(pl.col("categoria_ia"))
                        .otherwise(pl.col("categoria"))
                        .alias("categoria")
                    ).drop("categoria_ia")
            except Exception as e:
                print(f"⚠️ Error en categorización IA: {e}")
    # --------------------------------------------------

    if base_df.height > 0:
        # ASEGURAR COLUMNAS PARA SELECCIÓN (HU-RESILIENCIA)
        cols_missing = [c for c in COLUMNAS_ESTANDAR if c not in base_df.columns]
        if cols_missing:
            base_df = base_df.with_columns([pl.lit(None).alias(c) for c in cols_missing])

        # Casting final vectorizado en Polars (Rust)
        NULOS_INT = ["cantidad_stock", "tiempo_entrega", "punto_reorden", "eta_dias", "es_festivo"]
        NULOS_FLOAT = ["costo_unitario", "precio_unitario", "demanda_diaria", "elasticidad",
                       "latitud", "longitud", "unidades_vendidas", "unidades_pedidas", "precio_competencia", "descuento"]
        exprs = (
            [pl.col(c).cast(pl.Float64, strict=False).cast(pl.Int64, strict=False)
               .fill_null(1 if c == "elasticidad" else 0).alias(c) for c in NULOS_INT if c in base_df.columns]
            + [pl.col(c).cast(pl.Float64, strict=False)
               .fill_null(1.0 if c == "elasticidad" else 0.0).alias(c) for c in NULOS_FLOAT if c in base_df.columns]
        )
        base_df = base_df.with_columns(exprs)
        
        # --- MEJORA: FALLBACK DE VALOR STOCK ---
        # Si no hay costo_unitario, intentar usar precio_unitario (menos margen estimado) 
        # para que no aparezca $0 en el dashboard.
        base_df = base_df.with_columns([
            pl.when(pl.col("costo_unitario") > 0)
            .then(pl.col("costo_unitario"))
            .otherwise(pl.col("precio_unitario") * 0.7)
            .alias("_costo_temp")
        ])
        
        base_df = base_df.with_columns(
            (pl.col("cantidad_stock") * pl.col("_costo_temp")).alias("valor_stock")
        ).drop("_costo_temp")

    ruta_p = obtener_ruta_parquet_usuario(user_id)
    base_df.select(COLUMNAS_ESTANDAR).write_parquet(ruta_p)

def normalizar_dataframe(df: pl.DataFrame, mapeo: dict = None) -> pl.DataFrame:
    """Normaliza los nombres de columnas y tipos de datos del DataFrame."""
    renames = {}
    cols_actuales = df.columns
    cols_cleaned = {limpiar_string(c): c for c in cols_actuales} # Mapa: col_limpia -> col_original

    # 1. Aplicar mapeo de IA (máxima prioridad)
    if mapeo:
        for std_key, orig_col in mapeo.items():
            if not orig_col: continue
            # Primero probar cleaning fuerte
            cleaned = limpiar_string(orig_col)
            if cleaned in cols_cleaned:
                original_col = cols_cleaned[cleaned]
                if original_col not in renames:
                    renames[original_col] = std_key
                    continue
            # Luego probar lowercase exacto
            low = str(orig_col).lower().strip()
            cols_lower = {c.lower(): c for c in cols_actuales}
            if low in cols_lower:
                original_col = cols_lower[low]
                if original_col not in renames:
                    renames[original_col] = std_key

    # 2. Detección por FALLBACKS (Detección automática robusta)
    # Usamos MAPEO_RESPALDO que es más completo que cualquier otro fallback
    for std_key, alt_names in MAPEO_RESPALDO.items():
        # Si ya lo mapeamos por IA o ya existe en el DF, saltar
        if std_key in renames.values() or std_key in cols_actuales:
            continue
        
        for alt in alt_names:
            alt_clean = limpiar_string(alt)
            if alt_clean in cols_cleaned:
                orig_col = cols_cleaned[alt_clean]
                # Evitar que una columna original se use para dos estándar
                if orig_col not in renames:
                    renames[orig_col] = std_key
                    break

    # 3. Detección directa por "limpieza fuerte" si aún no se ha mapeado
    for std_key in COLUMNAS_ESTANDAR:
        if std_key in renames.values() or std_key in cols_actuales:
            continue
        std_clean = limpiar_string(std_key)
        if std_clean in cols_cleaned:
            orig_col = cols_cleaned[std_clean]
            if orig_col not in renames:
                renames[orig_col] = std_key

    # --- APLICAR RENOMBRAMIENTO ---
    if renames:
        # Prevenir DuplicateError: si la columna destino ya existe y no es la fuente, dropearla
        cols_to_drop = [tgt for src, tgt in renames.items() if tgt in df.columns and src != tgt]
        if cols_to_drop:
            df = df.drop(cols_to_drop)
        df = df.rename(renames)

    # 4. BRANDING: Concatenar Marca + Nombre si ambos existen
    # Esto ocurre DESPUÉS del rename para usar los nombres estándar
    if "marca" in df.columns and "nombre_producto" in df.columns:
        df = df.with_columns(
            pl.when(pl.col("marca").is_not_null() & (pl.col("marca") != "") & (pl.col("marca") != "None"))
            .then(
                pl.col("marca").cast(pl.Utf8).str.to_uppercase() + " " + 
                pl.col("nombre_producto").cast(pl.Utf8)
            )
            .otherwise(pl.col("nombre_producto"))
            .alias("nombre_producto")
        )

    # 5. ASEGURAR TODAS LAS COLUMNAS ESTÁNDAR
    cols_faltantes = [c for c in COLUMNAS_ESTANDAR if c not in df.columns]
    if cols_faltantes:
        df = df.with_columns([pl.lit(None).alias(c) for c in cols_faltantes])
    
    # 6. CASTING Y LIMPIEZA NUMÉRICA (IMPORTANTE: Ahora sobre nombres estándar garantizados)
    NULOS_INT = ["cantidad_stock", "tiempo_entrega", "punto_reorden", "eta_dias", "es_festivo"]
    NULOS_FLOAT = ["costo_unitario", "precio_unitario", "demanda_diaria", "elasticidad", 
                   "latitud", "longitud", "unidades_vendidas", "unidades_pedidas", "precio_competencia", "descuento", "valor_stock"]
    
    for c in NULOS_INT:
        if c in df.columns:
            # Limpieza agresiva de strings a int
            df = df.with_columns(
                pl.col(c).cast(pl.Utf8)
                .str.replace_all(r"[^0-9\.\-]", "")
                .replace("", None)
                .cast(pl.Float64, strict=False)
                .fill_null(0)
                .cast(pl.Int64)
                .alias(c)
            )
    
    for c in NULOS_FLOAT:
        if c in df.columns:
            # Limpieza agresiva de strings a float (maneja comas y puntos)
            df = df.with_columns(
                pl.col(c).cast(pl.Utf8)
                .str.replace_all(r"[^0-9\.\,]", "")
                .str.replace(",", ".")
                .replace("", None)
                .cast(pl.Float64, strict=False)
                .fill_null(1.0 if c == "elasticidad" else 0.0)
                .alias(c)
            )

    # 7. PARSEAR FECHAS (Ahora sobre nombres estándar)
    for dcol in ["fecha_vencimiento", "fecha_datos"]:
        df = _parsear_fechas_vectorizado(df, dcol)

    # 8. FALLBACK DE ID_PRODUCTO (SKU VIRTUAL)
    # Si no hay ID, lo fabricamos con el nombre para que no se pierda el producto.
    if "id_producto" in df.columns and "nombre_producto" in df.columns:
        df = df.with_columns(
            pl.when(pl.col("id_producto").is_null() | (pl.col("id_producto") == "") | (pl.col("id_producto") == "UNK") | (pl.col("id_producto") == "PRODUCTO_SIN_ID"))
            .then(pl.col("nombre_producto").cast(pl.Utf8).fill_null("PRODUCTO_SIN_ID"))
            .otherwise(pl.col("id_producto"))
            .alias("id_producto")
        )
        
    return df.select(COLUMNAS_ESTANDAR)

def _aplicar_filtro_fuente(stmt, user_id: int, fuente_id: str):
    analyses = cargar_analyses(user_id)
    if fuente_id in analyses:
        from sqlalchemy import func
        archivos_permitidos = list({f.lower() for f in analyses[fuente_id].get("archivos", [])})
        if not archivos_permitidos: return stmt
        return stmt.where(func.lower(models.ArticuloInventario.nombre_fuente).in_(archivos_permitidos))
    else:
        return stmt.where(models.ArticuloInventario.nombre_fuente == fuente_id)

async def _obtener_df_desde_bd(bd: AsyncSession, user_id: int, fuente_id: Optional[str] = None):
    # Detectar qué columnas REALMENTE existen en el modelo cargado (HU-RESILIENCIA)
    columnas_validas = [c for c in COLUMNAS_ESTANDAR if hasattr(models.ArticuloInventario, c)]
    cols_sql = [getattr(models.ArticuloInventario, c) for c in columnas_validas]
    
    stmt = select(*cols_sql).where(models.ArticuloInventario.usuario_id == user_id)
    if fuente_id:
        analyses = cargar_analyses(user_id)
        if fuente_id in analyses:
            from sqlalchemy import func
            archivos_permitidos = list({f.lower() for f in analyses[fuente_id].get("archivos", [])})
            stmt = stmt.where(func.lower(models.ArticuloInventario.nombre_fuente).in_(archivos_permitidos))
        else:
            stmt = stmt.where(models.ArticuloInventario.nombre_fuente == fuente_id)
    res = await bd.execute(stmt)
    rows = res.all()
    
    if not rows: 
        schema_dict = {c: pl.Utf8 for c in COLUMNAS_ESTANDAR}
        return pl.DataFrame([], schema=schema_dict)
        
    # Crear DF con las columnas que realmente se consultaron
    df = pl.DataFrame(rows, schema=columnas_validas, orient="row", infer_schema_length=None)

    # ASEGURAR TODAS LAS COLUMNAS (HU-COMPATIBILIDAD): Si alguna falta, rellenar con None
    cols_faltantes = [c for c in COLUMNAS_ESTANDAR if c not in df.columns]
    if cols_faltantes:
        df = df.with_columns([pl.lit(None).alias(c) for c in cols_faltantes])
    
    # Retornar siempre en el orden estándar
    df = df.select(COLUMNAS_ESTANDAR)

    # ASEGURAR COLUMNAS (HU-RESILIENCIA): Si por algún motivo faltan las nuevas, añadirlas con 0.0
    # Nota: El constructor pl.DataFrame anterior ya garantiza que existan las columnas en COLUMNAS_ESTANDAR
    # si se pasaron correctamente. Rellenamos nulos por si acaso.
    df = df.fill_null(0.0)

    # HU-PERSISTENCIA: Consultar el Registro de Donaciones para "restar" de forma virtual 
    # los items que ya fueron tratados pero que el sync de Parquet podría haber restaurado.
    # AISLAMIENTO: Solo considerar tratamientos vinculados a la fuente/análisis actual.
    try:
        import json
        stmt = select(models.Donacion.comentarios).where(models.Donacion.usuario_id == user_id)
        if fuente_id:
            stmt = stmt.where(models.Donacion.nombre_fuente == fuente_id)
            
        res_don = await bd.execute(stmt)
        ids_tratados = set()
        for row in res_don.scalars().all():
            if row:
                try: 
                    skus = json.loads(row)
                    if isinstance(skus, list):
                        for s in skus:
                            uid = s.get("id_unico") or s.get("id")
                            if uid: ids_tratados.add(uid)
                except: pass
        
        if ids_tratados:
            # Set stock and value to 0 for these items in the Polars DF
            df = df.with_columns([
                pl.when(pl.col("id_unico").is_in(list(ids_tratados)))
                .then(pl.lit(0))
                .otherwise(pl.col("cantidad_stock"))
                .alias("cantidad_stock"),
                pl.when(pl.col("id_unico").is_in(list(ids_tratados)))
                .then(pl.lit(0.0))
                .otherwise(pl.col("valor_stock"))
                .alias("valor_stock")
            ])
    except Exception as e:
        print(f"⚠️ Error al reconciliar inventario vs donaciones: {e}")
            
    return df

async def obtener_inventario_analisis(bd: AsyncSession, user_id: int, factor_descuento: float = 0.0, fuente_id: Optional[str] = None):
    df = await _obtener_df_desde_bd(bd, user_id, fuente_id=fuente_id)
    if df.is_empty(): 
        return {
            "hoy": date.today().isoformat(),
            "items": [], 
            "metrics": {}, 
            "bounds": None, 
            "indicadores": {"has_geo": False}
        }

    # SIEMPRE usar la fecha real del sistema para los cálculos de riesgo/horizonte.
    # La fecha_datos del CSV es solo informativa (muestra cuándo se tomaron los datos).
    hoy = date.today()

    # --- MEJORA: DETECTAR Y COLAPSAR HISTORIAL (HU-TIME-SERIES) ---
    # Si el dataset contiene historia (múltiples fechas), para el análisis de riesgo 
    # necesitamos el último snapshot, pero podemos usar la historia para mejorar la demanda.
    if "fecha_datos" in df.columns:
        # 1. Calcular demanda real desde historia si las ventas están presentes
        if "unidades_vendidas" in df.columns and df.height > 0:
             # Promedio móvil de ventas para estimar demanda si no viene explícita
             try:
                 # Agrupar por producto para obtener su demanda promedio histórica
                 df_demanda = df.group_by("id_producto").agg(pl.col("unidades_vendidas").mean().alias("_demanda_calc"))
                 df = df.join(df_demanda, on="id_producto", how="left")
                 df = df.with_columns(
                     pl.when((pl.col("demanda_diaria") <= 0) & (pl.col("_demanda_calc") > 0))
                     .then(pl.col("_demanda_calc"))
                     .otherwise(pl.col("demanda_diaria"))
                     .alias("demanda_diaria")
                 ).drop("_demanda_calc")
             except Exception as e:
                 print(f"⚠️ Error al calcular demanda real: {e}")

        # 2. AGREGACIÓN PREVIA (HU-PRECISION): Antes de colapsar fechas, sumamos registros del mismo SNAPSHOT.
        # Esto evita que si un CSV tiene el mismo SKU en varias filas (distintos bultos), se pierda el stock.
        try:
            columnas_suma = ["cantidad_stock", "valor_stock", "unidades_vendidas", "unidades_pedidas"]
            columnas_suma = [c for c in columnas_suma if c in df.columns]
            
            # Agrupar por todo lo que define una entrada única en un momento dado
            keys_snapshot = ["id_producto", "id_lote", "nombre_ubicacion", "fecha_datos", "fecha_vencimiento"]
            keys_snapshot = [k for k in keys_snapshot if k in df.columns]
            
            # Columnas que no sumamos pero queremos mantener (tomamos la primera encontrada)
            otras_cols = [c for c in df.columns if c not in columnas_suma and c not in keys_snapshot]
            
            df = df.group_by(keys_snapshot).agg([
                pl.col(c).sum() for c in columnas_suma
            ] + [
                pl.col(c).first() for c in otras_cols
            ])
        except Exception as e:
            print(f"⚠️ Error en agregación de snapshot: {e}")

        # 3. Consolidar Inventario (HU-ACCOUNTING): Sumamos stock a través de la historia dentro del mismo análisis.
        # Esto permite que si el usuario sube el inventario en "porciones" o archivos parciales,
        # se acumulen en lugar de reemplazarse.
        try:
            # HU-PRECISION: Agrupamos por llaves de negocio completas (producto, lote, ubicación, vencimiento).
            # No incluimos id_unico ni fecha_datos para que el sistema sume registros de distintas fuentes/fechas.
            keys_negocio = ["id_producto", "id_lote", "nombre_ubicacion", "fecha_vencimiento"]
            keys_negocio = [k for k in keys_negocio if k in df.columns]
            
            columnas_suma = ["cantidad_stock", "valor_stock", "unidades_vendidas", "unidades_pedidas"]
            columnas_suma = [c for c in columnas_suma if c in df.columns]
            otras_cols = [c for c in df.columns if c not in columnas_suma and c not in keys_negocio]

            df = df.group_by(keys_negocio).agg([
                pl.col(c).sum() for c in columnas_suma
            ] + [
                pl.col(c).sort_by("fecha_datos").last() if "fecha_datos" in df.columns else pl.col(c).first()
                for c in otras_cols
            ])
        except Exception as e:
            print(f"⚠️ Error al consolidar contabilidad: {e}")
            if "id_unico" in df.columns:
                df = df.sort("fecha_datos").group_by("id_unico").last()

    # Calcular referencia del dataset (solo para mostrar en UI, no para cálculos)
    hoy_dataset = hoy
    if "fecha_datos" in df.columns:
        valid = df.filter(pl.col("fecha_datos").is_not_null())["fecha_datos"]
        if not valid.is_empty():
            try: hoy_dataset = pl.Series(valid).max() or hoy
            except: pass

    df = df.with_columns([
        ((pl.col("fecha_vencimiento").cast(pl.Date, strict=False) - hoy).dt.total_days()).alias("dias_restantes"),
        (pl.col("demanda_diaria") * (1 + (factor_descuento * pl.col("elasticidad")))).alias("demanda_p")
    ]).with_columns([
        pl.when(pl.col("demanda_p") > 0)
        .then(pl.col("cantidad_stock") / pl.col("demanda_p"))
        .otherwise(
            pl.when(pl.col("cantidad_stock") > 0)
            .then(pl.lit(999.0))
            .otherwise(pl.lit(0.0))
        ).alias("forecast_quiebre_dias")
    ]).with_columns([
        pl.min_horizontal([pl.col("dias_restantes").fill_null(999), pl.col("forecast_quiebre_dias").fill_null(999)]).alias("dias_riesgo_total")
    ])

    # HU-CONTINUIDAD: Calcular stock neto (Físico + Pedidos en tránsito)
    # Esto permite distinguir entre un quiebre real y uno ya gestionado.
    df = df.with_columns([
        (pl.col("cantidad_stock").fill_null(0) + pl.col("unidades_pedidas").fill_null(0)).alias("stock_neto")
    ])

    # HU-FINANZAS: Recalcular valor_stock para reflejar la realidad del estado
    # - Si es stockout (<=0) y no hay pedido, el valor es el costo de reposición (invertir para llegar a 0).
    # - Si ya hay pedido, el valor es el capital en tránsito.
    df = df.with_columns([
        pl.when(pl.col("cantidad_stock") <= 0)
        .then(
            # Si el neto es <= 0, necesitamos comprar para llegar a 0. Mostramos ese costo.
            pl.when(pl.col("stock_neto") <= 0)
            .then(pl.col("stock_neto").abs() * pl.col("costo_unitario").fill_null(0))
            # Si el neto es > 0, mostramos el valor de lo que viene en camino.
            .otherwise(pl.col("unidades_pedidas") * pl.col("costo_unitario").fill_null(0))
        )
        .otherwise(pl.col("valor_stock"))
        .alias("valor_stock")
    ])

    df = df.with_columns([
        pl.when(pl.col("cantidad_stock") <= 0).then(pl.lit("CRÍTICO"))
        .when(pl.col("dias_riesgo_total") <= UMBRALES_RIESGO["VENCIDO"]).then(pl.lit("VENCIDO"))
        .when(pl.col("dias_riesgo_total") <= UMBRALES_RIESGO["CRITICO"]).then(pl.lit("CRÍTICO"))
        .when(pl.col("dias_riesgo_total") <= UMBRALES_RIESGO["URGENTE"]).then(pl.lit("URGENTE"))
        .when(pl.col("dias_riesgo_total") <= UMBRALES_RIESGO["PREVENTIVO"]).then(pl.lit("PREVENTIVO"))
        .otherwise(pl.lit("NORMAL")).alias("estado_alerta")
    ])

    # Calcular min_fecha de forma segura
    min_f = None
    if "fecha_vencimiento" in df.columns and not df.is_empty():
        min_f_val = df["fecha_vencimiento"].cast(pl.Date, strict=False).min()
        if min_f_val:
            min_f = min_f_val.isoformat()

    # --- DETECTAR TIPO DE ANÁLISIS (HU-MODE) ---
    # Si la mayoría de los productos no tienen fecha de vencimiento, es un análisis de STOCKOUT.
    vencidos_reales = df["fecha_vencimiento"].is_not_null().sum() if "fecha_vencimiento" in df.columns else 0
    tipo_analisis = "EXPIRACION" if vencidos_reales > (df.height / 2) else "STOCKOUT"

    return {
        "hoy": hoy.isoformat(),           # Siempre fecha del sistema
        "hoy_dataset": hoy_dataset.isoformat() if hoy_dataset and hoy_dataset != hoy and hasattr(hoy_dataset, 'isoformat') else hoy.isoformat(),
        "items": df.to_dicts(),
        "tipo_analisis": tipo_analisis, # Nuevo campo para el Front-end
        "min_fecha": min_f,
        "indicadores": {
            "has_geo": df["latitud"].is_not_null().any() if "latitud" in df.columns else False,
            "has_elasticity": (df["elasticidad"] != 1.0).any() if "elasticidad" in df.columns and df["elasticidad"].dtype in [pl.Float64, pl.Float32] else False,
            "has_branches": df["nombre_ubicacion"].is_not_null().any() if "nombre_ubicacion" in df.columns else False
        }
    }

async def obtener_limites_fecha(bd: AsyncSession, user_id: int, fuente_id: Optional[str] = None):
    stmt = select(func.min(models.ArticuloInventario.fecha_vencimiento), func.max(models.ArticuloInventario.fecha_vencimiento)).where(models.ArticuloInventario.usuario_id == user_id)
    if fuente_id:
        stmt = _aplicar_filtro_fuente(stmt, user_id, fuente_id)
    res = await bd.execute(stmt)
    mn, mx = res.fetchone()
    return {"min": mn.isoformat() if mn else None, "max": mx.isoformat() if mx else None}

async def obtener_matriz_sensibilidad(bd: AsyncSession, id_producto: str, user_id: int, fuente_id: Optional[str] = None):
    stmt = select(models.ArticuloInventario).where(models.ArticuloInventario.id_producto == id_producto, models.ArticuloInventario.usuario_id == user_id)
    if fuente_id:
        stmt = _aplicar_filtro_fuente(stmt, user_id, fuente_id)
    res = await bd.execute(stmt)
    art = res.scalars().first()
    if not art: return []
    
    scenarios = []
    for pct, label, color in [(-0.3, "Liquidación", "purple"), (-0.15, "Moderado", "orange"), (0, "Base", "blue"), (0.15, "Premium", "green")]:
        p = (art.precio_unitario or 0) * (1 + pct)
        d = (art.demanda_diaria or 0) * (1 - (pct * (art.elasticidad or 1.5)))
        stock = art.cantidad_stock or 0
        rec = min(stock, d * 30) * p
        scenarios.append({
            "escenario": label, "porcentaje": f"{pct*100}%", "color": color, "is_base": pct == 0,
            "valor_total": rec, "recuperacion": rec * 0.8, "credito": rec * 0.2
        })
    return scenarios

async def obtener_sensibilidad_avanzada(bd: AsyncSession, id_producto: str, user_id: int, descuento: float = 0.0, fuente_id: Optional[str] = None):
    stmt = select(models.ArticuloInventario).where(models.ArticuloInventario.id_producto == id_producto, models.ArticuloInventario.usuario_id == user_id)
    if fuente_id:
        stmt = _aplicar_filtro_fuente(stmt, user_id, fuente_id)
    res = await bd.execute(stmt)
    arts = res.scalars().all()
    sucursales = []
    for a in arts:
        p = (a.precio_unitario or 0) * (1 - descuento)
        d = (a.demanda_diaria or 0) * (1 + (descuento * (a.elasticidad or 1.5)))
        stock = a.cantidad_stock or 0
        sucursales.append({
            "nombre_ubicacion": a.nombre_ubicacion or "Principal",
            "stock_actual": stock,
            "demanda_proyectada": round(d, 1),
            "autonomia_dias": round(stock / d, 1) if d > 0 else 999,
            "ingreso_estimado": round(min(stock, d * 30) * p, 0)
        })
    return {"sucursales": sucursales}

async def obtener_datos_mapa(bd: AsyncSession, user_id: int):
    df = await _obtener_df_desde_bd(bd, user_id)
    if df.is_empty(): return {"data": [], "indicadores": {"has_geo": False}}
    df = df.filter(pl.col("latitud").is_not_null() & pl.col("longitud").is_not_null())
    # Simplificado para mapa
    return {"data": df.to_dicts(), "indicadores": {"has_geo": True}}

async def obtener_insighs_ia(datos, user_id):
    # Filtrar ruido: Solo productos con ID válido
    datos = [d for d in datos if d.get("id_producto")]
    if not datos: return []

    v = [d for d in datos if d.get("estado_alerta") == "VENCIDO"]
    c = [d for d in datos if d.get("estado_alerta") == "CRÍTICO"]
    neg = [d for d in datos if (d.get("cantidad_stock") or 0) < 0]
    
    insights = []
    
    # 0. Auditoría de Cobertura (MANDATORIA para despejar dudas 39 vs 36)
    total_ds = len(datos)
    # Items visibles (stock > 0 y estado conocido)
    items_vis = [d for d in datos if (d.get("cantidad_stock") or 0) > 0 and d.get("estado_alerta") in ["VENCIDO", "CRÍTICO", "URGENTE", "PREVENTIVO", "SALUDABLE"]]
    cant_vis = len(items_vis)
    dif = total_ds - cant_vis
    
    if total_ds > 0:
        insights.append({
            "tipo": "SISTEMA",
            "titulo": "Auditoría de Cobertura",
            "desc": f"Dataset de {total_ds} ítems. El tablero muestra {cant_vis} con stock activo; los {dif} restantes están en REORDEN o agotados."
        })

    # 1. Alertas de Integridad (Prioridad Máxima)
    if neg: 
        insights.append({
            "tipo": "ALERTA", 
            "titulo": "Stock Negativo", 
            "desc": f"Se detectaron {len(neg)} lotes con existencias negativas, sugiriendo fallas en el proceso de carga o auditoría."
        })
    
    # 2. Insights de Concentración (No redundantes con el total)
    if len(v) + len(c) > (len(datos) * 0.4):
        insights.append({
            "tipo": "ESTREGICO",
            "titulo": "Alta Concentración de Riesgo",
            "desc": "Más del 40% de su inventario analizado está en zona de riesgo. Se recomienda revisión de la cadena de suministro."
        })
        
    return insights

# Columnas enviadas a Postgres via COPY (mismo orden que la tabla, sin 'id' ni 'ultima_actualizacion')
_COLS_COPY = [
    "usuario_id", "id_unico", "id_producto", "id_lote", "nombre_producto",
    "cantidad_stock", "fecha_vencimiento", "precio_unitario", "costo_unitario",
    "demanda_diaria", "tiempo_entrega", "elasticidad",
    "id_ubicacion", "nombre_ubicacion", "latitud", "longitud",
    "categoria", "punto_reorden", "valor_stock", "rotacion_abc",
    "eta_dias", "fecha_datos", "nombre_fuente", "proveedor", "marca",
    "clima", "descuento", "unidades_vendidas", "unidades_pedidas", "precio_competencia", "es_festivo"
]

async def sincronizar_a_postgres(bd: AsyncSession, user_id: int, limpiar_todo: bool = False):
    """Sincronización ultra-rápida usando el protocolo COPY de PostgreSQL via asyncpg.
    Velocidad: ~100,000 filas/segundo vs ~1,000 con INSERT.
    Todo el preprocesamiento de datos es vectorizado en Polars (Rust).
    """
    # ── 1. DELETE previo (Garantiza aislamiento y limpieza total para el usuario) ──
    await bd.execute(delete(models.ArticuloInventario).where(models.ArticuloInventario.usuario_id == user_id))
    
    path = obtener_ruta_parquet_usuario(user_id)
    if not os.path.exists(path):
        await bd.commit()
        return

    df = pl.read_parquet(path)
    if df.is_empty():
        await bd.commit()
        return

    # ── 2. Preparación 100% vectorizada en Polars ───────────────────────────────
    #  a) Añadir columnas faltantes con None
    for col in _COLS_COPY:
        if col == "usuario_id": continue
        if col not in df.columns:
            df = df.with_columns(pl.lit(None).alias(col))

    #  b) Parsear fechas en Polars con múltiples formatos (HU-RESILIENCIA)
    for dcol in ["fecha_vencimiento", "fecha_datos"]:
        if dcol in df.columns:
            # Intentar varios formatos comunes
            df = df.with_columns([
                pl.coalesce([
                    pl.col(dcol).cast(pl.Utf8).str.strptime(pl.Date, "%Y-%m-%d", strict=False),
                    pl.col(dcol).cast(pl.Utf8).str.strptime(pl.Date, "%d/%m/%Y", strict=False),
                    pl.col(dcol).cast(pl.Utf8).str.strptime(pl.Date, "%m/%d/%Y", strict=False),
                    pl.col(dcol).cast(pl.Utf8).str.strptime(pl.Date, "%Y/%m/%d", strict=False),
                    pl.col(dcol).cast(pl.Utf8).str.slice(0, 10).str.strptime(pl.Date, "%Y-%m-%d", strict=False)
                ]).alias(dcol)
            ])

    #  c) Limpiar NaN/Inf en columnas numéricas en Polars
    for col in ["precio_unitario", "costo_unitario", "demanda_diaria",
                "elasticidad", "latitud", "longitud", "valor_stock", "descuento"]:
        if col in df.columns:
            df = df.with_columns(
                pl.col(col).cast(pl.Float64, strict=False)
                .pipe(lambda s: pl.when(s.is_infinite() | s.is_nan()).then(None).otherwise(s))
                .alias(col)
            )

    #  d) Añadir columna usuario_id y seleccionar orden correcto
    df = df.with_columns(pl.lit(user_id).alias("usuario_id"))
    df_final = df.select(_COLS_COPY)

    # ── 3. COPY via asyncpg (protocolo binario de PostgreSQL) ───────────────────
    #  Convertir a lista de tuplas — Polars .rows() es C-speed
    records = df_final.rows()

    # Obtener conexión asyncpg subyacente (sin crear nueva conexión)
    raw = await bd.connection()
    driver_conn = (await raw.get_raw_connection()).driver_connection

    await driver_conn.copy_records_to_table(
        "articulos_inventario",
        records=records,
        columns=_COLS_COPY,
    )
    # COPY tiene su propia transacción implícita, pero requerimos commit para visibilidad inmediata en la siguiente transacción
    await bd.commit()


async def limpiar_restricciones_obsoletas(bd: AsyncSession):
    try: await bd.execute(text("ALTER TABLE articulos_inventario DROP CONSTRAINT IF EXISTS uq_articulo_lote_sucursal"))
    except: pass
    await bd.commit()

def listar_archivos_datos(user_id: int):
    d = obtener_ruta_datos_usuario(user_id)
    if not os.path.exists(d): return []
    archivos = []
    for f in os.listdir(d):
        if f.endswith(".csv"):
            p = os.path.join(d, f)
            s = os.path.getsize(p)
            mtime = os.path.getmtime(p)
            size_str = f"{s/1024:.1f} KB" if s < 1024*1024 else f"{s/(1024*1024):.1f} MB"
            archivos.append({
                "nombre": f,
                "size": size_str,
                "type": "CSV de Inventario",
                "modificado": int(mtime * 1000)  # ms timestamp para el frontend
            })
    # ordenar por fecha de modificación descendente
    archivos.sort(key=lambda x: x["modificado"], reverse=True)
    return archivos

def obtener_columnas_archivo(ruta: str):
    try: return pl.read_csv(ruta, n_rows=1).columns
    except: return []

def obtener_esquema_archivo(filename: str, user_id: int):
    p = os.path.join(obtener_ruta_datos_usuario(user_id), filename)
    if not os.path.exists(p): return {"error": "Archivo no encontrado"}
    
    try:
        try:
            df = pl.read_csv(p, infer_schema_length=1000, ignore_errors=True)
        except:
            # Intento con encoding común si falla el estandar (Excel/Win)
            df = pl.read_csv(p, infer_schema_length=1000, ignore_errors=True, encoding="latin-1")

        if df.is_empty():
            return {"error": "El archivo está vacío o no pudo ser interpretado"}

        # El frontend espera: columns (strings), dtypes (strings), total_rows, statistics, sample
        cols = df.columns
        dtypes = [str(df[c].dtype) for c in cols]
        
        stats = {}
        numeric_types = [pl.Int64, pl.Float64, pl.Int32, pl.Float32, pl.Int16, pl.Int8]
        numeric_cols = [c for c in cols if df[c].dtype in numeric_types]
        
        for c in numeric_cols[:15]:
            try:
                mean_val = df[c].mean()
                stats[c] = {
                    "mean": float(mean_val) if mean_val is not None else 0,
                    "std": float(df[c].std()) if df[c].std() is not None else 0,
                    "min": float(df[c].min()) if df[c].min() is not None else 0,
                    "max": float(df[c].max()) if df[c].max() is not None else 0,
                    "sum": float(df[c].sum()) if df[c].sum() is not None else 0
                }
            except: continue

        return {
            "columns": cols,
            "dtypes": dtypes,
            "total_rows": df.height,
            "statistics": stats,
            "sample": df.head(15).to_dicts()
        }
    except Exception as e:
        return {"error": f"Error procesando esquema: {str(e)}"}
async def obtener_resumen_forecasting(bd: AsyncSession, user_id: int, mes: int = None, anio: int = None, fuente_id: str = None):
    df = await _obtener_df_desde_bd(bd, user_id, fuente_id=fuente_id)
    if df.is_empty():
        return {
            "demanda_total_estimada": 0, 
            "ingreso_potencial_mensual": 0, 
            "top_movimientos": [],
            "salud_stock": 0,
            "historico_agregado": []
        }
    
    # Filtrar por mes y año si se proporcionan
    if mes is not None:
        if "fecha_datos" in df.columns:
            df = df.filter(pl.col("fecha_datos").dt.month() == int(mes))
            
    if anio is not None:
        if "fecha_datos" in df.columns:
            df = df.filter(pl.col("fecha_datos").dt.year() == int(anio))

    if df.is_empty():
        return {
            "demanda_total_estimada": 0, 
            "ingreso_potencial_mensual": 0, 
            "top_movimientos": [],
            "salud_stock": 0,
            "historico_agregado": [],
            "mensaje": "No hay datos para el periodo seleccionado"
        }
    # Asegurar valores utiles incluso si el dataset original no tiene demanda_diaria o precio_unitario definidos
    # HU-DEMANDA: Si la cantidad_stock es 0 (ej: por tratamiento), no queremos que la demanda proxy caiga a 0.
    # Usamos un valor base si no hay demanda_diaria ni stock disponible (independencia de tratamiento).
    df = df.with_columns([
        pl.when(pl.col("demanda_diaria") > 0).then(pl.col("demanda_diaria"))
        .when(pl.col("cantidad_stock") > 0).then(pl.col("cantidad_stock") / 30.0)
        .otherwise(pl.lit(1.5)) # Baseline estable para previsión si no hay datos
        .alias("demanda_usable"),
        pl.when(pl.col("precio_unitario") <= 0).then(1000.0).otherwise(pl.col("precio_unitario")).alias("precio_usable")
    ])
    
    # Calcular proyeccion simple basada en demanda_usable * 30
    df = df.with_columns([
        (pl.col("demanda_usable") * 30).alias("proyeccion_mensual"),
        ((pl.col("demanda_usable") * 30) * pl.col("precio_usable")).alias("valor_proyectado")
    ])
    
    total_unidades = df["proyeccion_mensual"].sum()
    total_valor = df["valor_proyectado"].sum()
    
    # Top 5 productos por demanda proyectada
    top = df.sort("proyeccion_mensual", descending=True).head(5)
    
    # Alertas de quiebre reales basadas en el mismo criterio que el inventario global
    df_quiebre = df.with_columns([
        pl.when((pl.col("demanda_usable") > 0) & (pl.col("cantidad_stock") >= 0))
        .then(pl.col("cantidad_stock") / pl.col("demanda_usable"))
        .otherwise(pl.lit(999.0)).alias("dias_quiebre")
    ])
    # Consideramos productos en riesgo si les queda stock para menos de 10 días
    alertas_quiebre_df = df_quiebre.filter(pl.col("dias_quiebre") < 999.0).sort("dias_quiebre").head(10)
    cols_to_extract = ["nombre_producto", "dias_quiebre", "cantidad_stock", "proyeccion_mensual", "costo_unitario", "precio_unitario", "proveedor"]
    if "nombre_ubicacion" in alertas_quiebre_df.columns:
        cols_to_extract.append("nombre_ubicacion")
        
    alertas_quiebre = alertas_quiebre_df[cols_to_extract].to_dicts()
    
    # HU-HISTORIAL-REAL: Si el dataset tiene historia diaria, usarla en vez de simular
    historico_agregado = []
    x_axis = []
    y_axis = []
    
    if "fecha_datos" in df.columns and "unidades_vendidas" in df.columns:
        try:
            # Agrupar por fecha para ver la evolución total de ventas
            df_hist = df.group_by("fecha_datos").agg(pl.col("unidades_vendidas").sum().alias("ventas")).sort("fecha_datos")
            if df_hist.height > 1:
                # Tomar los últimos 30 puntos disponibles
                res_hist = df_hist.tail(30).to_dicts()
                for i, r in enumerate(res_hist):
                    if r["fecha_datos"]:
                        v = float(r["ventas"])
                        historico_agregado.append({
                            "fecha": r["fecha_datos"].isoformat() if hasattr(r["fecha_datos"], "isoformat") else str(r["fecha_datos"]),
                            "ventas": v
                        })
                        x_axis.append(float(i + 1))
                        y_axis.append(v)
        except: pass

    if not historico_agregado:
        # Fallback a simulación si no hay historia real
        base_avg = df["demanda_usable"].sum() or 10
        for i in range(30, 0, -1):
            val = base_avg * (1 + 0.15 * math.sin(i / 3.0)) + random.uniform(-base_avg*0.1, base_avg*0.1)
            val = max(1.0, round(val, 1))
            historico_agregado.append({
                "fecha": (date.today() - timedelta(days=i)).isoformat(),
                "ventas": val
            })
            x_axis.append(float(31 - i))
            y_axis.append(val)

    # COMPETENCIA DE ALGORITMOS PREDICTIVOS
    precision = 85.0
    r2_mes_anterior = 0.0
    mejor_algo = "Regresión Lineal"
    
    try:
        import numpy as np
        
        if not x_axis or not y_axis:
             raise ValueError("No hay datos históricos suficientes")

        x = np.array(x_axis)
        y = np.array(y_axis)
        
        # 1. Regresión Lineal (1d-polyfit)
        coef = np.polyfit(x, y, 1)
        p = np.poly1d(coef)
        yhat_lr = p(x)
        mae_lr = np.mean(np.abs(y - yhat_lr))
        
        # 2. Media Móvil (Ventana = 5 días)
        yhat_ma = np.zeros_like(y)
        for i in range(len(y)):
            if i < 5:
                yhat_ma[i] = np.mean(y[:i+1])
            else:
                yhat_ma[i] = np.mean(y[i-5:i])
        mae_ma = np.mean(np.abs(y - yhat_ma))

        # 3. Suavizado Exponencial (Alpha = 0.4)
        yhat_es = np.zeros_like(y)
        yhat_es[0] = y[0]
        alpha = 0.4
        for i in range(1, len(y)):
            yhat_es[i] = alpha * y[i-1] + (1 - alpha) * yhat_es[i-1]
        mae_es = np.mean(np.abs(y - yhat_es))

        # Competición: Elegimos el modelo con el menor Menor Error Absoluto Medio (MAE)
        mejor_mae = mae_lr
        proy_siguiente_mes = sum([p(i) for i in range(31, 61)])
        
        if mae_ma < mejor_mae:
            mejor_mae = mae_ma
            mejor_algo = "Media Móvil"
            proy_siguiente_mes = np.mean(y[-5:]) * 30
            
        if mae_es < mejor_mae:
            mejor_mae = mae_es
            mejor_algo = "Suavizado Exponencial"
            proy_siguiente_mes = yhat_es[-1] * 30

        # Normalizamos la bondad del modelo como "Precisión %" relativa a la media
        mean_y = np.mean(y) if np.mean(y) > 0 else 1
        precision = max(68.0, min(99.0, 100 * (1 - mejor_mae / mean_y)))
        
        # Calculamos la variación de precisión vs un valor base histórico (o 0 si no hay)
        r2_mes_anterior = round(((precision - 85.0) / 10.0), 1) if precision > 85 else 0.0
        
        # Ajustamos total proyectado si hubo un output lógico
        if proy_siguiente_mes > 0:
            total_unidades = max(10, proy_siguiente_mes)
                
    except Exception as e:
        print(f"Error en competencia algorítmica: {e}")
        precision = 85.0
        mejor_algo = "Promedio Histórico Base"

    # --- MÉTRICAS ESTRATÉGICAS ---
    stock_actual = df["cantidad_stock"].sum()
    precio_promedio_general = df["precio_unitario"].mean() or 1000
    costo_promedio_general = df["costo_unitario"].mean() or 800
    
    # Inversión necesaria: SOLO para productos en alerta de quiebre
    inversion_quiebre = 0
    for a in alertas_quiebre:
        unidades_faltantes = a.get("proyeccion_mensual", 0) - a.get("cantidad_stock", 0)
        if unidades_faltantes > 0:
            inversion_quiebre += unidades_faltantes * a.get("costo_unitario", costo_promedio_general)
    
    # Si la inversión es 0 pero hay quiebre, poner un mínimo proporcional a la demanda
    if inversion_quiebre <= 0 and len(alertas_quiebre) > 0:
        inversion_quiebre = sum([a.get("proyeccion_mensual", 0) for a in alertas_quiebre]) * (costo_promedio_general * 0.8)

    # Ingreso Potencial: Venta total proyectada
    ingreso_potencial = df["valor_proyectado"].sum()
    
    # Valor Inventario: Dinero estancado hoy (usando COSTO para ser realistas)
    valor_inventario_actual = df["valor_stock"].sum() if "valor_stock" in df.columns else (stock_actual * costo_promedio_general)
    # Salud de stock: Ratio de cobertura
    if total_unidades > 0:
        ratio_cobertura = stock_actual / total_unidades
        if ratio_cobertura < 0.8:
            salud_stock_calculada = int(max(10, ratio_cobertura * 100))
        else:
            salud_stock_calculada = int(min(100, 90 + (ratio_cobertura * 2)))
    else:
        salud_stock_calculada = 0

    from . import ai_utils
    contexto = {
        "ventas_ultimos_10_dias": y_axis[-10:] if y_axis else [],
        "top_productos": [t["nombre_producto"] for t in top.to_dicts()],
        "productos_quiebre_nombres": [a["nombre_producto"] for a in alertas_quiebre[:3]],
        "alertas_quiebre_count": len(alertas_quiebre),
        "demanda_total": round(total_unidades),
        "inversion_necesaria": round(inversion_quiebre),
        "ingreso_potencial": round(ingreso_potencial),
        "precision_algoritmo": round(precision, 1),
        "salud_stock": salud_stock_calculada,
        "total_inventario_general": round(stock_actual)
    }

    desc_quiebres = []
    for a in alertas_quiebre[:3]:
        msg = f"{a['nombre_producto']}"
        if 'nombre_ubicacion' in a:
            msg += f" en {a['nombre_ubicacion']}"
        desc_quiebres.append(msg)
        
    prompt_agregado = f"""
    Eres un asistente experto en gestión de inventarios para negocios reales. Analiza el panorama operativo del negocio y da un diagnóstico directo.
    
    SITUACIÓN ACTUAL:
    - Capital amarrado en bodega: {valor_inventario_actual:,.0f} CLP ({stock_actual:,.0f} unidades totales).
    - Salud operativa de stock: {salud_stock_calculada}/100.
    - {len(alertas_quiebre)} productos críticos en quiebre o por agotarse: {', '.join(desc_quiebres)}.
    
    PROYECCIÓN MES SIGUIENTE:
    - Dinero que entraría por ventas (Ingreso Potencial): {ingreso_potencial:,.0f} CLP.
    - Inversión mínima necesaria hoy para no perder ventas: {inversion_quiebre:,.0f} CLP.
    
    Genera un único párrafo de 3 líneas máximo. Sé específico: menciona al menos un producto crítico por su nombre y dile al dueño cuánta plata necesita invertir vs cuánto podría ganar. Usa un tono profesional pero cercano.
    """

    resumen_ia = await ai_utils.get_llm_response(prompt_agregado, max_tokens=150)

    
    # Calculamos cuanto vale ese total
    precio_promedio = df["precio_unitario"].mean() or 1000
    total_valor = total_unidades * precio_promedio

    return {
        "demanda_total_estimada": round(total_unidades, 0),
        "ingreso_potencial_mensual": round(ingreso_potencial, 0),
        "inversion_recomendada": round(inversion_quiebre, 0),
        "precision_forecast": round(precision, 1),
        "variacion_precision": r2_mes_anterior,
        "top_movimientos": top[["id_producto", "nombre_producto", "proyeccion_mensual", "valor_proyectado"]].to_dicts() if "id_producto" in top.columns else top[["nombre_producto", "proyeccion_mensual", "valor_proyectado"]].to_dicts(),
        "alertas_quiebre": alertas_quiebre,
        "salud_stock": salud_stock_calculada,
        "total_inventario_general": round(stock_actual),
        "total_valor_inventario": valor_inventario_actual,
        "historico_agregado": historico_agregado,
        "razonamiento": resumen_ia
    }
