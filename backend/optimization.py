"""
optimization.py — Módulo de Optimización de Redistribución de Stock entre Sucursales
======================================================================================

Responsabilidad:
    Dado un inventario con múltiples ubicaciones (nombre_ubicacion), calcula cuáles
    productos se deben mover, desde qué sucursal y hacia dónde, para minimizar el
    riesgo global de quiebre sin necesidad de comprar nueva mercadería.

Algoritmo:
    Se usa un algoritmo greedy de asignación de excedente a déficit.
    El greedy es suficiente para este dominio: el costo de cómputo es O(n·m) donde
    n = productos candidatos y m = pares de sucursales. Para datasets reales de retail
    (< 50000 SKUs) es prácticamente instantáneo.

    Pasos:
    1. Agrupar el inventario por (nombre_ubicacion, nombre_producto_normalizado).
       ⚠️  Se usa nombre_producto (no id_producto) porque en datasets reales cada lote
       tiene un id único, lo que haría imposible encontrar el mismo SKU en 2 sucursales.
       El nombre normalizado (minúsculas, sin tildes) soluciona esto.
    2. Para cada producto, calcular:
        - stock_ratio  = cantidad_stock / max(demanda_mensual, 1)
        - Si stock_ratio < UMBRAL_DEFICIT  → esta ubicación NECESITA el producto
        - Si stock_ratio > UMBRAL_EXCEDENTE → esta ubicación PUEDE ceder el producto
    3. Para cada par (sucursal_deficitaria, sucursal_cedente):
        a. Calcular unidades a transferir = min(excedente_cedente, deficit_necesario)
        b. Calcular distancia entre sucursales con Haversine (si hay lat/lon)
        c. Registrar el traslado con su impacto estimado
    4. Retornar lista de traslados priorizados por impacto (unidades × criticidad).

Columnas de entrada necesarias del inventario:
    - nombre_ubicacion  : Nombre de la tienda/bodega/sucursal            [REQUERIDO]
    - id_producto       : Código único del producto (o nombre_producto)   [REQUERIDO]
    - nombre_producto   : Nombre legible del producto                     [REQUERIDO]
    - cantidad_stock    : Unidades actuales en esa ubicación               [REQUERIDO]
    - demanda_diaria    : Demanda promedio diaria del producto             [RECOMENDADO]
    - estado_alerta     : VENCIDO / CRÍTICO / URGENTE / PREVENTIVO / NORMAL [RECOMENDADO]
    - latitud / longitud: Coordenadas para calcular distancia real         [OPCIONAL]

Salida (lista de dicts):
    {
        "producto"     : str,
        "desde"        : str,  # nombre de la sucursal cedente
        "hacia"        : str,  # nombre de la sucursal receptora
        "unidades"     : int,  # unidades a transferir
        "distancia_km" : float | None,
        "impacto"      : float,   # score de prioridad (mayor = más urgente)
        "razon"        : str      # justificación legible para el usuario
    }
"""

import math
from collections import defaultdict

# ─── Umbrales configurables ────────────────────────────────────────────────────
# stock_ratio = cantidad_stock / demanda_mensual
# Si stock_ratio < UMBRAL_DEFICIT  → la sucursal necesita reabastecimiento
# Si stock_ratio > UMBRAL_EXCEDENTE → la sucursal tiene stock para ceder
UMBRAL_DEFICIT    = 0.75  # < 75% de la demanda mensual cubierta → déficit
UMBRAL_EXCEDENTE  = 1.25  # > 125% de la demanda mensual disponible → excedente

# Clasificación por estado cuando no hay demanda_diaria disponible:
# ESTADOS que convierten a una sucursal en RECEPTORA (necesita stock de otro lado)
ESTADOS_RECEPTORES = {"VENCIDO", "CRÍTICO", "URGENTE"}
# ESTADOS que convierten a una sucursal en POSIBLE DONANTE (tiene stock más estable)
ESTADOS_DONANTES   = {"NORMAL", "PREVENTIVO"}

# Criticidad por estado de alerta (factor multiplicativo del impacto)
PESO_ESTADO = {
    "VENCIDO":    3.0,
    "CRÍTICO":    2.5,
    "URGENTE":    2.0,
    "PREVENTIVO": 1.2,
    "NORMAL":     0.5,
}

DIAS_MES = 30  # Factor de conversión demanda_diaria → demanda_mensual



def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calcula la distancia en km entre dos puntos geográficos (fórmula Gran Círculo).
    Retorna 0 si los puntos son idénticos.
    """
    if (lat1, lon1) == (lat2, lon2):
        return 0.0
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _coord_sucursal(items: list[dict]) -> tuple[float | None, float | None]:
    """Extrae la primera coordenada válida de la lista de ítems de una sucursal."""
    for item in items:
        lat = item.get("latitud") or item.get("lat")
        lon = item.get("longitud") or item.get("lon")
        try:
            flat, flon = float(lat), float(lon)
            if flat != 0 and flon != 0:
                return flat, flon
        except (TypeError, ValueError):
            continue
    return None, None


def calcular_redistribucion_optima(inventario: list[dict], max_traslados: int = 8) -> dict:
    """
    Algoritmo principal de redistribución greedy.

    Args:
        inventario   : Lista de ítems de inventario (cada ítem = 1 registro/lote).
        max_traslados: Número máximo de traslados a retornar (para no saturar la UI).

    Returns:
        {
            "traslados"        : [lista de traslados ordenados por impacto],
            "metricas"         : { resumen cuantitativo para la IA },
            "sucursales"       : { nombre → { total_skus, stock_total, criticos } }
        }
    """

    # ── 1. Agrupar inventario por (sucursal, producto) ─────────────────────────
    # Estructura: agrupado[sucursal][id_prod] = { lotes: [...], stock: N, demanda_mensual: M, ... }
    agrupado: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(lambda: {
        "lotes": [], "stock": 0.0, "demanda_mensual": 0.0,
        "nombre_producto": "", "estado_alerta": "NORMAL"
    }))

    resumen_sucursales: dict[str, dict] = defaultdict(lambda: {
        "total_skus": 0, "stock_total": 0.0, "criticos": 0,
        "lat": None, "lon": None, "_items": []
    })

    # Normalizar estado (el dataset puede tener tildes inconsistentes)
    _norm = lambda s: (s or "NORMAL").upper().replace("CRITICO", "CRÍTICO")

    # Función para normalizar nombre de producto: minúsculas, sin tildes, sin espacios extra.
    # Esto permite identificar el mismo producto aunque venga de fuentes distintas con
    # minúsculas/mayúsculas diferentes o tildes inconsistentes.
    _nt = str.maketrans("áéíóúüñÁÉÍÓÚÜÑ", "aeiouunAEIOUUN")
    def _norm_prod(s: str) -> str:
        return s.lower().strip().translate(_nt)

    for item in inventario:
        suc      = (item.get("nombre_ubicacion") or "").strip() or "Sin sucursal"
        nombre_p = str(item.get("nombre_producto") or item.get("id_producto") or "").strip()
        # CLAVE: agrupar por nombre normalizado, no por id_producto
        # id_producto es único por lote → nunca coincidiría entre sucursales
        prod_key = _norm_prod(nombre_p) if nombre_p else ""
        if not prod_key:
            continue

        stock   = float(item.get("cantidad_stock") or 0)
        demanda = float(item.get("demanda_diaria") or 0) * DIAS_MES
        estado  = _norm(item.get("estado_alerta"))

        grp = agrupado[suc][prod_key]
        grp["lotes"].append(item)
        grp["stock"]           += stock
        grp["demanda_mensual"] += demanda
        # Guardar el nombre legible (no normalizado) del primer ítem encontrado
        if not grp["nombre_producto"]:
            grp["nombre_producto"] = nombre_p
        # Si algún lote está en estado crítico, el grupo hereda el más grave
        mejor = PESO_ESTADO.get(grp["estado_alerta"], 0)
        nuevo = PESO_ESTADO.get(estado, 0)
        if nuevo > mejor:
            grp["estado_alerta"] = estado

        # Resumen de sucursal
        rs = resumen_sucursales[suc]
        rs["stock_total"] += stock
        rs["_items"].append(item)
        if estado in ("CRÍTICO", "VENCIDO"):
            rs["criticos"] += 1

    for suc, prods in agrupado.items():
        resumen_sucursales[suc]["total_skus"] = len(prods)
        lat, lon = _coord_sucursal(resumen_sucursales[suc].get("_items", []))
        resumen_sucursales[suc]["lat"] = lat
        resumen_sucursales[suc]["lon"] = lon

    # ── 2. Para cada producto (clave normalizada), clasificar como déficit o excedente ──
    # candidatos_deficit[prod_key]   = [(sucursal, unidades_necesarias, peso_estado, nombre), ...]
    # candidatos_excedente[prod_key] = [(sucursal, unidades_disponibles, nombre), ...]
    candidatos_deficit:   dict[str, list] = defaultdict(list)
    candidatos_excedente: dict[str, list] = defaultdict(list)

    for suc, prods in agrupado.items():
        for prod_key, grp in prods.items():
            stock    = grp["stock"]
            demanda  = grp["demanda_mensual"]  # puede ser 0 si demanda_diaria no está en el dataset
            estado   = grp["estado_alerta"]
            peso     = PESO_ESTADO.get(estado, 1.0)

            if demanda > 0:
                # ─ Método primario: ratio stock / demanda mensual ─
                ratio = stock / demanda
                es_deficit   = ratio < UMBRAL_DEFICIT
                es_excedente = ratio > UMBRAL_EXCEDENTE
            else:
                # ─ Método alternativo: clasificar por estado de alerta ─
                # Cuando no hay dato de demanda, el estado del lote indica la situación real.
                # VENCIDO/CRÍTICO/URGENTE → receptor (necesita mercadería saliente)
                # NORMAL/PREVENTIVO       → donante (tiene stock más estable)
                es_deficit   = estado in ESTADOS_RECEPTORES
                es_excedente = estado in ESTADOS_DONANTES and stock > 0

            if es_deficit:
                # Unidades necesarias: si hay demanda, calcular cobertura; si no, usar el stock actual como proxy
                if demanda > 0:
                    unidades_necesarias = max(1, round(demanda - stock))
                else:
                    # Sin demanda conocida, sugerir transferir un porcentaje razónable del stock
                    unidades_necesarias = max(1, round(stock * 0.3)) if stock > 0 else 10
                candidatos_deficit[prod_key].append((suc, unidades_necesarias, peso, grp["nombre_producto"]))

            elif es_excedente:
                # Unidades cedibles: si hay demanda, lo que sobra del mínimo operativo
                if demanda > 0:
                    unidades_cedibles = round(stock - demanda * UMBRAL_DEFICIT)
                else:
                    # Sin demanda conocida, ofrecer el 40% del stock como cedible
                    unidades_cedibles = round(stock * 0.4)
                if unidades_cedibles > 0:
                    candidatos_excedente[prod_key].append((suc, unidades_cedibles, grp["nombre_producto"]))

    # ── 3. Matching greedy: conectar déficits con excedentes ──────────────────
    traslados = []

    for prod_key, deficits in candidatos_deficit.items():
        excedentes = candidatos_excedente.get(prod_key, [])
        if not excedentes:
            continue

        # Ordenar déficits por urgencia (mayor peso primero)
        deficits_ord   = sorted(deficits,   key=lambda x: x[2], reverse=True)
        excedentes_ord = sorted(excedentes, key=lambda x: x[1], reverse=True)  # más excedente primero

        for (suc_dest, uds_nec, peso, nombre_prod) in deficits_ord:
            for (suc_orig, uds_disp, _) in excedentes_ord:
                if suc_orig == suc_dest:
                    continue  # Mismo lugar, no tiene sentido

                uds_transferir = min(uds_nec, uds_disp)
                if uds_transferir <= 0:
                    continue

                # Calcular distancia (None si no hay coords)
                lat_o = resumen_sucursales[suc_orig]["lat"]
                lon_o = resumen_sucursales[suc_orig]["lon"]
                lat_d = resumen_sucursales[suc_dest]["lat"]
                lon_d = resumen_sucursales[suc_dest]["lon"]

                distancia_km = None
                if all(v is not None for v in [lat_o, lon_o, lat_d, lon_d]):
                    distancia_km = round(_haversine_km(lat_o, lon_o, lat_d, lon_d), 1)

                # Score de impacto: unidades × peso de urgencia (distancia penaliza levemente si hay)
                dist_factor = 1.0 / (1.0 + (distancia_km or 0) / 100)  # normalizar distancia
                impacto = uds_transferir * peso * dist_factor

                # Razón legible para el usuario
                if peso >= PESO_ESTADO["CRÍTICO"]:
                    razon = f"Estado {resumen_sucursales[suc_dest].get('estado_alerta','CRÍTICO').lower()} en destino — traslado urgente"
                elif peso >= PESO_ESTADO["URGENTE"]:
                    razon = f"Riesgo de quiebre próximo en {suc_dest}"
                else:
                    razon = f"Balanceo preventivo de stock entre sucursales"

                traslados.append({
                    "producto"    : nombre_prod,
                    "desde"       : suc_orig,
                    "hacia"       : suc_dest,
                    "unidades"    : int(uds_transferir),
                    "distancia_km": distancia_km,
                    "impacto"     : round(impacto, 2),
                    "razon"       : razon,
                    "estado_dest" : resumen_sucursales[suc_dest].get("estado_alerta", "NORMAL"),
                })
                break  # Un excedente por déficit en la primera coincidencia (greedy)

    # ── 4. Ordenar por impacto descendente y limitar ───────────────────────────
    traslados.sort(key=lambda x: x["impacto"], reverse=True)
    traslados = traslados[:max_traslados]

    # ── 5. Métricas de resumen para la IA ─────────────────────────────────────
    total_sucursales  = len(agrupado)
    total_criticos    = sum(rs["criticos"] for rs in resumen_sucursales.values())
    total_stock       = sum(rs["stock_total"] for rs in resumen_sucursales.values())
    sucursales_con_excedente = len({t["desde"] for t in traslados})
    sucursales_con_deficit   = len({t["hacia"] for t in traslados})
    unidades_a_mover         = sum(t["unidades"] for t in traslados)

    metricas = {
        "total_sucursales"          : total_sucursales,
        "total_sku_en_riesgo"       : total_criticos,   # número de SKUs/lotes en estado crítico
        "total_stock_red"           : round(total_stock),  # unidades totales en la red
        "traslados_sugeridos"       : len(traslados),
        "sucursales_con_excedente"  : sucursales_con_excedente,
        "sucursales_con_deficit"    : sucursales_con_deficit,
        "unidades_totales_a_mover"  : unidades_a_mover,
        "hay_traslados_posibles"    : len(traslados) > 0,
        "sucursales_nombres"        : list(resumen_sucursales.keys()),
    }

    # Limpiar campo interno antes de retornar
    for rs in resumen_sucursales.values():
        rs.pop("_items", None)

    return {
        "traslados" : traslados,
        "metricas"  : metricas,
        "sucursales": dict(resumen_sucursales),
    }
