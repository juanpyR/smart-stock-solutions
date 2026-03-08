import os
import json
import httpx
import logging
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
from .product_wiki import PRODUCT_WIKI, obtener_info_experta
from .pack_wiki import sugerir_pack
RUTA_CACHE_MAPEO = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "mapeos_cache.json")
RUTA_CACHE_CATEGORIAS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "categorias_cache.json")

# Esquema estándar en ESPAÑOL
COLUMNAS_SISTEMA = {
    "esenciales": [
        "id_unico", "id_producto", "nombre_producto", "cantidad_stock", 
        "fecha_vencimiento", "precio_unitario", "costo_unitario", 
        "demanda_diaria", "nombre_ubicacion"
    ],
    "opcionales": [
        "categoria", "punto_reorden", "tiempo_entrega", "elasticidad", 
        "latitud", "longitud", "fecha_datos", "proveedor"
    ]
}

def cargar_cache_mapeo() -> dict:
    if os.path.exists(RUTA_CACHE_MAPEO):
        try:
            with open(RUTA_CACHE_MAPEO, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logging.error(f"Error cargando cache de mapeo: {e}")
    return {}

def guardar_cache_mapeo(cache: dict):
    try:
        os.makedirs(os.path.dirname(RUTA_CACHE_MAPEO), exist_ok=True)
        with open(RUTA_CACHE_MAPEO, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logging.error(f"Error guardando cache de mapeo: {e}")

def cargar_cache_categorias() -> dict:
    if os.path.exists(RUTA_CACHE_CATEGORIAS):
        try:
            with open(RUTA_CACHE_CATEGORIAS, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logging.error(f"Error cargando cache de categorias: {e}")
    return {}

def guardar_cache_categorias(cache: dict):
    try:
        os.makedirs(os.path.dirname(RUTA_CACHE_CATEGORIAS), exist_ok=True)
        with open(RUTA_CACHE_CATEGORIAS, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logging.error(f"Error guardando cache de categorias: {e}")

async def mapear_columnas_con_ia(columnas_archivo: list[str]) -> dict:
    """
    Usa la IA de Groq para mapear nombres de columnas al estándar en español.
    """
    cache = cargar_cache_mapeo()
    mapeo_resultado = {}
    columnas_desconocidas = []

    todas_estandar = COLUMNAS_SISTEMA["esenciales"] + COLUMNAS_SISTEMA["opcionales"]

    import re
    def normalizar(s: str) -> str:
        if not s: return ""
        s = str(s).lower().strip()
        s = s.replace("á","a").replace("é","e").replace("í","i").replace("ó","o").replace("ú","u").replace("ñ","n")
        return re.sub(r'[^a-z0-9]', '', s)

    for col_original in columnas_archivo:
        col_limpia = normalizar(col_original)
        if col_limpia in cache:
            std_name = cache[col_limpia]
            if std_name in todas_estandar:
                mapeo_resultado[std_name] = col_original
                continue
        
        encontrada = False
        for std in todas_estandar:
            if col_limpia == normalizar(std):
                mapeo_resultado[std] = col_original
                cache[col_limpia] = std
                encontrada = True
                break
        
        if not encontrada:
            columnas_desconocidas.append(col_original)

    if not columnas_desconocidas:
        guardar_cache_mapeo(cache)
        return mapeo_resultado

    prompt = f"""
    Eres un experto en ingeniería de datos y auditoría de inventarios. Tu misión es mapear columnas de archivos CSV (podrían estar en INGLÉS o ESPAÑOL) al esquema estándar siempre en ESPAÑOL.

    Columnas del CSV: {columnas_desconocidas}
    Esquema Estándar (Destino): {todas_estandar}

    REGLAS DE ORO:
    0. TRADUCCIÓN AUTOMÁTICA: Si una columna está en inglés (ej. 'Inventory Level', 'Units Sold', 'Price', 'Demand Forecast', 'Store ID'), tradúcela conceptualmente y mápeala al esquema destino en español que mejor le corresponda.
    1. 'fecha_vencimiento' (Vencimiento): Busca 'Fecha_Vencimiento', 'Caducidad', 'Vence', 'Expiration Date', 'Expiry'. PROHIBIDO mapear a 'Fecha_Movimiento' o 'Fecha_Carga'.
    2. 'cantidad_stock' (Stock): Busca 'Saldo', 'Existencias', 'Stock_Teorico', 'Unidades', 'Inventory Level', 'Stock', 'Qty'. PROHIBIDO mapear a 'Cantidad_Salida' o 'Ventas'.
    3. 'nombre_ubicacion' (Sucursal): Busca 'Sucursal', 'Tienda', 'Bodega', 'Local', 'Store ID', 'Warehouse', 'Location'.
    4. 'precio_unitario' (Precio): Busca 'Precio', 'Price', 'Unit Price', 'Retail Price'.
    5. 'demanda_diaria' (Demanda/Ventas): Busca 'Units Sold', 'Sales', 'Demand Forecast', 'Demanda'.
    6. 'fecha_datos' (Snapshot): Aquí mapée la 'Fecha_Movimiento', 'Fecha_Carga', 'Date' si existe.
    7. 'id_unico': Identificador del lote o registro.
    8. 'id_producto': SKU o código del producto, 'Product ID'.
    9. 'proveedor': Nombre de la empresa que suministra el producto. Busca 'Fabricante', 'Distribuidor', 'Vendor', 'Source', 'Supplier'.

    EJEMPLO:
    Si hay [Date, Expiration_Date, Inventory Level, Price], el mapeo es:
    - fecha_vencimiento -> Expiration_Date
    - cantidad_stock -> Inventory Level
    - precio_unitario -> Price
    - fecha_datos -> Date

    Devuelve SOLO un JSON puro. Sin explicaciones.
    """

    if not GROQ_API_KEY:
        return mapeo_resultado

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": "Responder solo con JSON puro en español. Máxima precisión."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0,
                    "response_format": {"type": "json_object"}
                },
                timeout=15.0
            )
            data = response.json()
            ia_mapeo = json.loads(data['choices'][0]['message']['content'])
            
            for k, v in ia_mapeo.items():
                if k in todas_estandar:
                    mapeo_resultado[k] = v
                    cache[normalizar(v)] = k
            
            guardar_cache_mapeo(cache)
    except Exception as e:
        logging.error(f"Error Groq: {e}")

    return mapeo_resultado

async def generar_recomendaciones_ia(
    productos: list, 
    analisis_sensibilidad: dict = None, 
    plan_accion_crisis: dict = None,
    todos_los_productos: list = None
) -> list:
    """
    Genera recomendaciones estratégicas con contexto completo (HU-04/HU-08/HU-AUDITORIA).
    """
async def generar_recomendaciones_ia(
    productos: list, 
    analisis_sensibilidad: dict = None, 
    plan_accion_crisis: dict = None,
    todos_los_productos: list = None
) -> list:
    """
    Genera recomendaciones estratégicas con contexto completo (HU-04/HU-08/HU-AUDITORIA).
    """
    def obtener_heuristicas():
        rec_heuristics = []
        # 0. Auditoría de Cobertura (Siempre se puede calcular)
        todos = todos_los_productos or productos
        total_ds = len(todos)
        items_vis = [p for p in todos if (p.get("cantidad_stock") or 0) > 0 and p.get("estado_alerta") in ["VENCIDO", "CRÍTICO", "URGENTE", "PREVENTIVO", "SALUDABLE"]]
        cant_vis = len(items_vis)
        dif = total_ds - cant_vis
        
        if total_ds > 0:
            rec_heuristics.append({
                "accion": "[SISTEMA] Auditoría de Cobertura de Inventario",
                "descripcion": f"Se identificó un total de {total_ds} productos registrados en el dataset maestro. Sin embargo, en el tablero de gestión de riesgos solo figuran {cant_vis} unidades. La diferencia de {dif} productos corresponde a ítems que actualmente no tienen stock físico disponible o se encuentran en el proceso de 'REORDEN', por lo que no representan un riesgo de pérdida física por expiración inmediata.",
                "por_que": "Asegura la precisión operativa al separar activos tangibles de registros de reabastecimiento.",
                "impacto": "Alto"
            })

        def fmt_lista(prods, limit=5):
            top = sorted(prods, key=lambda x: x.get('valor_stock', 0), reverse=True)[:limit]
            return ", ".join([p.get('nombre_producto', 'Desconocido') for p in top])

        # 1. VENCIDOS
        vencidos = [p for p in productos if p.get('estado_alerta') == 'VENCIDO']
        if vencidos:
            rec_heuristics.append({
                "accion": f"[VENCIDO] Plan de Saneamiento y Depuración",
                "descripcion": f"1. Segregar físicamente los {len(vencidos)} lotes vencidos. 2. Procesar como merma operativa para beneficio tributario. 3. Limpiar el inventario para liberar espacio en góndola.",
                "por_que": "Evitar multas sanitarias y optimizar el espacio de almacenamiento para productos de alta rotación.",
                "impacto": "Alto"
            })

        # 2. CRÍTICOS
        criticos = [p for p in productos if p.get('estado_alerta') == 'CRÍTICO']
        if criticos:
            rec_heuristics.append({
                "accion": f"[CRÍTICO] Rescate Financiero vía Donación",
                "descripcion": f"1. Identificar ítems de alto valor como {fmt_lista(criticos)}. 2. Coordinar entrega con banco de alimentos aliado. 3. Obtener certificado de donación para deducir el 100% del costo.",
                "por_que": "La venta comercial ya no es viable dado el corto horizonte de vencimiento. La donación rescata el capital vía impuestos.",
                "impacto": "Alto"
            })
        return rec_heuristics

    # ── HEURÍSTICA DE RESPALDO (SI NO HAY API KEY) ───────────────────────────
    if not GROQ_API_KEY:
        return obtener_heuristicas()

    # ── GENERACIÓN CON IA (GROQ) ─────────────────────────────────────────────
    todos = todos_los_productos or productos
    total_dataset = len(todos)
    items_visibles = [p for p in todos if (p.get("cantidad_stock") or 0) > 0 and p.get("estado_alerta") in ["VENCIDO", "CRÍTICO", "URGENTE", "PREVENTIVO", "SALUDABLE"]]
    cant_dashboard = len(items_visibles)
    diferencia_audit = total_dataset - cant_dashboard

    prompt = f"""
    Actúa como un Asistente Senior de Retail y Finanzas. Genera un reporte JSON estratégico para el dueño del negocio.

    AUDITORÍA DE INTEGRIDAD DE DATOS (MANDATORIA):
    - Total en Dataset Maestro: {total_dataset} productos.
    - Visibles en Dashboard: {cant_dashboard} productos (estos tienen stock > 0).
    - Diferencia de Auditoría: {diferencia_audit} productos (en REORDEN o sin stock).

    INSTRUCCIONES DE SALIDA (ESTRUCTURA JSON):
    Debes devolver un objeto JSON con la clave raíz "recomendaciones" que contenga una lista de objetos.
    
    1. La primera recomendación DEBE ser con el título "[SISTEMA] Auditoría de Cobertura". Explica claramente que de los {total_dataset} productos totales, solo {cant_dashboard} están bajo análisis de riesgo activo porque tienen existencias físicas. Los {diferencia_audit} restantes no aparecen porque están agotados o en reorden.
    
    2. Crea tarjetas tácticas para VENCIDO, CRÍTICO y URGENTE considerando estos datos:
       - Título: [ESTADO] Nombre de la Acción
       - Descripción: Pasos numerados (1, 2, 3) claros y directos.
       - Por qué: Rationale financiero (flujo de caja, beneficios fiscales, ROI).
       - Impacto: Alto, Medio o Bajo.

    DATOS DEL INVENTARIO:
    Top Riesgo: {json.dumps(productos[:20], ensure_ascii=False)}
    Sensibilidad: {json.dumps(analisis_sensibilidad, ensure_ascii=False)}

    Instrucción: Usa lenguaje de "Dueño de Negocio". Sé directo, sin rodeos ni saludos.
    """

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": "Analista Senior de Retail. Solo respondes JSON puro con la clave 'recomendaciones'."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.2,
                    "response_format": {"type": "json_object"},
                },
                timeout=35.0
            )
            response.raise_for_status()
            data = response.json()
            respuesta = json.loads(data['choices'][0]['message']['content'])
            return respuesta.get("recomendaciones", []) or obtener_heuristicas()
    except Exception as e:
        logging.error(f"❌ Error Groq: {e}")
        return obtener_heuristicas()

async def predecir_demanda_ia(historico_ventas: list, nombre_producto: str) -> dict:
    """
    HU-02: Predicción de Demanda con IA.
    Usa Groq como 'cerebro' estratégico y datos históricos para proyectar.
    Implementa un fallback de regresión simple si no hay suficientes datos para el LLM.
    """
    if not historico_ventas:
        return {"proyeccion": 0, "confianza": "baja", "razon": "Sin historial"}

    if not GROQ_API_KEY:
        # Fallback simple: Promedio móvil
        avg = sum(v.get('unidades', 0) for v in historico_ventas) / len(historico_ventas)
        return {"proyeccion": round(avg, 2), "confianza": "media (manual)", "razon": "Uso de promedio histórico"}

    prompt = f"""
    Eres un experto en Data Science para Retail. Analiza el historial de ventas del producto '{nombre_producto}':
    {json.dumps(historico_ventas, ensure_ascii=False)}

    Misión:
    1. Predice la demanda para el próximo mes (30 días).
    2. Identifica si hay estacionalidad.
    3. Sugiere la cantidad óptima de compra (Stock de Seguridad).

    Devuelve SOLO un JSON con:
    {{
      "proyeccion_mensual": 150.5,
      "confianza": "Alta/Media/Baja",
      "estacionalidad": "Descripción corta",
      "recomendacion_compra": 180,
      "razonamiento": "Explicación técnica breve"
    }}
    """

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                json={
                    "model": "llama-3.1-8b-instant", # Modelo más rápido para tareas analíticas
                    "messages": [
                        {"role": "system", "content": "Responder solo con JSON puro."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.1,
                    "response_format": {"type": "json_object"},
                },
                timeout=10.0
            )
            data = response.json()
            return json.loads(data['choices'][0]['message']['content'])
    except Exception as e:
        logging.error(f"Error en predicción Groq: {e}")
        # Fallback de emergencia
        return {"proyeccion_mensual": 0, "error": str(e)}

async def generar_insight_demanda_agregada(contexto: dict) -> str:
    if not GROQ_API_KEY:
        return f"⚠️ **ASISTENTE EN MODO SIMULACIÓN:** No se detectó una llave de acceso en el archivo `.env`. \n\nEste es un resumen local heurístico: El modelo de {contexto.get('algoritmo_ganador', 'Machine Learning')} opera con {contexto.get('precision_algoritmo', 0)}% de precisión. La proyección de {contexto.get('demanda_total')} unidades (${contexto.get('valor_total_estimado'):,.0f} CLP) sobre un stock actual de {contexto.get('total_inventario_general')} unidades sugiere una salud del {contexto.get('salud_stock')}%. Se detectan {contexto.get('alertas_quiebre_count', 0)} quiebres inminentes."

    prompt = f"""
    Eres un estratega senior de Cadena de Suministro (Supply Chain Architect). Tu audiencia es un CEO/Dueño de Negocio que necesita decisiones, no resúmenes obvios.
    
    CONTEXTO OPERACIONAL CRUCIAL:
    - Motor de Inteligencia: {contexto.get('algoritmo_ganador')} con {contexto.get('precision_algoritmo')}% de precision.
    - OLA DE CONSUMO (Demanda Mensual): {contexto.get('demanda_total')} unidades proyectadas (${contexto.get('valor_total_estimado'):,.0f} CLP en valor retail).
    - ESTADO DEL CAPITAL (Salud de Stock): {contexto.get('salud_stock')}% optimo. Inventario fisico actual: {contexto.get('total_inventario_general'):,.0f} unidades.
    - PRODUCTOS VOLUMÉTRICOS (Top Movers): {', '.join(contexto.get('top_productos', []))}
    - RIESGO DE FUGAS (Quiebres Inminentes): {contexto.get('alertas_quiebre_count')} productos detectados (ej. {', '.join(contexto.get('productos_quiebre_nombres', []))}).

    TU MISIÓN (Análisis Quirúrgico):
    Genera un informe estratégico estructurado en Markdown (con negritas y emojis) que:
    1. **Diagnóstico de Eficiencia**: ¿Qué tan confiable es la predicción actual? Menciona el algoritmo y la precisión como un respaldo técnico.
    2. **Análisis de Liquidez vs Demanda**: Compara la "Ola de Consumo" (${contexto.get('valor_total_estimado'):,.0f} CLP) contra el capital inmovilizado en bodega ({contexto.get('total_inventario_general')} unidades). ¿Estamos sobre-estoqueados o operando con 'leanness' peligrosa?
    3. **Impacto en el Top-Line**: Explica cómo los "Top Movers" ({contexto.get('top_productos', [])[:3]}) están traccionando la venta y qué pasa si fallamos en su disponibilidad.
    4. **Plan de Mitigación Quirúrgica**: Para los {contexto.get('alertas_quiebre_count')} quiebres detectados, propón una acción ejecutiva inmediata (ej. Reabastecimiento aéreo, cross-docking o cambio de proveedor).
    5. **Gestión Ética y Segura de Desperdicios**: Basándote en los Protocolos de Seguridad Alimentaria, ¿hay riesgos críticos de salud en los lotes próximos a vencer? Advierte sobre eliminaciones mandatorias si hay peligro.
    6. **Conclusión 'Bottom Line'**: Una sola frase final lapidaria sobre el riesgo financiero si no se actúa hoy.

    ESTILO: Corporativo, directo, sin introducciones vacías como "aquí tienes tu análisis". Usa Markdown para jerarquizar la información. Máximo 180 palabras.
    """

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": "Eres un Consultor Senior de Deloitte/McKinsey experto en logística. Tu lenguaje es técnico-gerencial. Evitas lo evidente. Entregas insight puro en Markdown."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.3,
                },
                timeout=15.0
            )
            data = response.json()
            return data['choices'][0]['message']['content'].strip()
    except Exception as e:
        logging.error(f"Error en insight general Groq: {e}")
        return f"Asistente Predictivo: El modelo funciona con {contexto.get('precision_algoritmo', 0)}% de precisión, basado fundamentalmente en {len(contexto.get('top_productos', []))} productos con mayor rotación."

async def categorizar_productos_ia(nombres_productos: list[str]) -> dict:
    """
    Usa la IA de Groq para categorizar una lista de nombres de productos.
    Devuelve un diccionario {nombre_producto: categoria}.
    """
    if not nombres_productos or not GROQ_API_KEY:
        return {}

    cache = cargar_cache_categorias()
    resultado = {}
    faltantes = []

    for nombre in nombres_productos:
        if not nombre: continue
        if nombre in cache:
            resultado[nombre] = cache[nombre]
        else:
            faltantes.append(nombre)

    if not faltantes:
        return resultado

    # Procesar por lotes de 50 para no exceder límites de tokens/contexto
    for i in range(0, len(faltantes), 50):
        lote = faltantes[i:i+50]
        prompt = f"""
        Como experto en categorización de retail, asigna la categoría industrial más adecuada a cada uno de estos productos.
        Responde SOLO con un objeto JSON donde las llaves sean los nombres de los productos y los valores sean la categoría técnica (ej: Lácteos, Limpieza, Carnes, Abarrotes, Higiene, etc.).
        
        Productos: {lote}
        """

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                    json={
                        "model": "llama-3.1-8b-instant", # Modelo rápido y eficiente para esto
                        "messages": [
                            {"role": "system", "content": "Responder solo con JSON puro. Sé preciso y conciso con las categorías."},
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": 0,
                        "response_format": {"type": "json_object"}
                    },
                    timeout=20.0
                )
                data = response.json()
                if 'choices' in data:
                    lote_categorizado = json.loads(data['choices'][0]['message']['content'])
                    for k, v in lote_categorizado.items():
                        resultado[k] = v
                        cache[k] = v
        except Exception as e:
            logging.error(f"Error categorizando con IA: {e}")

    guardar_cache_categorias(cache)
    return resultado

async def get_llm_response(prompt: str, max_tokens: int = 150) -> str:
    """
    Función genérica para obtener respuesta del LLM.
    """
    if not GROQ_API_KEY:
        return "Respondiendo en base a reglas locales por falta de API Key."

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                json={
                    "model": "llama-3.1-8b-instant",
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.3,
                    "max_tokens": max_tokens
                },
                timeout=15.0
            )
            data = response.json()
            return data['choices'][0]['message']['content'].strip()
    except Exception as e:
        logging.error(f"Error en get_llm_response: {e}")
        return "No se pudo generar el análisis automático en este momento."


async def interpretar_redistribucion_ia(resultado_algoritmo: dict) -> str:
    """
    Recibe la salida del algoritmo greedy de redistribución (optimization.py)
    y genera una interpretación estratégica legible para el usuario final.

    El algoritmo ya hizo el cálculo numérico. La IA NO recalcula ni inventa números:
    solo interpreta los traslados y métricas que el algoritmo entregó y redacta
    el plan de acción en lenguaje de negocio.

    Args:
        resultado_algoritmo: dict con keys "traslados", "metricas", "sucursales"

    Returns:
        str con el análisis en Markdown, o un fallback heurístico si no hay API key.
    """
    traslados = resultado_algoritmo.get("traslados", [])
    metricas  = resultado_algoritmo.get("metricas", {})

    # ── Fallback sin API Key ───────────────────────────────────────────────────
    if not GROQ_API_KEY:
        if not traslados:
            return (
                "**Sin transferencias disponibles:** Todas las sucursales presentan niveles de stock similares "
                "o insuficientes para redistribuir. Se recomienda orden de reposición desde proveedor."
            )
    # Fallback sin API Key: resumen estratégico (no lista de traslados)
        total_uds   = metricas.get('unidades_totales_a_mover', 0)
        n_cedentes  = metricas.get('sucursales_con_excedente', 0)
        n_receptoras= metricas.get('sucursales_con_deficit', 0)
        n_riesgo    = metricas.get('total_sku_en_riesgo', 0)
        n_traslados = len(traslados)
        return (
            f"**Diagnóstico de red:** {metricas.get('total_sucursales', 0)} sucursales analizadas. "
            f"{n_riesgo} lotes en estado crítico o vencido requieren acción.\n\n"
            f"**Prioridad inmediata:** Ejecutar los {n_traslados} traslados identificados — "
            f"{total_uds} unidades desde {n_cedentes} sucursales cedentes hacia {n_receptoras} receptoras.\n\n"
            f"**Impacto esperado:** Reducción del riesgo de quiebre sin nuevas compras. "
            f"Los traslados priorizados cubren los lotes de mayor urgencia primero.\n\n"
            f"**Advertencia:** La redistribución interna no reemplaza la reposicón desde proveedor "
            f"si el stock global de la red es insuficiente."
        )

    # ── Prompt para la IA ──────────────────────────────────────────────────────
    # Los traslados YA son visibles en las tarjetas de la UI. La IA NO debe repetirlos.
    # Su rol: dar el análisis estratégico de fondo.
    metricas_str  = json.dumps(metricas, ensure_ascii=False)
    # Pasamos solo métricas agregadas y los productos involucrados (sin detalles por tarjeta)
    productos_involucrados = list({t['producto'] for t in traslados})

    prompt = f"""
    Eres un Director de Operaciones de Retail. El sistema ya calculó los traslados de stock óptimos
    y los está mostrando en tarjetas visuales—el usuario ya los ve.

    ⚠️ NO repitas ni enumeres los traslados. Eso ya aparece arriba en la pantalla.
    Tu misión: dar el ANÁLISIS ESTRATÉGICO que las tarjetas no explican.

    ═══ MÉTRICAS DE LA RED ═══
    {metricas_str}
    Productos redistribuidos: {productos_involucrados}
    ══════════════════════════

    RESPONDE con esta estructura exacta (total máximo 130 palabras):

    **Diagnóstico de red:** [1-2 oraciones sobre el estado general: qué porcentaje de la red está en riesgo y por qué ocurre]

    **Prioridad operativa:** [1 oración sobre qué ejecutar primero y por qué ese producto/ruta tiene mayor impacto]

    **Impacto esperado:** [1-2 oraciones sobre qué riesgo se mitiga con estos traslados sin comprar nueva mercadería]

    **Límite del plan:** [1 oración honesta sobre qué NO resuelve esta redistribución y cuándo se necesita reposición]

    REGLAS ABSOLUTAS:
    - Cero menciones de traslados individuales o rutas específicas (eso ya está en las tarjetas).
    - Usa datos agregados de las métricas.
    - Solo Markdown con negritas en encabezados.
    """

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": "Eres un Director de Operaciones. Análisis estratégico breve. NUNCA enumeres traslados individuales —eso ya se muestra en tarjetas. Solo Markdown negritas."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.3,
                },
                timeout=18.0
            )
            data = response.json()
            return data['choices'][0]['message']['content'].strip()
    except Exception as e:
        logging.error(f"Error en interpretar_redistribucion_ia: {e}")
        if not traslados:
            return "Sin transferencias posibles con el stock actual. Se recomienda reposición desde proveedor."
        total_uds = metricas.get('unidades_totales_a_mover', 0)
        return (
            f"**Diagnóstico de red:** {metricas.get('total_sucursales', 0)} sucursales analizadas, "
            f"{metricas.get('total_sku_en_riesgo', 0)} lotes en estado crítico.\n\n"
            f"**Prioridad:** Ejecutar los {len(traslados)} traslados para mover {total_uds} unidades."
            f" Comenzar por los de mayor distancia corta (menor costo logístico).\n\n"
            f"**Impacto:** Reducción del riesgo de quiebre sin nuevas compras.\n\n"
            f"**Límite:** Esta redistribución no cubre productosausentes de la red "
            f"— esos requieren reposición desde proveedor."
        )

